'use strict';

// Remetente "@lid" (identificador interno do WhatsApp) precisa virar telefone
// antes de conferir a lista do modo de teste — caso real: …5116 era descartado.

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolverTelefoneLid } = require('../backend/provedores/wweb');

const LID = '123456789012345@lid';
const msg = (extra = {}, contato = null) => ({ from: LID, getContact: async () => { if (!contato) throw new Error('sem contato'); return contato; }, ...extra });

test('LID → telefone pelo getContactLidAndPhone do WhatsApp', async () => {
  const client = { getContactLidAndPhone: async (ids) => ids.map(() => ({ lid: LID, pn: '556599875116@c.us' })) };
  assert.equal(await resolverTelefoneLid(msg(), client), '556599875116');
});

test('LID → telefone pelo contato quando o WhatsApp não devolve pn (como o IA Command)', async () => {
  const client = { getContactLidAndPhone: async () => [{ lid: LID, pn: undefined }] };
  const contato = { id: { _serialized: '5565999875116@c.us' }, number: '123456789012345' };
  assert.equal(await resolverTelefoneLid(msg({}, contato), client), '5565999875116');
});

test('contact.number igual ao próprio LID não é aceito como telefone', async () => {
  const contato = { id: { _serialized: LID }, number: '123456789012345' };
  assert.equal(await resolverTelefoneLid(msg({}, contato), {}), null);
});

test('falhas do WhatsApp não derrubam a leitura: cai para o contato', async () => {
  const client = { getContactLidAndPhone: async () => { throw new Error('página fechada'); } };
  const contato = { id: { _serialized: '5565999875116@c.us' }, number: '5565999875116' };
  assert.equal(await resolverTelefoneLid(msg({}, contato), client), '5565999875116');
});

test('sem nenhuma pista → null (o provedor registra aviso mascarado)', async () => {
  assert.equal(await resolverTelefoneLid(msg(), null), null);
});

// Auditoria 3: pelo caminho real do provedor (_receber), não só pela função de resolução.
test('provedor: LID não resolvido sai como "lid" (nunca como telefone), mesmo com 13 dígitos', async () => {
  const { ProvedorWweb } = require('../backend/provedores/wweb');
  const p = new ProvedorWweb({ canal: { id: 'cn_t', sessao_id: 's' }, dirSessoes: '.' });
  p.client = { getContactLidAndPhone: async () => [{ lid: '1234567890123@lid', pn: undefined }] };
  const recebidas = [];
  p.on('mensagem', (m) => recebidas.push(m));
  p.log = () => {};
  await p._receber({ from: '1234567890123@lid', type: 'chat', body: 'oi', timestamp: Math.floor(Date.now() / 1000), id: { _serialized: 'x1' },
    getContact: async () => ({ id: { _serialized: '1234567890123@lid' }, number: '1234567890123' }) });
  assert.equal(recebidas.length, 1);
  assert.deepEqual(recebidas[0].de, { tipo: 'lid', valor: '1234567890123', autor: undefined });
  // Resolvido: sai como telefone.
  p.client = { getContactLidAndPhone: async () => [{ lid: '1234567890123@lid', pn: '5565999875116@c.us' }] };
  await p._receber({ from: '1234567890123@lid', type: 'chat', body: 'oi', timestamp: Math.floor(Date.now() / 1000), id: { _serialized: 'x2' }, getContact: async () => null });
  assert.deepEqual(recebidas[1].de, { tipo: 'telefone', valor: '5565999875116', autor: undefined });
});
