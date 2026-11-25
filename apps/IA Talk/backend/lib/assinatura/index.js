'use strict';

// G4 (Antigravity) — assinatura dos webhooks que o Talk envia aos sistemas e
// verificação do webhook da Meta (usada na G6). Assinaturas CONGELADAS na C0:
// C4 (webhooks) chama exatamente estas funções.
// Testes de contrato: apps/IA Talk/tests/g4-assinatura.test.js.
//
// Webhook do Talk → consumidor:
//   X-Talk-Evento-Id: evt_...
//   X-Talk-Timestamp: 1764072000            (segundos, UTC)
//   X-Talk-Assinatura: sha256=<hex>         HMAC-SHA256(segredo, `${timestamp}.${corpo}`)

const crypto = require('crypto');

const FORMATO_SHA256 = /^sha256=[0-9a-f]{64}$/;
const FORMATO_SHA256_CASE_INSENSITIVE = /^sha256=[0-9a-f]{64}$/i;
const TOLERANCIA_PADRAO_SEG = 300;

function _compararConstante(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function _parsearTimestampSegundos(timestamp) {
  if (typeof timestamp === 'number') {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) return null;
    return timestamp;
  }
  if (typeof timestamp === 'string') {
    const limpo = timestamp.trim();
    if (!/^\d+$/.test(limpo)) return null;
    const num = Number(limpo);
    if (!Number.isSafeInteger(num) || num < 0) return null;
    return num;
  }
  return null;
}

/**
 * Segredo novo para o webhook de uma aplicação (mostrado uma única vez).
 * @returns {string} 32 bytes aleatórios em base64url, prefixo 'whsec_'
 */
function gerarSegredo() {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`;
}

/**
 * @param {{ segredo: string, timestamp: number, corpo: string|Buffer }} p
 * @returns {string} 'sha256=<hex minúsculo>'
 */
function assinar(p) {
  const { segredo, timestamp, corpo } = p || {};
  if (typeof segredo !== 'string' || !segredo) {
    throw new TypeError('segredo deve ser uma string não vazia.');
  }
  const ts = _parsearTimestampSegundos(timestamp);
  if (ts === null) {
    throw new TypeError('timestamp deve ser um inteiro em segundos.');
  }
  if (typeof corpo !== 'string' && !Buffer.isBuffer(corpo)) {
    throw new TypeError('corpo deve ser string ou Buffer.');
  }

  const hmac = crypto.createHmac('sha256', segredo);
  hmac.update(`${ts}.`, 'utf8');
  hmac.update(Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo, 'utf8'));
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verificação do lado do consumidor (e nos testes do Talk). Comparação em
 * tempo constante; tolerância de relógio em segundos.
 * @param {{ segredo: string, timestamp: number|string, corpo: string|Buffer,
 *           assinatura: string, toleranciaSeg?: number, agoraMs?: number }} p
 *        padrões: toleranciaSeg 300, agoraMs Date.now()
 * @returns {{ ok: true } | { ok: false, motivo: 'assinatura_ausente'|'formato_invalido'|'timestamp_invalido'|'timestamp_expirado'|'assinatura_invalida' }}
 */
function verificar(p) {
  const {
    segredo,
    timestamp,
    corpo,
    assinatura,
    toleranciaSeg = TOLERANCIA_PADRAO_SEG,
    agoraMs = Date.now(),
  } = p || {};

  if (typeof assinatura !== 'string' || !assinatura.trim()) {
    return { ok: false, motivo: 'assinatura_ausente' };
  }

  const assinaturaLimpa = assinatura.trim();
  if (!FORMATO_SHA256.test(assinaturaLimpa)) {
    return { ok: false, motivo: 'formato_invalido' };
  }

  const ts = _parsearTimestampSegundos(timestamp);
  if (ts === null) {
    return { ok: false, motivo: 'timestamp_invalido' };
  }

  const tolerancia = Number.isFinite(Number(toleranciaSeg)) && Number(toleranciaSeg) >= 0
    ? Number(toleranciaSeg)
    : TOLERANCIA_PADRAO_SEG;

  if (!Number.isFinite(agoraMs) || Math.abs(agoraMs - ts * 1000) > tolerancia * 1000) {
    return { ok: false, motivo: 'timestamp_expirado' };
  }

  if (typeof segredo !== 'string' || !segredo || (typeof corpo !== 'string' && !Buffer.isBuffer(corpo))) {
    return { ok: false, motivo: 'assinatura_invalida' };
  }

  const esperada = assinar({ segredo, timestamp: ts, corpo });
  if (!_compararConstante(assinaturaLimpa, esperada)) {
    return { ok: false, motivo: 'assinatura_invalida' };
  }

  return { ok: true };
}

/**
 * Webhook da Meta: X-Hub-Signature-256 = 'sha256=' + HMAC-SHA256(appSecret, rawBody).
 * Sempre sobre o corpo CRU (Buffer), antes de qualquer JSON.parse.
 * @param {{ appSecret: string, rawBody: Buffer, cabecalho: string|undefined }} p
 * @returns {boolean}
 */
function verificarAssinaturaMeta(p) {
  const { appSecret, rawBody, cabecalho } = p || {};
  if (typeof appSecret !== 'string' || !appSecret) return false;
  if (!Buffer.isBuffer(rawBody)) return false;
  if (typeof cabecalho !== 'string' || !FORMATO_SHA256_CASE_INSENSITIVE.test(cabecalho.trim())) {
    return false;
  }

  const esperada = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return _compararConstante(cabecalho.trim().toLowerCase(), esperada);
}

module.exports = { gerarSegredo, assinar, verificar, verificarAssinaturaMeta };
