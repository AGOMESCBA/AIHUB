'use strict';

const { getDB } = require('../database');

function uuid() {
  return require('crypto').randomUUID
    ? require('crypto').randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function agora() {
  return new Date().toISOString();
}

function json(value) {
  if (value === undefined || value === null) return null;
  try { return JSON.stringify(value); } catch (_) { return null; }
}

function criarProposta(payload = {}) {
  const id = uuid();
  const ts = agora();
  getDB().prepare(`
    INSERT INTO spec_feedback_propostas (
      id, empresa_id, numero_wa, interpretation_log_id, modulo, fragmento_afetado,
      pergunta_original, sql_gerado, observacao_usuario, diagnostico_ia,
      texto_atual, texto_proposto, historico_dialogo_json, status, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?)
  `).run(
    id,
    payload.empresaId,
    payload.numeroWa || null,
    payload.interpretationLogId || null,
    payload.modulo || null,
    payload.fragmentoAfetado || null,
    payload.perguntaOriginal || null,
    payload.sqlGerado || null,
    payload.observacaoUsuario || null,
    payload.diagnosticoIa || null,
    payload.textoAtual || null,
    payload.textoProposto || null,
    json(payload.historicoDialogo || []),
    ts,
    ts,
  );
  return id;
}

function listar(empresaId, opts = {}) {
  const status = String(opts.status || '').trim();
  const params = [empresaId];
  const where = ['empresa_id = ?'];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const limit = Math.min(parseInt(opts.limit, 10) || 200, 1000);
  params.push(limit);
  return getDB().prepare(`
    SELECT * FROM spec_feedback_propostas
    WHERE ${where.join(' AND ')}
    ORDER BY criado_em DESC
    LIMIT ?
  `).all(...params);
}

function obterPorId(id, empresaId) {
  if (!id || !empresaId) return null;
  return getDB().prepare(`
    SELECT * FROM spec_feedback_propostas WHERE id = ? AND empresa_id = ?
  `).get(id, empresaId) || null;
}

function atualizarStatus(id, empresaId, status, revisadoPor = null) {
  const permitido = new Set(['pendente', 'aprovado', 'rejeitado']);
  if (!permitido.has(String(status))) return false;
  const info = getDB().prepare(`
    UPDATE spec_feedback_propostas
       SET status = ?, revisado_por = ?, revisado_em = ?, atualizado_em = ?
     WHERE id = ? AND empresa_id = ?
  `).run(status, revisadoPor, agora(), agora(), id, empresaId);
  return info.changes > 0;
}

module.exports = { criarProposta, listar, obterPorId, atualizarStatus };
