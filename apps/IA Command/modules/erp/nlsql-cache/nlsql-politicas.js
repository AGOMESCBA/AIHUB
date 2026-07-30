'use strict';

const crypto = require('crypto');
const calibracao = require('./nlsql-calibracao');

const STATUS_VALIDOS = new Set(['observacao', 'elegivel', 'liberado', 'bloqueado']);
const PRECISAO_MINIMA = 0.995;
const AMOSTRA_MINIMA = 30;
const AUTO_POLICY_USER = 'sistema:auto-policy';

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

function fonteRanking(row = {}) {
  const detalhes = parseJson(row.detalhes_json, row.detalhes || {});
  return detalhes?.ranking_fonte || detalhes?.fonte_score || row.ranking_fonte || 'nao_informado';
}

function scoreBucket(score) {
  return calibracao._test.scoreBucket(score, calibracao.DEFAULT_BUCKETS);
}

function novoGrupo({ module, fonte, minScore }) {
  return {
    module: module || 'sem_modulo',
    fonte_ranking: fonte || 'nao_informado',
    min_score: minScore,
    score_label: minScore === null ? 'Sem score' : calibracao._test.bucketLabel(minScore),
    total: 0,
    com_candidato: 0,
    match_template: 0,
    match_aplicado: 0,
    mismatch: 0,
    template_invalido: 0,
    sem_candidato: 0,
    aprovado_auto: 0,
    bloqueado_auto: 0,
    precisao_template: null,
    precisao_match_total: null,
    status_sugerido: 'observacao',
    criterio: '',
  };
}

function acumular(grupo, row = {}) {
  grupo.total += 1;
  if (row.comparacao_resultado === 'sem_candidato') {
    grupo.sem_candidato += 1;
  } else {
    grupo.com_candidato += 1;
  }
  if (row.comparacao_resultado === 'match_template_exato') grupo.match_template += 1;
  else if (row.comparacao_resultado === 'match_sql_aplicado_exato') grupo.match_aplicado += 1;
  else if (row.comparacao_resultado === 'mismatch') grupo.mismatch += 1;
  else if (row.comparacao_resultado === 'template_invalido') grupo.template_invalido += 1;
  if (row.classificacao_efetiva === 'aprovado_automatico' || row.classificacao_auto === 'aprovado_automatico') grupo.aprovado_auto += 1;
  if (/bloqueado|reprovado/.test(String(row.classificacao_efetiva || row.classificacao_auto || ''))) grupo.bloqueado_auto += 1;
}

function sugerirStatus(grupo, { precisaoMinima = PRECISAO_MINIMA, amostraMinima = AMOSTRA_MINIMA } = {}) {
  const g = { ...grupo };
  g.precisao_template = g.com_candidato ? g.match_template / g.com_candidato : null;
  g.precisao_match_total = g.com_candidato ? (g.match_template + g.match_aplicado) / g.com_candidato : null;
  if (g.template_invalido > 0 || g.mismatch > 0 || g.bloqueado_auto > 0) {
    g.status_sugerido = 'bloqueado';
    g.criterio = 'Houve mismatch, template invalido ou classificacao reprovada/bloqueada.';
  } else if (g.com_candidato >= amostraMinima && Number(g.precisao_template) >= precisaoMinima) {
    g.status_sugerido = 'liberado';
    g.criterio = `Precisao template >= ${(precisaoMinima * 100).toFixed(2)}% com amostra >= ${amostraMinima}.`;
  } else {
    g.status_sugerido = 'observacao';
    g.criterio = `Aguardando amostra >= ${amostraMinima} e precisao >= ${(precisaoMinima * 100).toFixed(2)}%.`;
  }
  return g;
}

function gerarSugestoes(rows = [], opts = {}) {
  const grupos = new Map();
  for (const row of rows || []) {
    const bucket = scoreBucket(row.candidate_score);
    const key = `${row.module || 'sem_modulo'}|${fonteRanking(row)}|${bucket === null ? 'sem_score' : bucket}`;
    if (!grupos.has(key)) {
      grupos.set(key, novoGrupo({ module: row.module, fonte: fonteRanking(row), minScore: bucket }));
    }
    acumular(grupos.get(key), row);
  }
  return [...grupos.values()]
    .map(g => sugerirStatus(g, opts))
    .sort((a, b) => String(a.module).localeCompare(String(b.module)) || String(a.fonte_ranking).localeCompare(String(b.fonte_ranking)) || (b.min_score ?? -1) - (a.min_score ?? -1));
}

