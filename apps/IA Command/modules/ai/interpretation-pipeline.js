// Pipeline de registro compartilhado entre canais de chat (WhatsApp real e
// chat Protheus, e qualquer canal futuro) — grava a interacao em dois
// lugares: interpretation_log (auditoria/telas admin, ver interpretation-log.js)
// e execution_log (cache/aprendizado de SQL canonico, usado por nlsql-cache).
//
// [EXTRAIDO 13/08/2026] Logica copiada de modules/whatsapp/service.js
// (metodo _registrarInterpretacao e auxiliares _moduloMonitorIntent,
// _traceInterpretacao, _normalizarNumeroWa, _promoverExecutionLogConfiavelCache,
// _resultadoSqlCacheavel) para ser reutilizavel pelo canal protheus_whatsapp,
// que gravava so em interpretation_log com um subconjunto de campos e nunca
// gravava em execution_log — ficava invisivel para auditoria completa e para
// o cache de reuso de SQL entre execucoes.
//
// CUIDADO: modules/whatsapp/service.js NAO foi alterado na sua logica interna
// — seu metodo _registrarInterpretacao passou a delegar para
// registrarInterpretacao() deste modulo, preservando exatamente o mesmo
// comportamento observavel (mesmos parametros, mesmo efeito no banco). A
// unica diferenca e a origem do texto de log (antes this.log(), agora um
// callback onLog opcional) — se o canal WhatsApp continuar passando seu
// this.log() como onLog, o comportamento e identico ao de antes.

const { getDB } = require('../database');
const interpretationLog = require('./interpretation-log');

const NLSQL_CACHE_QUARANTINE_DEFAULT_MINUTES = 30;

function _minutosEnv(nome, padrao, { min = 0, max = 24 * 60 } = {}) {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === null || String(bruto).trim() === '') return padrao;
  const n = Number(String(bruto).replace(',', '.'));
  if (!Number.isFinite(n)) return padrao;
  return Math.max(min, Math.min(max, n));
}

function _janelaCacheMs(nome, padraoMinutos) {
  return Math.round(_minutosEnv(nome, padraoMinutos) * 60 * 1000);
}

function _textoSqlIncacheavel(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return true;
  if (/^--\s*ERRO\s*:/i.test(texto)) return true;
  return /\bSQL rejeitado por (?:contrato|periodo inconsistente|SX3|cobertura incompleta)\b/i.test(texto);
}

function resultadoSqlCacheavel({ resultado = {}, statusExecucao = 'desconhecido', sqlFinalExecutado = null, sqlTemplate = null, chaveCache = null } = {}) {
  const erroValidacao = resultado?._sql_validacao_erro || resultado?.sql_validacao_erro || resultado?._sql_auditoria?.sql_validacao_erro || null;
  const subtipo = String(resultado?.subtipo || '').trim();
  const subtipoInvalido = /^(?:contrato_|sql_|periodo_sql_|funcao_data_|filtro_)/i.test(subtipo);
  if (statusExecucao !== 'sucesso') return { ok: false, cacheStatus: 'inapto_status' };
  if (resultado?.tipo !== 'sucesso_ai_sql') return { ok: false, cacheStatus: 'inapto_sem_sql_cacheavel' };
  if (erroValidacao || subtipoInvalido) return { ok: false, cacheStatus: 'inapto_validacao' };
  if (!chaveCache || !sqlFinalExecutado || !sqlTemplate) return { ok: false, cacheStatus: 'inapto_sem_sql_cacheavel' };
  if (_textoSqlIncacheavel(sqlFinalExecutado) || _textoSqlIncacheavel(sqlTemplate)) return { ok: false, cacheStatus: 'inapto_validacao' };
  return { ok: true, cacheStatus: 'pendente' };
}

function normalizarNumeroWa(valor) {
  return String(valor || '').split('@')[0].replace(/\D/g, '');
}

function moduloMonitorIntent(intent = {}, resultado = null) {
  const conhecidos = new Set(['compras', 'financeiro', 'faturamento', 'comissao', 'estoque']);
  const candidatos = [
    intent._moduloDinamico,
    resultado?.dataset_nome,
    ...(Array.isArray(intent._trace) ? intent._trace.map(t => t?.modulo) : []),
    ...(Array.isArray(resultado?.trace) ? resultado.trace.map(t => t?.modulo) : []),
    String(intent.intencao || '').replace(/_dinamico$/i, ''),
  ].filter(Boolean).map(v => String(v).toLowerCase());
  if (candidatos.some(v => /(?:^|[_+])compras(?:$|[_+])/.test(v) && /(?:^|[_+])faturamento(?:$|[_+])/.test(v))) return 'compras';
  return candidatos.find(v => conhecidos.has(v)) || null;
}

