'use strict';

const crypto = require('crypto');
const { getDB } = require('../database');

const DEFAULT_PRICES = [
  { provider: 'groq', model: 'openai/gpt-oss-20b', input: 0.075, output: 0.30 },
  { provider: 'openai', model: 'gpt-4o-mini', input: 0.15, output: 0.60 },
  { provider: 'gemini', model: 'gemini-3.5-flash', input: 1.50, output: 9.00 },
  { provider: 'deepseek', model: 'deepseek-chat', input: 0.27, output: 1.10 },
  { provider: 'claude', model: 'claude-haiku-4-5-20251001', input: 0.80, output: 4.00 },
];

function nowIso() {
  return new Date().toISOString();
}

function normalizarProvider(valor) {
  return String(valor || '').trim().toLowerCase();
}

function normalizarModel(valor) {
  return String(valor || '').trim();
}

function tokensFromUsage(usage = {}) {
  const input = Number(
    usage.prompt_tokens ??
    usage.input_tokens ??
    usage.promptTokenCount ??
    usage.inputTokenCount ??
    0
  ) || 0;
  const output = Number(
    usage.completion_tokens ??
    usage.output_tokens ??
    usage.candidatesTokenCount ??
    usage.outputTokenCount ??
    0
  ) || 0;
  const total = Number(usage.total_tokens ?? usage.totalTokens ?? usage.totalTokenCount ?? (input + output)) || 0;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total || input + output,
  };
}

function garantirPrecosPadrao() {
  const db = getDB();
  const count = db.prepare('SELECT COUNT(*) AS total FROM ia_usage_pricing').get()?.total || 0;
  if (count > 0) return;
  const agora = nowIso();
  const insert = db.prepare(`
    INSERT INTO ia_usage_pricing
      (id, provider, model, moeda, preco_input_1m, preco_output_1m, ativo, vigente_desde, criado_em, atualizado_em)
    VALUES (?, ?, ?, 'USD', ?, ?, 1, ?, ?, ?)
  `);
  const vigente = agora.slice(0, 10);
  const tx = db.transaction(() => {
    for (const row of DEFAULT_PRICES) {
      insert.run(crypto.randomUUID(), row.provider, row.model, row.input, row.output, vigente, agora, agora);
    }
  });
  tx();
}

function buscarPreco(provider, model) {
  garantirPrecosPadrao();
  const prov = normalizarProvider(provider);
  const mdl = normalizarModel(model);
  const db = getDB();
  return db.prepare(`
    SELECT *
      FROM ia_usage_pricing
     WHERE ativo = 1
       AND provider = ?
       AND (model = ? OR model = '*')
     ORDER BY CASE WHEN model = ? THEN 0 ELSE 1 END, vigente_desde DESC
     LIMIT 1
  `).get(prov, mdl, mdl) || {
    moeda: 'USD',
    preco_input_1m: 0,
    preco_output_1m: 0,
  };
}

function calcularCusto(tokens, preco) {
  const input = (Number(tokens.input_tokens) || 0) * (Number(preco.preco_input_1m) || 0) / 1000000;
  const output = (Number(tokens.output_tokens) || 0) * (Number(preco.preco_output_1m) || 0) / 1000000;
  return Number((input + output).toFixed(8));
}

function registrarUso(evento = {}) {
  if (!evento.provider) return null;
  const empresaId = evento.empresaId ?? evento.empresa_id ?? null;
  const provider = normalizarProvider(evento.provider);
  const model = normalizarModel(evento.model);
  const tokens = tokensFromUsage(evento.usage || evento);
  const preco = buscarPreco(provider, model);
  const custo = calcularCusto(tokens, preco);
  const row = {
    id: crypto.randomUUID(),
    empresa_id: empresaId ? Number(empresaId) : null,
    canal_id: evento.canalId || evento.canal_id || null,
    numero_wa: evento.numeroWa || evento.numero_wa || null,
    provider,
    model,
    operacao: evento.operacao || null,
    origem: evento.origem || null,
    ok: evento.ok === false ? 0 : 1,
    error: evento.error ? String(evento.error).slice(0, 500) : null,
    input_tokens: tokens.input_tokens,
    output_tokens: tokens.output_tokens,
    total_tokens: tokens.total_tokens,
    preco_input_1m: Number(preco.preco_input_1m) || 0,
    preco_output_1m: Number(preco.preco_output_1m) || 0,
    moeda: preco.moeda || 'USD',
    custo_estimado_usd: custo,
    criado_em: nowIso(),
  };
  getDB().prepare(`
    INSERT INTO ia_usage_events
      (id, empresa_id, canal_id, numero_wa, provider, model, operacao, origem, ok, error,
       input_tokens, output_tokens, total_tokens, preco_input_1m, preco_output_1m, moeda,
       custo_estimado_usd, criado_em)
    VALUES
      (@id, @empresa_id, @canal_id, @numero_wa, @provider, @model, @operacao, @origem, @ok, @error,
       @input_tokens, @output_tokens, @total_tokens, @preco_input_1m, @preco_output_1m, @moeda,
       @custo_estimado_usd, @criado_em)
  `).run(row);
  return row;
}

