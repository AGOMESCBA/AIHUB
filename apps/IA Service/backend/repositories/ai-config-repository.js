// Unico ponto de acesso SQL a tabela `ai_config` (chaves de provider de IA,
// uma linha por empresa). Proprio do IA Service — nao compartilha com o
// ai_config do IA Command (bancos fisicamente separados, ver database/index.js).
//
// Chaves de API gravadas CRIPTOGRAFADAS em repouso (AES-256-GCM via
// crypto-envelope.js, mesma SVC_DATA_CRYPTO_KEY já usada para credenciais de
// fontes históricas) — 2026-09, correção de segurança: até aqui eram gravadas
// em texto plano no SQLite, único segredo do IA Service sem essa proteção
// (config do Agente Local, senha de SQL Server etc. já usavam esse padrão).
// decryptSecret nunca lança para valor ausente (encryptSecret já retorna null
// para string vazia/null), então getConfig funciona igual antes de qualquer
// chave existir.

const { getDB } = require('../database');
const cryptoEnvelope = require('../services/crypto-envelope');

function _rowParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    provedorPrimario: row.provedor_primario,
    fallbackOrdem: row.fallback_ordem,
    groqApiKey: cryptoEnvelope.decryptSecret(row.groq_api_key),
    openaiApiKey: cryptoEnvelope.decryptSecret(row.openai_api_key),
    claudeApiKey: cryptoEnvelope.decryptSecret(row.claude_api_key),
    geminiApiKey: cryptoEnvelope.decryptSecret(row.gemini_api_key),
    loginExternoApelido: row.login_externo_apelido,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function getConfig(empresaId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const row = db.prepare(`SELECT * FROM ai_config WHERE empresa_id = ?`).get(Number(empresaId));
  return _rowParaDominio(row);
}

/**
 * Resolve a empresa a partir do apelido configurável (/entrar-servico/:apelido)
 * — mesmo padrão do IA Command (protheus_web_login_path em ai_config). Só
 * conveniência/identidade visual: o login continua funcionando por telefone
 * mesmo sem apelido nenhum (login-externo-service.js nunca depende disto).
 */
function getConfigPorApelido(apelido) {
  if (!apelido) return null;
  const db = getDB();
  const row = db.prepare(`SELECT * FROM ai_config WHERE login_externo_apelido = ?`).get(String(apelido).toLowerCase());
  return _rowParaDominio(row);
}

// Mesma normalização usada no login externo (login-externo-routes.js já
// removida de lá, mas o formato de slug continua o mesmo padrão do resto
// do projeto): minúsculas, só [a-z0-9-], sem hífen duplicado/nas pontas.
function _normalizarApelido(valor) {
  const limpo = String(valor || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return limpo || null;
}

function salvarConfig(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  const existente = getConfig(empresaId);

  // Criptografa ANTES de gravar — o COALESCE abaixo compara com a coluna
  // crua do banco (já cifrada), então o valor novo também precisa estar
  // cifrado para a comparação/substituição fazer sentido byte a byte (senão
  // o COALESCE sempre "substituiria", pois um texto plano nunca é NULL).
  const groqCifrado = cryptoEnvelope.encryptSecret(dados.groqApiKey);
  const openaiCifrado = cryptoEnvelope.encryptSecret(dados.openaiApiKey);
  const claudeCifrado = cryptoEnvelope.encryptSecret(dados.claudeApiKey);
  const geminiCifrado = cryptoEnvelope.encryptSecret(dados.geminiApiKey);

  let apelido = existente?.loginExternoApelido ?? null;
  if (dados.loginExternoApelido !== undefined) {
    apelido = _normalizarApelido(dados.loginExternoApelido);
    if (apelido) {
      const emUso = db.prepare(`SELECT empresa_id FROM ai_config WHERE login_externo_apelido = ? AND empresa_id != ?`)
        .get(apelido, Number(empresaId));
      if (emUso) throw new Error(`O apelido "${apelido}" já está em uso por outra empresa.`);
    }
  }

  if (existente) {
    db.prepare(`
      UPDATE ai_config
         SET provedor_primario = ?, fallback_ordem = ?,
             groq_api_key = COALESCE(?, groq_api_key),
             openai_api_key = COALESCE(?, openai_api_key),
             claude_api_key = COALESCE(?, claude_api_key),
             gemini_api_key = COALESCE(?, gemini_api_key),
             login_externo_apelido = ?,
             atualizado_em = ?
       WHERE empresa_id = ?
    `).run(
      dados.provedorPrimario || existente.provedorPrimario,
      dados.fallbackOrdem || existente.fallbackOrdem,
      groqCifrado,
      openaiCifrado,
      claudeCifrado,
      geminiCifrado,
      apelido,
      agora,
      Number(empresaId)
    );
  } else {
    db.prepare(`
      INSERT INTO ai_config (
        empresa_id, provedor_primario, fallback_ordem,
        groq_api_key, openai_api_key, claude_api_key, gemini_api_key,
        login_externo_apelido, criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(empresaId),
      dados.provedorPrimario || 'groq',
      dados.fallbackOrdem || 'groq,openai,claude,gemini',
      groqCifrado,
      openaiCifrado,
      claudeCifrado,
      geminiCifrado,
      apelido,
      agora,
      agora
    );
  }

  return getConfig(empresaId);
}

module.exports = { getConfig, getConfigPorApelido, salvarConfig };
