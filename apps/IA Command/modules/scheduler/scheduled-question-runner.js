const whatsappManager = require('../whatsapp/service-manager');
const channels        = require('../whatsapp/channel-store');
const http            = require('http');
const interpretationLog = require('../ai/interpretation-log');
const responseFormatter = require('../erp/core/response-formatter');
const messageTemplates = require('../whatsapp/message-templates');
const store = require('./scheduled-question-store');

const SQL_HANDLERS = {
  compras: require('../erp/totvs_protheus/compras/ai-sql-handler-v2'),
  financeiro: require('../erp/totvs_protheus/financeiro/ai-sql-handler-v2'),
  faturamento: require('../erp/totvs_protheus/faturamento/ai-sql-handler-v2'),
  comissao: require('../erp/totvs_protheus/comissao/ai-sql-handler-v2'),
};

function sqlFixo(job) {
  return String(job?.sql_fixo || '').trim();
}

function partesData(date, timezone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'America/Manaus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const partes = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return {
    ano: partes.year,
    mes: partes.month,
    dia: partes.day,
    yyyymmdd: `${partes.year}${partes.month}${partes.day}`,
    iso: `${partes.year}-${partes.month}-${partes.day}`,
  };
}

function macrosDataSql(job, referencia = new Date()) {
  const timezone = job?.timezone || 'America/Manaus';
  const hoje = partesData(referencia, timezone);
  const ontem = partesData(new Date(referencia.getTime() - 24 * 60 * 60 * 1000), timezone);
  const amanha = partesData(new Date(referencia.getTime() + 24 * 60 * 60 * 1000), timezone);
  const ultimoDiaMes = String(new Date(Date.UTC(Number(hoje.ano), Number(hoje.mes), 0)).getUTCDate()).padStart(2, '0');
  return {
    DATA_EXECUCAO: hoje.yyyymmdd,
    DATA_EXECUCAO_ISO: hoje.iso,
    HOJE: hoje.yyyymmdd,
    HOJE_ISO: hoje.iso,
    ONTEM: ontem.yyyymmdd,
    ONTEM_ISO: ontem.iso,
    AMANHA: amanha.yyyymmdd,
    AMANHA_ISO: amanha.iso,
    INICIO_MES: `${hoje.ano}${hoje.mes}01`,
    INICIO_MES_ISO: `${hoje.ano}-${hoje.mes}-01`,
    FIM_MES: `${hoje.ano}${hoje.mes}${ultimoDiaMes}`,
    FIM_MES_ISO: `${hoje.ano}-${hoje.mes}-${ultimoDiaMes}`,
    ANO: hoje.ano,
    MES: hoje.mes,
    DIA: hoje.dia,
  };
}

function aplicarMacrosSql(sql, job) {
  const macros = macrosDataSql(job);
  return String(sql || '').replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/gi, (match, nome) => {
    const chave = String(nome || '').toUpperCase();
    return macros[chave] === undefined ? match : macros[chave];
  });
}

function consultaSemSetRowcount(sql) {
  return String(sql || '').replace(/^\s*SET\s+ROWCOUNT\s+\d+\s*;\s*/i, '').trim();
}

function validarSqlFixoBasico(sql) {
  const consulta = consultaSemSetRowcount(sql);
  if (!/^\s*(select|with)\b/i.test(consulta)) {
    throw Object.assign(new Error('SQL fixo deve iniciar com SELECT ou WITH.'), { statusCode: 400 });
  }
  const semPontoFinal = consulta.replace(/;\s*$/, '');
  if (/;\s*\S/.test(semPontoFinal)) {
    throw Object.assign(new Error('SQL fixo deve conter apenas uma consulta.'), { statusCode: 400 });
  }
  if (/\b(insert|update|delete|drop|alter|truncate|exec|execute|merge|create|grant|revoke)\b/i.test(sql)) {
    throw Object.assign(new Error('SQL fixo permite apenas consulta de leitura.'), { statusCode: 400 });
  }
}