function periodoPadrao() {
  const fim = new Date();
  const inicio = new Date(fim);
  inicio.setDate(1);
  return { inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
}

function montarWhere({ empresaId, inicio, fim, provider } = {}) {
  const where = [];
  const params = {};
  if (empresaId) { where.push('empresa_id = @empresaId'); params.empresaId = Number(empresaId); }
  if (inicio) { where.push('date(criado_em) >= date(@inicio)'); params.inicio = inicio; }
  if (fim) { where.push('date(criado_em) <= date(@fim)'); params.fim = fim; }
  if (provider) { where.push('provider = @provider'); params.provider = normalizarProvider(provider); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function listarEventos(filtros = {}) {
  const { inicio, fim } = filtros.inicio || filtros.fim ? filtros : periodoPadrao();
  const { sql, params } = montarWhere({ ...filtros, inicio, fim });
  const limit = Math.min(Math.max(Number(filtros.limit) || 300, 1), 1000);
  return getDB().prepare(`
    SELECT *
      FROM ia_usage_events
      ${sql}
     ORDER BY criado_em DESC
     LIMIT @limit
  `).all({ ...params, limit });
}

function resumir(filtros = {}) {
  const { inicio, fim } = filtros.inicio || filtros.fim ? filtros : periodoPadrao();
  const agrupamento = ['dia', 'mes', 'ano', 'provider', 'numero_wa', 'operacao'].includes(filtros.agrupamento)
    ? filtros.agrupamento
    : 'dia';
  const expr = {
    dia: "date(criado_em)",
    mes: "strftime('%Y-%m', criado_em)",
    ano: "strftime('%Y', criado_em)",
    provider: 'provider',
    numero_wa: "COALESCE(numero_wa, '')",
    operacao: "COALESCE(operacao, '')",
  }[agrupamento];
  const { sql, params } = montarWhere({ ...filtros, inicio, fim });
  return getDB().prepare(`
    SELECT ${expr} AS grupo,
           COUNT(*) AS chamadas,
           SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens,
           SUM(total_tokens) AS total_tokens,
           ROUND(SUM(custo_estimado_usd), 8) AS custo_estimado_usd
      FROM ia_usage_events
      ${sql}
     GROUP BY ${expr}
     ORDER BY grupo DESC
  `).all(params);
}

function listarPrecos() {
  garantirPrecosPadrao();
  return getDB().prepare('SELECT * FROM ia_usage_pricing ORDER BY provider, model, vigente_desde DESC').all();
}

function salvarPreco(dados = {}) {
  const provider = normalizarProvider(dados.provider);
  const model = normalizarModel(dados.model);
  if (!provider || !model) throw new Error('Provider e modelo sao obrigatorios.');
  const agora = nowIso();
  const row = {
    id: dados.id || crypto.randomUUID(),
    provider,
    model,
    moeda: dados.moeda || 'USD',
    preco_input_1m: Number(dados.preco_input_1m) || 0,
    preco_output_1m: Number(dados.preco_output_1m) || 0,
    ativo: dados.ativo === false || Number(dados.ativo) === 0 ? 0 : 1,
    vigente_desde: dados.vigente_desde || agora.slice(0, 10),
    criado_em: agora,
    atualizado_em: agora,
  };
  getDB().prepare(`
    INSERT INTO ia_usage_pricing
      (id, provider, model, moeda, preco_input_1m, preco_output_1m, ativo, vigente_desde, criado_em, atualizado_em)
    VALUES
      (@id, @provider, @model, @moeda, @preco_input_1m, @preco_output_1m, @ativo, @vigente_desde, @criado_em, @atualizado_em)
    ON CONFLICT(provider, model, vigente_desde) DO UPDATE SET
      moeda = excluded.moeda,
      preco_input_1m = excluded.preco_input_1m,
      preco_output_1m = excluded.preco_output_1m,
      ativo = excluded.ativo,
      atualizado_em = excluded.atualizado_em
  `).run(row);
  return buscarPreco(provider, model);
}

module.exports = {
  tokensFromUsage,
  registrarUso,
  listarEventos,
  resumir,
  listarPrecos,
  salvarPreco,
  buscarPreco,
  garantirPrecosPadrao,
};
