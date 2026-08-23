// Orquestracao de mensagens do canal Protheus WhatsApp.
//
// Reaproveita o mesmo pipeline de IA usado pelo canal WhatsApp real — sem
// duplicar logica de intencao, roteamento ou seguranca. A unica diferenca de
// contrato e que aqui o "contexto anterior" vem da sessao persistida em SQLite
// (session-store.js), nao de estado em memoria, porque este canal e stateless
// por requisicao HTTP.
//
// intent._remetente recebe o celular do usuario Protheus — o MESMO campo que o
// canal WhatsApp usa hoje, entao vendedor-seguranca.js / cliente-seguranca.js e
// a tabela whatsapp_allowed_numbers continuam sendo a unica fonte de permissao,
// sem nenhuma alteracao.

const intentService = require('../ai/intent-service');
const intentMerger = require('../ai/intent-merger');
const intentRouter = require('../erp/core/intent-router');
const responseFormatter = require('../erp/core/response-formatter');
const sessionStore = require('./session-store');
const interpretationPipeline = require('../ai/interpretation-pipeline');
const interpretationLog = require('../ai/interpretation-log');
const { getDB } = require('../database');
const IACWhatsAppService = require('../whatsapp/service');
const periodResolver = require('../ai/period-resolver');
const canonicalIntent = require('../erp/nlsql-cache/canonical-intent');
const sqlTemplate = require('../erp/nlsql-cache/sql-template');

// Nome de campo cru do Protheus: prefixo de tabela (letra + ate 2 letras/digitos,
// ex: E2, A1, SB1) + underscore + resto (ex: E2_PREFIXO, A1_NOME, SB1_DESC).
// Prefixos de tabela Protheus tipicamente misturam letra e digito (E2, D2, C5),
// por isso [A-Z][A-Z0-9]{0,2} e nao so letras — regra testada contra os campos
// reais que motivaram esta funcao (E2_PREFIXO, E2_NUM). Sempre maiusculo, o que
// já distingue de alias amigavel gerado pela IA (minusculo, ex: numero_titulo).
const REGEX_CAMPO_CRU_PROTHEUS = /^[A-Z][A-Z0-9]{0,2}_[A-Z0-9]+$/;
const SX3_LABEL_CACHE_TTL_MS = 5 * 60 * 1000;
const SX3_LABEL_CACHE_MAX = 200;
const sx3LabelCache = new Map();

function sx3CacheGet(key) {
  const item = sx3LabelCache.get(key);
  if (!item) return null;
  if (item.expiraEm <= Date.now()) {
    sx3LabelCache.delete(key);
    return null;
  }
  return item.valor;
}

function sx3CacheSet(key, valor) {
  sx3LabelCache.set(key, { valor, expiraEm: Date.now() + SX3_LABEL_CACHE_TTL_MS });
  if (sx3LabelCache.size > SX3_LABEL_CACHE_MAX) {
    const firstKey = sx3LabelCache.keys().next().value;
    if (firstKey) sx3LabelCache.delete(firstKey);
  }
  return valor;
}

function aplicarRenomeioRows(rows, renomeio) {
  if (!renomeio || !Object.keys(renomeio).length) return rows;
  return rows.map((row) => {
    const nova = {};
    for (const [chave, valor] of Object.entries(row)) {
      const alvo = renomeio[String(chave || '').toUpperCase()] || chave;
      nova[alvo] = valor;
    }
    return nova;
  });
}

// Mesmo padrao de deteccao de "RESET"/"limpar contexto" usado pelo canal
// WhatsApp real (ver _textoResetExplicito em modules/whatsapp/service.js) —
// copiado (nao importado) porque e uma funcao pequena e autocontida, e o
// arquivo do WhatsApp e critico o bastante para nao ganhar um export novo so
// para isso. Frase precisa ser curta e ISOLADA (^...$) para nao disparar em
// perguntas de negocio que mencionem essas palavras de outro jeito.
function textoResetExplicito(texto) {
  const t = String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  return /^(reset|\/reset|resetar|reiniciar|reinicia|recomecar|\/recomecar|limpar|limpar conversa|limpar tudo|limpar contexto|limpar cache|esquecer tudo|esqueca tudo|esquece tudo|nova conversa|novo inicio|comecar|comecar de novo|comecar novamente)$/.test(t);
}

