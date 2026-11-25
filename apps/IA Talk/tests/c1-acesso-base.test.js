'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const cifra = require('../backend/seguranca/cifra');
const telefone = require('../backend/seguranca/telefone');
const sessoes = require('../backend/acesso/sessoes');
const { abrirBanco } = require('../backend/database');

cifra.definirChaveParaTeste(crypto.randomBytes(32));

function banco() {
  const db = abrirBanco({ arquivo: ':memory:' });
  const t = new Date().toISOString();
  db.prepare("INSERT INTO empresas (id, nome, apelido, criado_em, atualizado_em) VALUES ('emp_a', 'A', 'a-1', ?, ?)").run(t, t);
  db.prepare("INSERT INTO empresas (id, nome, apelido, criado_em, atualizado_em) VALUES ('emp_b', 'B', 'b-1', ?, ?)").run(t, t);
  db.prepare("INSERT INTO usuarios (id, nome, telefone, criado_em, atualizado_em) VALUES ('usr_1', 'Ana', '5565999990001', ?, ?)").run(t, t);
  db.prepare("INSERT INTO membros (id, empresa_id, usuario_id, papel, criado_em, atualizado_em) VALUES ('mbr_1', 'emp_a', 'usr_1', 'supervisor', ?, ?)").run(t, t);
  return db;
}

test('cifra: ida e volta, envelope versionado e adulteração recusada', () => {
  const env = cifra.cifrar('senha-de-teste');
  assert.match(env, /^v1:/);
  assert.notEqual(cifra.cifrar('senha-de-teste'), env, 'IV aleatório');
  assert.equal(cifra.decifrar(env), 'senha-de-teste');
  const partes = env.split(':');
  partes[3] = Buffer.from('outra coisa').toString('base64');
  assert.throws(() => cifra.decifrar(partes.join(':')));
  assert.equal(cifra.cifrar(''), null);
  assert.equal(cifra.decifrar(null), null);
});

test('cifra: hash com finalidade separada e comparação em tempo constante', () => {
  assert.equal(cifra.hashSecreto('abc', 'sessao'), cifra.hashSecreto('abc', 'sessao'));
  assert.notEqual(cifra.hashSecreto('abc', 'sessao'), cifra.hashSecreto('abc', 'token'));
  assert.equal(cifra.iguaisTempoConstante('x1', 'x1'), true);
  assert.equal(cifra.iguaisTempoConstante('x1', 'x12'), false);
  assert.equal(cifra.iguaisTempoConstante('', ''), false);
});

