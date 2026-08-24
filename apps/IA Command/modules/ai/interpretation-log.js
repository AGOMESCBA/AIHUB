const { getDB } = require('../database');

function _agenteUrl(empresaId) {
  if (!empresaId) return null;
  try {
    const row = getDB().prepare(
      'SELECT agente_local_ativo, agente_local_url FROM ai_config WHERE empresa_id = ? LIMIT 1'
    ).get(empresaId);
    if (!row?.agente_local_ativo || !row?.agente_local_url) return null;
    const url = row.agente_local_url.trim();
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}`;
    } catch (_) { return url; }
  } catch (_) { return null; }
}

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

const _columnCache = new Map();

function colunaExiste(tabela, coluna) {
  const key = `${tabela}.${coluna}`;
  if (_columnCache.has(key)) return _columnCache.get(key);
  try {
    const exists = getDB()
      .prepare(`PRAGMA table_info(${tabela})`)
      .all()
      .some(c => c.name === coluna);
    _columnCache.set(key, exists);
    return exists;
  } catch (_) {
    _columnCache.set(key, false);
    return false;
  }
}

function temVinculoChatProtheus(logId) {
  if (!logId || !colunaExiste('protheus_chat_messages', 'interpretation_log_id')) return false;
  try {
    return !!getDB().prepare(`
      SELECT 1
        FROM protheus_chat_messages
       WHERE interpretation_log_id = ?
       LIMIT 1
    `).get(logId);
  } catch (_) {
    return false;
  }
}

function temVinculoAgendamento(logId) {
  if (!logId || !colunaExiste('scheduled_question_runs', 'interpretation_log_id')) return false;
  try {
    return !!getDB().prepare(`
      SELECT 1
        FROM scheduled_question_runs
       WHERE interpretation_log_id = ?
       LIMIT 1
    `).get(logId);
  } catch (_) {
    return false;
  }
}

function canalOrigemDoRegistro(row = {}) {
  if (!row) return row;
  if (temVinculoChatProtheus(row.id)) {
    row.canal_origem = 'chat';
    return row;
  }
  if (temVinculoAgendamento(row.id)) {
    row.canal_origem = 'agendamento';
    return row;
  }
  if (row.canal_origem && row.canal_origem !== 'agendamento') return row;
  if (row.canal_origem === 'agendamento') row.canal_origem = null;
  const origem = String(row.origem || '').trim().toLowerCase();
  const pipelineOrigem = String(row.pipeline_origem || '').trim().toLowerCase();
  const usuario = String(row.usuario || '').trim().toLowerCase();
  const sqlFixoSemRun = origem === 'agendamento_sql_fixo' || pipelineOrigem === 'agendamento_sql_fixo';
  if (usuario === 'agendamento' && !sqlFixoSemRun) {
    row.canal_origem = 'agendamento';
  } else if (row.canal_id) {
    row.canal_origem = 'whatsapp';
  } else if (sqlFixoSemRun) {
    row.canal_origem = 'chat';
  } else if (row.numero_wa) {
    row.canal_origem = 'chat';
  }
  return row;
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

function moduloDinamico(payload = {}) {
  const intent = payload.intent || {};
  const resultado = payload.resultado || {};
  const conhecido = new Set(['compras', 'financeiro', 'faturamento', 'comissao', 'estoque']);

  const candidatos = [
    intent._moduloDinamico,
    resultado.dataset_nome,
    ...(Array.isArray(intent._trace) ? intent._trace.map(t => t?.modulo) : []),
    ...(Array.isArray(resultado.trace) ? resultado.trace.map(t => t?.modulo) : []),
    ...(Array.isArray(payload.trace) ? payload.trace.map(t => t?.modulo) : []),
    String(intent.intencao || '').replace(/_dinamico$/i, ''),
  ].filter(Boolean).map(v => String(v).toLowerCase());

  if (candidatos.some(v => /(?:^|[_+])compras(?:$|[_+])/.test(v) && /(?:^|[_+])faturamento(?:$|[_+])/.test(v))) return 'compras';
  return candidatos.find(v => conhecido.has(v)) || null;
}

function faseExecucao(payload = {}) {
  const resultado = payload.resultado || {};
  if (payload.fase_execucao || resultado._fase_execucao) {
    return payload.fase_execucao || resultado._fase_execucao;
  }

  const temSqlExecutado = !!(
    payload.sql_final_executado
    || resultado._sql_auditoria?.sql_final_executado
    || resultado.sql_gerado
  );
  if (resultado.tipo === 'sucesso_ai_sql' || temSqlExecutado) return 'execucao_normal';
  if (resultado._diagnostico_tecnico && resultado.tipo === 'erro') return 'pre_execucao_tecnica';
  return 'sem_execucao';
}

function registrar(payload = {}) {
  const db = getDB();
  const now = agora();
  const id = payload.id || uuid();
  const intent = payload.intent || {};
  const resultado = payload.resultado || {};
  const modulo = moduloDinamico(payload);
  const intencaoPersistida = modulo ? `${modulo}_dinamico` : (intent.intencao || null);
  const fase = faseExecucao(payload);

  const row = {
    id,
    empresa_id: payload.empresa_id ?? null,
    usuario: payload.usuario || null,
    numero_wa: payload.numero_wa || null,
    canal_id: payload.canal_id || null,
    canal_origem: payload.canal_origem || null,
    texto_original: payload.texto_original || '',
    intent_json: json(intent),
    intencao: intencaoPersistida,
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
    modulo: modulo || null,
    sql_gerado: resultado.sql_gerado || payload.sql_gerado || null,
    escopo_execucao: payload.escopo_execucao || resultado.escopo_execucao || intent._escopoExecucao || null,
    sql_canonico_origem: resultado._sql_canonico_origem || payload.sql_canonico_origem || null,
    sql_canonico_empresa_origem: resultado._sql_canonico_empresa_origem || payload.sql_canonico_empresa_origem || null,
    sql_canonico_original: resultado._sql_canonico_original || payload.sql_canonico_original || null,
    sql_canonico_adaptado: resultado._sql_canonico || payload.sql_canonico_adaptado || null,
    sql_auditoria_json: json(resultado._sql_auditoria || payload.sql_auditoria || null),
    sql_canonico_parametros_json: json(resultado._sql_canonico_parametros || payload.sql_canonico_parametros || []),
    sql_canonico_parametrizado: (resultado._sql_canonico_parametrizado || payload.sql_canonico_parametrizado) ? 1 : 0,
    sql_ia_bruto: resultado._sql_auditoria?.sql_ia_bruto || payload.sql_ia_bruto || null,
    sql_final_executado: resultado._sql_auditoria?.sql_final_executado || resultado.sql_gerado || payload.sql_final_executado || null,
    intent_canonico_json: json(resultado._intent_canonico || intent._intentCanonico || payload.intent_canonico || null),
    intent_canonico_hash: resultado._intent_canonico_hash || intent._intentCanonicoHash || payload.intent_canonico_hash || null,
    intent_canonico_estrutural_json: json(resultado._intent_canonico_estrutural || intent._intentCanonicoEstrutural || payload.intent_canonico_estrutural || null),
    chave_cache: resultado._chave_cache || intent._chaveCacheIntent || payload.chave_cache || null,
    sql_template: resultado._sql_template || resultado._sql_auditoria?.sql_template || payload.sql_template || null,
    sql_template_parametros_json: json(resultado._sql_template_parametros || resultado._sql_auditoria?.sql_template_parametros || payload.sql_template_parametros || []),
    sql_canonico_reuso_motivo: resultado._sql_canonico_reuso_motivo || payload.sql_canonico_reuso_motivo || null,
    sql_canonico_reuso_permitido: resultado._sql_canonico_reuso_permitido == null && payload.sql_canonico_reuso_permitido == null
      ? null
      : ((resultado._sql_canonico_reuso_permitido ?? payload.sql_canonico_reuso_permitido) ? 1 : 0),
    sql_canonico_empresa_atual: payload.empresa_id ?? resultado._sql_auditoria?.empresa_id ?? null,
    fase_execucao: fase,
    agente_url: payload.agente_url || resultado._agente_url || _agenteUrl(payload.empresa_id) || null,
    duracao_ms: payload.duracao_ms ?? resultado.duracao_ms ?? null,
    trace_json: json(payload.trace || intent._trace || resultado.trace || []),
    pipeline_origem: resultado._pipeline_origem || payload.pipeline_origem || null,
    chat_turno: resultado._chat_turno ?? payload.chat_turno ?? null,
    sql_validacao_erro: resultado._sql_validacao_erro || payload.sql_validacao_erro || null,
    timing_json: json(payload.timing_json || null),
    formatacao_caminho: payload.formatacao_caminho || null,
    recebido_em: payload.recebido_em || null,
    pipeline_ms: payload.pipeline_ms ?? null,
    entregue_ms: payload.entregue_ms ?? null,
    feedback: payload.feedback || null,
    feedback_observacao: payload.feedback_observacao || null,
    criado_em: now,
    atualizado_em: now,
  };

  if (!colunaExiste('interpretation_log', 'canal_origem')) {
    delete row.canal_origem;
  }

  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  db.prepare(`INSERT INTO interpretation_log (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(cols.map(c => row[c]));
  return row;
}

function listar(empresaId, opts = {}) {
  const limit = Math.min(parseInt(opts.limit, 10) || 200, 1000);
  const fase = String(opts.fase_execucao || '').trim();
  const params = [empresaId];
  const where = ['empresa_id = ?'];
  if (fase) {
    where.push('fase_execucao = ?');
    params.push(fase);
  }
  params.push(limit);
  return getDB().prepare(`
    SELECT *
    FROM interpretation_log
    WHERE ${where.join(' AND ')}
    ORDER BY criado_em DESC
    LIMIT ?
  `).all(...params).map(canalOrigemDoRegistro);
}

function listarResumo(empresaId, opts = {}) {
  const limit = Math.min(parseInt(opts.limit, 10) || 200, 1000);
  const fase = String(opts.fase_execucao || '').trim();
  const params = [empresaId];
  const where = ['empresa_id = ?'];
  const canalOrigemSelect = colunaExiste('interpretation_log', 'canal_origem')
    ? 'canal_origem'
    : 'NULL AS canal_origem';
  if (fase) {
    where.push('fase_execucao = ?');
    params.push(fase);
  }
  params.push(limit);
  return getDB().prepare(`
    SELECT
      id,
      criado_em,
      usuario,
      numero_wa,
      canal_id,
      ${canalOrigemSelect},
      origem,
      substr(texto_original, 1, 240) AS texto_original,
      substr(resposta_entregue, 1, 360) AS resposta_entregue,
      intencao,
      dataset_nome,
      trace_json,
      intent_json,
      pipeline_origem,
      fase_execucao,
      sql_canonico_origem,
      provedor,
      confianca,
      fallback_usado,
      escopo_execucao,
      resultado_tipo,
      cache_hit
    FROM interpretation_log
    WHERE ${where.join(' AND ')}
    ORDER BY criado_em DESC
    LIMIT ?
  `).all(...params).map(canalOrigemDoRegistro);
}

function obterPorId(id, empresaId) {
  if (!id || !empresaId) return null;
  const row = getDB().prepare(`
    SELECT *
    FROM interpretation_log
    WHERE id = ? AND empresa_id = ?
    LIMIT 1
  `).get(id, empresaId) || null;
  if (row && row.canal_origem === undefined) row.canal_origem = null;
  return canalOrigemDoRegistro(row);
}

// Busca a ultima interpretacao de sucesso (com SQL gerado) deste remetente, usada pelos
// comandos de WhatsApp "mostre o SQL usado" e pelo fluxo de reporte de erro do usuario.
// numeroWa deve vir ja normalizado (mesmo formato gravado em numero_wa no registro).
function obterUltimaComSqlPorSender(empresaId, numeroWa) {
  if (!empresaId || !numeroWa) return null;
  return getDB().prepare(`
    SELECT *
    FROM interpretation_log
    WHERE empresa_id = ? AND numero_wa = ?
      AND (sql_final_executado IS NOT NULL OR sql_gerado IS NOT NULL)
    ORDER BY criado_em DESC
    LIMIT 1
  `).get(empresaId, numeroWa) || null;
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

function atualizarEntregue(id, entregueMs) {
  if (!id || entregueMs == null) return false;
  const info = getDB().prepare(`
    UPDATE interpretation_log
       SET entregue_ms = ?, atualizado_em = ?
     WHERE id = ?
  `).run(entregueMs, agora(), id);
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

function excluirPorIds(empresaId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const db = getDB();
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(
    `DELETE FROM interpretation_log WHERE empresa_id = ? AND id IN (${placeholders})`
  ).run([empresaId, ...ids]);
  return info.changes || 0;
}

module.exports = { registrar, listar, listarResumo, obterPorId, obterUltimaComSqlPorSender, registrarFeedback, atualizarEntregue, limpar, excluirPorIds, camposInferidos, moduloDinamico, faseExecucao };
