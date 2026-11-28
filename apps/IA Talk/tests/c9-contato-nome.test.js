'use strict';

// Nome do contato vem do perfil do WhatsApp (notifyName); nome editado na Central nunca é trocado.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const repo = require('../backend/atendimento/repositorio');
const { ProvedorWweb } = require('../backend/provedores/wweb');
const { novoId } = require('../backend/ids');
cifra.definirChaveParaTeste(crypto.randomBytes(32));

test('provedor: nome de perfil do WhatsApp (notifyName) vai junto com a mensagem', async () => {
  const p = new ProvedorWweb({ canal: { id: 'cn_t', sessao_id: 's' }, dirSessoes: '.' });
  const recebidas = [];
  p.on('mensagem', (m) => recebidas.push(m));
  await p._receber({ from: '5565999875116@c.us', type: 'chat', body: 'oi', timestamp: Math.floor(Date.now() / 1000),
    id: { id: 'AB1', _serialized: 'false_5565999875116@c.us_AB1' }, _data: { notifyName: '  Alessandro Gomes ' } });
  assert.equal(recebidas[0].nome, 'Alessandro Gomes');
  await p._receber({ from: '5565999875116@c.us', type: 'chat', body: 'oi', timestamp: Math.floor(Date.now() / 1000), id: { id: 'AB2' }, _data: {} });
  assert.equal(recebidas[1].nome, null);
});

test('contato sem nome ganha o nome do WhatsApp; nome editado na Central não é trocado', () => {
  const db = abrirBanco({ arquivo: ':memory:' });
  const t = new Date().toISOString();
  const emp = novoId('empresa');
  db.prepare("INSERT INTO empresas (id, nome, apelido, situacao, criado_em, atualizado_em) VALUES (?, 'J2A', 'j2a', 'ativa', ?, ?)").run(emp, t, t);
  const a = repo.acharOuCriarContato(db, emp, '5565999875116', {});
  assert.equal(a.nome, 'Contato sem nome');
  const b = repo.acharOuCriarContato(db, emp, '556599875116', { nomeWhatsapp: 'Alessandro Gomes' }); // sem o nono dígito: mesmo contato
  assert.equal(b.id, a.id);
  assert.equal(db.prepare('SELECT nome FROM contatos WHERE id = ?').get(a.id).nome, 'Alessandro Gomes');
  db.prepare("UPDATE contatos SET nome = 'Alessandro (J2A)' WHERE id = ?").run(a.id); // editado na Central
  repo.acharOuCriarContato(db, emp, '5565999875116', { nomeWhatsapp: 'Ale' });
  const c = db.prepare('SELECT nome, nome_whatsapp FROM contatos WHERE id = ?').get(a.id);
  assert.deepEqual(c, { nome: 'Alessandro (J2A)', nome_whatsapp: 'Ale' });
  const novo = repo.acharOuCriarContato(db, emp, '5565911112222', { nomeWhatsapp: 'Maria' });
  assert.equal(novo.nome, 'Maria');
});

test('mensagens antigas do contato mostram o nome atual, não o da chegada', () => {
  const db = abrirBanco({ arquivo: ':memory:' });
  db.pragma('foreign_keys = OFF'); // o teste é só a leitura do item
  const ct = repo.acharOuCriarContato(db, 'emp_x', '5565999875116', {});
  const it = repo.adicionarItem(db, 'cv_x', { categoria: 'mensagem', direcao: 'entrada', autor: { tipo: 'contato', id: ct.id, nome: ct.nome }, tipo: 'texto', texto: 'oi' });
  assert.equal(repo.paraItem(it).autor.nome, 'Contato sem nome');
  db.prepare("UPDATE contatos SET nome = 'Agomes' WHERE id = ?").run(ct.id);
  assert.equal(repo.paraItem(repo.listarItens(db, 'cv_x', { limite: 10 })[0]).autor.nome, 'Agomes');
  const sis = repo.adicionarItem(db, 'cv_x', { categoria: 'evento', autor: { tipo: 'sistema', id: null, nome: 'IA Talk' }, texto: 'x' });
  assert.equal(repo.paraItem(sis).autor.nome, 'IA Talk', 'outros autores ficam como gravados');
});

test('provedor: sem notifyName, o nome vem do contato (pushname, conta comercial ou agenda)', async () => {
  const p = new ProvedorWweb({ canal: { id: 'cn_t', sessao_id: 's' }, dirSessoes: '.' });
  const recebidas = [];
  p.on('mensagem', (m) => recebidas.push(m));
  const msg = (id, getContact) => ({ from: '5565999875116@c.us', type: 'chat', body: 'oi', timestamp: Math.floor(Date.now() / 1000), id: { id }, _data: {}, getContact });
  await p._receber(msg('C1', async () => ({ pushname: ' Agomes ', name: 'Alessandro (agenda)' })));
  await p._receber(msg('C2', async () => ({ pushname: '', verifiedName: 'J2A Consultoria' })));
  await p._receber(msg('C3', async () => ({ name: 'Alessandro (agenda)' })));
  await p._receber(msg('C4', async () => { throw new Error('sem contato'); }));
  assert.deepEqual(recebidas.map(m => m.nome), ['Agomes', 'J2A Consultoria', 'Alessandro (agenda)', null]);
});
