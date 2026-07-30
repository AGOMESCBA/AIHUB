'use strict';

const DEFAULT_BUCKETS = [0.995, 0.99, 0.98, 0.95, 0.9, 0.8, 0.7, 0];
const MIN_AMOSTRA_RECOMENDACAO = 30;
const PRECISAO_ALVO = 0.995;

function parseJson(valor, fallback = null) {
  if (!valor) return fallback;
  if (typeof valor !== 'string') return valor;
  try { return JSON.parse(valor); } catch (_) { return fallback; }
}

function pct(valor) {
  return valor === null || valor === undefined ? null : Number(valor);
}

function bucketLabel(min) {
  return min <= 0 ? '<0.700' : `>=${min.toFixed(3)}`;
}

function scoreBucket(score, buckets = DEFAULT_BUCKETS) {
  if (score === null || score === undefined || score === '') return null;
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  const ordenados = [...buckets].sort((a, b) => b - a);
  return ordenados.find(min => s >= min) ?? 0;
}

function resultadoTipo(resultado) {
  if (resultado === 'match_template_exato') return 'match_template';
  if (resultado === 'match_sql_aplicado_exato') return 'match_aplicado';
  if (resultado === 'mismatch') return 'mismatch';
  if (resultado === 'template_invalido') return 'template_invalido';
  if (resultado === 'sem_candidato') return 'sem_candidato';
  return 'outro';
}

function fonteRanking(row = {}) {
  const detalhes = parseJson(row.detalhes_json, row.detalhes || {});
  return detalhes?.ranking_fonte || detalhes?.fonte_score || row.ranking_fonte || 'nao_informado';
}

function novoGrupo(chave, label) {
  return {
    chave,
    label,
    total: 0,
    com_candidato: 0,
    sem_candidato: 0,
    match_template: 0,
    match_aplicado: 0,
    mismatch: 0,
    template_invalido: 0,
    outro: 0,
    precisao_template: null,
    precisao_match_total: null,
    taxa_mismatch: null,
    taxa_template_invalido: null,
  };
}

function acumular(grupo, row = {}) {
  grupo.total += 1;
  const tipo = resultadoTipo(row.comparacao_resultado);
  grupo[tipo] = (grupo[tipo] || 0) + 1;
  if (tipo === 'sem_candidato') grupo.sem_candidato += 1;
  else grupo.com_candidato += 1;
}

function finalizarGrupo(grupo) {
  grupo.precisao_template = grupo.com_candidato ? grupo.match_template / grupo.com_candidato : null;
  grupo.precisao_match_total = grupo.com_candidato ? (grupo.match_template + grupo.match_aplicado) / grupo.com_candidato : null;
  grupo.taxa_mismatch = grupo.com_candidato ? grupo.mismatch / grupo.com_candidato : null;
  grupo.taxa_template_invalido = grupo.com_candidato ? grupo.template_invalido / grupo.com_candidato : null;
  return grupo;
}

function ordenarPorTotalDesc(a, b) {
  return b.total - a.total || String(a.label).localeCompare(String(b.label));
}

function recomendarLimiar(faixas = [], { precisaoAlvo = PRECISAO_ALVO, minAmostra = MIN_AMOSTRA_RECOMENDACAO } = {}) {
  const candidatas = faixas
    .filter(f => f.min_score > 0 && f.com_candidato >= minAmostra && Number(f.precisao_template) >= precisaoAlvo)
    .sort((a, b) => a.min_score - b.min_score);
  const escolha = candidatas[0] || null;
  if (escolha) {
    return {
      status: 'recomendado',
      limiar: escolha.min_score,
      label: escolha.label,
      precisao_template: escolha.precisao_template,
      amostra: escolha.com_candidato,
      criterio: `Precisao template >= ${(precisaoAlvo * 100).toFixed(2)}% com amostra >= ${minAmostra}`,
    };
  }
  const maiorAmostra = [...faixas].filter(f => f.min_score > 0).sort((a, b) => b.com_candidato - a.com_candidato)[0] || null;
  return {
    status: 'insuficiente',
    limiar: null,
    label: null,
    precisao_template: maiorAmostra?.precisao_template ?? null,
    amostra: maiorAmostra?.com_candidato || 0,
    criterio: `Ainda nao ha faixa com precisao >= ${(precisaoAlvo * 100).toFixed(2)}% e amostra >= ${minAmostra}`,
  };
}

