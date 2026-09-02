const crypto = require('crypto');
const {
  decryptPayload,
  encryptPayload,
  isEncryptedEnvelope,
} = require('./aes-gcm-envelope');

const FIELD_MARKER = 'iacsec:v1:';

function chaveBase() {
  return String(
    process.env.IAC_CHAT_DATA_CRYPTO_KEY
    || process.env.IAC_PROTHEUS_CHAT_SECRET
    || process.env.SESSION_SECRET
    || ''
  ).trim();
}

function keyMaterial() {
  const base = chaveBase();
  if (!base || base === 'iahub-secret' || base === 'mude-para-uma-chave-secreta-aleatoria-longa') {
    return null;
  }
  return crypto.createHash('sha256').update(base).digest('base64');
}

function ativo() {
  return !!keyMaterial();
}

function encryptValue(value, { kid = 'chat' } = {}) {
  const key = keyMaterial();
  if (!key || value === null || value === undefined) return value;
  const envelope = encryptPayload({ value }, key, { kid });
  return FIELD_MARKER + Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

function decryptValue(value) {
  if (typeof value !== 'string' || !value.startsWith(FIELD_MARKER)) return value;
  const key = keyMaterial();
  if (!key) return value;
  try {
    const raw = Buffer.from(value.slice(FIELD_MARKER.length), 'base64').toString('utf8');
    const envelope = JSON.parse(raw);
    if (!isEncryptedEnvelope(envelope)) return value;
    return decryptPayload(envelope, key).value;
  } catch (_) {
    return value;
  }
}

function encryptText(value) {
  if (value === null || value === undefined) return value;
  return encryptValue(String(value), { kid: 'chat-text' });
}

function decryptText(value) {
  const decrypted = decryptValue(value);
  return decrypted === null || decrypted === undefined ? decrypted : String(decrypted);
}

function encryptJson(value) {
  if (value === null || value === undefined) return value;
  if (!ativo()) return JSON.stringify(value);
  return encryptValue(value, { kid: 'chat-json' });
}

function decryptJson(value) {
  return decryptValue(value);
}

function parseJsonField(value, fallback = null) {
  if (!value) return fallback;
  const decrypted = decryptJson(value);
  if (typeof decrypted !== 'string') return decrypted ?? fallback;
  try {
    return JSON.parse(decrypted);
  } catch (_) {
    return fallback;
  }
}

module.exports = {
  ativo,
  decryptJson,
  decryptText,
  encryptJson,
  encryptText,
  parseJsonField,
};