function normalizarTextoCurto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function agrupamentosDoContexto(contextoAnterior) {
  const bruto = contextoAnterior?.agrupar_por;
  const lista = Array.isArray(bruto)
    ? bruto
    : String(bruto || '').split(/[,\|;]/);
  return lista
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(item => item.replace(/_/g, ' ').toLowerCase());
}

function periodoDoContexto(contextoAnterior) {
  const p = contextoAnterior?.periodo || {};
  const dataInicio = String(p.dataInicio || p.data_inicio || '').trim();
  const dataFim = String(p.dataFim || p.data_fim || '').trim();
  if (!/^\d{8}$/.test(dataInicio) || !/^\d{8}$/.test(dataFim)) return null;
  return { dataInicio, dataFim };
}

function dataUtc(yyyymmdd) {
  const s = String(yyyymmdd || '');
  return new Date(Date.UTC(
    parseInt(s.slice(0, 4), 10),
    parseInt(s.slice(4, 6), 10) - 1,
    parseInt(s.slice(6, 8), 10)
  ));
}

function yyyymmdd(date) {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('');
}

function ultimoDiaMes(ano, mes1a12) {
  return new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();
}

function subtrairAnoMantendoDia(data) {
  const d = dataUtc(data);
  const ano = d.getUTCFullYear() - 1;
  const mes = d.getUTCMonth() + 1;
  const dia = Math.min(d.getUTCDate(), ultimoDiaMes(ano, mes));
  return `${String(ano).padStart(4, '0')}${String(mes).padStart(2, '0')}${String(dia).padStart(2, '0')}`;
}

function periodoComparacaoDoContexto(contextoAnterior, tipoComparacao) {
  const periodo = periodoDoContexto(contextoAnterior);
  if (!periodo) return null;

  if (tipoComparacao === 'ano_passado') {
    return {
      tipo: 'personalizado',
      data_inicio: subtrairAnoMantendoDia(periodo.dataInicio),
      data_fim: subtrairAnoMantendoDia(periodo.dataFim),
    };
  }

  const inicio = dataUtc(periodo.dataInicio);
  const fim = dataUtc(periodo.dataFim);
  const dias = Math.max(1, Math.round((fim - inicio) / 86400000) + 1);
  const fimAnterior = new Date(inicio);
  fimAnterior.setUTCDate(fimAnterior.getUTCDate() - 1);
  const inicioAnterior = new Date(fimAnterior);
  inicioAnterior.setUTCDate(inicioAnterior.getUTCDate() - (dias - 1));
  return {
    tipo: 'personalizado',
    data_inicio: yyyymmdd(inicioAnterior),
    data_fim: yyyymmdd(fimAnterior),
  };
}

