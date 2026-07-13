const crypto = require('crypto');

const ENVELOPE_VERSION = 1;
const ENVELOPE_ALG = 'AES-256-GCM';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function isEncryptedEnvelope(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.v === ENVELOPE_VERSION &&
    value.enc === ENVELOPE_ALG &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.data === 'string'
  );
}

function normalizeKey(key) {
  const raw = String(key || '').trim();
  if (!raw) throw new Error('Chave de criptografia nao configurada.');

  let buf;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    buf = Buffer.from(raw, 'base64');
  }

  if (buf.length !== 32) {
    throw new Error('Chave de criptografia invalida: esperado 32 bytes (AES-256).');
  }
  return buf;
}

function generateKeyBase64() {
  return crypto.randomBytes(32).toString('base64');
}

function encryptPayload(payload, key, { kid = 'default' } = {}) {
  const keyBuf = normalizeKey(key);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv, { authTagLength: TAG_BYTES });
  const plaintext = Buffer.from(JSON.stringify(payload ?? {}), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: ENVELOPE_VERSION,
    enc: ENVELOPE_ALG,
    kid,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptPayload(envelope, key) {
  if (!isEncryptedEnvelope(envelope)) {
    throw new Error('Envelope criptografado invalido.');
  }
  const keyBuf = normalizeKey(key);
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const data = Buffer.from(envelope.data, 'base64');
  if (iv.length !== IV_BYTES) throw new Error('IV invalido no envelope criptografado.');
  if (tag.length !== TAG_BYTES) throw new Error('Tag invalida no envelope criptografado.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

module.exports = {
  ENVELOPE_ALG,
  ENVELOPE_VERSION,
  decryptPayload,
  encryptPayload,
  generateKeyBase64,
  isEncryptedEnvelope,
  normalizeKey,
};
