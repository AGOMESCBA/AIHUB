// Criptografia AES-256-GCM do IA Service — mesmo padrão já validado e testado
// em apps/IA Command/modules/security/aes-gcm-envelope.js (Etapa 0 confirmou
// que esse utilitário é sólido: 82 linhas, sem dependência de outro módulo
// além de `crypto` nativo). Replicado aqui como arquivo próprio para manter o
// desacoplamento entre os dois sistemas decidido desde a Etapa 1 — nunca um
// `require` cruzando para dentro de apps/IA Command.
//
// Dois usos:
// 1) encryptSecret/decryptSecret — criptografia em repouso de segredos
//    armazenados no SQLite (senha do SQL Server, token do Agente Local).
// 2) encryptPayload/decryptPayload/isEncryptedEnvelope — envelope para o
//    payload do POST /execute do Agente Local, quando a criptografia de
//    transporte estiver ativa (mesmo protocolo que o IA Command já usa).

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
  if (!raw) throw new Error('Chave de criptografia não configurada.');

  let buf;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    buf = Buffer.from(raw, 'base64');
  }

  if (buf.length !== 32) {
    throw new Error('Chave de criptografia inválida: esperado 32 bytes (AES-256).');
  }
  return buf;
}

function generateKeyBase64() {
  return crypto.randomBytes(32).toString('base64');
}

// Chave de criptografia dos segredos em repouso — nunca hardcoded, nunca
// logada. Cascata: env var própria do IA Service → fallback documentado que
// EXIGE configuração explícita (não cai silenciosamente para um valor fraco).
function _chaveSegredos() {
  const key = process.env.SVC_DATA_CRYPTO_KEY;
  if (!key) {
    throw new Error(
      'SVC_DATA_CRYPTO_KEY não configurada. Defina uma chave AES-256 (32 bytes, base64 ou hex) ' +
      'nas variáveis de ambiente antes de armazenar credenciais de fontes históricas.'
    );
  }
  return key;
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
    throw new Error('Envelope criptografado inválido.');
  }
  const keyBuf = normalizeKey(key);
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const data = Buffer.from(envelope.data, 'base64');
  if (iv.length !== IV_BYTES) throw new Error('IV inválido no envelope criptografado.');
  if (tag.length !== TAG_BYTES) throw new Error('Tag inválida no envelope criptografado.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

// Segredo em repouso: string simples (senha, token) → string serializada
// (JSON do envelope) para gravar numa coluna TEXT do SQLite, e vice-versa.
// Nunca aparece em log — quem chamar isso é responsável por não logar o
// valor decifrado (repositories/services desta etapa nunca logam segredo).
function encryptSecret(plainText) {
  if (plainText === null || plainText === undefined || plainText === '') return null;
  const envelope = encryptPayload({ s: String(plainText) }, _chaveSegredos());
  return JSON.stringify(envelope);
}

function decryptSecret(encryptedText) {
  if (!encryptedText) return null;
  let envelope;
  try {
    envelope = JSON.parse(encryptedText);
  } catch (_) {
    throw new Error('Segredo armazenado em formato inválido (não é um envelope JSON).');
  }
  try {
    const payload = decryptPayload(envelope, _chaveSegredos());
    return payload.s;
  } catch (err) {
    // GCM lança "Unsupported state or unable to authenticate data" quando a
    // tag de autenticação não bate — na prática, sempre que SVC_DATA_CRYPTO_KEY
    // mudou depois que este segredo foi salvo (ver deploy/INSTRUCOES.md: essa
    // chave é fixa por instalação, nunca deveria trocar). Mensagem amigável
    // em vez do erro técnico do Node, que confundia o usuário final (2026-10).
    if (/unsupported state|unable to authenticate/i.test(err.message)) {
      throw new Error('Credencial protegida não pôde ser lida (chave de criptografia da instalação mudou desde que foi salva). Reconfigure em Configuração de IA → Agente Local.');
    }
    throw err;
  }
}

module.exports = {
  ENVELOPE_ALG,
  ENVELOPE_VERSION,
  decryptPayload,
  encryptPayload,
  generateKeyBase64,
  isEncryptedEnvelope,
  normalizeKey,
  encryptSecret,
  decryptSecret,
};
