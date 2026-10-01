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

function getAgentConfig(empresaId) {
  if (!empresaId) return null;
  const row = safeGet('SELECT * FROM platform_agent_configs WHERE empresa_id = ?', [Number(empresaId)]);
  if (!row || !row.agente_local_url) return null;
  return {
    empresaId: row.empresa_id,
    url: row.agente_local_url || '',
    token: decrypt(row.agente_local_token_enc),
    ativo: !!row.agente_local_ativo,
    cryptoAtivo: !!row.agente_local_crypto_ativo,
    cryptoKey: decrypt(row.agente_local_crypto_key_enc),
    atualizadoEm: row.atualizado_em,
  };
}

function listarIaServicePorTelefone(telefoneNormalizado) {
  const telefone = String(telefoneNormalizado || '').replace(/\D/g, '');
  if (!telefone) return [];

  // Exige o vínculo PRÓPRIO 'ia-service/chat-web' — autorização do IA
  // Service nunca depende de campos/roles de outro sistema (ex.: módulo
  // SoftExpert do IA Command pode ser desativado por motivos do domínio
  // Protheus sem relação nenhuma com quem pode logar no IA Service). Esse
  // role é criado automaticamente pela importação
  // (platform-import-ia-command.js) quando a identidade tem código
  // SoftExpert, ou manualmente na tela Platform — nunca inferido de outro
  // role na hora do login.
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
      r.metadata_json AS role_metadata_json
    FROM platform_whatsapp_identities i
    JOIN platform_identity_roles r
      ON r.identity_id = i.id
     AND r.empresa_id = i.empresa_id
    WHERE i.numero_normalizado = ?
      AND i.ativo = 1
      AND r.liberado = 1
      AND lower(r.sistema) = 'ia-service'
      AND lower(r.modulo) = 'chat-web'
    ORDER BY i.empresa_id ASC
  `, [telefone]);

  return rows.map(row => {
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

// Resolve a empresa a partir do apelido configurável do login externo do IA
// Service (/entrar-servico/:apelido) — só identidade visual (nome/logo na
// tela de entrada), o login continua funcionando 100% por telefone mesmo
// sem apelido. Antes vivia em ai_config.login_externo_apelido (IA Service);
// migrado para platform_ai_configs, fonte única de verdade agora.
function getConfigPorApelido(apelido) {
  if (!apelido) return null;
  const row = getDB().prepare(`
    SELECT empresa_id FROM platform_ai_configs WHERE login_externo_apelido = ?
  `).get(String(apelido).toLowerCase());
  if (!row) return null;
  return { empresaId: row.empresa_id };
}

module.exports = { getAiConfig, getAgentConfig, listarIaServicePorTelefone, getConfigPorApelido };
