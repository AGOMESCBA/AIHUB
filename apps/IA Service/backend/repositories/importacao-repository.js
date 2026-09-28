// Repository de `raw_import`, `importacoes`, `importacao_inconsistencias`.

const crypto = require('crypto');
const { getDB } = require('../database');

function hashJson(objeto) {
  return crypto.createHash('sha256').update(JSON.stringify(objeto)).digest('hex');
}

// ── RAW ──────────────────────────────────────────────────────────────────

/**
 * Upsert do RAW por (empresa, fonte, tabela_origem, oid_origem). Só grava se
 * o hash mudou (seção 15/21 do prompt) — retorna se houve escrita ou não,
 * para o importador não contar RAW "sem alteração" como inserção.
 */
function upsertRaw(empresaId, { fonteId, sistemaOrigem, tabelaOrigem, oidOrigem, dados, importacaoId }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  const hash = hashJson(dados);

  const existente = db.prepare(`
    SELECT id, hash_conteudo FROM raw_import WHERE empresa_id = ? AND fonte_id = ? AND tabela_origem = ? AND oid_origem = ?
  `).get(Number(empresaId), fonteId, tabelaOrigem, oidOrigem);

  if (existente) {
    if (existente.hash_conteudo === hash) return { escreveu: false, id: existente.id };
    db.prepare(`
      UPDATE raw_import SET dados_json = ?, hash_conteudo = ?, importacao_id = ?, importado_em = ? WHERE id = ?
    `).run(JSON.stringify(dados), hash, importacaoId ?? null, agora, existente.id);
    return { escreveu: true, id: existente.id };
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO raw_import (id, empresa_id, fonte_id, sistema_origem, tabela_origem, oid_origem, dados_json, hash_conteudo, importacao_id, importado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, Number(empresaId), fonteId, sistemaOrigem, tabelaOrigem, oidOrigem, JSON.stringify(dados), hash, importacaoId ?? null, agora);
  return { escreveu: true, id };
}

function contarRaw(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (filtros.fonteId) { condicoes.push('fonte_id = ?'); params.push(filtros.fonteId); }
  if (filtros.tabelaOrigem) { condicoes.push('tabela_origem = ?'); params.push(filtros.tabelaOrigem); }
  return db.prepare(`SELECT COUNT(*) AS total FROM raw_import WHERE ${condicoes.join(' AND ')}`).get(...params).total;
}

// ── Importações (controle) ──────────────────────────────────────────────

function _importacaoParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id, empresaId: row.empresa_id, fonteId: row.fonte_id, tipo: row.tipo, status: row.status,
    periodoInicio: row.periodo_inicio, periodoFim: row.periodo_fim,
    checkpoint: row.checkpoint_json ? JSON.parse(row.checkpoint_json) : null,
    registrosLidos: row.registros_lidos, registrosInseridos: row.registros_inseridos,
    registrosAtualizados: row.registros_atualizados, registrosIgnorados: row.registros_ignorados,
    registrosErro: row.registros_erro,
    posicionamentosLidos: row.posicionamentos_lidos, posicionamentosInseridos: row.posicionamentos_inseridos,
    posicionamentosAtualizados: row.posicionamentos_atualizados,
    mensagemErro: row.mensagem_erro, inicioEm: row.inicio_em, terminoEm: row.termino_em,
    criadoEm: row.criado_em, atualizadoEm: row.atualizado_em,
  };
}

function criarImportacao(empresaId, { fonteId, tipo, periodoInicio, periodoFim }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  db.prepare(`
    INSERT INTO importacoes (id, empresa_id, fonte_id, tipo, status, periodo_inicio, periodo_fim, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, 'pendente', ?, ?, ?, ?)
  `).run(id, Number(empresaId), fonteId, tipo || 'full', periodoInicio ?? null, periodoFim ?? null, agora, agora);
  return getImportacao(empresaId, id);
}

function getImportacao(empresaId, importacaoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return _importacaoParaDominio(db.prepare(`SELECT * FROM importacoes WHERE id = ? AND empresa_id = ?`).get(importacaoId, Number(empresaId)));
}