function montarComparacaoPorAceite(texto, contextoAnterior) {
  const t = normalizarTextoCurto(texto);
  if (!t || t.length > 80) return null;
  const aceita = /^(sim|sim quero|quero|quero sim|pode|pode sim|ok|isso|isso mesmo|vamos|vamos sim|compare|comparar)$/.test(t);
  const pedeAnoPassado = /\b(ano passado|mesmo periodo|ano anterior)\b/.test(t);
  const pedePeriodoAnterior = /\b(periodo anterior|mes anterior|anterior)\b/.test(t);
  if (!aceita && !pedeAnoPassado && !pedePeriodoAnterior) return null;

  if (!periodoDoContexto(contextoAnterior)) return null;
  const perguntaAnterior = String(contextoAnterior?._mensagemOriginal || contextoAnterior?._perguntaOriginal || '').trim();
  if (!perguntaAnterior || perguntaAnterior.length < 8) return null;
  const agrupamentos = agrupamentosDoContexto(contextoAnterior);
  const manterAgrupamentos = agrupamentos.length
    ? ` mantendo os mesmos agrupamentos (${agrupamentos.join(', ')})`
    : ' mantendo os mesmos agrupamentos e campos da pergunta anterior';

  if (pedeAnoPassado) {
    return {
      texto: `Compare com o mesmo periodo do ano passado${manterAgrupamentos}: ${perguntaAnterior}`,
      tipoComparacao: 'ano_passado',
      periodo: periodoComparacaoDoContexto(contextoAnterior, 'ano_passado'),
    };
  }
  return {
    texto: `Compare com o periodo anterior${manterAgrupamentos}: ${perguntaAnterior}`,
    tipoComparacao: 'periodo_anterior',
    periodo: periodoComparacaoDoContexto(contextoAnterior, 'periodo_anterior'),
  };
}

// Mesma logica usada pelo canal WhatsApp real para rotular campos sem alias
// (ver labelsSx3ParaFormatacao em modules/erp/ia-owner/runner.js), mas aplicada
// diretamente as chaves de `rows` — la, o mapa so rotula texto ja formatado,
// sem renomear as rows entregues a este canal (que alimentam a grid).
function traduzirNomesCruesViaSx3(rows, empresaId) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  const primeira = rows[0];
  const camposCrus = Object.keys(primeira).filter((k) => REGEX_CAMPO_CRU_PROTHEUS.test(k));
  if (!camposCrus.length) return rows;
  const camposOrdenados = camposCrus.slice().sort();
  const cacheKey = `${empresaId}::${camposOrdenados.join(',')}`;
  const renomeioCache = sx3CacheGet(cacheKey);
  if (renomeioCache) {
    return aplicarRenomeioRows(rows, renomeioCache);
  }

  const renomeio = {};

  let conexoes;
  try {
    conexoes = getDB().prepare(
      `SELECT DISTINCT c.id, COALESCE(c.ativo, 0) AS ativo, COALESCE(c.padrao, 0) AS padrao, c.criado_em
         FROM protheus_sx3 sx3
         JOIN connections c ON c.id = sx3.connection_id
        WHERE sx3.empresa_id = ?
        ORDER BY ativo DESC, padrao DESC, c.criado_em DESC`
    ).all(empresaId);
  } catch (_) {
    sx3CacheSet(cacheKey, renomeio);
    return aplicarRenomeioRows(rows, renomeio);
  }
  if (!Array.isArray(conexoes) || !conexoes.length) {
    sx3CacheSet(cacheKey, renomeio);
    return aplicarRenomeioRows(rows, renomeio);
  }

  const placeholders = camposOrdenados.map(() => '?').join(',');
  let titulos;
  try {
    const placeholdersConexoes = conexoes.map(() => '?').join(',');
    titulos = getDB().prepare(`
      SELECT sx3.campo, sx3.titulo
      FROM protheus_sx3 sx3
      JOIN connections c ON c.id = sx3.connection_id
      WHERE sx3.empresa_id = ?
        AND sx3.connection_id IN (${placeholdersConexoes})
        AND UPPER(sx3.campo) IN (${placeholders})
      ORDER BY COALESCE(c.ativo, 0) DESC, COALESCE(c.padrao, 0) DESC, c.criado_em DESC, sx3.connection_id DESC
    `).all(empresaId, ...conexoes.map(c => c.id), ...camposOrdenados);
  } catch (_) {
    sx3CacheSet(cacheKey, renomeio);
    return aplicarRenomeioRows(rows, renomeio);
  }
  for (const { campo, titulo } of titulos || []) {
    const campoKey = String(campo || '').trim().toUpperCase();
    const tituloLimpo = String(titulo || '').trim();
    if (campoKey && tituloLimpo && tituloLimpo.toUpperCase() !== campoKey) {
      renomeio[campoKey] = tituloLimpo;
    }
  }
  sx3CacheSet(cacheKey, renomeio);
  const faltantes = camposOrdenados.filter(campo => !renomeio[campo]);
  if (faltantes.length) {
    console.warn(`[protheus_whatsapp] SX3 sem titulo para campos: empresa=${empresaId} campos=${faltantes.join(',')}`);
  }
  return aplicarRenomeioRows(rows, renomeio);
}

