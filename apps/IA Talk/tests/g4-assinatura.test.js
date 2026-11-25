'use strict';

// G4 (Antigravity): contrato de backend/lib/assinatura.
// Vetor fixo abaixo = o mesmo que os consumidores (IA Command etc.) vão usar
// para validar a implementação deles.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const assinatura = require('../backend/lib/assinatura');

const SEGREDO = 'whsec_teste_segredo';
const TS = 1764072000;
const CORPO = '{"id":"evt_1","tipo":"mensagem.recebida"}';
const ESPERADA = `sha256=${crypto.createHmac('sha256', SEGREDO).update(`${TS}.${CORPO}`).digest('hex')}`;

test('assinatura: módulo exporta as funções congeladas', () => {
  for (const f of ['gerarSegredo', 'assinar', 'verificar', 'verificarAssinaturaMeta']) assert.equal(typeof assinatura[f], 'function', f);
});

test('assinar: HMAC-SHA256 de "timestamp.corpo"', () => {
  assert.equal(assinatura.assinar({ segredo: SEGREDO, timestamp: TS, corpo: CORPO }), ESPERADA);
  assert.equal(assinatura.assinar({ segredo: SEGREDO, timestamp: TS, corpo: Buffer.from(CORPO) }), ESPERADA);
  const s1 = assinatura.gerarSegredo();
  const s2 = assinatura.gerarSegredo();
  assert.match(s1, /^whsec_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(s1, s2);
});

test('verificar: aceita válida e aponta cada motivo de recusa', () => {
  const agoraMs = TS * 1000 + 10_000;
  const base = { segredo: SEGREDO, timestamp: TS, corpo: CORPO, agoraMs };
  assert.deepEqual(assinatura.verificar({ ...base, assinatura: ESPERADA }), { ok: true });
  assert.equal(assinatura.verificar({ ...base, assinatura: '' }).motivo, 'assinatura_ausente');
  assert.equal(assinatura.verificar({ ...base, assinatura: 'md5=abc' }).motivo, 'formato_invalido');
  assert.equal(assinatura.verificar({ ...base, timestamp: 'ontem', assinatura: ESPERADA }).motivo, 'timestamp_invalido');
  assert.equal(assinatura.verificar({ ...base, agoraMs: (TS + 301) * 1000, assinatura: ESPERADA }).motivo, 'timestamp_expirado');
  assert.equal(assinatura.verificar({ ...base, corpo: `${CORPO} `, assinatura: ESPERADA }).motivo, 'assinatura_invalida');
});

test('verificar: casos de borda (string timestamp, Buffer, janela exata, futuro, segredo trocado)', () => {
  const base = { segredo: SEGREDO, timestamp: String(TS), corpo: Buffer.from(CORPO), assinatura: ESPERADA };
  assert.deepEqual(assinatura.verificar({ ...base, agoraMs: (TS + 300) * 1000 }), { ok: true });
  assert.deepEqual(assinatura.verificar({ ...base, agoraMs: (TS - 300) * 1000 }), { ok: true });
  assert.equal(assinatura.verificar({ ...base, agoraMs: (TS - 301) * 1000 }).motivo, 'timestamp_expirado');
  assert.equal(assinatura.verificar({ ...base, agoraMs: TS * 1000, segredo: 'whsec_outro' }).motivo, 'assinatura_invalida');
  assert.equal(assinatura.verificar({ ...base, agoraMs: TS * 1000, assinatura: 'sha256=1234' }).motivo, 'formato_invalido');
  assert.equal(assinatura.verificar({ ...base, agoraMs: TS * 1000, timestamp: -1 }).motivo, 'timestamp_invalido');
  assert.equal(assinatura.verificar({ ...base, agoraMs: TS * 1000, timestamp: 12.5 }).motivo, 'timestamp_invalido');
});

test('verificarAssinaturaMeta: X-Hub-Signature-256 sobre o corpo cru', () => {
  const raw = Buffer.from('{"object":"whatsapp_business_account"}');
  const cab = `sha256=${crypto.createHmac('sha256', 'app_secret_teste').update(raw).digest('hex')}`;
  assert.equal(assinatura.verificarAssinaturaMeta({ appSecret: 'app_secret_teste', rawBody: raw, cabecalho: cab }), true);
  assert.equal(assinatura.verificarAssinaturaMeta({ appSecret: 'app_secret_teste', rawBody: raw, cabecalho: cab.toUpperCase() }), true);
  assert.equal(assinatura.verificarAssinaturaMeta({ appSecret: 'app_secret_teste', rawBody: Buffer.from(`${raw} `), cabecalho: cab }), false);
  assert.equal(assinatura.verificarAssinaturaMeta({ appSecret: 'outro_secret', rawBody: raw, cabecalho: cab }), false);
  assert.equal(assinatura.verificarAssinaturaMeta({ appSecret: '', rawBody: raw, cabecalho: cab }), false);
  assert.equal(assinatura.verificarAssinaturaMeta({ appSecret: 'app_secret_teste', rawBody: raw.toString('utf8'), cabecalho: cab }), false);
  assert.equal(assinatura.verificarAssinaturaMeta({ appSecret: 'app_secret_teste', rawBody: raw, cabecalho: undefined }), false);
});