function montarIntentSqlFixo(job) {
  return {
    intencao: `${String(job.modulo || 'agendamento').toLowerCase()}_dinamico`,
    origem: 'agendamento_sql_fixo',
    confianca: 1,
    periodo: {},
    filtros: {},
    _moduloDinamico: String(job.modulo || '').toLowerCase(),
    _mensagemOriginal: job.pergunta || job.nome || 'Consulta agendada',
    _empresaIdFixa: Number(job.empresa_id || 0) || null,
    _systemOrigin: 'agendamento',
    _skipIaSqlGeneration: true,
  };
}

function statusExecucaoSql(resultado, resposta) {
  const corpo = String(resposta || '').trim();
  return {
    ok: resultado?.tipo !== 'erro' && !/^(nao consegui|não consegui|nao foi possivel|não foi possivel|ocorreu um erro|erro\b)/i.test(corpo),
    error_detail: resultado?.subtipo || resultado?._sql_validacao_erro || resultado?.mensagem || null,
  };
}

async function executarSqlFixoUmaVez(empresaId, job) {
  const sqlOriginal = sqlFixo(job);
  const sql = aplicarMacrosSql(sqlOriginal, job);
  validarSqlFixoBasico(sql);

  const modulo = String(job.modulo || '').toLowerCase();
  const handler = SQL_HANDLERS[modulo];
  if (!handler) {
    throw Object.assign(new Error('Informe um modulo valido para executar SQL fixo.'), { statusCode: 400 });
  }

  const intent = montarIntentSqlFixo(job);
  const t0 = Date.now();
  const resultado = await handler.executarSqlDireto(sql, intent, Number(empresaId));
  const resposta = responseFormatter.formatar(resultado, intent, { empresaId: Number(empresaId), messageTemplates });
  const status = statusExecucaoSql(resultado, resposta);
  const log = interpretationLog.registrar({
    empresa_id: Number(empresaId),
    usuario: 'agendamento',
    numero_wa: null,
    texto_original: job.pergunta || job.nome || 'Consulta agendada',
    intent,
    resultado,
    resposta_entregue: resposta,
    origem: 'agendamento_sql_fixo',
    duracao_ms: resultado?.duracao_ms ?? (Date.now() - t0),
    sql_gerado: sql,
    sql_canonico_original: sqlOriginal,
    sql_final_executado: resultado?._sql_auditoria?.sql_final_executado || resultado?.sql_gerado || sql,
    pipeline_origem: 'agendamento_sql_fixo',
  });

  return {
    resposta,
    ok: status.ok,
    error_detail: status.error_detail,
    interpretation_log_id: log.id,
    duration_ms: resultado?.duracao_ms ?? (Date.now() - t0),
  };
}

async function executarPerguntaUmaVez(svc, empresaId, job, destinatarios) {
  if (sqlFixo(job)) return executarSqlFixoUmaVez(empresaId, job);
  return svc.executeScheduledQuestionOnce({
    empresaId,
    numero: destinatarios[0]?.numero,
    pergunta: job.pergunta,
  });
}