function traceInterpretacao({ intent = {}, resultado = null, escopo = null, contextoAnterior = null } = {}) {
  const trace = [];
  const vistos = new Set();
  const add = (item) => {
    if (!item) return;
    const chave = JSON.stringify({
      etapa: item.etapa || null,
      acao: item.acao || null,
      modulo: item.modulo || null,
      motor: item.motor || null,
      intencao: item.intencao || null,
      detalhe: item.detalhe || null,
    });
    if (vistos.has(chave)) return;
    vistos.add(chave);
    trace.push(item);
  };
  (Array.isArray(intent._trace) ? intent._trace : []).forEach(add);
  (Array.isArray(resultado?.trace) ? resultado.trace : []).forEach(add);
  if (contextoAnterior || intent._contextoAplicado) {
    trace.push({
      etapa: 'contexto',
      acao: intent._contextoAplicado ? 'aplicado' : 'disponivel',
      intencao: contextoAnterior?.intencao || intent.intencao || null,
      detalhe: contextoAnterior ? `anterior=${contextoAnterior.intencao || 'desconhecido'}` : null,
    });
  }
  if (resultado?._sql_canonico_origem) {
    trace.push({
      etapa: 'sql_canonico',
      acao: resultado._sql_canonico_origem === 'whatsapp_all_reuso' ? 'reutilizado_adaptado_sx2_sx3' : 'definido_por_ia',
      modulo: moduloMonitorIntent(intent, resultado) || null,
      detalhe: `origem=${resultado._sql_canonico_origem}; empresa_origem=${resultado._sql_canonico_empresa_origem || 'n/a'}; escopo=${intent._escopoExecucao || 'single'}; parametros=${Array.isArray(resultado._sql_canonico_parametros) ? resultado._sql_canonico_parametros.length : 0}`,
    });
  }
  if (resultado?._diagnostico_tecnico) {
    const diag = resultado._diagnostico_tecnico;
    trace.push({
      etapa: 'diagnostico',
      acao: diag.codigo || resultado.subtipo || resultado.tipo || 'falha',
      modulo: moduloMonitorIntent(intent, resultado) || null,
      detalhe: [diag.titulo, diag.descricao, diag.acao_sistema].filter(Boolean).join(' | '),
    });
  }
  trace.push({
    etapa: 'finalizacao',
    acao: resultado?.tipo || 'desconhecido',
    modulo: moduloMonitorIntent(intent, resultado) || null,
    intencao: intent.intencao || null,
  });
  return trace;
}

function promoverExecutionLogConfiavelCache(empresaId, numeroWa, { onLog } = {}) {
  try {
    const janelaMs = _janelaCacheMs('IAC_NLSQL_CACHE_QUARANTINE_MINUTES', NLSQL_CACHE_QUARANTINE_DEFAULT_MINUTES);
    const limite = new Date(Date.now() - janelaMs).toISOString();
    const info = getDB().prepare(`
      UPDATE execution_log
         SET confiavel_cache = 1,
             confiavel_cache_em = ?,
             cache_status = 'confiavel'
       WHERE empresa_id = ?
         AND numero_wa = ?
         AND status IN ('sucesso', 'sucesso_ai_sql')
         AND cache_status = 'pendente'
         AND criado_em <= ?
    `).run(new Date().toISOString(), empresaId, numeroWa, limite);
    if (info.changes > 0 && typeof onLog === 'function') {
      onLog(`Cache NL-SQL: ${info.changes} execucao(oes) promovida(s) a confiavel apos quarentena de ${Math.round(janelaMs / 60000)} min.`, 'info');
    }
  } catch (err) {
    if (typeof onLog === 'function') onLog(`Falha ao promover execution_log para cache confiavel: ${err.message}`, 'warning');
  }
}