function calibrarShadowRows(rows = [], opts = {}) {
  const buckets = opts.buckets || DEFAULT_BUCKETS;
  const geral = novoGrupo('geral', 'Geral');
  const porModulo = new Map();
  const porFonte = new Map();
  const porClassificacao = new Map();
  const porFaixa = new Map();
  const porModuloFaixa = new Map();

  for (const row of rows || []) {
    acumular(geral, row);

    const modulo = row.module || 'sem_modulo';
    if (!porModulo.has(modulo)) porModulo.set(modulo, novoGrupo(modulo, modulo));
    acumular(porModulo.get(modulo), row);

    const fonte = fonteRanking(row);
    if (!porFonte.has(fonte)) porFonte.set(fonte, novoGrupo(fonte, fonte));
    acumular(porFonte.get(fonte), row);

    const classificacao = row.classificacao_efetiva || row.classificacao_auto || 'nao_classificado';
    if (!porClassificacao.has(classificacao)) porClassificacao.set(classificacao, novoGrupo(classificacao, classificacao));
    acumular(porClassificacao.get(classificacao), row);

    const bucket = scoreBucket(row.candidate_score, buckets);
    const faixaKey = bucket === null ? 'sem_score' : String(bucket);
    if (!porFaixa.has(faixaKey)) {
      const minScore = bucket === null ? null : bucket;
      porFaixa.set(faixaKey, { ...novoGrupo(faixaKey, bucket === null ? 'Sem score' : bucketLabel(bucket)), min_score: minScore });
    }
    acumular(porFaixa.get(faixaKey), row);

    const moduloFaixaKey = `${modulo}|${faixaKey}`;
    if (!porModuloFaixa.has(moduloFaixaKey)) {
      const minScore = bucket === null ? null : bucket;
      porModuloFaixa.set(moduloFaixaKey, {
        ...novoGrupo(moduloFaixaKey, `${modulo} ${bucket === null ? 'Sem score' : bucketLabel(bucket)}`),
        module: modulo,
        min_score: minScore,
        faixa: bucket === null ? 'Sem score' : bucketLabel(bucket),
      });
    }
    acumular(porModuloFaixa.get(moduloFaixaKey), row);
  }

  const faixas = [...porFaixa.values()]
    .map(finalizarGrupo)
    .sort((a, b) => (b.min_score ?? -1) - (a.min_score ?? -1));
  const modulos = [...porModulo.values()].map(finalizarGrupo).sort(ordenarPorTotalDesc);
  const fontes = [...porFonte.values()].map(finalizarGrupo).sort(ordenarPorTotalDesc);
  const classificacoes = [...porClassificacao.values()].map(finalizarGrupo).sort(ordenarPorTotalDesc);
  const moduloFaixas = [...porModuloFaixa.values()]
    .map(finalizarGrupo)
    .sort((a, b) => String(a.module).localeCompare(String(b.module)) || (b.min_score ?? -1) - (a.min_score ?? -1));

  return {
    resumo: finalizarGrupo(geral),
    faixas,
    modulos,
    fontes,
    classificacoes,
    modulo_faixas: moduloFaixas,
    recomendacao: recomendarLimiar(faixas, opts),
  };
}

function filtrosWhere({ empresaId, inicio = '', fim = '', modulo = '', fonte = '' } = {}) {
  const wheres = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (inicio) { wheres.push('criado_em >= ?'); params.push(`${inicio}T00:00:00.000`); }
  if (fim) { wheres.push('criado_em <= ?'); params.push(`${fim}T23:59:59.999`); }
  if (modulo) { wheres.push('module = ?'); params.push(String(modulo).trim().toLowerCase()); }
  if (fonte) {
    wheres.push('(detalhes_json LIKE ? OR detalhes_json LIKE ?)');
    params.push(`%"ranking_fonte":"${fonte}"%`, `%"ranking_fonte": "${fonte}"%`);
  }
  return { wheres, params };
}

function carregarRows({ empresaId, inicio = '', fim = '', modulo = '', fonte = '', limit = 5000, db = null } = {}) {
  const database = db || require('../../database').getDB();
  const filtro = filtrosWhere({ empresaId, inicio, fim, modulo, fonte });
  const max = Math.max(1, Math.min(Number(limit) || 5000, 50000));
  return database.prepare(`
    SELECT module, intent, candidate_score, comparacao_resultado, classificacao_auto, classificacao_efetiva, detalhes_json, criado_em
      FROM nlsql_semantic_shadow_log
     WHERE ${filtro.wheres.join(' AND ')}
     ORDER BY criado_em DESC
     LIMIT ?
  `).all(...filtro.params, max);
}

function calibrarShadow({ empresaId, inicio = '', fim = '', modulo = '', fonte = '', limit = 5000, db = null } = {}) {
  const rows = carregarRows({ empresaId, inicio, fim, modulo, fonte, limit, db });
  return {
    filtros: { empresaId: Number(empresaId), inicio, fim, modulo, fonte, limit },
    amostra_lida: rows.length,
    ...calibrarShadowRows(rows),
  };
}

module.exports = {
  DEFAULT_BUCKETS,
  MIN_AMOSTRA_RECOMENDACAO,
  PRECISAO_ALVO,
  calibrarShadow,
  calibrarShadowRows,
  carregarRows,
  recomendarLimiar,
  _test: {
    parseJson,
    scoreBucket,
    bucketLabel,
    resultadoTipo,
    fonteRanking,
    filtrosWhere,
  },
};
