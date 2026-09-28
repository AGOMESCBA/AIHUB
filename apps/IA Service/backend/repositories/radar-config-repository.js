// Único ponto de acesso SQL à tabela `radar_config` — preferências da tela
// Radar de Chamados por empresa (ex.: intervalo de auto-refresh).

const { getDB } = require('../database');

function _rowParaDominio(row) {
  if (!row) return null;
  return {
    empresaId: row.empresa_id,
    autoRefreshSegundos: row.auto_refresh_segundos,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function getConfig(empresaId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return _rowParaDominio(db.prepare(`SELECT * FROM radar_config WHERE empresa_id = ?`).get(Number(empresaId)));
}

function salvarConfig(empresaId, { autoRefreshSegundos }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  const existente = getConfig(empresaId);

  if (existente) {
    db.prepare(`
      UPDATE radar_config SET auto_refresh_segundos = ?, atualizado_em = ? WHERE empresa_id = ?
    `).run(autoRefreshSegundos, agora, Number(empresaId));
  } else {
    db.prepare(`
      INSERT INTO radar_config (empresa_id, auto_refresh_segundos, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?)
    `).run(Number(empresaId), autoRefreshSegundos, agora, agora);
  }

  return getConfig(empresaId);
}

module.exports = { getConfig, salvarConfig };
