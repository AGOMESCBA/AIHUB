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

function marcarAplicado(id, empresaId, arquivo) {
  const info = getDB().prepare(`
    UPDATE spec_feedback_propostas
       SET status = 'aplicado', spec_aplicado_em = ?, spec_aplicado_arquivo = ?, atualizado_em = ?
     WHERE id = ? AND empresa_id = ? AND status = 'aprovado'
  `).run(agora(), arquivo, agora(), id, empresaId);
  return info.changes > 0;
}

function excluirPorIds(empresaId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const db = getDB();
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(
    `DELETE FROM spec_feedback_propostas WHERE empresa_id = ? AND id IN (${placeholders})`
  ).run(empresaId, ...ids);
  return info.changes || 0;
}

function listarEmpresasComPendencias() {
  return getDB().prepare(`
    SELECT empresa_id, COUNT(*) AS total, MIN(criado_em) AS primeiro_em, MAX(criado_em) AS ultimo_em
    FROM spec_feedback_propostas
    WHERE status = 'pendente'
    GROUP BY empresa_id
    HAVING COUNT(*) > 0
    ORDER BY empresa_id ASC
  `).all().map(row => ({
    empresa_id: Number(row.empresa_id),
    total: Number(row.total || 0),
    primeiro_em: row.primeiro_em || null,
    ultimo_em: row.ultimo_em || null,
  }));
}

function avisoJaEnviado(empresaId, dataRef) {
  const row = getDB().prepare(`
    SELECT id
    FROM spec_feedback_daily_notifications
    WHERE empresa_id = ? AND data_ref = ?
    LIMIT 1
  `).get(Number(empresaId), String(dataRef || ''));
  return !!row;
}

function registrarAvisoEnviado({ empresaId, dataRef, numeroWa, totalPendencias, channelId }) {
  const id = uuid();
  getDB().prepare(`
    INSERT OR IGNORE INTO spec_feedback_daily_notifications (
      id, empresa_id, data_ref, numero_wa, total_pendencias, channel_id, enviado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(empresaId),
    String(dataRef || ''),
    numeroWa || null,
    Number(totalPendencias || 0),
    channelId || null,
    agora(),
  );
  return id;
}

module.exports = {
  criarProposta,
  listar,
  obterPorId,
  atualizarStatus,
  marcarAplicado,
  excluirPorIds,
  listarEmpresasComPendencias,
  avisoJaEnviado,
  registrarAvisoEnviado,
};
