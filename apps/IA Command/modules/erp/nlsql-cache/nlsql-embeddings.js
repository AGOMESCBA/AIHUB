'use strict';

const aiProviderClient = require('../core/ai-provider-client');

const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'text-embedding-3-small';

function now() {
  return new Date().toISOString();
}

function parseJson(valor, fallback = null) {
  if (!valor) return fallback;
  if (typeof valor !== 'string') return valor;
  try { return JSON.parse(valor); } catch (_) { return fallback; }
}

function json(valor) {
  try { return JSON.stringify(valor ?? null); } catch (_) { return null; }
}

function limitarErro(err) {
  return String(err?.message || err || '').slice(0, 1000);
}

function moduloWhere(modulo, alias = '') {
  const m = String(modulo || '').trim().toLowerCase();
  if (!m) return null;
  const prefix = alias ? `${alias}.` : '';
  return { where: `${prefix}module = ?`, params: [m] };
}

function textoEmbeddingFromExample(row = {}) {
  const estrutural = parseJson(row.intent_canonico_estrutural_json, null);
  const canonico = parseJson(row.intent_canonico_json, null);
  const base = estrutural || {
    module: row.module || null,
    intent: row.intent || null,
    metric: parseJson(row.metric_json, []),
    date_basis: row.date_basis || null,
    group_by: parseJson(row.group_by_json, []),
    filter_keys: parseJson(row.filter_keys_json, []),
    entity_types: parseJson(row.entity_types_json, []),
    security_scope: parseJson(row.security_scope_json, null),
    prompt_version: row.prompt_version || null,
    spec_version: row.spec_version || null,
    schema_version: row.schema_version || null,
    model: row.model || null,
  };
  return JSON.stringify({
    tipo: 'iac-nlsql-intent-estrutural',
    estrutural: base,
    canonico_minimo: canonico ? {
      module: canonico.module || null,
      intent: canonico.intent || null,
      metric: canonico.metric || null,
      date_basis: canonico.date_basis || null,
      group_by: canonico.group_by || null,
      filter_keys: Object.keys(canonico.filters || {}).sort(),
    } : null,
  });
}

function textoEmbeddingFromCanonical({ canonical = {}, structural = null } = {}) {
  const base = structural || {
    module: canonical.module || null,
    intent: canonical.intent || null,
    metric: canonical.metric || null,
    date_basis: canonical.date_basis || null,
    group_by: canonical.group_by || null,
    filter_keys: Object.keys(canonical.filters || {}).sort(),
    entity_types: Array.isArray(canonical.entities)
      ? canonical.entities.map(e => ({
        tipo: e?.tipo || null,
        tem_loja: e?.loja != null,
        security: !!e?.security,
      })).filter(e => e.tipo)
      : [],
    security_scope: canonical.security_scope || null,
    empresa_id: canonical.empresa_id ?? null,
    prompt_version: canonical.prompt_version || null,
    spec_version: canonical.spec_version || null,
    schema_version: canonical.schema_version || null,
    model: canonical.model || null,
  };
  return JSON.stringify({
    tipo: 'iac-nlsql-intent-estrutural',
    estrutural: base,
    canonico_minimo: {
      module: canonical.module || null,
      intent: canonical.intent || null,
      metric: canonical.metric || null,
      date_basis: canonical.date_basis || null,
      group_by: canonical.group_by || null,
      filter_keys: Object.keys(canonical.filters || {}).sort(),
    },
  });
}

