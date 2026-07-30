'use strict';

const crypto = require('crypto');
const sqlTemplate = require('./sql-template');
const nlsqlEmbeddings = require('./nlsql-embeddings');
const nlsqlClassificacao = require('./nlsql-classificacao');

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

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

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim();
}

function lista(valor) {
  if (!valor) return [];
  return Array.isArray(valor) ? valor.filter(v => v !== null && v !== undefined && v !== '') : [valor];
}

function intersecaoScore(a = [], b = []) {
  const aa = new Set(lista(a).map(v => String(v)));
  const bb = new Set(lista(b).map(v => String(v)));
  if (!aa.size && !bb.size) return 1;
  if (!aa.size || !bb.size) return 0;
  let inter = 0;
  for (const v of aa) if (bb.has(v)) inter += 1;
  return inter / Math.max(aa.size, bb.size);
}

function structuralFromCanonical(canonico = {}) {
  return {
    module: canonico.module || null,
    intent: canonico.intent || null,
    metric: lista(canonico.metric),
    date_basis: canonico.date_basis || null,
    group_by: lista(canonico.group_by),
    filter_keys: Object.keys(canonico.filters || {}).sort(),
    entity_types: lista(canonico.entities).map(e => ({
      tipo: e?.tipo || null,
      tem_loja: e?.loja != null,
      security: !!e?.security,
    })).filter(e => e.tipo),
    security_scope: canonico.security_scope || null,
    empresa_id: canonico.empresa_id ?? null,
    prompt_version: canonico.prompt_version || null,
    spec_version: canonico.spec_version || null,
    schema_version: canonico.schema_version || null,
    model: canonico.model || null,
  };
}

function searchTextFrom({ canonico = {}, estrutural = {}, row = {} } = {}) {
  return [
    row.texto_original,
    canonico.module,
    canonico.intent,
    ...(canonico.metric || []),
    canonico.date_basis,
    ...(canonico.group_by || []),
    ...Object.keys(canonico.filters || {}),
    ...(canonico.entities || []).flatMap(e => [e?.tipo, e?.nome]),
    estrutural.module,
    estrutural.intent,
  ].filter(Boolean).map(normalizarTexto).filter(Boolean).join(' ');
}

function securityKey(scope) {
  return json(scope || null);
}

function idExecucaoValido(valor) {
  const v = String(valor || '').trim();
  if (!v) return false;
  if (/^(admin|usuario|user|sistema)$/i.test(v)) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    || /^[a-z0-9_-]{12,}$/i.test(v);
}

function normalizarExecutionLogId(valor) {
  const v = String(valor || '').trim();
  return idExecucaoValido(v) ? v : null;
}

function exampleFromExecutionRow(row = {}) {
  const canonico = parseJson(row.intent_canonico_json, null);
  if (!canonico || typeof canonico !== 'object') return null;
  const estrutural = parseJson(row.intent_canonico_estrutural_json, null) || structuralFromCanonical(canonico);
  const searchText = searchTextFrom({ canonico, estrutural, row });
  if (!searchText || !row.sql_template) return null;
  const executionLogId = normalizarExecutionLogId(row.correlation_id);
  if (!executionLogId) return null;
  return {
    id: uuid(),
    execution_log_id: executionLogId,
    empresa_id: Number(row.empresa_id),
    numero_wa: row.numero_wa || null,
    module: canonico.module || estrutural.module || null,
    intent: canonico.intent || estrutural.intent || null,
    metric: lista(canonico.metric || estrutural.metric),
    date_basis: canonico.date_basis || estrutural.date_basis || null,
    group_by: lista(canonico.group_by || estrutural.group_by),
    filter_keys: Object.keys(canonico.filters || {}).sort().length
      ? Object.keys(canonico.filters || {}).sort()
      : lista(estrutural.filter_keys),
    entity_types: lista(estrutural.entity_types || (canonico.entities || []).map(e => ({ tipo: e?.tipo, tem_loja: e?.loja != null, security: !!e?.security }))),
    security_scope: canonico.security_scope || estrutural.security_scope || null,
    prompt_version: row.prompt_version || canonico.prompt_version || null,
    spec_version: row.spec_version || canonico.spec_version || null,
    schema_version: row.schema_version || canonico.schema_version || null,
    model: row.model || canonico.model || null,
    chave_cache: row.chave_cache || null,
    intent_canonico_hash: row.intent_canonico_hash || null,
    intent_canonico_json: json(canonico),
    intent_canonico_estrutural_json: json(estrutural),
    search_text: searchText,
    sql_template: row.sql_template,
    sql_final_executado: row.sql_final_executado || null,
  };
}