function listarImportacoes(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (filtros.fonteId) { condicoes.push('fonte_id = ?'); params.push(filtros.fonteId); }
  const limite = Math.min(Number(filtros.limite) || 50, 500);
  const rows = db.prepare(`SELECT * FROM importacoes WHERE ${condicoes.join(' AND ')} ORDER BY criado_em DESC LIMIT ?`).all(...params, limite);
  return rows.map(_importacaoParaDominio);
}

function atualizarImportacao(empresaId, importacaoId, patch) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  const atual = getImportacao(empresaId, importacaoId);
  if (!atual) return null;

  const campos = {
    status: patch.status ?? atual.status,
    checkpoint_json: patch.checkpoint !== undefined ? JSON.stringify(patch.checkpoint) : (atual.checkpoint ? JSON.stringify(atual.checkpoint) : null),
    registros_lidos: patch.registrosLidos ?? atual.registrosLidos,
    registros_inseridos: patch.registrosInseridos ?? atual.registrosInseridos,
    registros_atualizados: patch.registrosAtualizados ?? atual.registrosAtualizados,
    registros_ignorados: patch.registrosIgnorados ?? atual.registrosIgnorados,
    registros_erro: patch.registrosErro ?? atual.registrosErro,
    posicionamentos_lidos: patch.posicionamentosLidos ?? atual.posicionamentosLidos,
    posicionamentos_inseridos: patch.posicionamentosInseridos ?? atual.posicionamentosInseridos,
    posicionamentos_atualizados: patch.posicionamentosAtualizados ?? atual.posicionamentosAtualizados,
    mensagem_erro: patch.mensagemErro !== undefined ? patch.mensagemErro : atual.mensagemErro,
    inicio_em: patch.inicioEm !== undefined ? patch.inicioEm : atual.inicioEm,
    termino_em: patch.terminoEm !== undefined ? patch.terminoEm : atual.terminoEm,
  };

  db.prepare(`
    UPDATE importacoes SET status = ?, checkpoint_json = ?, registros_lidos = ?, registros_inseridos = ?,
      registros_atualizados = ?, registros_ignorados = ?, registros_erro = ?,
      posicionamentos_lidos = ?, posicionamentos_inseridos = ?, posicionamentos_atualizados = ?,
      mensagem_erro = ?, inicio_em = ?, termino_em = ?, atualizado_em = ?
    WHERE id = ? AND empresa_id = ?
  `).run(
    campos.status, campos.checkpoint_json, campos.registros_lidos, campos.registros_inseridos,
    campos.registros_atualizados, campos.registros_ignorados, campos.registros_erro,
    campos.posicionamentos_lidos, campos.posicionamentos_inseridos, campos.posicionamentos_atualizados,
    campos.mensagem_erro, campos.inicio_em, campos.termino_em, agora, importacaoId, Number(empresaId)
  );

  return getImportacao(empresaId, importacaoId);
}

// ── Inconsistências ──────────────────────────────────────────────────────

function registrarInconsistencia(empresaId, { importacaoId, tipoEntidade, oidOrigem, tipoInconsistencia, detalhe }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  db.prepare(`
    INSERT INTO importacao_inconsistencias (id, empresa_id, importacao_id, tipo_entidade, oid_origem, tipo_inconsistencia, detalhe, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, Number(empresaId), importacaoId, tipoEntidade, oidOrigem ?? null, tipoInconsistencia, detalhe ?? null, agora);
  return id;
}

function listarInconsistencias(empresaId, importacaoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM importacao_inconsistencias WHERE empresa_id = ? AND importacao_id = ? ORDER BY criado_em ASC
  `).all(Number(empresaId), importacaoId);
  return rows.map(r => ({
    id: r.id, tipoEntidade: r.tipo_entidade, oidOrigem: r.oid_origem,
    tipoInconsistencia: r.tipo_inconsistencia, detalhe: r.detalhe, criadoEm: r.criado_em,
  }));
}

module.exports = {
  hashJson,
  upsertRaw, contarRaw,
  criarImportacao, getImportacao, listarImportacoes, atualizarImportacao,
  registrarInconsistencia, listarInconsistencias,
};