function cosineSimilarity(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return null;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function resolverConfigEmbedding(empresaId) {
  const { keys } = await aiProviderClient.resolverKeysEOrdem(empresaId);
  const provider = String(process.env.IAC_NLSQL_EMBEDDING_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  const model = String(process.env.IAC_NLSQL_EMBEDDING_MODEL || DEFAULT_MODEL).trim();
  if (provider !== 'openai') throw new Error(`Provider de embeddings nao suportado: ${provider}`);
  const apiKey = keys?.openai || process.env.OPENAI_API_KEY || null;
  if (!apiKey) throw new Error('Chave OpenAI nao configurada para embeddings NL-SQL.');
  return { provider, model, apiKey };
}

async function gerarEmbeddingOpenAI({ apiKey, model, input, timeoutMs = 30000 }) {
  const parsed = await aiProviderClient._httpPost(
    'api.openai.com',
    '/v1/embeddings',
    { Authorization: `Bearer ${apiKey}` },
    { model, input },
    timeoutMs,
  );
  const embedding = parsed?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || !embedding.length) throw new Error('Resposta de embedding sem vetor.');
  return {
    embedding,
    usage: parsed.usage || null,
  };
}

async function gerarEmbeddingTexto({ empresaId, input } = {}) {
  if (!input) throw new Error('Texto de embedding NL-SQL vazio.');
  const cfg = await resolverConfigEmbedding(empresaId);
  const gerado = await gerarEmbeddingOpenAI({
    apiKey: cfg.apiKey,
    model: cfg.model,
    input,
    timeoutMs: Number(process.env.IAC_NLSQL_EMBEDDING_TIMEOUT_MS || 30000),
  });
  return {
    provider: cfg.provider,
    model: cfg.model,
    embedding: gerado.embedding,
    usage: gerado.usage || null,
  };
}

function statusEmbeddings({ empresaId, modulo = '', db = null } = {}) {
  const database = db || require('../../database').getDB();
  const wheres = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  const moduloFiltro = moduloWhere(modulo);
  if (moduloFiltro) {
    wheres.push(moduloFiltro.where);
    params.push(...moduloFiltro.params);
  }
  const row = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN embedding_status = 'pendente' THEN 1 ELSE 0 END) AS pendentes,
      SUM(CASE WHEN embedding_status = 'processando' THEN 1 ELSE 0 END) AS processando,
      SUM(CASE WHEN embedding_status = 'ok' THEN 1 ELSE 0 END) AS ok,
      SUM(CASE WHEN embedding_status = 'erro' THEN 1 ELSE 0 END) AS erro,
      SUM(CASE WHEN embedding_json IS NOT NULL THEN 1 ELSE 0 END) AS com_embedding
      FROM nlsql_semantic_examples
     WHERE ${wheres.join(' AND ')}
  `).get(...params);
  return {
    total: Number(row?.total || 0),
    pendentes: Number(row?.pendentes || 0),
    processando: Number(row?.processando || 0),
    ok: Number(row?.ok || 0),
    erro: Number(row?.erro || 0),
    com_embedding: Number(row?.com_embedding || 0),
  };
}

function listarPendentes({ empresaId, limit = 50, modulo = '', incluirErros = false, db = null } = {}) {
  const database = db || require('../../database').getDB();
  const wheres = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  const statusFiltro = incluirErros
    ? "embedding_status IN ('pendente', 'erro')"
    : "embedding_status = 'pendente'";
  wheres.push(statusFiltro);
  const moduloFiltro = moduloWhere(modulo);
  if (moduloFiltro) {
    wheres.push(moduloFiltro.where);
    params.push(...moduloFiltro.params);
  }
  params.push(Math.max(1, Math.min(Number(limit) || 50, 500)));
  return database.prepare(`
    SELECT *
      FROM nlsql_semantic_examples
     WHERE ${wheres.join(' AND ')}
     ORDER BY criado_em ASC
     LIMIT ?
  `).all(...params);
}

async function processarPendentes({ empresaId, limit = 50, modulo = '', incluirErros = false, db = null } = {}) {
  const database = db || require('../../database').getDB();
  const cfg = await resolverConfigEmbedding(empresaId);
  const rows = listarPendentes({ empresaId, limit, modulo, incluirErros, db: database });
  const updateProcessando = database.prepare(`
    UPDATE nlsql_semantic_examples
       SET embedding_status = 'processando',
           embedding_provider = ?,
           embedding_model = ?,
           embedding_error = NULL,
           atualizado_em = ?
     WHERE id = ?
  `);
  const updateOk = database.prepare(`
    UPDATE nlsql_semantic_examples
       SET embedding_json = ?,
           embedding_provider = ?,
           embedding_model = ?,
           embedding_status = 'ok',
           embedding_error = NULL,
           atualizado_em = ?
     WHERE id = ?
  `);
  const updateErro = database.prepare(`
    UPDATE nlsql_semantic_examples
       SET embedding_status = 'erro',
           embedding_provider = ?,
           embedding_model = ?,
           embedding_error = ?,
           atualizado_em = ?
     WHERE id = ?
  `);

  const detalhes = [];
  let processados = 0;
  let erros = 0;
  for (const row of rows) {
    updateProcessando.run(cfg.provider, cfg.model, now(), row.id);
    try {
      const input = textoEmbeddingFromExample(row);
      const gerado = await gerarEmbeddingOpenAI({
        apiKey: cfg.apiKey,
        model: cfg.model,
        input,
        timeoutMs: Number(process.env.IAC_NLSQL_EMBEDDING_TIMEOUT_MS || 30000),
      });
      updateOk.run(json(gerado.embedding), cfg.provider, cfg.model, now(), row.id);
      processados += 1;
      detalhes.push({ id: row.id, execution_log_id: row.execution_log_id, status: 'ok', dimensoes: gerado.embedding.length });
    } catch (err) {
      erros += 1;
      updateErro.run(cfg.provider, cfg.model, limitarErro(err), now(), row.id);
      detalhes.push({ id: row.id, execution_log_id: row.execution_log_id, status: 'erro', erro: limitarErro(err) });
    }
  }
  return {
    provider: cfg.provider,
    model: cfg.model,
    candidatos: rows.length,
    processados,
    erros,
    detalhes,
  };
}

module.exports = {
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
  textoEmbeddingFromExample,
  textoEmbeddingFromCanonical,
  cosineSimilarity,
  gerarEmbeddingTexto,
  statusEmbeddings,
  listarPendentes,
  processarPendentes,
  _test: {
    parseJson,
    textoEmbeddingFromExample,
    textoEmbeddingFromCanonical,
    cosineSimilarity,
  },
};