function registrarInterpretacao(payload) {
  try {
    const logId = interpretationPipeline.registrarInterpretacao(payload);
    if (logId) {
      console.log(`[protheus_whatsapp] Interpretacao registrada: id=${logId} empresa=${payload.empresaId} usuario=${payload.sender || ''}`);
      return logId;
    }

    // O pipeline compartilhado pode absorver falhas internas para nao derrubar
    // o WhatsApp. No chat Protheus, o historico e parte da auditoria principal,
    // entao tentamos a gravacao direta antes de devolver a resposta ao usuario.
    const trace = interpretationPipeline.traceInterpretacao({ intent: payload.intent, resultado: payload.resultado });
    const row = interpretationLog.registrar({
      empresa_id: payload.empresaId,
      usuario: payload.sender,
      numero_wa: interpretationPipeline.normalizarNumeroWa(payload.sender),
      canal_id: payload.canalId ?? null,
      texto_original: payload.texto,
      intent: payload.intent,
      resultado: payload.resultado,
      resposta_entregue: payload.resposta,
      sql_gerado: payload.resultado?.sql_gerado || null,
      duracao_ms: payload.duracaoMs ?? null,
      trace,
    });
    console.log(`[protheus_whatsapp] Interpretacao registrada por fallback direto: id=${row?.id || 'n/a'} empresa=${payload.empresaId} usuario=${payload.sender || ''}`);
    return row?.id || null;
  } catch (e) {
    console.error('[protheus_whatsapp] Falha ao registrar interpretacao:', e.message);
    return null;
  }
}

function normalizarEmpresasSelecionadas(empresasSelecionadas) {
  if (!Array.isArray(empresasSelecionadas)) return [];
  const vistas = new Set();
  return empresasSelecionadas
    .map((emp) => {
      const empresa_id = Number(emp?.empresa_id || emp?.empresaId || emp?.id || 0);
      if (!empresa_id || vistas.has(empresa_id)) return null;
      vistas.add(empresa_id);
      return {
        ...emp,
        empresa_id,
        empresaId: empresa_id,
        nome: String(emp?.nome || emp?.codigoProtheus || emp?.codigo_protheus || `Empresa ${empresa_id}`).trim(),
      };
    })
    .filter(Boolean);
}

function gridConfigDoFavorito(favorito) {
  try {
    return favorito?.grid_config_json ? JSON.parse(favorito.grid_config_json) : null;
  } catch (_) {
    return null;
  }
}

function intentDoFavorito(favorito, empresaId, celular, modulo) {
  let intent = {};
  try {
    intent = favorito?.intent_json ? JSON.parse(favorito.intent_json) : {};
  } catch (_) {
    intent = {};
  }

  const pergunta = String(favorito?.pergunta_texto || favorito?.titulo || '').trim();
  const detectado = periodResolver.identificarPeriodoTexto(pergunta);
  const resolvido = periodResolver.resolverPeriodo(detectado);
  const periodo = resolvido?.dataInicio && resolvido?.dataFim
    ? {
        ...detectado,
        dataInicio: resolvido.dataInicio,
        dataFim: resolvido.dataFim,
        data_inicio: resolvido.dataInicio,
        data_fim: resolvido.dataFim,
        start: resolvido.dataInicio,
        end: resolvido.dataFim,
      }
    : (intent._periodoCanonicoResolvido || intent.periodo || {});

  return {
    ...intent,
    intencao: intent.intencao || `${modulo}_dinamico`,
    periodo,
    _periodoCanonicoResolvido: periodo,
    _moduloDinamico: modulo,
    _remetente: celular,
    _mensagemOriginal: pergunta,
    _empresaIdFixa: Number(empresaId || 0) || null,
    _skipIaSqlGeneration: true,
  };
}