// Registra a interacao completa: interpretation_log (auditoria) +
// execution_log (cache/aprendizado). Mesmo contrato de entrada usado por
// modules/whatsapp/service.js#_registrarInterpretacao — canalId e
// tipoMensagem sao opcionais (o canal Protheus nao tem conceito de um nem
// de outro; ficam null, igual campos ja tratados como opcionais no schema).
function registrarInterpretacao({
  empresaId, sender, texto, intent, resultado, resposta, duracaoMs,
  timingJson = null, formatacaoCaminho = null, recebidoEm = null,
  pipelineMs = null, entregueMs = null, canalId = null, tipoMensagem = 'texto',
  onLog = null,
}) {
  let logId = null;
  try {
    const trace = traceInterpretacao({ intent, resultado });
    const row = interpretationLog.registrar({
      empresa_id: empresaId,
      usuario: sender,
      numero_wa: normalizarNumeroWa(sender),
      canal_id: canalId,
      texto_original: texto,
      intent,
      resultado,
      resposta_entregue: resposta,
      sql_gerado: resultado?.sql_gerado || null,
      escopo_execucao: resultado?._escopoExecucao || intent?._escopoExecucao || null,
      sql_canonico_origem: resultado?._sql_canonico_origem || null,
      sql_canonico_empresa_origem: resultado?._sql_canonico_empresa_origem || null,
      sql_canonico_original: resultado?._sql_canonico_original || null,
      sql_canonico_adaptado: resultado?._sql_canonico || null,
      sql_auditoria: resultado?._sql_auditoria || null,
      sql_canonico_parametros: resultado?._sql_canonico_parametros || [],
      sql_canonico_parametrizado: !!resultado?._sql_canonico_parametrizado,
      sql_canonico_reuso_motivo: resultado?._sql_canonico_reuso_motivo || null,
      sql_canonico_reuso_permitido: resultado?._sql_canonico_reuso_permitido,
      timing_json: timingJson,
      formatacao_caminho: formatacaoCaminho || intent?._formatacaoCaminho || null,
      duracao_ms: duracaoMs ?? null,
      recebido_em: recebidoEm ?? null,
      pipeline_ms: pipelineMs ?? null,
      entregue_ms: entregueMs ?? null,
      trace,
    });
    logId = row?.id || null;
  } catch (err) {
    if (typeof onLog === 'function') onLog(`Falha ao registrar interpretacao: ${err.message}`, 'warning');
  }

  try {
    const STATUS_MAP = { sucesso: 'sucesso', sucesso_ai_sql: 'sucesso', erro: 'erro', sem_dados: 'sem_dados', dialogo: 'dialogo', desconhecido: 'desconhecido' };
    const numeroWa = normalizarNumeroWa(sender);
    promoverExecutionLogConfiavelCache(empresaId, numeroWa, { onLog });
    const intentCanonico = resultado?._intent_canonico || intent?._intentCanonico || null;
    const ehConsolidadoSemIntentCache = resultado?._pipeline_origem === 'consolidado'
      && !intentCanonico
      && !(resultado?._chave_cache || intent?._chaveCacheIntent);
    if (ehConsolidadoSemIntentCache) return logId;
    const statusExecucao = STATUS_MAP[resultado?.tipo] ?? resultado?.tipo ?? 'desconhecido';
    const sqlFinalExecutado = resultado?._sql_auditoria?.sql_final_executado || resultado?.sql_gerado || null;
    const sqlTemplate = resultado?._sql_template || resultado?._sql_auditoria?.sql_template || resultado?._sql_canonico || null;
    const chaveCache = resultado?._chave_cache || intent?._chaveCacheIntent || null;
    const cacheavel = resultadoSqlCacheavel({ resultado, statusExecucao, sqlFinalExecutado, sqlTemplate, chaveCache });
    const chaveCacheAprendizado = cacheavel.ok ? chaveCache : null;
    const sqlTemplateAprendizado = cacheavel.ok ? sqlTemplate : null;
    const detalhesExecucao = JSON.stringify({
      escopo_execucao: intent?._escopoExecucao || null,
      modulo: moduloMonitorIntent(intent, resultado) || null,
      intent_canonico_hash: resultado?._intent_canonico_hash || intent?._intentCanonicoHash || null,
      chave_cache: chaveCache,
      cache_aprendizado_bloqueado: !cacheavel.ok,
      cache_aprendizado_motivo: cacheavel.cacheStatus,
      intent_canonico_validation: intentCanonico?.validation || null,
      sql_template_parametros: resultado?._sql_template_parametros || resultado?._sql_auditoria?.sql_template_parametros || [],
      sql_canonico_origem: resultado?._sql_canonico_origem || null,
      sql_canonico_empresa_origem: resultado?._sql_canonico_empresa_origem || null,
      sql_canonico_parametrizado: !!resultado?._sql_canonico_parametrizado,
      sql_canonico_reuso_motivo: resultado?._sql_canonico_reuso_motivo || null,
      sql_canonico_reuso_permitido: resultado?._sql_canonico_reuso_permitido ?? null,
      sql_auditoria: resultado?._sql_auditoria || null,
      rows_count: Array.isArray(resultado?.rows) ? resultado.rows.length : null,
      subtipo: resultado?.subtipo || null,
    });
    getDB().prepare(
      `INSERT OR IGNORE INTO execution_log
         (correlation_id, empresa_id, usuario, numero_wa, intencao, status, duracao_ms, tipo_mensagem,
          detalhes_json, texto_original, intent_canonico_json, intent_canonico_hash, chave_cache,
          sql_final_executado, sql_template, prompt_version, spec_version, schema_version, model,
          confiavel_cache, cache_status, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      require('crypto').randomUUID(),
      empresaId,
      sender,
      numeroWa,
      intent?.intencao || 'desconhecido',
      statusExecucao,
      duracaoMs ?? null,
      tipoMensagem || 'texto',
      detalhesExecucao,
      texto || null,
      intentCanonico ? JSON.stringify(intentCanonico) : null,
      resultado?._intent_canonico_hash || intent?._intentCanonicoHash || null,
      chaveCacheAprendizado,
      sqlFinalExecutado,
      sqlTemplateAprendizado,
      intentCanonico?.prompt_version || null,
      intentCanonico?.spec_version || null,
      intentCanonico?.schema_version || null,
      intentCanonico?.model || null,
      0,
      cacheavel.cacheStatus,
      new Date().toISOString(),
    );
  } catch (err) {
    if (typeof onLog === 'function') onLog(`Falha ao registrar execucao: ${err.message}`, 'warning');
  }
  return logId;
}

module.exports = {
  registrarInterpretacao,
  traceInterpretacao,
  moduloMonitorIntent,
  normalizarNumeroWa,
  promoverExecutionLogConfiavelCache,
  resultadoSqlCacheavel,
};