function carregarRowsShadow({ empresaId, inicio = '', fim = '', modulo = '', fonte = '', limit = 50000, db = null } = {}) {
  const database = db || require('../../database').getDB();
  const wheres = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (inicio) { wheres.push('criado_em >= ?'); params.push(`${inicio}T00:00:00.000`); }
  if (fim) { wheres.push('criado_em <= ?'); params.push(`${fim}T23:59:59.999`); }
  if (modulo) { wheres.push('module = ?'); params.push(String(modulo).trim().toLowerCase()); }
  if (fonte) {
    wheres.push('(detalhes_json LIKE ? OR detalhes_json LIKE ?)');
    params.push(`%"ranking_fonte":"${fonte}"%`, `%"ranking_fonte": "${fonte}"%`);
  }
  return database.prepare(`
    SELECT module, candidate_score, comparacao_resultado, classificacao_auto, classificacao_efetiva, detalhes_json, criado_em
      FROM nlsql_semantic_shadow_log
     WHERE ${wheres.join(' AND ')}
     ORDER BY criado_em DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(Number(limit) || 50000, 50000)));
}

function chavePolitica(row = {}) {
  return `${row.module}|${row.fonte_ranking}|${row.min_score === null || row.min_score === undefined ? 'sem_score' : Number(row.min_score).toFixed(3)}`;
}

function minScoreKey(valor) {
  return valor === null || valor === undefined || valor === '' || valor === 'sem_score' ? 'sem_score' : Number(valor).toFixed(3);
}

function normalizarSettings(row = {}) {
  return {
    empresa_id: Number(row.empresa_id || 0) || null,
    shadow_enabled: row.shadow_enabled === undefined ? 1 : Number(row.shadow_enabled) === 1 ? 1 : 0,
    auto_reuse_enabled: row.auto_reuse_enabled === undefined ? 0 : Number(row.auto_reuse_enabled) === 1 ? 1 : 0,
    auto_policy_enabled: row.auto_policy_enabled === undefined ? 1 : Number(row.auto_policy_enabled) === 1 ? 1 : 0,
    precision_min: Number.isFinite(Number(row.precision_min)) ? Math.max(0, Math.min(1, Number(row.precision_min))) : PRECISAO_MINIMA,
    sample_min: Number.isFinite(Number(row.sample_min)) ? Math.max(1, Math.min(100000, Number(row.sample_min))) : AMOSTRA_MINIMA,
    atualizado_por: row.atualizado_por || null,
    criado_em: row.criado_em || null,
    atualizado_em: row.atualizado_em || null,
  };
}

function carregarSettings({ empresaId, db = null } = {}) {
  const database = db || require('../../database').getDB();
  const row = database.prepare(`
    SELECT *
      FROM nlsql_semantic_settings
     WHERE empresa_id = ?
     LIMIT 1
  `).get(Number(empresaId));
  return normalizarSettings(row || { empresa_id: Number(empresaId) });
}

function salvarSettings({
  empresaId,
  autoReuseEnabled,
  autoPolicyEnabled,
  shadowEnabled,
  precisionMin,
  sampleMin,
  usuario = 'sistema',
  db = null,
} = {}) {
  const database = db || require('../../database').getDB();
  const atual = carregarSettings({ empresaId, db: database });
  const settings = normalizarSettings({
    empresa_id: Number(empresaId),
    shadow_enabled: shadowEnabled === undefined ? atual.shadow_enabled : (shadowEnabled ? 1 : 0),
    auto_reuse_enabled: autoReuseEnabled === undefined ? atual.auto_reuse_enabled : (autoReuseEnabled ? 1 : 0),
    auto_policy_enabled: autoPolicyEnabled === undefined ? atual.auto_policy_enabled : (autoPolicyEnabled ? 1 : 0),
    precision_min: precisionMin === undefined ? atual.precision_min : Number(precisionMin),
    sample_min: sampleMin === undefined ? atual.sample_min : Number(sampleMin),
  });
  const ts = now();
  database.prepare(`
    INSERT INTO nlsql_semantic_settings (
      empresa_id, shadow_enabled, auto_reuse_enabled, auto_policy_enabled, precision_min, sample_min,
      atualizado_por, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(empresa_id) DO UPDATE SET
      shadow_enabled = excluded.shadow_enabled,
      auto_reuse_enabled = excluded.auto_reuse_enabled,
      auto_policy_enabled = excluded.auto_policy_enabled,
      precision_min = excluded.precision_min,
      sample_min = excluded.sample_min,
      atualizado_por = excluded.atualizado_por,
      atualizado_em = excluded.atualizado_em
  `).run(
    Number(empresaId),
    settings.shadow_enabled,
    settings.auto_reuse_enabled,
    settings.auto_policy_enabled,
    settings.precision_min,
    settings.sample_min,
    String(usuario || 'sistema').slice(0, 120),
    ts,
    ts,
  );
  return carregarSettings({ empresaId, db: database });
}

function configShadowAtivo({ empresaId, db = null } = {}) {
  const settings = carregarSettings({ empresaId, db });
  return Number(settings.shadow_enabled) === 1;
}

function configAutoReuseAtivo({ empresaId, db = null } = {}) {
  const settings = carregarSettings({ empresaId, db });
  return Number(settings.auto_reuse_enabled) === 1;
}

function listarPersistidas({ empresaId, db = null } = {}) {
  const database = db || require('../../database').getDB();
  return database.prepare(`
    SELECT *
      FROM nlsql_semantic_policies
     WHERE empresa_id = ?
  `).all(Number(empresaId));
}

function listarPoliticas({ empresaId, inicio = '', fim = '', modulo = '', fonte = '', limit = 50000, db = null } = {}) {
  const database = db || require('../../database').getDB();
  const settings = carregarSettings({ empresaId, db: database });
  const rows = carregarRowsShadow({ empresaId, inicio, fim, modulo, fonte, limit, db: database });
  const sugestoes = gerarSugestoes(rows, {
    precisaoMinima: settings.precision_min,
    amostraMinima: settings.sample_min,
  });
  const persistidas = new Map(listarPersistidas({ empresaId, db: database }).map(p => [chavePolitica(p), p]));
  const usadas = new Set();
  const combinadas = sugestoes.map(s => {
    const p = persistidas.get(chavePolitica(s));
    usadas.add(chavePolitica(s));
    return {
      ...s,
      id: p?.id || null,
      status: p?.status || s.status_sugerido,
      status_origem: p ? 'persistido' : 'sugerido',
      status_motivo: p?.status_motivo || null,
      atualizado_em: p?.atualizado_em || null,
      atualizado_por: p?.atualizado_por || null,
    };
  });
  for (const [key, p] of persistidas.entries()) {
    if (usadas.has(key)) continue;
    if (modulo && p.module !== modulo) continue;
    if (fonte && p.fonte_ranking !== fonte) continue;
    combinadas.push({
      module: p.module,
      fonte_ranking: p.fonte_ranking,
      min_score: p.min_score,
      score_label: p.min_score === null || p.min_score === undefined ? 'Sem score' : calibracao._test.bucketLabel(Number(p.min_score)),
      total: 0,
      com_candidato: 0,
      match_template: 0,
      match_aplicado: 0,
      mismatch: 0,
      template_invalido: 0,
      sem_candidato: 0,
      aprovado_auto: 0,
      bloqueado_auto: 0,
      precisao_template: null,
      precisao_match_total: null,
      status_sugerido: 'observacao',
      criterio: 'Politica persistida sem amostra recente nos filtros atuais.',
      id: p.id,
      status: p.status,
      status_origem: 'persistido',
      status_motivo: p.status_motivo || null,
      atualizado_em: p.atualizado_em || null,
      atualizado_por: p.atualizado_por || null,
    });
  }
  return {
    filtros: { empresaId: Number(empresaId), inicio, fim, modulo, fonte, limit },
    settings,
    total: combinadas.length,
    rows: combinadas,
    resumo: {
      observacao: combinadas.filter(r => r.status === 'observacao').length,
      elegivel: combinadas.filter(r => r.status === 'elegivel').length,
      liberado: combinadas.filter(r => r.status === 'liberado').length,
      bloqueado: combinadas.filter(r => r.status === 'bloqueado').length,
    },
  };
}

function autoPromoverPoliticas({ empresaId, modulo = '', fonte = '', limit = 50000, db = null } = {}) {
  const database = db || require('../../database').getDB();
  const settings = carregarSettings({ empresaId, db: database });
  if (Number(settings.auto_policy_enabled) !== 1) {
    return { ok: true, ativo: false, promovidos: 0, bloqueados: 0, settings };
  }
  const rows = carregarRowsShadow({ empresaId, modulo, fonte, limit, db: database });
  const sugestoes = gerarSugestoes(rows, {
    precisaoMinima: settings.precision_min,
    amostraMinima: settings.sample_min,
  });
  const persistidas = new Map(listarPersistidas({ empresaId, db: database }).map(p => [chavePolitica(p), p]));
  let promovidos = 0;
  let bloqueados = 0;
  const tx = database.transaction(() => {
    for (const sugestao of sugestoes) {
      const existente = persistidas.get(chavePolitica(sugestao));
      const foiManual = existente?.atualizado_por && existente.atualizado_por !== AUTO_POLICY_USER;
      if (sugestao.status_sugerido === 'bloqueado') {
        if (!existente || existente.status !== 'bloqueado') {
          salvarStatus({
            empresaId,
            module: sugestao.module,
            fonteRanking: sugestao.fonte_ranking,
            minScore: sugestao.min_score,
            status: 'bloqueado',
            motivo: `Auto-bloqueado: ${sugestao.criterio}`,
            usuario: AUTO_POLICY_USER,
            db: database,
          });
          bloqueados += 1;
        }
        continue;
      }
      if (sugestao.status_sugerido !== 'liberado') continue;
      if (existente?.status === 'liberado') continue;
      if (foiManual) continue;
      salvarStatus({
        empresaId,
        module: sugestao.module,
        fonteRanking: sugestao.fonte_ranking,
        minScore: sugestao.min_score,
        status: 'liberado',
        motivo: `Auto-liberado: ${sugestao.criterio}`,
        usuario: AUTO_POLICY_USER,
        db: database,
      });
      promovidos += 1;
    }
  });
  tx();
  return { ok: true, ativo: true, promovidos, bloqueados, settings };
}

function politicaLiberadaParaCandidato({ empresaId, module, fonteRanking: fonte, score, db = null } = {}) {
  const modulo = String(module || '').trim().toLowerCase();
  const fonteValor = String(fonte || 'nao_informado').trim();
  const bucket = scoreBucket(score);
  if (!empresaId || !modulo || bucket === null) {
    return { liberado: false, motivo: 'politica_sem_modulo_ou_score', bucket };
  }
  autoPromoverPoliticas({ empresaId, modulo, fonte: fonteValor, db });
  const payload = listarPoliticas({ empresaId, modulo, fonte: fonteValor, db });
  const key = `${modulo}|${fonteValor}|${bucket}`;
  const decisao = (payload.rows || []).find(row => `${row.module}|${row.fonte_ranking}|${row.min_score}` === key)
    || (payload.rows || []).find(row => row.module === modulo && row.fonte_ranking === fonteValor && Number(row.min_score) === Number(bucket));
  if (!decisao) return { liberado: false, motivo: 'politica_nao_encontrada', bucket };
  const persistida = decisao.status_origem === 'persistido';
  return {
    liberado: persistida && decisao.status === 'liberado',
    motivo: persistida && decisao.status === 'liberado'
      ? 'politica_liberada'
      : persistida
        ? `politica_status_${decisao.status || 'indefinido'}`
        : `politica_apenas_sugerida_${decisao.status || 'indefinido'}`,
    bucket,
    politica: decisao,
  };
}

function salvarStatus({ empresaId, module, fonteRanking: fonte, minScore, status, motivo = '', usuario = 'sistema', db = null } = {}) {
  const st = String(status || '').trim();
  if (!STATUS_VALIDOS.has(st)) throw new Error(`Status de politica invalido: ${st}`);
  const database = db || require('../../database').getDB();
  const modulo = String(module || '').trim().toLowerCase();
  const fonteValor = String(fonte || 'nao_informado').trim();
  const scoreValor = minScore === null || minScore === undefined || minScore === '' || minScore === 'sem_score' ? null : Number(minScore);
  const scoreKey = minScoreKey(scoreValor);
  if (!modulo) throw new Error('Modulo da politica nao informado.');
  const existente = database.prepare(`
    SELECT id
      FROM nlsql_semantic_policies
     WHERE empresa_id = ?
       AND module = ?
       AND fonte_ranking = ?
       AND min_score_key = ?
     LIMIT 1
  `).get(Number(empresaId), modulo, fonteValor, scoreKey);
  const id = existente?.id || uuid();
  const ts = now();
  if (existente) {
    database.prepare(`
      UPDATE nlsql_semantic_policies
         SET status = ?,
             status_motivo = ?,
             atualizado_por = ?,
             atualizado_em = ?
       WHERE id = ?
    `).run(st, String(motivo || '').slice(0, 1000), String(usuario || 'sistema').slice(0, 120), ts, id);
  } else {
    database.prepare(`
      INSERT INTO nlsql_semantic_policies (
        id, empresa_id, module, fonte_ranking, min_score, min_score_key, status, status_motivo,
        atualizado_por, criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, Number(empresaId), modulo, fonteValor, scoreValor, scoreKey, st, String(motivo || '').slice(0, 1000), String(usuario || 'sistema').slice(0, 120), ts, ts);
  }
  return { id, module: modulo, fonte_ranking: fonteValor, min_score: scoreValor, status: st };
}

module.exports = {
  STATUS_VALIDOS,
  PRECISAO_MINIMA,
  AMOSTRA_MINIMA,
  gerarSugestoes,
  carregarSettings,
  salvarSettings,
  configShadowAtivo,
  configAutoReuseAtivo,
  autoPromoverPoliticas,
  listarPoliticas,
  salvarStatus,
  politicaLiberadaParaCandidato,
  _test: {
    fonteRanking,
    scoreBucket,
    sugerirStatus,
    chavePolitica,
    minScoreKey,
    normalizarSettings,
  },
};
