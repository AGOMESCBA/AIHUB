const crypto = require('crypto');
const { getDB } = require('../database');
const { redigirValor } = require('../services/redaction-service');

function _json(valor) {
  return valor === undefined || valor === null ? null : JSON.stringify(redigirValor(valor));
}

function _parse(valor) {
  if (!valor) return null;
  try { return redigirValor(JSON.parse(valor)); } catch (_) { return null; }
}

function _rowParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    atendimentoId: row.atendimento_id,
    mensagemId: row.mensagem_id,
    mensagemUsuarioId: row.mensagem_usuario_id,
    provider: redigirValor(row.provider),
    model: redigirValor(row.model),
    status: redigirValor(row.status),
    manifesto: _parse(row.manifesto_json),
    contexto: _parse(row.contexto_json),
    pesquisa: _parse(row.pesquisa_json),
    qualityGate: _parse(row.quality_gate_json),
    usage: _parse(row.usage_json),
    tentativas: _parse(row.tentativas_json),
    tokensEstimadosPrompt: row.tokens_estimados_prompt,
    tokensEstimadosResposta: row.tokens_estimados_resposta,
    promptChars: row.prompt_chars,
    respostaChars: row.resposta_chars,
    respostaTruncada: !!row.resposta_truncada,
    latenciaMs: row.latencia_ms,
    retryDeQualityGate: !!row.retry_de_quality_gate,
    criadoEm: row.criado_em,
  };
}

function salvarExecucao(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!dados?.atendimentoId) throw new Error('atendimentoId é obrigatório.');

  const db = getDB();
  const id = dados.id || crypto.randomUUID();
  const agora = new Date().toISOString();

  const pertence = db.prepare(`
    SELECT 1 FROM atendimentos WHERE id = ? AND empresa_id = ?
  `).get(dados.atendimentoId, Number(empresaId));
  if (!pertence) throw new Error('Atendimento não encontrado nesta empresa.');

  db.prepare(`
    INSERT INTO investigacao_execucoes (
      id, empresa_id, atendimento_id, mensagem_id, mensagem_usuario_id,
      provider, model, status, manifesto_json, contexto_json, pesquisa_json,
      quality_gate_json, usage_json, tentativas_json, tokens_estimados_prompt,
      tokens_estimados_resposta, prompt_chars, resposta_chars, resposta_truncada,
      latencia_ms, retry_de_quality_gate, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(empresaId),
    dados.atendimentoId,
    dados.mensagemId ?? null,
    dados.mensagemUsuarioId ?? null,
    dados.provider ?? null,
    dados.model ?? null,
    dados.status || 'concluido',
    _json(dados.manifesto),
    _json(dados.contexto),
    _json(dados.pesquisa),
    _json(dados.qualityGate),
    _json(dados.usage),
    _json(dados.tentativas),
    dados.tokensEstimadosPrompt ?? null,
    dados.tokensEstimadosResposta ?? null,
    dados.promptChars ?? null,
    dados.respostaChars ?? null,
    dados.respostaTruncada ? 1 : 0,
    dados.latenciaMs ?? null,
    dados.retryDeQualityGate ? 1 : 0,
    agora
  );

  return getExecucao(empresaId, id);
}

function getExecucao(empresaId, id) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const row = db.prepare(`
    SELECT * FROM investigacao_execucoes WHERE id = ? AND empresa_id = ?
  `).get(id, Number(empresaId));
  return _rowParaDominio(row);
}

function listarPorAtendimento(empresaId, atendimentoId, { limite = 20 } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');
  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM investigacao_execucoes
     WHERE empresa_id = ? AND atendimento_id = ?
     ORDER BY criado_em DESC
     LIMIT ?
  `).all(Number(empresaId), atendimentoId, Math.min(Number(limite) || 20, 100));
  return rows.map(_rowParaDominio);
}

module.exports = { salvarExecucao, getExecucao, listarPorAtendimento };