// Chama o worker Windows Service via HTTP para executar a pergunta agendada.
function _executarViaWorker(workerPort, empresaId, numero, pergunta) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ empresaId, numero, pergunta });
    const req  = http.request({
      hostname: '127.0.0.1', port: workerPort, path: '/scheduled-question',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 330000,
    }, (res) => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => {
        try {
          const json = JSON.parse(b);
          if (res.statusCode >= 400) reject(Object.assign(new Error(json.erro || `HTTP ${res.statusCode}`), { statusCode: res.statusCode }));
          else resolve(json);
        } catch (_) { reject(new Error('Resposta inválida do worker.')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout ao chamar worker do agendamento.')); });
    req.write(body);
    req.end();
  });
}

async function executarJob(empresaId, job, { trigger_tipo = 'manual', usuario = 'sistema' } = {}) {
  const destinatarios = store.listarDestinatarios(empresaId, job.id);
  if (!destinatarios.length) {
    throw Object.assign(new Error('Job sem destinatarios ativos.'), { statusCode: 400 });
  }

  // Detecta se o canal roda como Windows Service — delega ao worker via HTTP
  const canal = channels.buscarCanal(job.channel_id);
  if (canal?.is_windows_service && canal?.worker_port) {
    const run  = store.criarRun(empresaId, job, { trigger_tipo, usuario });
    const dest = destinatarios[0];
    store.criarDelivery(empresaId, run.id, job.id, dest);
    try {
      if (sqlFixo(job)) {
        // SQL fixo não passa pelo worker — executa localmente sem WhatsApp
        const svc = whatsappManager.get(job.channel_id);
        if (!svc) throw Object.assign(new Error('Canal WhatsApp do job nao esta conectado.'), { statusCode: 409 });
        return await executarSqlFixoUmaVez(empresaId, job);
      }
      const resultado = await _executarViaWorker(canal.worker_port, empresaId, dest.numero, job.pergunta);
      store.atualizarRun(empresaId, run.id, {
        status: resultado.ok !== false ? 'sucesso' : 'erro',
        resposta: resultado.resposta,
        interpretation_log_id: resultado.interpretation_log_id,
        finished_at: new Date().toISOString(),
        duration_ms: resultado.duration_ms,
      });
      return resultado;
    } catch (err) {
      store.atualizarRun(empresaId, run.id, {
        status: 'erro',
        erro: err.message,
        finished_at: new Date().toISOString(),
      });
      throw err;
    }
  }

  // Modo legado — canal rodando via monitor (processo principal)
  const svc = whatsappManager.get(job.channel_id);
  if (!svc || svc.getStatus() !== 'connected') {
    throw Object.assign(new Error('Canal WhatsApp do job nao esta conectado.'), { statusCode: 409 });
  }

  const run = store.criarRun(empresaId, job, { trigger_tipo, usuario });
  const started = Date.now();
  const resumo = [];
  let sucessos = 0;
  let falhas = 0;
  let primeiroLogId = null;
  let primeiraResposta = null;
  let resultadoUnico = null;

  const entregas = destinatarios.map(dest => ({
    dest,
    deliveryId: store.criarDelivery(empresaId, run.id, job.id, dest),
  }));

  try {
    resultadoUnico = await executarPerguntaUmaVez(svc, empresaId, job, destinatarios);
    primeiroLogId = resultadoUnico.interpretation_log_id || null;
    primeiraResposta = resultadoUnico.resposta || null;
  } catch (err) {
    for (const entrega of entregas) {
      falhas++;
      resumo.push(`${entrega.dest.nome || entrega.dest.numero}: ${err.message}`);
      store.atualizarDelivery(entrega.deliveryId, { status: 'erro', erro: err.message });
    }
    return store.atualizarRun(empresaId, run.id, {
      status: 'erro',
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      interpretation_log_id: null,
      resposta: resumo.join('\n'),
      erro: resumo.join('\n'),
    });
  }

  for (const { dest, deliveryId } of entregas) {
    try {
      await svc.sendScheduledQuestionDelivery({
        empresaId,
        numero: dest.numero,
        resposta: resultadoUnico.resposta,
        ok: resultadoUnico.ok,
      });
      if (resultadoUnico.ok === false) falhas++;
      else sucessos++;
      resumo.push(`${dest.nome || dest.numero}: ${resultadoUnico.ok === false ? (resultadoUnico.error_detail || 'executado com erro na consulta') : 'enviado'}`);
      store.atualizarDelivery(deliveryId, { status: 'sucesso', sent_at: new Date().toISOString(), erro: null });
    } catch (err) {
      falhas++;
      resumo.push(`${dest.nome || dest.numero}: ${err.message}`);
      store.atualizarDelivery(deliveryId, { status: 'erro', erro: err.message });
    }
  }

  const status = sucessos && !falhas ? 'sucesso' : sucessos ? 'parcial' : 'erro';
  if (primeiroLogId) {
    try { interpretationLog.atualizarEntregue(primeiroLogId, Date.now() - started); } catch (_) {}
  }
  return store.atualizarRun(empresaId, run.id, {
    status,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    interpretation_log_id: primeiroLogId,
    resposta: primeiraResposta || resumo.join('\n'),
    erro: falhas ? resumo.filter(x => !x.endsWith(': enviado')).join('\n') : null,
  });
}

module.exports = { executarJob };
