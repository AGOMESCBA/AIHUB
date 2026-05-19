const { getDB } = require('../database');

function uuid() {
  return require('crypto').randomUUID
    ? require('crypto').randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function agora() {
  return new Date().toISOString();
}

function json(value) {
  if (value === undefined) return null;
  try { return JSON.stringify(value ?? null); } catch (_) { return null; }
}

function camposInferidos(intent = {}) {
  if (intent._resolvidoLocalmente || intent._provedor === 'deterministico') return [];
  const campos = [];
  if (intent.periodo?.tipo && intent.periodo.tipo !== 'nenhum') campos.push('periodo');
  if (Object.keys(intent.filtros || {}).length) campos.push('filtros');
  if (intent.agrupar_por) campos.push('agrupar_por');
  if (intent.operacao_analitica) campos.push('operacao_analitica');
  if (intent.ordenar_por) campos.push('ordenar_por');
  if (intent.limite) campos.push('limite');
  if (intent.intencao && intent.intencao !== 'desconhecido') campos.push('intencao');
  return campos;
}

function registrar(payload = {}) {
  const db = getDB();
  const now = agora();
  const id = payload.id || uuid();
  const intent = payload.intent || {};
  const resultado = payload.resultado || {};

  const row = {
    id,
    empresa_id: payload.empresa_id ?? null,
    usuario: payload.usuario || null,
    numero_wa: payload.numero_wa || null,
    canal_id: payload.canal_id || null,
    texto_original: payload.texto_original || '',
    intent_json: json(intent),
    intencao: intent.intencao || null,
    periodo_json: json(intent.periodo || {}),
    filtros_json: json(intent.filtros || {}),
    agrupar_por: intent.agrupar_por || null,
    ordenar_por: intent.ordenar_por || null,
    limite: intent.limite || null,
    sinonimos_aplicados: json(intent._sinonimosAplicados || []),
    campos_inferidos_ia: json(camposInferidos(intent)),
    provedor: intent._provedor || null,
    confianca: typeof intent.confianca === 'number' ? intent.confianca : null,
    origem: intent.origem || 'texto',
    cache_hit: intent._cache ? 1 : 0,
    fallback_usado: (payload.fallback_usado || intent._fallback) ? 1 : 0,
    precisa_confirmacao: intent.precisa_confirmacao ? 1 : 0,
    resultado_tipo: resultado.tipo || payload.resultado_tipo || null,
    dataset_id: resultado.dataset_id || null,
    dataset_nome: resultado.dataset_nome || null,
    rows_count: Array.isArray(resultado.rows) ? resultado.rows.length : (payload.rows_count ?? null),
    resposta_entregue: payload.resposta_entregue || null,
    sql_gerado: resultado.sql_gerado || payload.sql_gerado || null,
    duracao_ms: payload.duracao_ms ?? null,
    feedback: payload.feedback || null,
    feedback_observacao: payload.feedback_observacao || null,
    criado_em: now,
    atualizado_em: now,
  };

  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  db.prepare(`INSERT INTO interpretation_log (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(cols.map(c => row[c]));
  return row;
}

function listar(empresaId, opts = {}) {
  const limit = Math.min(parseInt(opts.limit, 10) || 200, 1000);
  return getDB().prepare(`
    SELECT *
    FROM interpretation_log
    WHERE empresa_id = ?
    ORDER BY criado_em DESC
    LIMIT ?
  `).all(empresaId, limit);
}

function registrarFeedback(id, empresaId, feedback, observacao = null) {
  const permitido = new Set(['positivo', 'negativo', 'corrigido', 'ignorar']);
  const fb = permitido.has(String(feedback)) ? String(feedback) : 'corrigido';
  const info = getDB().prepare(`
    UPDATE interpretation_log
       SET feedback = ?, feedback_observacao = ?, atualizado_em = ?
     WHERE id = ? AND empresa_id = ?
  `).run(fb, observacao || null, agora(), id, empresaId);
  return info.changes > 0;
}

function limpar(empresaId, opts = {}) {
  const db = getDB();
  const params = [empresaId];
  const where = ['empresa_id = ?'];

  if (opts.inicio) {
    where.push('criado_em >= ?');
    params.push(opts.inicio);
  }

  if (opts.fim) {
    where.push('criado_em <= ?');
    params.push(opts.fim);
  }

  const info = db.prepare(`DELETE FROM interpretation_log WHERE ${where.join(' AND ')}`).run(params);
  return info.changes || 0;
}

module.exports = { registrar, listar, registrarFeedback, limpar, camposInferidos };
