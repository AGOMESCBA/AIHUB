'use strict';

// Cache de curta duracao dos resultados tabulares (rows) retornados por consultas
// no canal WhatsApp real (single-empresa). Permite gerar PDF/Excel sob demanda
// (ex: "manda em excel") sem rechamar a IA — os dados ja executados ficam aqui.

const crypto = require('crypto');
const { getDB } = require('../database');

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — mesmo TTL de chat-history.js

function salvarResultadoTabular({ empresaId, sender, pergunta, rows, intent, resumoTexto }) {
  if (!empresaId || !sender || !Array.isArray(rows) || !rows.length) return null;
  try {
    const db = getDB();
    const id = crypto.randomUUID();
    const agora = new Date().toISOString();
    db.prepare(`
      INSERT INTO whatsapp_query_cache
        (id, empresa_id, sender, pergunta, resumo_texto, rows_json, rows_count,
         intent_json, periodo_json, filtros_json, agrupar_por, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, Number(empresaId), String(sender), pergunta || null, resumoTexto || null,
      JSON.stringify(rows), rows.length,
      intent ? JSON.stringify(intent) : null,
      intent?.periodo ? JSON.stringify(intent.periodo) : null,
      intent?.filtros ? JSON.stringify(intent.filtros) : null,
      intent?.agrupar_por || null,
      agora,
    );
    return id;
  } catch (_) {
    return null;
  }
}

function _linhaParaResultado(row) {
  if (!row) return null;
  let rows = [];
  try { rows = JSON.parse(row.rows_json) || []; } catch (_) { rows = []; }
  if (!rows.length) return null;
  return {
    id: row.id,
    pergunta: row.pergunta,
    resumoTexto: row.resumo_texto,
    rows,
    rowsCount: row.rows_count,
    intent: row.intent_json ? JSON.parse(row.intent_json) : null,
    periodo: row.periodo_json ? JSON.parse(row.periodo_json) : null,
    filtros: row.filtros_json ? JSON.parse(row.filtros_json) : null,
    agruparPor: row.agrupar_por,
    criadoEm: row.criado_em,
  };
}

function obterUltimoResultadoTabular({ empresaId, sender }) {
  if (!empresaId || !sender) return null;
  try {
    const corte = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const row = getDB().prepare(`
      SELECT id, pergunta, resumo_texto, rows_json, rows_count, intent_json,
             periodo_json, filtros_json, agrupar_por, criado_em
      FROM whatsapp_query_cache
      WHERE empresa_id = ? AND sender = ? AND criado_em >= ?
      ORDER BY criado_em DESC LIMIT 1
    `).get(Number(empresaId), String(sender), corte);
    return _linhaParaResultado(row);
  } catch (_) {
    return null;
  }
}

function obterPorId({ empresaId, id }) {
  if (!empresaId || !id) return null;
  try {
    const corte = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const row = getDB().prepare(`
      SELECT id, pergunta, resumo_texto, rows_json, rows_count, intent_json,
             periodo_json, filtros_json, agrupar_por, criado_em
      FROM whatsapp_query_cache
      WHERE empresa_id = ? AND id = ? AND criado_em >= ?
      LIMIT 1
    `).get(Number(empresaId), String(id), corte);
    return _linhaParaResultado(row);
  } catch (_) {
    return null;
  }
}

function limparExpirados() {
  try {
    const corte = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    getDB().prepare(`DELETE FROM whatsapp_query_cache WHERE criado_em < ?`).run(corte);
  } catch (_) {}
}

module.exports = {
  salvarResultadoTabular,
  obterUltimoResultadoTabular,
  obterPorId,
  limparExpirados,
};
