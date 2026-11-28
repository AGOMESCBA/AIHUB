'use strict';

// P2 — não perder mensagens com o canal fora: ponto de controle por canal (supervisor), recuperação
// das conversas com não lidas na conexão (provedor do WhatsApp, cliente falso), limite de 24 h, número
// novo sem importar histórico e a mesma mensagem nunca processada duas vezes.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const { SupervisorCanais } = require('../backend/canais/supervisor');
const { ProvedorWweb, RECUPERAR_MAX_SEG } = require('../backend/provedores/wweb');
const { novoId } = require('../backend/ids');
cifra.definirChaveParaTeste(crypto.randomBytes(32));

const agoraSeg = () => Math.floor(Date.now() / 1000);
const msg = (id, seg, extra = {}) => ({ from: '5565999875116@c.us', type: 'chat', body: `m${id}`, timestamp: seg, id: { id, _serialized: `false_x_${id}` },
  _data: { notifyName: 'Cliente' }, ...extra });

test('supervisor: ponto de controle só avança e vai para o processo do canal', () => {
  const db = abrirBanco({ arquivo: ':memory:' });
  const t = new Date().toISOString();
  db.prepare("INSERT INTO empresas (id, nome, apelido, situacao, criado_em, atualizado_em) VALUES ('emp_x', 'X', 'xx', 'ativa', ?, ?)").run(t, t);
  const canal = novoId('canal');
  db.prepare(`INSERT INTO canais (id, empresa_dona_id, nome, provedor, estado, estado_desde, ligado, sessao_id, criado_em, atualizado_em, recebimento_modo)
    VALUES (?, 'emp_x', 'C', 'wweb', 'conectado', ?, 1, 's1', ?, ?, 'todos')`).run(canal, t, t, t);
  const sup = new SupervisorCanais({ db, emitir: () => {}, log: { error() {} } });
  const chega = (em) => sup._receber(canal, { de: { tipo: 'telefone', valor: '5565999875116' }, tipo: 'texto', texto: 'x', em });
  chega('2026-11-28T10:00:00.000Z');
  chega('2026-11-28T09:00:00.000Z'); // recuperada, mais antiga: não volta o ponto
  assert.equal(db.prepare('SELECT recebido_ate FROM canais').get().recebido_ate, '2026-11-28T10:00:00.000Z');
  chega('2026-11-28T11:00:00.000Z');
  assert.equal(db.prepare('SELECT recebido_ate FROM canais').get().recebido_ate, '2026-11-28T11:00:00.000Z');
});

test('provedor: recupera não lidas depois do ponto, ignora grupo, as próprias e as antigas; nada em dobro', async () => {
  const desde = agoraSeg() - 600; // canal caiu há 10 min
  const p = new ProvedorWweb({ canal: { id: 'cn_t', sessao_id: 's', recebido_ate: new Date(desde * 1000).toISOString() }, dirSessoes: '.' });
  const recebidas = [];
  p.on('mensagem', (m) => recebidas.push(m.texto));
  p._aceitarApos = desde - 5;
  p.client = { getChats: async () => [
    { isGroup: false, unreadCount: 3, fetchMessages: async () => [msg('A', desde - 3600), msg('B', desde + 60), msg('C', desde + 120, { fromMe: true }), msg('D', desde + 180)] },
    { isGroup: true, unreadCount: 5, fetchMessages: async () => [msg('G', desde + 60)] },
    { isGroup: false, unreadCount: 0, fetchMessages: async () => [msg('Z', desde + 60)] },
  ] };
  assert.equal(await p._recuperarNaoLidas(), 2);
  assert.deepEqual(recebidas, ['mB', 'mD'], 'só as não lidas depois da queda, sem as próprias');
  await p._receber(msg('D', desde + 180)); // a mesma chegando também pelo evento
  assert.deepEqual(recebidas, ['mB', 'mD'], 'nunca em dobro');
  assert.equal(RECUPERAR_MAX_SEG, 24 * 60 * 60);
});
