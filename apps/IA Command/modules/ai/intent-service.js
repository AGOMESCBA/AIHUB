const groqProvider   = require('./providers/groq');
const geminiProvider = require('./providers/gemini');
const validator      = require('./schema-validator');

// Resolves API keys: IA Command SQLite config → IAHub configuracoes → env
async function _resolveKeys(empresaId) {
  const keys = { groq: null, gemini: null };

  // 1. IA Command own config (SQLite)
  try {
    const { getDB } = require('../database');
    const db  = getDB();
    const row = db.prepare("SELECT groq_api_key, gemini_api_key FROM ai_config WHERE empresa_id = ? LIMIT 1").get(empresaId);
    if (row?.groq_api_key)   keys.groq   = row.groq_api_key;
    if (row?.gemini_api_key) keys.gemini = row.gemini_api_key;
  } catch (_) {}

  // 2. IAHub configuracoes (fallback)
  if (!keys.groq) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      keys.groq = await getApiKey(empresaId, 'groq_api_key');
    } catch (_) {}
  }
  if (!keys.gemini) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      keys.gemini = await getApiKey(empresaId, 'gemini_api_key');
    } catch (_) {}
  }

  // 3. Environment variables
  if (!keys.groq)   keys.groq   = process.env.GROQ_API_KEY   || null;
  if (!keys.gemini) keys.gemini = process.env.GEMINI_API_KEY  || null;

  return keys;
}

async function classificar(mensagem, empresaId) {
  const keys = await _resolveKeys(empresaId);

  // Try Groq first
  if (keys.groq) {
    try {
      const raw    = await groqProvider.classificarIntencao(mensagem, keys.groq);
      const result = validator.validar(raw);
      if (result.valido) return { ...result.intent, _provedor: 'groq' };
    } catch (e) {
      console.warn('[IA Command] Groq falhou, tentando Gemini:', e.message);
    }
  }

  // Fallback to Gemini
  if (keys.gemini) {
    try {
      const raw    = await geminiProvider.classificarIntencao(mensagem, keys.gemini);
      const result = validator.validar(raw);
      if (result.valido) return { ...result.intent, _provedor: 'gemini' };
    } catch (e) {
      console.warn('[IA Command] Gemini também falhou:', e.message);
    }
  }

  // No provider available or both failed
  return {
    intencao:            'desconhecido',
    modulo:              '',
    acao:                '',
    periodo:             { tipo: 'nenhum' },
    filtros:             {},
    agrupar_por:         null,
    ordenar_por:         null,
    limite:              null,
    confianca:           0,
    precisa_confirmacao: false,
    origem:              'texto',
    _provedor:           'nenhum',
    _erro:               'Nenhuma chave de IA configurada ou todos os provedores falharam.',
  };
}

module.exports = { classificar };
