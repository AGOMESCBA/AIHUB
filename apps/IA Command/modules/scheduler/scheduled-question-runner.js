const whatsappManager = require('../whatsapp/service-manager');
const channels        = require('../whatsapp/channel-store');
const http            = require('http');
const interpretationLog = require('../ai/interpretation-log');
const responseFormatter = require('../erp/core/response-formatter');
const messageTemplates = require('../whatsapp/message-templates');
const store = require('./scheduled-question-store');
const crud = require('../database/crud');
const connectionFactory = require('../erp/providers/connection-factory');
const semanticDatasetRunner = require('../erp/core/semantic-dataset-ai-runner');

const SQL_HANDLERS = {
  compras: require('../erp/totvs_protheus/compras/ai-sql-handler-v2'),
  financeiro: require('../erp/totvs_protheus/financeiro/ai-sql-handler-v2'),
  faturamento: require('../erp/totvs_protheus/faturamento/ai-sql-handler-v2'),
  comissao: require('../erp/totvs_protheus/comissao/ai-sql-handler-v2'),
};

function sqlFixo(job) {
  return String(job?.sql_fixo || '').trim();
}

function normalizarNumeroWa(valor) {
  const numero = String(valor || '').replace(/\D/g, '');
  return numero || null;
}

function numeroWaSqlFixo(job, destinatarios) {
  const direto = normalizarNumeroWa(job?.numero_wa || job?.numeroWa || job?.celular);
  if (direto) return direto;
  const primeiro = Array.isArray(destinatarios) ? destinatarios.find(Boolean) : null;
  return normalizarNumeroWa(primeiro?.numero || primeiro?.celular || primeiro?.telefone || primeiro?.wa);
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

function partesCalendario(ano, mes, dia) {
  const date = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return { ano: y, mes: m, dia: d, yyyymmdd: `${y}${m}${d}`, iso: `${y}-${m}-${d}` };
}

function normalizarAnoMes(ano, mes) {
  const indice = (Number(ano) * 12) + (Number(mes) - 1);
  const y = Math.floor(indice / 12);
  const m = indice - (y * 12) + 1;
  return { ano: y, mes: m };
}

function ultimoDiaDoMes(ano, mes) {
  return new Date(Date.UTC(Number(ano), Number(mes), 0)).getUTCDate();
}

function deslocarDia(base, dias) {
  return partesCalendario(base.ano, base.mes, Number(base.dia) + Number(dias || 0));
}

function deslocarMes(base, meses) {
  const alvo = normalizarAnoMes(base.ano, Number(base.mes) + Number(meses || 0));
  const dia = Math.min(Number(base.dia), ultimoDiaDoMes(alvo.ano, alvo.mes));
  return partesCalendario(alvo.ano, alvo.mes, dia);
}

function periodoMes(base, meses = 0) {
  const alvo = normalizarAnoMes(base.ano, Number(base.mes) + Number(meses || 0));
  const inicio = partesCalendario(alvo.ano, alvo.mes, 1);
  const fim = partesCalendario(alvo.ano, alvo.mes, ultimoDiaDoMes(alvo.ano, alvo.mes));
  return { inicio, fim };
}

function periodoAno(base, anos = 0) {
  const ano = Number(base.ano) + Number(anos || 0);
  return {
    inicio: partesCalendario(ano, 1, 1),
    fim: partesCalendario(ano, 12, 31),
  };
}

function inicioDaSemana(base) {
  const date = new Date(Date.UTC(Number(base.ano), Number(base.mes) - 1, Number(base.dia)));
  const day = date.getUTCDay();
  return deslocarDia(base, -(day === 0 ? 6 : day - 1));
}

function periodoSemana(base, semanas = 0) {
  const inicio = deslocarDia(inicioDaSemana(base), Number(semanas || 0) * 7);
  const fim = Number(semanas || 0) === 0 ? base : deslocarDia(inicio, 6);
  return { inicio, fim };
}

function macrosDataSql(job, referencia = new Date()) {
  const timezone = job?.timezone || 'America/Manaus';
  const hoje = partesData(referencia, timezone);
  const ontem = deslocarDia(hoje, -1);
  const amanha = deslocarDia(hoje, 1);
  const semanaAtual = periodoSemana(hoje, 0);
  const semanaAnterior = periodoSemana(hoje, -1);
  const proximaSemana = periodoSemana(hoje, 1);
  const mesAtual = periodoMes(hoje, 0);
  const mesAnterior = periodoMes(hoje, -1);
  const anoAtual = periodoAno(hoje, 0);
  const anoAnterior = periodoAno(hoje, -1);
  return {
    DATA_EXECUCAO: hoje.yyyymmdd,
    DATA_EXECUCAO_ISO: hoje.iso,
    HOJE: hoje.yyyymmdd,
    HOJE_ISO: hoje.iso,
    ONTEM: ontem.yyyymmdd,
    ONTEM_ISO: ontem.iso,
    AMANHA: amanha.yyyymmdd,
    AMANHA_ISO: amanha.iso,
    INICIO_SEMANA: semanaAtual.inicio.yyyymmdd,
    INICIO_SEMANA_ISO: semanaAtual.inicio.iso,
    FIM_SEMANA: semanaAtual.fim.yyyymmdd,
    FIM_SEMANA_ISO: semanaAtual.fim.iso,
    INICIO_SEMANA_ANTERIOR: semanaAnterior.inicio.yyyymmdd,
    INICIO_SEMANA_ANTERIOR_ISO: semanaAnterior.inicio.iso,
    FIM_SEMANA_ANTERIOR: semanaAnterior.fim.yyyymmdd,
    FIM_SEMANA_ANTERIOR_ISO: semanaAnterior.fim.iso,
    INICIO_PROXIMA_SEMANA: proximaSemana.inicio.yyyymmdd,
    INICIO_PROXIMA_SEMANA_ISO: proximaSemana.inicio.iso,
    FIM_PROXIMA_SEMANA: proximaSemana.fim.yyyymmdd,
    FIM_PROXIMA_SEMANA_ISO: proximaSemana.fim.iso,
    INICIO_MES: mesAtual.inicio.yyyymmdd,
    INICIO_MES_ISO: mesAtual.inicio.iso,
    FIM_MES: mesAtual.fim.yyyymmdd,
    FIM_MES_ISO: mesAtual.fim.iso,
    INICIO_MES_ANTERIOR: mesAnterior.inicio.yyyymmdd,
    INICIO_MES_ANTERIOR_ISO: mesAnterior.inicio.iso,
    FIM_MES_ANTERIOR: mesAnterior.fim.yyyymmdd,
    FIM_MES_ANTERIOR_ISO: mesAnterior.fim.iso,
    INICIO_ANO: anoAtual.inicio.yyyymmdd,
    INICIO_ANO_ISO: anoAtual.inicio.iso,
    FIM_ANO: anoAtual.fim.yyyymmdd,
    FIM_ANO_ISO: anoAtual.fim.iso,
    INICIO_ANO_ANTERIOR: anoAnterior.inicio.yyyymmdd,
    INICIO_ANO_ANTERIOR_ISO: anoAnterior.inicio.iso,
    FIM_ANO_ANTERIOR: anoAnterior.fim.yyyymmdd,
    FIM_ANO_ANTERIOR_ISO: anoAnterior.fim.iso,
    ANO: hoje.ano,
    MES: hoje.mes,
    DIA: hoje.dia,
  };
}

function resolverMacroDataSql(nome, deslocamento, job, referencia = new Date()) {
  const chave = String(nome || '').toUpperCase();
  const offset = deslocamento === undefined || deslocamento === null || deslocamento === '' ? null : Number(deslocamento);
  const hoje = partesData(referencia, job?.timezone || 'America/Manaus');

  if (offset !== null && !Number.isFinite(offset)) return undefined;

  if (offset !== null) {
    if (chave === 'HOJE' || chave === 'DATA_EXECUCAO') return deslocarDia(hoje, offset).yyyymmdd;
    if (chave === 'HOJE_ISO' || chave === 'DATA_EXECUCAO_ISO') return deslocarDia(hoje, offset).iso;
    if (chave === 'INICIO_SEMANA') return periodoSemana(hoje, offset).inicio.yyyymmdd;
    if (chave === 'INICIO_SEMANA_ISO') return periodoSemana(hoje, offset).inicio.iso;
    if (chave === 'FIM_SEMANA') return periodoSemana(hoje, offset).fim.yyyymmdd;
    if (chave === 'FIM_SEMANA_ISO') return periodoSemana(hoje, offset).fim.iso;
    if (chave === 'INICIO_MES') return periodoMes(hoje, offset).inicio.yyyymmdd;
    if (chave === 'INICIO_MES_ISO') return periodoMes(hoje, offset).inicio.iso;
    if (chave === 'FIM_MES') return periodoMes(hoje, offset).fim.yyyymmdd;
    if (chave === 'FIM_MES_ISO') return periodoMes(hoje, offset).fim.iso;
    if (chave === 'INICIO_ANO') return periodoAno(hoje, offset).inicio.yyyymmdd;
    if (chave === 'INICIO_ANO_ISO') return periodoAno(hoje, offset).inicio.iso;
    if (chave === 'FIM_ANO') return periodoAno(hoje, offset).fim.yyyymmdd;
    if (chave === 'FIM_ANO_ISO') return periodoAno(hoje, offset).fim.iso;
    if (chave === 'ANO') return String(Number(hoje.ano) + offset);
    return undefined;
  }

  const macros = macrosDataSql(job, referencia);
  return macros[chave];
}

// Macros de identidade (seguranca por papel dinamico, ex: SoftExpert) — resolvem o codigo,
// papel e sistema cadastrados em whatsapp_numero_modulos para o UNICO destinatario do job.
// So fazem sentido quando o job tem exatamente 1 destinatario: SQL fixo executa uma unica
// vez e manda a mesma resposta para todos, entao um codigo por pessoa so e correto se so
// houver uma pessoa. Retorna undefined (macro nao resolvida, permanece {{...}} no SQL) se
// nao houver destinatario, houver mais de um, ou o cadastro nao tiver modulo/papel/codigo.
function _identidadeDoDestinatarioUnico(job, destinatarios) {
  if (!Array.isArray(destinatarios) || destinatarios.length !== 1) return null;
  const numeroId = destinatarios[0]?.id || destinatarios[0]?.numero_id;
  const erp = _erpDoModulo(job.empresa_id, job.modulo);
  if (!numeroId || !erp) return null;
  try {
    const row = crud.listar('whatsapp_numero_modulos', {})
      .find(m => m.numero_id === numeroId && String(m.erp || '').toLowerCase() === erp && String(m.modulo || '').toLowerCase() === String(job.modulo || '').toLowerCase());
    if (!row) return null;
    return {
      codigo: row.codigo_identidade || null,
      papel: row.papel || null,
      sistema: erp,
    };
  } catch (_) {
    return null;
  }
}

function resolverMacroIdentidadeSql(nome, job, destinatarios) {
  const chave = String(nome || '').toUpperCase();
  if (!['CODIGO_IDENTIDADE', 'PAPEL_IDENTIDADE', 'SISTEMA_IDENTIDADE'].includes(chave)) return undefined;
  const identidade = _identidadeDoDestinatarioUnico(job, destinatarios);
  if (!identidade) return undefined;
  if (chave === 'CODIGO_IDENTIDADE') return identidade.codigo || undefined;
  if (chave === 'PAPEL_IDENTIDADE') return identidade.papel || undefined;
  if (chave === 'SISTEMA_IDENTIDADE') return identidade.sistema || undefined;
  return undefined;
}

function aplicarMacrosSql(sql, job, referencia = new Date(), destinatarios = null) {
  return String(sql || '').replace(/\{\{\s*([A-Z0-9_]+)(?::\s*([+-]?\d+))?\s*\}\}/gi, (match, nome, deslocamento) => {
    const valorData = resolverMacroDataSql(nome, deslocamento, job, referencia);
    if (valorData !== undefined) return valorData;
    const valorIdentidade = resolverMacroIdentidadeSql(nome, job, destinatarios);
    if (valorIdentidade !== undefined) {
      // Escapa aspas simples: o valor entra direto no SQL (ex: WHERE campo = '{{CODIGO_IDENTIDADE}}').
      return String(valorIdentidade).replace(/'/g, "''");
    }
    return match;
  });
}

function macrosPendentesSql(sql) {
  const pendentes = new Set();
  String(sql || '').replace(/\{\{\s*([A-Z0-9_]+)(?::\s*([+-]?\d+))?\s*\}\}/gi, (match) => {
    pendentes.add(match);
    return match;
  });
  return Array.from(pendentes);
}

function validarMacrosResolvidasSql(sql) {
  const pendentes = macrosPendentesSql(sql);
  if (!pendentes.length) return;
  const detalhe = pendentes.slice(0, 5).join(', ');
  throw Object.assign(new Error(`Macro SQL nao reconhecida ou sem contexto para substituicao: ${detalhe}.`), {
    statusCode: 400,
    macrosPendentes: pendentes,
  });
}

function avaliarMacrosSql(sql, job, referencia = new Date(), destinatarios = null) {
  const sqlResolvido = aplicarMacrosSql(sql, job, referencia, destinatarios);
  const macrosPendentes = macrosPendentesSql(sqlResolvido);
  return {
    ok: macrosPendentes.length === 0,
    sqlResolvido,
    macrosPendentes,
  };
}

function consultaSemSetRowcount(sql) {
  return String(sql || '').replace(/^\s*SET\s+ROWCOUNT\s+\d+\s*;\s*/i, '').trim();
}

function garantirSetRowcountSqlFixo(sql, limite = 10000) {
  const texto = String(sql || '').trim();
  if (!texto) return texto;
  if (/^\s*SET\s+ROWCOUNT\s+\d+\s*;\s*/i.test(texto)) return texto;
  const n = Math.min(Math.max(Number(limite) || 10000, 1), 50000);
  return `SET ROWCOUNT ${n};\n${texto}`;
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

// Descobre a qual sistema (erp) pertence o modulo do job, a partir das intentions reais da
// empresa (mesma fonte usada em modulosDisponiveis(), sem lista fixa por sistema).
function _erpDoModulo(empresaId, modulo) {
  const alvo = String(modulo || '').trim().toLowerCase();
  if (!alvo) return 'protheus';
  const intencoes = crud.listar('intentions', { empresa_id: empresaId, ativo: 1 });
  const achada = intencoes.find(i =>
    String(i.acao || '').toLowerCase() === 'ai_text_to_sql' &&
    String(i.modulo || '').trim().toLowerCase() === alvo
  );
  return String(achada?.erp || 'protheus').trim().toLowerCase() || 'protheus';
}

const SQL_FIXO_GENERICO_LIMITE_LINHAS = 30;

// Formata o resultado do SQL fixo generico como listagem linha a linha, sem somar colunas
// (diferente de formatarAiSqlLocal, feito para agregacoes da IA sem GROUP BY explicito).
// SQL fixo e escrito pelo proprio admin com colunas ja nomeadas para leitura — cada linha do
// resultado e um registro distinto (ex: um chamado), nao uma metrica a ser consolidada.
function _formatarSqlFixoGenerico(rows, titulo) {
  try {
    return semanticDatasetRunner.formatarRespostaSemantica(rows, titulo);
  } catch (_) {}

  const cabecalho = titulo ? `*${titulo}*\n\n` : '';
  if (!rows || !rows.length) return `${cabecalho}Nenhum dado encontrado para sua consulta.`;
  const colunas = Object.keys(rows[0] || {});
  const limitadas = rows.slice(0, SQL_FIXO_GENERICO_LIMITE_LINHAS);
  const itens = limitadas.map((row, i) => {
    const campos = colunas
      .map(col => `${col.replace(/_/g, ' ')}: ${row[col] ?? '-'}`)
      .join(' | ');
    return `${i + 1}. ${campos}`;
  });
  const rodape = rows.length > SQL_FIXO_GENERICO_LIMITE_LINHAS
    ? `\n\n_Mostrando ${SQL_FIXO_GENERICO_LIMITE_LINHAS} de ${rows.length} registro(s). Refine o SQL para reduzir o resultado._`
    : `\n\n_${rows.length} registro(s)._`;
  return `${cabecalho}*Resultado*\n\n${itens.join('\n')}${rodape}`;
}

// Caminho generico de SQL fixo para sistemas sem handler dedicado (ex: SoftExpert): executa
// o SQL direto na conexao/agente-local do sistema (mesmo mecanismo dos datasets semanticos)
// e formata a resposta como listagem, sem as regras especificas dos handlers Protheus (que
// dependem de spec proprio de dominio) nem a logica de soma da IA (formatarAiSqlLocal).
async function _executarSqlFixoGenerico(empresaId, job, erp, sql, sqlOriginal, destinatarios = null) {
  const intent = montarIntentSqlFixo(job);
  const t0 = Date.now();
  let resultado;
  try {
    const conn = connectionFactory.carregarConexao(Number(empresaId), { sistemaOrigem: erp });
    conn._pergunta = job.pergunta || job.nome || 'Consulta agendada';
    conn._modulo = job.modulo || 'agendamento';
    conn._operacao = intent.intencao;
    conn._empresa_id = String(empresaId || '');
    const rows = await connectionFactory.executar(conn, sql, {});
    const titulo = job.pergunta || job.nome || null;
    resultado = {
      tipo: 'sucesso_ai_sql',
      resposta_direta: _formatarSqlFixoGenerico(rows, titulo),
      rows: rows || [],
      sql_gerado: sql,
      duracao_ms: Date.now() - t0,
    };
  } catch (e) {
    resultado = {
      tipo: 'erro',
      subtipo: /conex|timeout|agente/i.test(e.message || '') ? 'sem_conexao' : 'erro_erp',
      resposta_direta: `Nao consegui executar o SQL fixo: ${e.message}`,
      sql_gerado: `${sql}\n\n-- ERRO: ${e.message}`,
      duracao_ms: Date.now() - t0,
    };
  }

  const resposta = resultado.resposta_direta;
  const status = statusExecucaoSql(resultado, resposta);
  const log = interpretationLog.registrar({
    empresa_id: Number(empresaId),
    usuario: 'agendamento',
    numero_wa: numeroWaSqlFixo(job, destinatarios),
    texto_original: job.pergunta || job.nome || 'Consulta agendada',
    intent,
    resultado,
    resposta_entregue: resposta,
    origem: 'agendamento_sql_fixo',
    canal_origem: 'agendamento',
    duracao_ms: resultado.duracao_ms,
    sql_gerado: sql,
    sql_canonico_original: sqlOriginal,
    sql_final_executado: sql,
    pipeline_origem: 'agendamento_sql_fixo',
  });

  return {
    resposta,
    ok: status.ok,
    error_detail: status.error_detail,
    interpretation_log_id: log.id,
    duration_ms: resultado.duracao_ms,
    rows: resultado.rows || [],
    intent,
  };
}

async function executarSqlFixoUmaVez(empresaId, job, destinatarios = null) {
  const sqlOriginal = sqlFixo(job);
  const avaliacaoMacros = avaliarMacrosSql(sqlOriginal, { ...job, empresa_id: empresaId }, new Date(), destinatarios);
  validarMacrosResolvidasSql(avaliacaoMacros.sqlResolvido);
  const sql = garantirSetRowcountSqlFixo(avaliacaoMacros.sqlResolvido);
  validarSqlFixoBasico(sql);

  const modulo = String(job.modulo || '').toLowerCase();
  const handler = SQL_HANDLERS[modulo];
  if (!handler) {
    const erp = _erpDoModulo(empresaId, modulo);
    if (erp === 'protheus') {
      throw Object.assign(new Error('Informe um modulo valido para executar SQL fixo.'), { statusCode: 400 });
    }
    return _executarSqlFixoGenerico(empresaId, job, erp, sql, sqlOriginal, destinatarios);
  }

  const intent = montarIntentSqlFixo(job);
  const t0 = Date.now();
  const resultado = await handler.executarSqlDireto(sql, intent, Number(empresaId));
  const resposta = responseFormatter.formatar(resultado, intent, { empresaId: Number(empresaId), messageTemplates });
  const status = statusExecucaoSql(resultado, resposta);
  const log = interpretationLog.registrar({
    empresa_id: Number(empresaId),
    usuario: 'agendamento',
    numero_wa: numeroWaSqlFixo(job, destinatarios),
    texto_original: job.pergunta || job.nome || 'Consulta agendada',
    intent,
    resultado,
    resposta_entregue: resposta,
    origem: 'agendamento_sql_fixo',
    canal_origem: 'agendamento',
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
    rows: resultado?.rows || [],
    intent,
  };
}

// Nota: anexo automatico de agendamento (rows/intent) so esta disponivel hoje para o
// caminho de SQL fixo (executarSqlFixoUmaVez) — executeScheduledQuestionOnce passa pelo
// _pipeline do WhatsApp, que retorna so a string final ja formatada, sem expor rows/intent
// para fora. Estender isso exigiria mudar o contrato de retorno de _pipeline, fora do
// escopo desta entrega (ver plano: mudanca de contrato minima).
async function executarPerguntaUmaVez(svc, empresaId, job, destinatarios) {
  if (sqlFixo(job)) return executarSqlFixoUmaVez(empresaId, job, destinatarios);
  return svc.executeScheduledQuestionOnce({
    empresaId,
    numero: destinatarios[0]?.numero,
    pergunta: job.pergunta,
    modulo: job.modulo || null,
  });
}

// Chama o worker Windows Service via HTTP.
function _postWorker(workerPort, path, payload, timeoutMs = 330000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req  = http.request({
      hostname: '127.0.0.1', port: workerPort, path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs,
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

function _executarViaWorker(workerPort, empresaId, numero, pergunta, jobNome, modulo) {
  return _postWorker(workerPort, '/scheduled-question', { empresaId, numero, pergunta, jobNome, modulo });
}

function _enviarViaWorker(workerPort, empresaId, numero, resposta, ok, jobNome) {
  return _postWorker(workerPort, '/send-message', { empresaId, numero, resposta, ok, jobNome }, 30000);
}

async function executarJob(empresaId, job, { trigger_tipo = 'manual', usuario = 'sistema' } = {}) {
  const isRetry = trigger_tipo === 'schedule_retry';
  const destinatarios = isRetry
    ? store.listarDestinatariosPendentes(empresaId, job.id, job.retry_recipient_ids)
    : store.listarDestinatarios(empresaId, job.id);
  if (!destinatarios.length) {
    throw Object.assign(new Error('Job sem destinatarios ativos.'), { statusCode: 400 });
  }

  // Detecta se o canal roda como Windows Service — delega ao worker via HTTP
  const canal = channels.buscarCanal(job.channel_id);
  if (canal?.is_windows_service && canal?.worker_port) {
    const run = store.criarRun(empresaId, job, { trigger_tipo, usuario });
    const started = Date.now();
    const resumo = [];
    let sucessos = 0;
    let falhas = 0;
    const recipientIdsFalhos = [];
    const entregas = destinatarios.map(dest => ({
      dest,
      deliveryId: store.criarDelivery(empresaId, run.id, job.id, dest),
    }));
    try {
      let resultado;
      if (sqlFixo(job)) {
        // SQL fixo: executa localmente e envia para cada destinatário via worker
        resultado = await executarSqlFixoUmaVez(empresaId, job, destinatarios);
        for (const { dest, deliveryId } of entregas) {
          try {
            await _enviarViaWorker(canal.worker_port, empresaId, dest.numero, resultado.resposta, resultado.ok, job.nome);
            if (resultado.ok === false) falhas++;
            else sucessos++;
            resumo.push(`${dest.nome || dest.numero}: ${resultado.ok === false ? (resultado.error_detail || 'executado com erro na consulta') : 'enviado'}`);
            store.atualizarDelivery(deliveryId, { status: 'sucesso', sent_at: new Date().toISOString(), erro: null });
          } catch (err) {
            falhas++;
            recipientIdsFalhos.push(dest.id);
            resumo.push(`${dest.nome || dest.numero}: ${err.message}`);
            store.atualizarDelivery(deliveryId, { status: 'erro', erro: err.message });
          }
        }
      } else {
        // Pergunta IA: worker executa e envia em uma chamada (apenas primeiro destinatário)
        resultado = await _executarViaWorker(canal.worker_port, empresaId, destinatarios[0]?.numero, job.pergunta, job.nome, job.modulo || null);
        const { dest, deliveryId } = entregas[0];
        if (resultado.ok === false) falhas++;
        else sucessos++;
        resumo.push(`${dest.nome || dest.numero}: ${resultado.ok === false ? (resultado.error_detail || 'executado com erro na consulta') : 'enviado'}`);
        store.atualizarDelivery(deliveryId, { status: 'sucesso', sent_at: new Date().toISOString(), erro: null });
      }
      const statusDelivery = sucessos && !falhas ? 'sucesso' : sucessos ? 'parcial' : 'erro';
      if (resultado.interpretation_log_id) {
        try { interpretationLog.atualizarEntregue(resultado.interpretation_log_id, Date.now() - started); } catch (_) {}
      }
      store.atualizarRun(empresaId, run.id, {
        status: statusDelivery,
        resposta: resultado.resposta,
        erro: falhas ? resumo.filter(x => !x.endsWith(': enviado')).join('\n') : null,
        interpretation_log_id: resultado.interpretation_log_id,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      });
      if (falhas) {
        throw Object.assign(new Error(`Falha ao enviar para ${falhas} destinatario(s).`), {
          statusCode: 502,
          recipientIdsFalhos,
        });
      }
      return resultado;
    } catch (err) {
      if (!('recipientIdsFalhos' in err)) {
        for (const { dest, deliveryId } of entregas) {
          falhas++;
          recipientIdsFalhos.push(dest.id);
          resumo.push(`${dest.nome || dest.numero}: ${err.message}`);
          store.atualizarDelivery(deliveryId, { status: 'erro', erro: err.message });
        }
        store.atualizarRun(empresaId, run.id, {
          status: 'erro',
          erro: err.message,
          resposta: resumo.join('\n') || null,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - started,
        });
      }
      err.recipientIdsFalhos = err.recipientIdsFalhos || recipientIdsFalhos;
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
    const recipientIdsFalhos = [];
    for (const entrega of entregas) {
      falhas++;
      recipientIdsFalhos.push(entrega.dest.id);
      resumo.push(`${entrega.dest.nome || entrega.dest.numero}: ${err.message}`);
      store.atualizarDelivery(entrega.deliveryId, { status: 'erro', erro: err.message });
    }
    store.atualizarRun(empresaId, run.id, {
      status: 'erro',
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      interpretation_log_id: null,
      resposta: resumo.join('\n'),
      erro: resumo.join('\n'),
    });
    throw Object.assign(err, { recipientIdsFalhos });
  }

  const recipientIdsFalhos = [];
  for (const { dest, deliveryId } of entregas) {
    try {
      await svc.sendScheduledQuestionDelivery({
        empresaId,
        numero: dest.numero,
        resposta: resultadoUnico.resposta,
        ok: resultadoUnico.ok,
        rows: resultadoUnico.rows || null,
        intent: resultadoUnico.intent || null,
      });
      if (resultadoUnico.ok === false) falhas++;
      else sucessos++;
      resumo.push(`${dest.nome || dest.numero}: ${resultadoUnico.ok === false ? (resultadoUnico.error_detail || 'executado com erro na consulta') : 'enviado'}`);
      store.atualizarDelivery(deliveryId, { status: 'sucesso', sent_at: new Date().toISOString(), erro: null });
    } catch (err) {
      falhas++;
      recipientIdsFalhos.push(dest.id);
      resumo.push(`${dest.nome || dest.numero}: ${err.message}`);
      store.atualizarDelivery(deliveryId, { status: 'erro', erro: err.message });
    }
  }

  const status = sucessos && !falhas ? 'sucesso' : sucessos ? 'parcial' : 'erro';
  if (primeiroLogId) {
    try { interpretationLog.atualizarEntregue(primeiroLogId, Date.now() - started); } catch (_) {}
  }
  const run_atualizado = store.atualizarRun(empresaId, run.id, {
    status,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    interpretation_log_id: primeiroLogId,
    resposta: primeiraResposta || resumo.join('\n'),
    erro: falhas ? resumo.filter(x => !x.endsWith(': enviado')).join('\n') : null,
  });
  if (falhas) {
    throw Object.assign(new Error(`Falha ao enviar para ${falhas} destinatario(s).`), {
      statusCode: 502,
      recipientIdsFalhos,
    });
  }
  return run_atualizado;
}

module.exports = {
  executarJob,
  executarSqlFixoUmaVez,
  avaliarMacrosSql,
  _test: {
    aplicarMacrosSql,
    macrosPendentesSql,
    validarMacrosResolvidasSql,
    avaliarMacrosSql,
    consultaSemSetRowcount,
    garantirSetRowcountSqlFixo,
    validarSqlFixoBasico,
    macrosDataSql,
    resolverMacroDataSql,
    executarSqlFixoUmaVez,
    _erpDoModulo,
  },
};
