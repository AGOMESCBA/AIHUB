const crypto = require('crypto');
const { getDB } = require('../database');
const { redigirValor } = require('../services/redaction-service');

function _json(valor) {
  return valor === undefined || valor === null ? null : JSON.stringify(redigirValor(valor));
}

function _parse(valor, fallback = null) {
  if (!valor) return fallback;
  try { return redigirValor(JSON.parse(valor)); } catch (_) { return fallback; }
}

function _texto(valor) {
  return valor === undefined || valor === null ? null : redigirValor(String(valor));
}

function _row(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    atendimentoId: row.atendimento_id,
    dossieId: row.dossie_id,
    mensagemUsuarioId: row.mensagem_usuario_id,
    mensagemAssistenteId: row.mensagem_assistente_id,
    execucaoId: row.execucao_id,
    idempotencyKey: redigirValor(row.idempotency_key),
    provider: redigirValor(row.provider),
    model: redigirValor(row.model),
    status: redigirValor(row.status),
    interpretacao: _parse(row.interpretacao_json),
    proposta: _parse(row.proposta_json),
    estadoAnterior: _parse(row.estado_anterior_json),
    alteracoesAceitas: _parse(row.alteracoes_aceitas_json, []),
    alteracoesRejeitadas: _parse(row.alteracoes_rejeitadas_json, []),
    erro: redigirValor(row.erro),
    usage: _parse(row.usage_json),
    tentativas: _parse(row.tentativas_json, []),
    latenciaMs: row.latencia_ms,
    criadoEm: row.criado_em,
  };
}

function getPorIdempotencyKey(empresaId, atendimentoId, idempotencyKey, db = getDB()) {
  const row = db.prepare(`
    SELECT * FROM investigacao_dossie_atualizacoes
     WHERE empresa_id = ? AND atendimento_id = ? AND idempotency_key = ?
  `).get(Number(empresaId), atendimentoId, String(idempotencyKey));
  return _row(row);
}

function salvarAtualizacao(empresaId, dados, db = getDB()) {
  if (!empresaId) throw new Error('empresaId e obrigatorio.');
  if (!dados?.atendimentoId) throw new Error('atendimentoId e obrigatorio.');
  if (!dados?.dossieId) throw new Error('dossieId e obrigatorio.');
  if (!dados?.idempotencyKey) throw new Error('idempotencyKey e obrigatorio.');

  const id = dados.id || crypto.randomUUID();
  const agora = new Date().toISOString();
  db.prepare(`
    INSERT INTO investigacao_dossie_atualizacoes (
      id, empresa_id, atendimento_id, dossie_id, mensagem_usuario_id,
      mensagem_assistente_id, execucao_id, idempotency_key, provider, model,
      status, interpretacao_json, proposta_json, estado_anterior_json,
      alteracoes_aceitas_json, alteracoes_rejeitadas_json, erro, usage_json,
      tentativas_json, latencia_ms, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(empresaId),
    dados.atendimentoId,
    dados.dossieId,
    dados.mensagemUsuarioId ?? null,
    dados.mensagemAssistenteId ?? null,
    dados.execucaoId ?? null,
    String(dados.idempotencyKey),
    _texto(dados.provider),
    _texto(dados.model),
    dados.status || 'falha',
    _json(dados.interpretacao),
    _json(dados.proposta),
    _json(dados.estadoAnterior),
    _json(dados.alteracoesAceitas || []),
    _json(dados.alteracoesRejeitadas || []),
    _texto(dados.erro),
    _json(dados.usage),
    _json(dados.tentativas || []),
    dados.latenciaMs ?? null,
    agora
  );

  return getPorIdempotencyKey(empresaId, dados.atendimentoId, dados.idempotencyKey, db);
}

function listarPorAtendimento(empresaId, atendimentoId, { limite = 20 } = {}, db = getDB()) {
  const rows = db.prepare(`
    SELECT * FROM investigacao_dossie_atualizacoes
     WHERE empresa_id = ? AND atendimento_id = ?
     ORDER BY criado_em DESC
     LIMIT ?
  `).all(Number(empresaId), atendimentoId, Math.min(Number(limite) || 20, 100));
  return rows.map(_row);
}

module.exports = { getPorIdempotencyKey, salvarAtualizacao, listarPorAtendimento };
