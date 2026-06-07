'use strict';

const { getDB } = require('../../database');

const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 min — mesmo TTL da sessão WhatsApp

/**
 * Salva um turno (user ou assistant) no histórico de chat.
 */
function salvarTurn(empresaId, sender, role, content) {
  try {
    getDB().prepare(`
      INSERT INTO chat_history (empresa_id, sender, role, content, criado_em)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(empresaId), String(sender), role, String(content || ''), new Date().toISOString());
  } catch (_) {}
}

/**
 * Carrega o histórico recente de chat para (empresa, sender).
 * Retorna array de { role, content } pronto para enviar à API de chat.
 * `limitesTurnos` = número de pares (user+assistant) a retornar.
 */
function carregarHistorico(empresaId, sender, limiteTurnos = 5) {
  try {
    const corte = new Date(Date.now() - CONTEXT_TTL_MS).toISOString();
    const rows = getDB().prepare(`
      SELECT role, content FROM chat_history
      WHERE empresa_id = ? AND sender = ? AND criado_em >= ?
      ORDER BY id ASC
    `).all(String(empresaId), String(sender), corte);

    // Mantém apenas os últimos N pares (user + assistant = 2 rows por turno)
    const maxRows = limiteTurnos * 2;
    const slice = rows.length > maxRows ? rows.slice(-maxRows) : rows;
    return slice.map(r => ({ role: r.role, content: r.content }));
  } catch (_) {
    return [];
  }
}

/**
 * Apaga todo o histórico de um sender (ex: mudança de empresa ou timeout).
 */
function limparHistorico(empresaId, sender) {
  try {
    getDB().prepare(`DELETE FROM chat_history WHERE empresa_id = ? AND sender = ?`)
      .run(String(empresaId), String(sender));
  } catch (_) {}
}

/**
 * Remove entradas expiradas de todas as empresas (manutenção periódica).
 */
function limparExpirados() {
  try {
    const corte = new Date(Date.now() - CONTEXT_TTL_MS).toISOString();
    getDB().prepare(`DELETE FROM chat_history WHERE criado_em < ?`).run(corte);
  } catch (_) {}
}

module.exports = { salvarTurn, carregarHistorico, limparHistorico, limparExpirados };
