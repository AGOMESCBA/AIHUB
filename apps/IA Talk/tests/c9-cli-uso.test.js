'use strict';

// C9 — uso do número pela linha de comando (plano B da tela): mesmas regras do cadastro e auditoria.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const { executar } = require('../backend/cli/canal-teste');
const { novoId } = require('../backend/ids');
cifra.definirChaveParaTeste(crypto.randomBytes(32));

test('canal-teste.js --uso: liga com setor da empresa dona, recusa setor inexistente, volta para integração', () => {
  const db = abrirBanco({ arquivo: ':memory:' });
  const t = new Date().toISOString();
  const emp = novoId('empresa');
  db.prepare("INSERT INTO empresas (id, nome, apelido, situacao, criado_em, atualizado_em) VALUES (?, 'J2A', 'j2a', 'ativa', ?, ?)").run(emp, t, t);
  db.prepare("INSERT INTO setores (id, empresa_id, codigo, nome, criado_em, atualizado_em) VALUES (?, ?, 'suporte', 'Suporte', ?, ?)").run(novoId('setor'), emp, t, t);
  const canal = novoId('canal');
  db.prepare(`INSERT INTO canais (id, empresa_dona_id, nome, numero, provedor, estado_desde, sessao_id, criado_em, atualizado_em)
    VALUES (?, ?, 'IA Talk', '5565999991752', 'wweb', ?, 's1', ?, ?)`).run(canal, emp, t, t, t);

  assert.throws(() => executar(db, { canal: 'IA Talk', uso: 'compartilhado' }), /Informe --setor/);
  assert.throws(() => executar(db, { canal: 'IA Talk', uso: 'compartilhado', setor: 'financeiro' }), /não encontrado/);
  assert.throws(() => executar(db, { canal: 'IA Talk', uso: 'outro', setor: 'suporte' }), /Use --uso/);
  const r = executar(db, { canal: 'IA Talk', uso: 'compartilhado', setor: 'suporte' });
  assert.equal(r.uso, 'compartilhado');
  const c = db.prepare('SELECT uso, atendimento_empresa_id, setor_padrao_id FROM canais WHERE id = ?').get(canal);
  assert.equal(c.atendimento_empresa_id, emp);
  assert.ok(c.setor_padrao_id);
  assert.ok(db.prepare("SELECT 1 FROM auditoria WHERE acao = 'canal.uso'").get());
  assert.equal(executar(db, { canal: 'IA Talk', uso: 'integracao' }).uso, 'integracao');
  assert.equal(db.prepare('SELECT setor_padrao_id FROM canais WHERE id = ?').get(canal).setor_padrao_id, null);
});
