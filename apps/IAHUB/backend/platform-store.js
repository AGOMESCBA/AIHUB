const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { ensurePlatformSchema } = require('./platform-schema');

const DB_PATH = path.join(__dirname, '..', 'data', 'iahub-platform.db');
const PREFIX = 'iahub-aes-gcm:';

let db;

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    ensurePlatformSchema(db);
  }
  return db;
}

function key() {
  return crypto.createHash('sha256')
    .update(process.env.IAHUB_PLATFORM_CRYPTO_KEY || process.env.SVC_DATA_CRYPTO_KEY || process.env.SESSION_SECRET || 'iahub-platform-dev-key')
    .digest();
}

function decrypt(value) {
  if (!value) return '';
  if (!String(value).startsWith(PREFIX)) return String(value);
  const raw = Buffer.from(String(value).slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function safeGet(sql, params = []) {
  try {
    return getDB().prepare(sql).get(...params);
  } catch (err) {
    if (/no such table/i.test(err.message || '')) return null;
    throw err;
  }
}

function safeAll(sql, params = []) {
  try {
    return getDB().prepare(sql).all(...params);
  } catch (err) {
    if (/no such table/i.test(err.message || '')) return [];
    throw err;
  }
}

function getAiConfig(empresaId) {
  if (!empresaId) return null;
  const row = safeGet('SELECT * FROM platform_ai_configs WHERE empresa_id = ? AND COALESCE(ativo, 1) = 1', [Number(empresaId)]);
  if (!row) return null;
  return {
    empresaId: row.empresa_id,
    provedorPrimario: row.provedor_primario || row.provider || 'groq',
    fallbackOrdem: row.fallback_ordem || 'groq,deepseek,gemini,claude,openai',
    groqApiKey: decrypt(row.groq_api_key_enc),
    openaiApiKey: decrypt(row.openai_api_key_enc),
    geminiApiKey: decrypt(row.gemini_api_key_enc),
    deepseekApiKey: decrypt(row.deepseek_api_key_enc),
    claudeApiKey: decrypt(row.claude_api_key_enc),
    groqModelo: row.groq_modelo || 'openai/gpt-oss-20b',
    openaiModelo: row.openai_modelo || 'gpt-4o-mini',
    geminiModelo: row.gemini_modelo || 'gemini-3.5-flash',
    deepseekModelo: row.deepseek_modelo || 'deepseek-chat',
    claudeModelo: row.claude_modelo || 'claude-haiku-4-5-20251001',
    atualizadoEm: row.atualizado_em,
  };
}

function listarIaServicePorTelefone(telefoneNormalizado) {
  const telefone = String(telefoneNormalizado || '').replace(/\D/g, '');
  if (!telefone) return [];

  // Aceita tanto o vínculo explícito 'ia-service/chat-web' (criado na tela
  // Platform) quanto o role 'softexpert/chamados' já trazido pela
  // importação automática do IA Command — o IA Service é sobre chamados
  // SoftExpert, então um consultor com acesso ao SoftExpert já tem base
  // suficiente para logar, sem depender de configuração manual extra por
  // empresa. Quando a mesma identidade tem os dois roles, prioriza
  // 'ia-service' (mais específico, pode ter sido ajustado manualmente).
  const rows = safeAll(`
    SELECT
      i.id,
      i.empresa_id,
      i.nome,
      i.numero,
      i.numero_normalizado,
      i.ativo,
      i.metadata_json,
      r.codigo_identidade,
      r.papel,
      r.metadata_json AS role_metadata_json,
      r.sistema
    FROM platform_whatsapp_identities i
    JOIN platform_identity_roles r
      ON r.identity_id = i.id
     AND r.empresa_id = i.empresa_id
    WHERE i.numero_normalizado = ?
      AND i.ativo = 1
      AND r.liberado = 1
      AND (
        (lower(r.sistema) = 'ia-service' AND lower(r.modulo) = 'chat-web')
        OR (lower(r.sistema) = 'softexpert' AND lower(r.modulo) = 'chamados')
      )
    ORDER BY i.empresa_id ASC, CASE WHEN lower(r.sistema) = 'ia-service' THEN 0 ELSE 1 END ASC
  `, [telefone]);

  const porEmpresa = new Map();
  for (const row of rows) {
    if (!porEmpresa.has(row.empresa_id)) porEmpresa.set(row.empresa_id, row);
  }

  return [...porEmpresa.values()].map(row => {
    const metadata = parseJson(row.metadata_json, {});
    const roleMetadata = parseJson(row.role_metadata_json, {});
    const iaService = metadata.iaService || {};
    return {
      platformIdentityId: row.id,
      empresaId: row.empresa_id,
      nome: row.nome,
      telefone: row.numero || row.numero_normalizado,
      ativo: !!row.ativo,
      papel: row.papel || 'analista',
      usuarioIdIahub: iaService.usuarioIdIahub || roleMetadata.usuarioIdIahub || null,
      idSoftexpert: iaService.idSoftexpert || roleMetadata.idSoftexpert || row.codigo_identidade || null,
      preAnaliseAutomatica: iaService.preAnaliseAutomatica !== false && roleMetadata.preAnaliseAutomatica !== false,
    };
  });
}

module.exports = { getAiConfig, listarIaServicePorTelefone };
