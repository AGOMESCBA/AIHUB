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
