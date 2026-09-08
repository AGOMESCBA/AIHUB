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

function normalizarTermo(termo) {
  return String(termo || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarDominio(dominio) {
  return String(dominio || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function _parseRow(row) {
  if (!row) return null;
  return { ...row, ativo: !!row.ativo };
}

// dominio '' (string vazia) representa "sem domínio especificado" — mantido como valor
// concreto (nao NULL) para o indice UNIQUE (termo, dominio) funcionar corretamente no SQLite,
// onde NULL nunca é igual a NULL em constraints UNIQUE.
function buscarPorTermo(termo, dominio = '') {
  const termoNorm = normalizarTermo(termo);
  if (!termoNorm) return null;
  const row = getDB().prepare(`
    SELECT * FROM analytic_glossary WHERE termo = ? AND dominio = ? AND ativo = 1
  `).get(termoNorm, normalizarDominio(dominio));
  return _parseRow(row);
}

function criar(payload = {}) {
  const ts = agora();
  const termoNorm = normalizarTermo(payload.termo);
  if (!termoNorm) throw new Error('analytic-glossary-store: termo obrigatorio.');
  if (!payload.definicaoTecnica) throw new Error('analytic-glossary-store: definicaoTecnica obrigatoria.');
  const dominioNorm = normalizarDominio(payload.dominio);

  // O indice UNIQUE (termo, dominio) cobre TODAS as linhas, ativas ou nao — uma entrada
  // desativada (ativo=0) continua ocupando o par termo+dominio. Sem este upsert, reaprender
  // um termo que ja foi desativado (ex: definicao tecnica corrigida apos bug) falha com
  // UNIQUE constraint no INSERT puro, e o caller (fail-open) segue sem glossario nenhum —
  // bug real confirmado em producao (07/09/2026, "analise vertical" apos correcao do prompt).
  const existenteQualquerStatus = getDB().prepare(`
    SELECT id FROM analytic_glossary WHERE termo = ? AND dominio = ?
  `).get(termoNorm, dominioNorm);

  if (existenteQualquerStatus) {
    getDB().prepare(`
      UPDATE analytic_glossary
      SET definicao_tecnica = ?, origem = ?, pergunta_origem = ?, ativo = 1, atualizado_em = ?
      WHERE id = ?
    `).run(
      payload.definicaoTecnica,
      payload.origem || 'ia_aprendido',
      payload.perguntaOrigem || null,
      ts,
      existenteQualquerStatus.id,
    );
    return existenteQualquerStatus.id;
  }

  const id = uuid();
  getDB().prepare(`
    INSERT INTO analytic_glossary (
      id, termo, dominio, definicao_tecnica, origem, pergunta_origem, ativo, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    termoNorm,
    dominioNorm,
    payload.definicaoTecnica,
    payload.origem || 'ia_aprendido',
    payload.perguntaOrigem || null,
    ts,
    ts,
  );
  return id;
}

function listar(opts = {}) {
  const somenteAtivos = opts.somenteAtivos !== false;
  const where = somenteAtivos ? 'WHERE ativo = 1' : '';
  const limit = Math.min(parseInt(opts.limit, 10) || 200, 1000);
  const rows = getDB().prepare(`
    SELECT * FROM analytic_glossary ${where} ORDER BY criado_em DESC LIMIT ?
  `).all(limit);
  return rows.map(_parseRow);
}

function obterPorId(id) {
  if (!id) return null;
  const row = getDB().prepare(`SELECT * FROM analytic_glossary WHERE id = ?`).get(id);
  return _parseRow(row);
}

function desativar(id) {
  const info = getDB().prepare(`
    UPDATE analytic_glossary SET ativo = 0, atualizado_em = ? WHERE id = ?
  `).run(agora(), id);
  return info.changes > 0;
}

function reativar(id) {
  const info = getDB().prepare(`
    UPDATE analytic_glossary SET ativo = 1, atualizado_em = ? WHERE id = ?
  `).run(agora(), id);
  return info.changes > 0;
}

// Edicao manual pelo painel admin — marca origem como 'admin_manual' para distinguir de
// entradas aprendidas automaticamente pela IA auxiliar (auditoria: quem definiu o texto final).
function atualizar(id, payload = {}) {
  if (!payload.definicaoTecnica) throw new Error('analytic-glossary-store: definicaoTecnica obrigatoria.');
  const info = getDB().prepare(`
    UPDATE analytic_glossary SET definicao_tecnica = ?, origem = 'admin_manual', atualizado_em = ? WHERE id = ?
  `).run(payload.definicaoTecnica, agora(), id);
  return info.changes > 0;
}

module.exports = {
  normalizarTermo,
  normalizarDominio,
  buscarPorTermo,
  criar,
  listar,
  obterPorId,
  atualizar,
  desativar,
  reativar,
};
