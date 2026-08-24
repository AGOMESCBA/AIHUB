'use strict';

// Configuracao por empresa de como o WhatsApp real deve montar/dividir respostas
// e oferecer/anexar PDF/Excel. Le da tabela whatsapp_response_config (1 linha por
// empresa); ausencia de linha ou de coluna preenchida cai nos DEFAULTS abaixo.

const { getDB } = require('../database');

const DEFAULTS = {
  limite_parte_whatsapp: 3500,
  limite_pergunta_anexo_caracteres: 8000,
  anexar_pdf_automatico_acima_de: 0,   // 0 = desativado
  anexar_excel_automatico_acima_de: 0, // 0 = desativado
  formato_padrao_anexo: 'excel',
};

const CACHE_TTL_MS = 60 * 1000; // 60s — evita SELECT a cada mensagem, refletindo edicoes em <1min
const _cache = new Map(); // empresaId -> { valor, expiraEm }

function obterConfigWhatsapp(empresaId) {
  const chave = Number(empresaId);
  const cached = _cache.get(chave);
  if (cached && cached.expiraEm > Date.now()) return cached.valor;

  let valor = { ...DEFAULTS };
  try {
    const row = getDB().prepare(
      `SELECT * FROM whatsapp_response_config WHERE empresa_id = ?`
    ).get(chave);
    if (row) {
      for (const campo of Object.keys(DEFAULTS)) {
        if (row[campo] !== null && row[campo] !== undefined) valor[campo] = row[campo];
      }
    }
  } catch (_) {
    // mantém defaults
  }

  _cache.set(chave, { valor, expiraEm: Date.now() + CACHE_TTL_MS });
  return valor;
}

function invalidarCache(empresaId) {
  _cache.delete(Number(empresaId));
}

module.exports = { obterConfigWhatsapp, invalidarCache, DEFAULTS };