function sqlExecucaoDoFavorito(favorito, empresaId, celular, modulo) {
  const sqlFixo = String(favorito?.sql_final_executado || '').trim();
  const template = String(favorito?.sql_template || '').trim();
  if (/\{\{\s*(?!iac:)[A-Z0-9_]+(?::\s*[+-]?\d+)?\s*\}\}/i.test(sqlFixo)) {
    return { sql: sqlFixo, origem: 'sql_fixo_macro_agendamento', intent: null, aplicados: [] };
  }
  if (!template) return { sql: sqlFixo, origem: 'sql_fixo', intent: null, aplicados: [] };

  const intent = intentDoFavorito(favorito, empresaId, celular, modulo);
  const canonico = canonicalIntent.gerarIntentCanonico({
    spec: { nome: modulo },
    intent,
    empresaId,
    mensagem: favorito?.pergunta_texto || favorito?.titulo || '',
  }).canonical;
  const aplicado = sqlTemplate.aplicarSqlTemplate(template, canonico);
  if (!aplicado.ok) {
    return { sql: sqlFixo, origem: 'sql_fixo_template_pendente', intent, aplicados: aplicado.aplicados || [] };
  }
  return { sql: aplicado.sql, origem: 'sql_template', intent, aplicados: aplicado.aplicados || [] };
}

async function executarFavorito({ empresaId, celular, sessaoId, favorito }) {
  const modulo = String(favorito?.modulo || '').trim().toLowerCase();
  const sqlExec = sqlExecucaoDoFavorito(favorito, empresaId, celular, modulo);
  const sql = String(sqlExec.sql || '').trim();
  if (!modulo || !sql) {
    throw Object.assign(new Error('Favorito sem modulo ou SQL auditado.'), { statusCode: 400 });
  }

  const job = {
    empresa_id: empresaId,
    nome: favorito.titulo,
    pergunta: favorito.pergunta_texto,
    modulo,
    sql_fixo: sql,
    sql_template: favorito.sql_template || null,
    sql_template_parametros: sqlExec.aplicados || [],
    timezone: process.env.TZ || 'America/Manaus',
  };
  const scheduledQuestionRunner = require('../scheduler/scheduled-question-runner');
  const resultadoExec = await scheduledQuestionRunner.executarSqlFixoUmaVez(empresaId, job, [
    { nome: celular, numero: celular },
  ]);
  const respostaTexto = resultadoExec.resposta || 'Consulta favorita executada.';
  const rows = Array.isArray(resultadoExec.rows)
    ? traduzirNomesCruesViaSx3(resultadoExec.rows, empresaId)
    : null;
  const { perguntaId, respostaId } = sessionStore.salvarTurno({
    sessaoId,
    perguntaTexto: favorito.pergunta_texto,
    respostaTexto,
    rows,
    tipoResultado: resultadoExec.ok === false ? 'erro' : 'favorito_sql_fixo',
    intent: {
      intencao: `${modulo}_dinamico`,
      origem: sqlExec.origem === 'sql_template' ? 'protheus_chat_favorito_template' : 'protheus_chat_favorito',
      _moduloDinamico: modulo,
      _remetente: celular,
      _mensagemOriginal: favorito.pergunta_texto,
      _sqlTemplateAplicado: sqlExec.origem === 'sql_template',
      _sqlTemplateParametros: sqlExec.aplicados || [],
      _skipIaSqlGeneration: true,
    },
  });
  if (resultadoExec.interpretation_log_id) {
    sessionStore.vincularInterpretacao({
      mensagemId: respostaId,
      sessaoId,
      interpretationLogId: resultadoExec.interpretation_log_id,
    });
  }
  const gridConfig = gridConfigDoFavorito(favorito);
  if (gridConfig) {
    sessionStore.salvarGridConfig({ mensagemId: respostaId, sessaoId, gridConfig });
  }
  if (favorito.id) {
    sessionStore.marcarFavoritoUsado({ favoritoId: favorito.id, empresaId, celular });
  }
  return {
    mensagemId: respostaId,
    perguntaId,
    texto: respostaTexto,
    rows,
    temDados: Array.isArray(rows) && rows.length > 0,
    rowsCount: Array.isArray(rows) ? rows.length : 0,
    tipo: resultadoExec.ok === false ? 'erro' : 'favorito_sql_fixo',
    favoritoId: favorito.id || null,
    gridConfig,
  };
}