function inserirExemplo(db, exemplo) {
  const ts = now();
  db.prepare(`
    INSERT OR IGNORE INTO nlsql_semantic_examples (
      id, execution_log_id, empresa_id, numero_wa, module, intent, metric_json, date_basis,
      group_by_json, filter_keys_json, entity_types_json, security_scope_json,
      prompt_version, spec_version, schema_version, model, chave_cache, intent_canonico_hash,
      intent_canonico_json, intent_canonico_estrutural_json, search_text, sql_template,
      sql_final_executado, embedding_status, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    exemplo.id,
    exemplo.execution_log_id,
    exemplo.empresa_id,
    exemplo.numero_wa,
    exemplo.module,
    exemplo.intent,
    json(exemplo.metric),
    exemplo.date_basis,
    json(exemplo.group_by),
    json(exemplo.filter_keys),
    json(exemplo.entity_types),
    securityKey(exemplo.security_scope),
    exemplo.prompt_version,
    exemplo.spec_version,
    exemplo.schema_version,
    exemplo.model,
    exemplo.chave_cache,
    exemplo.intent_canonico_hash,
    exemplo.intent_canonico_json,
    exemplo.intent_canonico_estrutural_json,
    exemplo.search_text,
    exemplo.sql_template,
    exemplo.sql_final_executado,
    'pendente',
    ts,
    ts,
  );
}

function moduloWhereClause(modulo) {
  const m = String(modulo || '').trim().toLowerCase();
  if (!m) return null;
  return {
    where: `(e.intent_canonico_json LIKE ? OR e.intent_canonico_json LIKE ?)`,
    params: [`%"module":"${m}"%`, `%"module": "${m}"%`],
  };
}

function filtrosBackfill({ empresaId, inicio = '', fim = '', modulo = '', somentePendentes = false } = {}) {
  const wheres = [
    'e.empresa_id = ?',
    "e.cache_status = 'confiavel'",
    'e.confiavel_cache = 1',
    'e.intent_canonico_json IS NOT NULL',
    'e.sql_template IS NOT NULL',
    'e.sql_final_executado IS NOT NULL',
    "TRIM(e.sql_template) NOT LIKE '-- ERRO:%'",
    "TRIM(e.sql_final_executado) NOT LIKE '-- ERRO:%'",
    "e.sql_template NOT LIKE '%SQL rejeitado por contrato%'",
    "e.sql_template NOT LIKE '%SQL rejeitado por periodo inconsistente%'",
    "e.sql_final_executado NOT LIKE '%SQL rejeitado por contrato%'",
    "e.sql_final_executado NOT LIKE '%SQL rejeitado por periodo inconsistente%'",
  ];
  const params = [Number(empresaId)];
  if (inicio) { wheres.push('e.criado_em >= ?'); params.push(`${inicio}T00:00:00.000`); }
  if (fim) { wheres.push('e.criado_em <= ?'); params.push(`${fim}T23:59:59.999`); }
  const moduloFiltro = moduloWhereClause(modulo);
  if (moduloFiltro) {
    wheres.push(moduloFiltro.where);
    params.push(...moduloFiltro.params);
  }
  if (somentePendentes) wheres.push('x.execution_log_id IS NULL');
  return { wheres, params };
}

function statusBackfill({ empresaId, inicio = '', fim = '', modulo = '', db = null } = {}) {
  const database = db || require('../../database').getDB();
  const baseWheres = [
    'e.empresa_id = ?',
    "e.cache_status = 'confiavel'",
    'e.confiavel_cache = 1',
    'e.sql_final_executado IS NOT NULL',
    "TRIM(e.sql_final_executado) NOT LIKE '-- ERRO:%'",
    "e.sql_final_executado NOT LIKE '%SQL rejeitado por contrato%'",
    "e.sql_final_executado NOT LIKE '%SQL rejeitado por periodo inconsistente%'",
  ];
  const baseParams = [Number(empresaId)];
  if (inicio) { baseWheres.push('e.criado_em >= ?'); baseParams.push(`${inicio}T00:00:00.000`); }
  if (fim) { baseWheres.push('e.criado_em <= ?'); baseParams.push(`${fim}T23:59:59.999`); }
  const moduloFiltro = moduloWhereClause(modulo);
  if (moduloFiltro) {
    baseWheres.push(moduloFiltro.where);
    baseParams.push(...moduloFiltro.params);
  }

  const confiaveis = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN e.intent_canonico_json IS NULL THEN 1 ELSE 0 END) AS sem_intent,
      SUM(CASE WHEN e.sql_template IS NULL THEN 1 ELSE 0 END) AS sem_template
      FROM execution_log e
     WHERE ${baseWheres.join(' AND ')}
  `).get(...baseParams);

  const elegiveisFiltro = filtrosBackfill({ empresaId, inicio, fim, modulo, somentePendentes: false });
  const elegiveis = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN x.execution_log_id IS NOT NULL THEN 1 ELSE 0 END) AS ja_indexados,
      SUM(CASE WHEN x.execution_log_id IS NULL THEN 1 ELSE 0 END) AS pendentes
      FROM execution_log e
      LEFT JOIN nlsql_semantic_examples x ON x.execution_log_id = e.correlation_id
     WHERE ${elegiveisFiltro.wheres.join(' AND ')}
  `).get(...elegiveisFiltro.params);

  return {
    confiaveis: Number(confiaveis?.total || 0),
    elegiveis: Number(elegiveis?.total || 0),
    ja_indexados: Number(elegiveis?.ja_indexados || 0),
    pendentes: Number(elegiveis?.pendentes || 0),
    sem_intent: Number(confiaveis?.sem_intent || 0),
    sem_template: Number(confiaveis?.sem_template || 0),
  };
}

function backfillConfiaveis({ empresaId, limit = 200, inicio = '', fim = '', modulo = '', db = null } = {}) {
  const database = db || require('../../database').getDB();
  const filtro = filtrosBackfill({ empresaId, inicio, fim, modulo, somentePendentes: true });
  const rows = database.prepare(`
    SELECT e.*
      FROM execution_log e
      LEFT JOIN nlsql_semantic_examples x ON x.execution_log_id = e.correlation_id
     WHERE ${filtro.wheres.join(' AND ')}
     ORDER BY e.criado_em DESC
     LIMIT ?
  `).all(...filtro.params, Math.max(1, Math.min(Number(limit) || 200, 1000)));

  let inseridos = 0;
  let ignorados = 0;
  for (const row of rows) {
    const exemplo = exampleFromExecutionRow(row);
    if (!exemplo) {
      ignorados += 1;
      continue;
    }
    inserirExemplo(database, exemplo);
    inseridos += 1;
  }
  return { candidatos: rows.length, inseridos, ignorados };
}

function scoreEstrutural(atual = {}, candidato = {}) {
  let score = 0;
  let peso = 0;
  const add = (w, v) => { peso += w; score += w * v; };
  add(0.22, atual.module && candidato.module && atual.module === candidato.module ? 1 : 0);
  add(0.16, atual.intent && candidato.intent && atual.intent === candidato.intent ? 1 : 0);
  add(0.14, intersecaoScore(atual.metric, candidato.metric));
  add(0.10, atual.date_basis && candidato.date_basis && atual.date_basis === candidato.date_basis ? 1 : 0);
  add(0.12, intersecaoScore(atual.group_by, candidato.group_by));
  add(0.12, intersecaoScore(atual.filter_keys, candidato.filter_keys));
  add(0.08, intersecaoScore((atual.entity_types || []).map(e => `${e.tipo}:${!!e.security}`), (candidato.entity_types || []).map(e => `${e.tipo}:${!!e.security}`)));
  add(0.06, securityKey(atual.security_scope) === securityKey(candidato.security_scope) ? 1 : 0);
  return peso ? score / peso : 0;
}

function candidatoFromRow(row = {}) {
  return {
    module: row.module,
    intent: row.intent,
    metric: parseJson(row.metric_json, []),
    date_basis: row.date_basis,
    group_by: parseJson(row.group_by_json, []),
    filter_keys: parseJson(row.filter_keys_json, []),
    entity_types: parseJson(row.entity_types_json, []),
    security_scope: parseJson(row.security_scope_json, null),
  };
}

function exemploFromRowScore(row = {}, candidato = {}, score, detalhes = {}) {
  return {
    score,
    score_estrutural: detalhes.score_estrutural ?? null,
    score_embedding: detalhes.score_embedding ?? null,
    score_fonte: detalhes.score_fonte || 'estrutural',
    embedding_model: detalhes.embedding_model || row.embedding_model || null,
    pergunta: row.search_text,
    intent: row.intent,
    module: row.module,
    date_basis: row.date_basis,
    metric: candidato.metric,
    group_by: candidato.group_by,
    filter_keys: candidato.filter_keys,
    sql_template: row.sql_template,
    execution_log_id: row.execution_log_id,
    criado_em: row.criado_em,
  };
}

function passaPrefiltroSemantico(atual = {}, candidato = {}) {
  if (atual.module && candidato.module && atual.module !== candidato.module) return false;
  if (atual.intent && candidato.intent && atual.intent !== candidato.intent) return false;
  if (lista(atual.metric).length && lista(candidato.metric).length && intersecaoScore(atual.metric, candidato.metric) <= 0) return false;
  if (lista(atual.group_by).length && lista(candidato.group_by).length && intersecaoScore(atual.group_by, candidato.group_by) <= 0) return false;
  const entidadesAtual = (atual.entity_types || []).map(e => `${e.tipo}:${!!e.security}`);
  const entidadesCand = (candidato.entity_types || []).map(e => `${e.tipo}:${!!e.security}`);
  if (entidadesAtual.length && entidadesCand.length && intersecaoScore(entidadesAtual, entidadesCand) <= 0) return false;
  return true;
}

function scoreHibridoEmbedding(scoreEmbedding, scoreEstruturalValor, pesoEmbedding = 0.72) {
  const emb = scoreEmbedding === null || scoreEmbedding === undefined ? NaN : Number(scoreEmbedding);
  const estrut = scoreEstruturalValor === null || scoreEstruturalValor === undefined ? NaN : Number(scoreEstruturalValor);
  if (!Number.isFinite(emb)) return Number.isFinite(estrut) ? estrut : 0;
  if (!Number.isFinite(estrut)) return emb;
  const peso = Math.max(0, Math.min(Number(pesoEmbedding) || 0.72, 1));
  return (emb * peso) + (estrut * (1 - peso));
}

function buscarFewShot({ empresaId, intentCanonicoInfo, limit = 3, threshold = 0.45, db = null } = {}) {
  if (!empresaId || !intentCanonicoInfo?.canonical) return [];
  const database = db || require('../../database').getDB();
  const atual = structuralFromCanonical(intentCanonicoInfo.canonical);
  const rows = database.prepare(`
    SELECT *
      FROM nlsql_semantic_examples
     WHERE empresa_id = ?
       AND module = ?
       AND spec_version IS ?
       AND prompt_version IS ?
       AND schema_version IS ?
       AND TRIM(sql_template) NOT LIKE '-- ERRO:%'
       AND sql_template NOT LIKE '%SQL rejeitado por contrato%'
       AND sql_template NOT LIKE '%SQL rejeitado por periodo inconsistente%'
     ORDER BY criado_em DESC
     LIMIT 80
  `).all(
    Number(empresaId),
    atual.module,
    atual.spec_version,
    atual.prompt_version,
    atual.schema_version,
  );

  return rows.map(row => {
    const candidato = candidatoFromRow(row);
    const score = scoreEstrutural(atual, candidato);
    return exemploFromRowScore(row, candidato, score, {
      score_estrutural: score,
      score_fonte: 'estrutural',
    });
  })
    .filter(ex => ex.score >= threshold)
    .sort((a, b) => b.score - a.score || String(b.criado_em || '').localeCompare(String(a.criado_em || '')))
    .slice(0, Math.max(0, Math.min(Number.isFinite(Number(limit)) ? Number(limit) : 3, 5)));
}

async function buscarFewShotComEmbeddings({ empresaId, intentCanonicoInfo, limit = 3, threshold = 0.45, db = null } = {}) {
  if (!empresaId || !intentCanonicoInfo?.canonical) return { exemplos: [], fonte: 'embedding_indisponivel' };
  const database = db || require('../../database').getDB();
  const atual = structuralFromCanonical(intentCanonicoInfo.canonical);
  const input = nlsqlEmbeddings.textoEmbeddingFromCanonical({
    canonical: intentCanonicoInfo.canonical,
    structural: intentCanonicoInfo.structural || atual,
  });
  const atualEmbedding = await nlsqlEmbeddings.gerarEmbeddingTexto({ empresaId, input });
  const rows = database.prepare(`
    SELECT *
      FROM nlsql_semantic_examples
     WHERE empresa_id = ?
       AND module = ?
       AND spec_version IS ?
       AND prompt_version IS ?
       AND schema_version IS ?
       AND embedding_status = 'ok'
       AND embedding_json IS NOT NULL
       AND TRIM(sql_template) NOT LIKE '-- ERRO:%'
       AND sql_template NOT LIKE '%SQL rejeitado por contrato%'
       AND sql_template NOT LIKE '%SQL rejeitado por periodo inconsistente%'
     ORDER BY criado_em DESC
     LIMIT 160
  `).all(
    Number(empresaId),
    atual.module,
    atual.spec_version,
    atual.prompt_version,
    atual.schema_version,
  );

  const exemplos = rows.map(row => {
    const candidato = candidatoFromRow(row);
    if (!passaPrefiltroSemantico(atual, candidato)) return null;
    const scoreEstruturalValor = scoreEstrutural(atual, candidato);
    const scoreEmbedding = nlsqlEmbeddings.cosineSimilarity(atualEmbedding.embedding, parseJson(row.embedding_json, []));
    if (scoreEmbedding === null) return null;
    const score = scoreHibridoEmbedding(scoreEmbedding, scoreEstruturalValor);
    return exemploFromRowScore(row, candidato, score, {
      score_estrutural: scoreEstruturalValor,
      score_embedding: scoreEmbedding,
      score_fonte: 'embedding_hibrido',
      embedding_model: atualEmbedding.model,
    });
  }).filter(Boolean)
    .filter(ex => ex.score >= threshold)
    .sort((a, b) => b.score - a.score || String(b.criado_em || '').localeCompare(String(a.criado_em || '')))
    .slice(0, Math.max(0, Math.min(Number.isFinite(Number(limit)) ? Number(limit) : 3, 5)));

  return {
    exemplos,
    fonte: 'embedding_hibrido',
    modelo_embedding: atualEmbedding.model,
    candidatos_vetoriais: rows.length,
  };
}

function exemplosParaPrompt(exemplos = []) {
  return exemplos.map((ex, idx) => ({
    n: idx + 1,
    similaridade: Number(ex.score.toFixed(3)),
    similaridade_embedding: ex.score_embedding == null ? null : Number(ex.score_embedding.toFixed(3)),
    similaridade_estrutural: ex.score_estrutural == null ? null : Number(ex.score_estrutural.toFixed(3)),
    fonte_score: ex.score_fonte || 'estrutural',
    modulo: ex.module,
    intencao: ex.intent,
    metrica: ex.metric,
    agrupamento: ex.group_by,
    filtros_estruturais: ex.filter_keys,
    base_data: ex.date_basis,
    sql_template_parametrizado: ex.sql_template,
  }));
}

function normalizarSqlComparacao(sql) {
  return String(sql || '')
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/;+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=<>+\-*/])\s*/g, '$1')
    .replace(/\bAS\s+/gi, 'AS ')
    .trim()
    .toUpperCase();
}

function avaliarShadowCandidate({ candidato = null, intentCanonicoInfo = null, actualSqlTemplate = null, actualSqlCanonico = null, actualSqlFinal = null, autoReuseThreshold = 0.98 } = {}) {
  if (!candidato) {
    return {
      comparacao_resultado: 'sem_candidato',
      template_valido: false,
      auto_reuse_elegivel: false,
      candidate_sql_aplicado: null,
      detalhes: { motivo: 'nenhum_candidato_semantico_acima_do_limiar_shadow' },
    };
  }

  const aplicado = sqlTemplate.aplicarSqlTemplate(candidato.sql_template, intentCanonicoInfo?.canonical || {});
  const candidatoTemplateNorm = normalizarSqlComparacao(candidato.sql_template);
  const atualTemplateNorm = normalizarSqlComparacao(actualSqlTemplate);
  const candidatoAplicadoNorm = normalizarSqlComparacao(aplicado.sql);
  const atualCanonicoNorm = normalizarSqlComparacao(actualSqlCanonico);
  const atualFinalNorm = normalizarSqlComparacao(actualSqlFinal);

  let comparacao = 'mismatch';
  if (!aplicado.ok) {
    comparacao = 'template_invalido';
  } else if (candidatoTemplateNorm && candidatoTemplateNorm === atualTemplateNorm) {
    comparacao = 'match_template_exato';
  } else if (candidatoAplicadoNorm && (candidatoAplicadoNorm === atualCanonicoNorm || candidatoAplicadoNorm === atualFinalNorm)) {
    comparacao = 'match_sql_aplicado_exato';
  }

  const autoReuseThresholdNumber = autoReuseThreshold === null || autoReuseThreshold === undefined
    ? 0.98
    : (Number.isFinite(Number(autoReuseThreshold)) ? Number(autoReuseThreshold) : 0.98);
  const autoReuseElegivel = aplicado.ok
    && Number(candidato.score || 0) >= autoReuseThresholdNumber
    && comparacao === 'match_template_exato';

  return {
    comparacao_resultado: comparacao,
    template_valido: !!aplicado.ok,
    auto_reuse_elegivel: autoReuseElegivel,
    candidate_sql_aplicado: aplicado.sql,
    detalhes: {
      pendentes_template: aplicado.pendentes_template || [],
      aplicados: aplicado.aplicados || [],
      score: candidato.score ?? null,
      normalizacao: {
        template_igual: candidatoTemplateNorm === atualTemplateNorm,
        aplicado_igual_canonico: candidatoAplicadoNorm === atualCanonicoNorm,
        aplicado_igual_final: candidatoAplicadoNorm === atualFinalNorm,
      },
    },
  };
}

function registrarShadowLog({ empresaId, numeroWa = null, intentCanonicoInfo = null, candidato = null, avaliacao = null, actualSqlTemplate = null, actualSqlCanonico = null, actualSqlFinal = null, autoReuseThreshold = null, detalhes = {}, db = null } = {}) {
  const database = db || require('../../database').getDB();
  const c = intentCanonicoInfo?.canonical || {};
  const aval = avaliacao || avaliarShadowCandidate({
    candidato,
    intentCanonicoInfo,
    actualSqlTemplate,
    actualSqlCanonico,
    actualSqlFinal,
    autoReuseThreshold,
  });
  const payloadDetalhes = {
    ...(detalhes || {}),
    ...(aval.detalhes || {}),
  };
  const classificacao = nlsqlClassificacao.aplicarClassificacaoRow({
    candidate_score: candidato?.score ?? null,
    comparacao_resultado: aval.comparacao_resultado,
    template_valido: aval.template_valido ? 1 : 0,
    candidate_execution_log_id: candidato?.execution_log_id || null,
    candidate_sql_template: candidato?.sql_template || null,
  });
  const id = uuid();
  database.prepare(`
    INSERT INTO nlsql_semantic_shadow_log (
      id, empresa_id, numero_wa, module, intent, intent_canonico_hash, chave_cache,
      candidate_execution_log_id, candidate_score, candidate_sql_template, candidate_sql_aplicado,
      actual_sql_template, actual_sql_canonico, actual_sql_final, template_valido,
      comparacao_resultado, auto_reuse_limiar, auto_reuse_elegivel,
      classificacao_auto, classificacao_auto_motivo, classificacao_auto_em, classificacao_efetiva,
      detalhes_json, servido_em_producao, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(empresaId),
    numeroWa || null,
    c.module || null,
    c.intent || null,
    intentCanonicoInfo?.canonicalHash || null,
    intentCanonicoInfo?.cacheKey || null,
    candidato?.execution_log_id || null,
    candidato?.score ?? null,
    candidato?.sql_template || null,
    aval.candidate_sql_aplicado || null,
    actualSqlTemplate || null,
    actualSqlCanonico || null,
    actualSqlFinal || null,
    aval.template_valido ? 1 : 0,
    aval.comparacao_resultado,
    autoReuseThreshold ?? null,
    aval.auto_reuse_elegivel ? 1 : 0,
    classificacao.classificacao_auto,
    classificacao.classificacao_auto_motivo,
    classificacao.classificacao_auto_em,
    classificacao.classificacao_efetiva,
    json(payloadDetalhes),
    0,
    now(),
  );
  return { id, ...aval, classificacao };
}

module.exports = {
  backfillConfiaveis,
  statusBackfill,
  buscarFewShot,
  buscarFewShotComEmbeddings,
  exemplosParaPrompt,
  avaliarShadowCandidate,
  registrarShadowLog,
  _test: {
    parseJson,
    structuralFromCanonical,
    exampleFromExecutionRow,
    scoreEstrutural,
    passaPrefiltroSemantico,
    scoreHibridoEmbedding,
    searchTextFrom,
    idExecucaoValido,
    normalizarExecutionLogId,
    normalizarSqlComparacao,
    avaliarShadowCandidate,
  },
};
