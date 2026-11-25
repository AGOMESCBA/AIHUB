'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirBanco, aplicarMigracoes } = require('../backend/database');
const { Contexto, escopo } = require('../backend/repositorios/base');
const auditoria = require('../backend/repositorios/auditoria');
const { erro, corpoErro, ErroTalk } = require('../backend/erros');
const { lerPaginacao, montarPagina, codificarCursor } = require('../backend/paginacao');
const { novoId } = require('../backend/ids');

function bancoComDuasEmpresas() {
  const db = abrirBanco({ arquivo: ':memory:' });
  const agora = new Date().toISOString();
  const ins = db.prepare('INSERT INTO empresas (id, nome, apelido, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)');
  ins.run('emp_a', 'Empresa A', 'empresa-a', agora, agora);
  ins.run('emp_b', 'Empresa B', 'empresa-b', agora, agora);
  return db;
}

test('migrações: aplicam uma vez e registram a versão', () => {
  const db = abrirBanco({ arquivo: ':memory:' });
  const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const t of ['empresas', 'usuarios', 'membros', 'auditoria', 'talk_migracoes']) assert.ok(tabelas.includes(t), `tabela ${t}`);
  assert.deepEqual(aplicarMigracoes(db), [], 'segunda aplicação não repete nada');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM talk_migracoes').get().n, 1);
});

test('banco: apelido é único sem diferenciar maiúsculas e situação é conferida', () => {
  const db = bancoComDuasEmpresas();
  const agora = new Date().toISOString();
  assert.throws(() => db.prepare('INSERT INTO empresas (id, nome, apelido, criado_em, atualizado_em) VALUES (?,?,?,?,?)').run('emp_c', 'C', 'EMPRESA-A', agora, agora), /UNIQUE/);
  assert.throws(() => db.prepare("UPDATE empresas SET situacao = 'apagada' WHERE id = 'emp_a'").run(), /CHECK/);
});

test('isolamento: escopo só devolve dado da empresa do contexto', () => {
  const db = bancoComDuasEmpresas();
  const ctxA = new Contexto({ empresaId: 'emp_a', usuarioId: 'usr_1' });
  const ctxB = new Contexto({ empresaId: 'emp_b', usuarioId: 'usr_2' });
  auditoria.registrar(db, ctxA, { acao: 'teste.a', resumo: 'da A' });
  auditoria.registrar(db, ctxB, { acao: 'teste.b', resumo: 'da B' });

  const daA = auditoria.listar(db, ctxA).itens;
  assert.equal(daA.length, 1);
  assert.equal(daA[0].acao, 'teste.a');
  // Mesmo pedindo outra empresa no parâmetro, vale a do contexto.
  const forcado = escopo(db, ctxA).todos('SELECT acao FROM auditoria WHERE empresa_id = @empresa_id', { empresa_id: 'emp_b' });
  assert.deepEqual(forcado.map(r => r.acao), ['teste.a']);
});

test('isolamento: SQL sem @empresa_id é recusado antes de rodar', () => {
  const db = bancoComDuasEmpresas();
  const rep = escopo(db, new Contexto({ empresaId: 'emp_a' }));
  assert.throws(() => rep.todos('SELECT * FROM auditoria'), /sem filtro @empresa_id/);
  assert.throws(() => rep.executar('DELETE FROM auditoria'), /sem filtro @empresa_id/);
});

test('isolamento: contexto sem empresa não acessa dado de empresa', () => {
  const db = bancoComDuasEmpresas();
  assert.throws(() => escopo(db, new Contexto({ usuarioId: 'usr_1' })), (e) => e instanceof ErroTalk && e.status === 401);
  assert.throws(() => escopo(db, { empresaId: 'emp_a' }), /exige um Contexto/, 'objeto solto não vale como contexto');
  assert.throws(() => new Contexto({ empresaId: 'emp_a' }).exigirPlataforma(), (e) => e.status === 403);
});

test('auditoria: paginação por cursor não repete nem pula itens', () => {
  const db = bancoComDuasEmpresas();
  const ctx = new Contexto({ empresaId: 'emp_a' });
  for (let i = 0; i < 7; i++) auditoria.registrar(db, ctx, { acao: `a.${i}` });
  const vistos = [];
  let cursor;
  do {
    const p = auditoria.listar(db, ctx, { limite: 3, cursor });
    vistos.push(...p.itens.map(i => i.id));
    cursor = p.proximo_cursor;
  } while (cursor);
  assert.equal(vistos.length, 7);
  assert.equal(new Set(vistos).size, 7);
});

test('erros: formato único com código, mensagem e campos', () => {
  const e = erro('requisicao_invalida', 'Confira os campos.', { campos: { nome: 'Informe o nome.' } });
  assert.equal(e.status, 400);
  assert.deepEqual(corpoErro(e), { erro: { codigo: 'requisicao_invalida', mensagem: 'Confira os campos.', campos: { nome: 'Informe o nome.' } } });
  assert.equal(erro('limite_excedido', 'x').status, 429);
  assert.equal(erro('codigo_inexistente', 'x').status, 500);
});

test('paginação: limite padrão, faixa e cursor inválido', () => {
  assert.equal(lerPaginacao({}).limite, 50);
  assert.throws(() => lerPaginacao({ limite: '0' }), (e) => e.status === 400);
  assert.throws(() => lerPaginacao({ limite: '201' }), (e) => e.status === 400);
  assert.throws(() => lerPaginacao({ cursor: '%%%' }), (e) => e.status === 400);
  assert.deepEqual(lerPaginacao({ cursor: codificarCursor({ o: 5 }) }).cursor, { o: 5 });
  const p = montarPagina([1, 2, 3], { limite: 2, cursorDoUltimo: (x) => ({ x }) });
  assert.deepEqual(p.itens, [1, 2]);
  assert.ok(p.proximo_cursor);
  assert.equal(montarPagina([1], { limite: 2, cursorDoUltimo: () => ({}) }).proximo_cursor, null);
});

test('ids: prefixo por tipo e aleatórios', () => {
  const a = novoId('canal');
  assert.match(a, /^cn_[A-Za-z0-9_-]{16}$/);
  assert.notEqual(a, novoId('canal'));
  assert.throws(() => novoId('qualquer'), /desconhecido/);
});