test('cifra: chave mestra gerada uma vez em arquivo, ou do ambiente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-chave-'));
  try {
    const arquivo = path.join(dir, '.chave-mestra');
    const a = cifra.carregarChave({ env: {}, arquivo });
    assert.equal(a.length, 32);
    assert.deepEqual(cifra.carregarChave({ env: {}, arquivo }), a);
    const doEnv = crypto.randomBytes(32).toString('base64');
    assert.deepEqual(cifra.carregarChave({ env: { IA_TALK_CHAVE_MESTRA: doEnv }, arquivo }), Buffer.from(doEnv, 'base64'));
    assert.throws(() => cifra.carregarChave({ env: { IA_TALK_CHAVE_MESTRA: 'curta' }, arquivo }), /32 bytes/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('telefone: normaliza, valida, nono dígito e máscara', () => {
  assert.equal(telefone.normalizar('+55 (65) 99999-0001'), '5565999990001');
  assert.equal(telefone.valido('65 99999-0001'), false, 'sem DDI');
  assert.deepEqual(telefone.variantesBrasil('5565999990001').sort(), ['556599990001', '5565999990001']);
  assert.equal(telefone.mascarar('5565999990001'), '+55 65 9••••-0001');
  assert.equal(telefone.mascararEmail('ana@exemplo.com.br'), 'a••@exemplo.com.br');
});

test('sessão: só o hash no banco; válida com vínculo ativo; renova a validade', () => {
  const db = banco();
  const token = sessoes.criar(db, { usuarioId: 'usr_1', empresaId: 'emp_a', origem: 'telefone' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessoes WHERE token_hash = ?').get(token).n, 0, 'token puro nunca é gravado');
  const s = sessoes.validar(db, token);
  assert.equal(s.empresa_id, 'emp_a');
  assert.equal(s.papel, 'supervisor');
  const ctx = sessoes.contextoDaSessao(s);
  assert.equal(ctx.empresaId, 'emp_a');
  assert.equal(ctx.plataforma, false);
  assert.equal(sessoes.validar(db, 'token-inventado'), null);
  assert.equal(sessoes.validar(db, ''), null);
});

test('sessão: vence por inatividade e pelo teto semanal', () => {
  const db = banco();
  const token = sessoes.criar(db, { usuarioId: 'usr_1', empresaId: 'emp_a', origem: 'telefone' });
  const agora = Date.now();
  assert.ok(sessoes.validar(db, token, { agoraMs: agora + sessoes.INATIVIDADE_MS - 60_000 }), 'usado antes de vencer');
  assert.equal(sessoes.validar(db, token, { agoraMs: agora + 2 * sessoes.INATIVIDADE_MS + 120_000 }), null, '8 h sem uso');
  const t2 = sessoes.criar(db, { usuarioId: 'usr_1', empresaId: 'emp_a', origem: 'telefone' });
  let instante = agora;
  for (let i = 0; i < 25; i++) { instante += 7 * 60 * 60 * 1000; sessoes.validar(db, t2, { agoraMs: instante }); }
  assert.equal(sessoes.validar(db, t2, { agoraMs: agora + sessoes.TETO_MS + 1000 }), null, 'teto de 7 dias mesmo em uso');
});

test('sessão: cai ao revogar, ao inativar usuário, empresa ou vínculo', () => {
  const db = banco();
  const token = () => sessoes.criar(db, { usuarioId: 'usr_1', empresaId: 'emp_a', origem: 'telefone' });
  const t1 = token();
  sessoes.revogar(db, sessoes.validar(db, t1).id);
  assert.equal(sessoes.validar(db, t1), null, 'Sair');

  const t2 = token();
  db.prepare("UPDATE membros SET situacao = 'inativo' WHERE id = 'mbr_1'").run();
  assert.equal(sessoes.validar(db, t2), null, 'vínculo inativo');
  db.prepare("UPDATE membros SET situacao = 'ativo' WHERE id = 'mbr_1'").run();

  const t3 = token();
  db.prepare("UPDATE empresas SET situacao = 'inativa' WHERE id = 'emp_a'").run();
  assert.equal(sessoes.validar(db, t3), null, 'empresa inativa');
  db.prepare("UPDATE empresas SET situacao = 'ativa' WHERE id = 'emp_a'").run();

  const t4 = token();
  assert.equal(sessoes.revogarDoUsuario(db, 'usr_1'), 3, 'derruba as não revogadas (t2, t3 e t4)');
  assert.equal(sessoes.validar(db, t4), null);
});

test('sessão: sem vínculo com a empresa só a administração da plataforma entra', () => {
  const db = banco();
  const semVinculo = sessoes.criar(db, { usuarioId: 'usr_1', empresaId: 'emp_b', origem: 'hub' });
  assert.equal(sessoes.validar(db, semVinculo), null);
  db.prepare("UPDATE usuarios SET administrador_plataforma = 1 WHERE id = 'usr_1'").run();
  const s = sessoes.validar(db, semVinculo);
  assert.ok(s);
  assert.equal(sessoes.contextoDaSessao(s).plataforma, true);
});

test('cookie: leitura e opções seguras', () => {
  assert.equal(sessoes.lerCookie({ headers: { cookie: 'a=1; talk.sid=abc%2D1; b=2' } }), 'abc-1');
  assert.equal(sessoes.lerCookie({ headers: {} }), null);
  const o = sessoes.opcoesCookie({ secure: true });
  assert.deepEqual([o.httpOnly, o.sameSite, o.secure, o.path], [true, 'lax', true, '/app/ia-talk']);
});
