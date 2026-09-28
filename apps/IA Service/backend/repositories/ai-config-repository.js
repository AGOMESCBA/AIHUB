// Unico ponto de acesso SQL a tabela `ai_config` (chaves de provider de IA,
// uma linha por empresa). Proprio do IA Service — nao compartilha com o
// ai_config do IA Command (bancos fisicamente separados, ver database/index.js).

const { getDB } = require('../database');

function _rowParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    provedorPrimario: row.provedor_primario,
    fallbackOrdem: row.fallback_ordem,
    groqApiKey: row.groq_api_key,
    openaiApiKey: row.openai_api_key,
    claudeApiKey: row.claude_api_key,
    geminiApiKey: row.gemini_api_key,
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

function salvarConfig(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  const existente = getConfig(empresaId);

  if (existente) {
    db.prepare(`
      UPDATE ai_config
         SET provedor_primario = ?, fallback_ordem = ?,
             groq_api_key = COALESCE(?, groq_api_key),
             openai_api_key = COALESCE(?, openai_api_key),
             claude_api_key = COALESCE(?, claude_api_key),
             gemini_api_key = COALESCE(?, gemini_api_key),
             atualizado_em = ?
       WHERE empresa_id = ?
    `).run(
      dados.provedorPrimario || existente.provedorPrimario,
      dados.fallbackOrdem || existente.fallbackOrdem,
      dados.groqApiKey ?? null,
      dados.openaiApiKey ?? null,
      dados.claudeApiKey ?? null,
      dados.geminiApiKey ?? null,
      agora,
      Number(empresaId)
    );
  } else {
    db.prepare(`
      INSERT INTO ai_config (
        empresa_id, provedor_primario, fallback_ordem,
        groq_api_key, openai_api_key, claude_api_key, gemini_api_key,
        criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(empresaId),
      dados.provedorPrimario || 'groq',
      dados.fallbackOrdem || 'groq,openai,claude,gemini',
      dados.groqApiKey ?? null,
      dados.openaiApiKey ?? null,
      dados.claudeApiKey ?? null,
      dados.geminiApiKey ?? null,
      agora,
      agora
    );
  }

  return getConfig(empresaId);
}

module.exports = { getConfig, salvarConfig };