async function processarMensagem({ empresaId, celular, sessaoId, texto, empresasSelecionadas = null }) {
  // Comando "RESET"/"limpar contexto" — mesma deteccao do canal WhatsApp
  // real (textoResetExplicito acima), mas SEM apagar mensagens do historico
  // visual: diferente do WhatsApp (onde nao ha tela de conversa persistida),
  // aqui o usuario ve o historico completo na sidebar/chat, entao apagar
  // seria destrutivo e nao foi pedido — so o CONTEXTO (ultimoIntent) precisa
  // esquecer o que veio antes, exatamente o que o botao de reset no
  // cabecalho ja faz (sessionStore.resetarMemoria, ver routes.js). Retorna
  // direto, sem passar pelo pipeline de IA nem gravar interpretation_log —
  // nao e uma pergunta de negocio.
  if (textoResetExplicito(texto)) {
    sessionStore.resetarMemoria({ sessaoId });
    const respostaTextoReset = '🔄 *Contexto reiniciado!*\n\nEsqueci o que conversamos antes. Pode fazer uma nova pergunta.';
    const { perguntaId, respostaId } = sessionStore.salvarTurno({
      sessaoId,
      perguntaTexto: texto,
      respostaTexto: respostaTextoReset,
      rows: null,
      tipoResultado: null,
      intent: null,
    });
    return {
      mensagemId: respostaId,
      perguntaId,
      texto: respostaTextoReset,
      rows: null,
      temDados: false,
      rowsCount: 0,
      tipo: null,
    };
  }

  const empresasMulti = normalizarEmpresasSelecionadas(empresasSelecionadas);
  if (empresasMulti.length > 1) {
    const whatsService = new IACWhatsAppService();
    const respostaTexto = await whatsService._pipelineAll(texto, empresasMulti, celular, {
      _recebidoEm: new Date().toISOString(),
    });
    const { perguntaId, respostaId } = sessionStore.salvarTurno({
      sessaoId,
      perguntaTexto: texto,
      respostaTexto,
      rows: null,
      tipoResultado: 'multiempresa',
      intent: {
        tipo: 'multiempresa',
        escopo: 'multiempresa',
        empresas: empresasMulti.map(emp => emp.empresa_id),
        _remetente: celular,
        _mensagemOriginal: texto,
      },
    });
    return {
      mensagemId: respostaId,
      perguntaId,
      texto: respostaTexto,
      rows: null,
      temDados: false,
      rowsCount: 0,
      tipo: 'multiempresa',
    };
  }

  const t0 = Date.now();
  const contextoAnterior = sessionStore.ultimoIntent({ sessaoId });
  const comparacaoAceite = montarComparacaoPorAceite(texto, contextoAnterior);
  const textoParaIA = comparacaoAceite?.texto || texto;
  if (textoParaIA !== texto) {
    console.log(`[protheus_whatsapp] Aceite de comparacao reescrito: "${String(texto).trim()}" -> "${textoParaIA.slice(0, 180)}"`);
  }

  let intent = await intentService.classificar(textoParaIA, empresaId, {
    contextoAnterior,
    historicoResumido: null,
    tenantAliases: [],
  });

  intent._remetente = celular;
  intent._mensagemOriginal = texto;
  if (textoParaIA !== texto) intent._mensagemReescrita = textoParaIA;

  if (contextoAnterior) {
    intent = intentMerger.mesclar(intent, contextoAnterior, 0, textoParaIA, {});
  }
  if (comparacaoAceite?.periodo) {
    intent.periodo = comparacaoAceite.periodo;
    intent._periodoComparacaoAceite = comparacaoAceite.tipoComparacao;
    intent._periodoCanonicoResolvido = {
      dataInicio: comparacaoAceite.periodo.data_inicio,
      dataFim: comparacaoAceite.periodo.data_fim,
    };
  }

  const resultado = await intentRouter.rotear(intent, empresaId);
  const rowsBrutas = Array.isArray(resultado?.rows) ? resultado.rows : null;
  const rows = rowsBrutas ? traduzirNomesCruesViaSx3(rowsBrutas, empresaId) : null;
  const resultadoFormatacao = rows ? { ...resultado, rows } : resultado;
  const respostaBase = responseFormatter.formatar(resultadoFormatacao, intent, { empresaId });
  const apresentacao = responseFormatter.montarApresentacaoResposta(respostaBase, resultadoFormatacao, intent, {
    empresaId,
    sugerirComparacao: true,
  });
  const respostaTexto = responseFormatter.textoApresentacao(apresentacao, respostaBase);

  const { perguntaId, respostaId } = sessionStore.salvarTurno({
    sessaoId,
    perguntaTexto: texto,
    respostaTexto,
    rows,
    tipoResultado: resultado?.tipo || null,
    intent,
  });

  // [UNIFICADO 13/08/2026] Mesmo pipeline de registro usado pelo canal
  // WhatsApp real (modules/ai/interpretation-pipeline.js, extraido de
  // modules/whatsapp/service.js#_registrarInterpretacao) — antes este canal
  // chamava interpretation-log.js direto com so 7 campos (sem timing, trace,
  // canal_id) e NUNCA gravava em execution_log, ficando invisivel para o
  // cache/aprendizado de SQL canonico que o WhatsApp usa. canalId fica null
  // (este canal nao tem conceito de canal multi-empresa como o WhatsApp).
  try {
    const interpretationLogId = registrarInterpretacao({
      empresaId,
      sender: celular,
      texto,
      intent,
      resultado,
      resposta: respostaTexto,
      duracaoMs: Date.now() - t0,
      canalId: null,
      tipoMensagem: 'texto',
      onLog: (msg, nivel) => {
        const fn = nivel === 'warning' || nivel === 'warn' ? console.warn : console.log;
        fn('[protheus_whatsapp]', msg);
      },
    });
    if (interpretationLogId) {
      sessionStore.vincularInterpretacao({
        mensagemId: respostaId,
        sessaoId,
        interpretationLogId,
      });
    }
  } catch (e) {
    // Falha ao logar nao pode derrubar a resposta ja calculada ao usuario, mas precisa ficar
    // visivel — antes esse erro era engolido em silencio, escondendo falhas de gravacao.
    console.error('[protheus_whatsapp] Falha ao registrar interpretacao:', e.message);
  }

  return {
    mensagemId: respostaId,
    perguntaId,
    texto: respostaTexto,
    apresentacao,
    rows: null,
    temDados: Array.isArray(rows) && rows.length > 0,
    rowsCount: Array.isArray(rows) ? rows.length : 0,
    tipo: resultado?.tipo || null,
  };
}

module.exports = { processarMensagem, executarFavorito };
