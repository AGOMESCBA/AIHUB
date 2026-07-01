'use strict';

const fs = require('fs');
const path = require('path');
const DatasetEngine = require('./dataset-query-engine');
const crud = require('../database/crud');
const crossModuleDetector = require('./cross-module-detector');
const crossModuleSpecCombiner = require('./cross-module-spec-combiner');
const iaOwnerRunner = require('./ia-owner/runner');
const { getDB } = require('../database');
const channelStore = require('../whatsapp/channel-store');

const PIPELINE_TRACE_FILE = path.join(__dirname, '..', '..', '..', '..', 'logs', 'iac-whatsapp-pipeline.log');

function _tracePipeline(evento, dados = {}) {
  try {
    const mem = process.memoryUsage();
    fs.mkdirSync(path.dirname(PIPELINE_TRACE_FILE), { recursive: true });
    fs.appendFileSync(
      PIPELINE_TRACE_FILE,
      JSON.stringify({
        ts: new Date().toISOString(),
        evento,
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
        ...dados,
      }) + '\n',
      'utf8',
    );
  } catch (_) {}
}

const AI_SQL_HANDLERS = {
  compras: './compras/ai-sql-handler-v2',
  financeiro: './financeiro/ai-sql-handler-v2',
  faturamento: './faturamento/ai-sql-handler-v2',
  comissao: './comissao/ai-sql-handler-v2',
};

const NOMES_MODULOS = {
  compras:     'Compras',
  financeiro:  'Financeiro',
  faturamento: 'Faturamento',
  comissao:    'Comissão',
};

function _verificarAutorizacaoModulo(intent, empresaId, modulo) {
  const coluna = `modulo_${modulo}`;
  const remetente = intent._remetente;
  if (!remetente || !modulo || !NOMES_MODULOS[modulo]) return null; // sem restrição para intents sem remetente

  try {
    const db = getDB();

    const eid = Number(empresaId);

    // Verifica se há números autorizados cadastrados — se não houver, não aplica restrição
    const total = db.prepare(
      `SELECT COUNT(*) AS total FROM whatsapp_allowed_numbers WHERE empresa_id = ? AND ativo = 1`
    ).get(eid)?.total || 0;
    if (!total) return null;

    // Busca o registro deste remetente
    const variantes = channelStore.variantesNumeroBrasil(remetente);
    const lid = channelStore.extrairLid(remetente);
    const placeholders = variantes.map(() => '?').join(',');
    const row = db.prepare(
      `SELECT ${coluna} FROM whatsapp_allowed_numbers
        WHERE empresa_id = ? AND ativo = 1
          AND (numero IN (${placeholders}) OR wa_lid = ?)
        LIMIT 1`
    ).get(eid, ...variantes, lid);

    if (!row) return null; // número não está na lista — _isSenderAuthorized já teria bloqueado antes
    if (row[coluna]) return null; // módulo habilitado — libera

    return {
      tipo: 'erro',
      subtipo: 'modulo_nao_autorizado',
      resposta_direta: `Ainda não consigo consultar o módulo *${NOMES_MODULOS[modulo]}* para o seu número. Peça ao gestor do IA Command para liberar esse módulo no seu cadastro de WhatsApp e tente novamente.`,
    };
  } catch (e) {
    return null; // falha silenciosa: não bloqueia por erro técnico
  }
}

// Loaders lazy dos specs — usados pelo combinador cross-module
function _verificarAlgumModuloAutorizado(intent, empresaId, modulos = Object.keys(NOMES_MODULOS)) {
  const remetente = intent._remetente;
  if (!remetente) return null;
  try {
    const db = getDB();
    const eid = Number(empresaId);
    const total = db.prepare(
      `SELECT COUNT(*) AS total FROM whatsapp_allowed_numbers WHERE empresa_id = ? AND ativo = 1`
    ).get(eid)?.total || 0;
    if (!total) return null;

    const modulosValidos = [...new Set((modulos || []).filter(m => NOMES_MODULOS[m]))];
    if (!modulosValidos.length) return null;
    const variantes = channelStore.variantesNumeroBrasil(remetente);
    const lid = channelStore.extrairLid(remetente);
    const placeholders = variantes.map(() => '?').join(',');
    const colunas = modulosValidos.map(m => `modulo_${m}`).join(', ');
    const row = db.prepare(
      `SELECT ${colunas} FROM whatsapp_allowed_numbers
        WHERE empresa_id = ? AND ativo = 1
          AND (numero IN (${placeholders}) OR wa_lid = ?)
        LIMIT 1`
    ).get(eid, ...variantes, lid);
    if (!row) return null;
    if (modulosValidos.some(m => row[`modulo_${m}`])) return null;
    return {
      tipo: 'erro',
      subtipo: 'modulo_nao_autorizado',
      resposta_direta: 'Ainda nao consigo consultar informacoes do ERP para o seu numero. Peca ao gestor do IA Command para liberar ao menos um modulo no seu cadastro de WhatsApp e tente novamente.',
    };
  } catch (_) {
    return null;
  }
}

const SPEC_LOADERS = {
  faturamento: () => require('./faturamento/faturamento-ia-owner-spec'),
  compras:     () => require('./compras/compras-ia-owner-spec'),
  financeiro:  () => require('./financeiro/financeiro-ia-owner-spec'),
  comissao:    () => require('./comissao/comissao-ia-owner-spec'),
};

const LOG_PREFIX_MODULO = {
  compras: 'ComprasAI',
  financeiro: 'FinanceiroAI',
  faturamento: 'FaturamentoAI',
  comissao: 'ComissaoAI',
};

function _appendTrace(intent = {}, evento = {}) {
  const trace = Array.isArray(intent._trace) ? intent._trace.slice(0, 40) : [];
  trace.push({
    etapa: evento.etapa || 'router',
    acao: evento.acao || 'rotear',
    modulo: evento.modulo || intent._moduloDinamico || null,
    intencao: evento.intencao || intent.intencao || null,
    detalhe: evento.detalhe || null,
  });
  return { ...intent, _trace: trace };
}

function _normalizarModuloDinamico(registro = {}) {
  const texto = String(registro.modulo || registro.nome || '').toLowerCase();
  if (texto.includes('compras') || texto.includes('compra')) return 'compras';
  if (texto.includes('financeiro')) return 'financeiro';
  if (texto.includes('faturamento')) return 'faturamento';
  if (texto.includes('comissao') || texto.includes('comissão')) return 'comissao';
  return texto.split(/[_\s-]+/).filter(Boolean)[0] || 'dinamico';
}

function _pareceAiSqlDinamico(registro = {}) {
  const nome = String(registro.nome || '').toLowerCase();
  const modulo = _normalizarModuloDinamico(registro);
  return nome.endsWith('_dinamico') && !!AI_SQL_HANDLERS[modulo];
}

function _resolverModuloDinamico(intent = {}, registro = {}) {
  const candidatos = [
    intent._moduloDinamico,
    String(intent.intencao || '').replace(/_dinamico$/i, ''),
    registro.modulo,
    registro.nome,
  ];
  for (const candidato of candidatos) {
    const modulo = _normalizarModuloDinamico({ modulo: candidato, nome: candidato });
    if (AI_SQL_HANDLERS[modulo]) return modulo;
  }
  return _normalizarModuloDinamico(registro);
}

function _normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bdocumetnos\b/g, 'documentos')
    .replace(/\bdocumetno\b/g, 'documento')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _dominioDinamicoForcadoPorTexto(mensagem = '') {
  const texto = _normalizarTexto(mensagem);
  const mencionaDocumentoFinanceiro = /\b(documentos?|titulos?|duplicatas?)\b/.test(texto);
  const mencionaPago = /\b(pago|pagos|pagas|pagamento|pagamentos|baixado|baixados|liquidado|liquidados)\b/.test(texto);
  const mencionaRecebido = /\b(recebido|recebidos|recebidas|recebimento|recebimentos)\b/.test(texto);
  if (mencionaDocumentoFinanceiro && (mencionaPago || mencionaRecebido)) return 'financeiro';
  return null;
}

function _deveFallbackAposFalhaCanonico(intent = {}, resultado, subtiposTerminais = new Set()) {
  if (intent._usarSqlCanonicoWhatsappAll) return false;
  if (!resultado || typeof resultado !== 'object') return false;
  return resultado.tipo === 'erro' && !subtiposTerminais.has(resultado.subtipo);
}

function _extrairPossivelEntidadeDaPreposicao(mensagem = '') {
  const texto = String(mensagem || '').trim();
  const m = texto.match(/\b(?:da|de|do)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s.'-]{2,40})\s*$/i);
  if (!m) return null;
  const nome = m[1].trim().replace(/[.,;:!?]+$/g, '').trim();
  if (!nome || /^(mes|mês|ano|cliente|produto|vendedor|fornecedor|filial|loja|empresa)$/i.test(nome)) return null;
  return nome;
}

function _mensagemPedeFilialExplicitamente(mensagem = '') {
  return /\b(?:filial|filiais|loja|lojas|unidade|unidades)\b/i.test(String(mensagem || ''));
}

function _corrigirIntentDinamicoPorTexto(intent = {}, empresaId) {
  const dominio = _dominioDinamicoForcadoPorTexto(intent._mensagemOriginal || intent.intencao || '');
  if (!dominio) return intent;

  const nomeAtual = String(intent.intencao || '').toLowerCase();
  const ehDinamico = intent._dynamicAiScope || nomeAtual.endsWith('_dinamico') || String(intent.acao || '').toLowerCase() === 'ai_text_to_sql';
  if (!ehDinamico) return intent;

  let alvo = null;
  try {
    alvo = crud
      .listar('intentions', { empresa_id: empresaId, ativo: 1 })
      .find(r => _normalizarModuloDinamico(r) === dominio && (String(r.acao || '').toLowerCase() === 'ai_text_to_sql' || _pareceAiSqlDinamico(r)));
  } catch (_) {}

  const nomeAlvo = alvo?.nome || `${dominio}_dinamico`;
  if (nomeAtual === String(nomeAlvo).toLowerCase()) return intent;
  return _appendTrace({
    ...intent,
    intencao: nomeAlvo,
    _moduloDinamico: dominio,
    _dominioCorrigidoPorTexto: dominio,
  }, {
    acao: 'corrigir_dominio_dinamico',
    modulo: dominio,
    intencao: nomeAlvo,
    detalhe: `de=${intent.intencao || 'desconhecido'}; motivo=documento_pago_recebido`,
  });
}

const FILTROS_ENTIDADE_DINAMICA = new Set([
  'cliente',
  'fornecedor',
  'vendedor',
  'produto',
  'grupo_produto',
  'centro_custo',
  'natureza',
  'tes',
]);

function _filialEhCodigoConfiavel(valor) {
  const v = String(valor || '').trim().toUpperCase();
  if (!v) return false;
  if (v === 'TODAS' || v === 'TODOS') return true;
  if (/^\d{1,10}$/.test(v)) return true;
  return /^[A-Z0-9]{1,3}$/.test(v) && /\d/.test(v);
}

function _temFiltroEntidadeDinamica(intent = {}) {
  return Object.entries(intent.filtros || {})
    .some(([k, v]) => {
      const chave = String(k).toLowerCase();
      const valor = String(v || '').trim();
      if (!valor) return false;
      if (FILTROS_ENTIDADE_DINAMICA.has(chave)) return true;
      return chave === 'filial' && !_filialEhCodigoConfiavel(valor);
    });
}

const _PALAVRAS_ERP = /\b(saldo|valor|total|vencimento|vencendo|vencer|fornecedor|fornecedores|cliente|clientes|nota|notas|pedido|pedidos|titulo|titulos|duplicata|duplicatas|fatura|faturas|pagamento|pagamentos|recebimento|recebimentos|compra|compras|venda|vendas|estoque|produto|produtos|financeiro|comissao|comissoes|carteira|banco|bancos|conta|contas|fluxo|caixa|emissao|parcela|parcelas|nf|nfe|xml)\b/i;

function _parecePerguntaErp(mensagem) {
  return _PALAVRAS_ERP.test(String(mensagem || '').normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

async function rotear(intent, empresaId) {
  intent = _corrigirIntentDinamicoPorTexto(intent, empresaId);
  const t0 = Date.now();

  if (intent.intencao === 'desconhecido') {
    const mensagem = intent._mensagemOriginal || intent.intencao || '';
    if (_parecePerguntaErp(mensagem)) {
      const _todosModulos = Object.keys(SPEC_LOADERS);
      const erroAutorizacao = _verificarAlgumModuloAutorizado(intent, empresaId, _todosModulos);
      if (erroAutorizacao) return erroAutorizacao;
      const _specs = _todosModulos.map(m => SPEC_LOADERS[m]());
      const _specCombinado = crossModuleSpecCombiner.combinarSpecs(_specs);
      const _intentLimpo = {
        _mensagemOriginal: mensagem,
        _remetente: intent._remetente || null,
        _channelId: intent._channelId || null,
        intencao: 'erp_generico',
        periodo: { tipo: 'nenhum' },
        filtros: {},
        _dynamicAiScope: true,
      };
      console.log(`[IACommandAI] Desconhecido com sinal ERP — roteando para spec combinado (todos os modulos) | empresa=${empresaId}`);
      const resultado = await iaOwnerRunner.executar(_specCombinado, _intentLimpo, empresaId);
      const traceResultado = [
        ...(Array.isArray(intent._trace) ? intent._trace : []),
        ...(Array.isArray(resultado?.trace) ? resultado.trace : []),
        { etapa: 'router', acao: 'fallback_erp_generico', modulo: 'todos', intencao: 'desconhecido', detalhe: `tipo=${resultado?.tipo || 'n/a'}; duracao_ms=${Date.now() - t0}` },
      ];
      return { dataset_id: null, dataset_nome: 'erp_generico', ...(resultado || {}), trace: traceResultado };
    }
    return { tipo: 'desconhecido', mensagem: intent._erro || 'Fiquei em duvida sobre qual indicador, periodo ou detalhe voce quer consultar.' };
  }

  if (intent.precisa_confirmacao || intent._baixaConfianca) {
    const nomeIntent = String(intent.intencao || '').toLowerCase();
    const ehDinamicoAiSql = intent._dynamicAiScope || nomeIntent.endsWith('_dinamico');
    if (!ehDinamicoAiSql) {
      return {
        tipo: 'desconhecido',
        subtipo: 'confirmacao_necessaria',
        mensagem: intent._erro || 'Entendi parcialmente sua pergunta, mas preciso que voce confirme o indicador, periodo ou filtro antes de consultar o ERP.',
      };
    }
  }

  const registros = crud.listar('intentions', { empresa_id: empresaId, nome: intent.intencao });
  const registro = registros.find(r => r.ativo !== 0);

  if (!registro) {
    return {
      tipo: 'erro',
      subtipo: 'sem_intencao',
      mensagem: `Intencao "${intent.intencao}" nao esta cadastrada para esta empresa. Configure-a no painel de Intencoes.`,
    };
  }

  const erroSemModulo = _verificarAlgumModuloAutorizado(intent, empresaId);
  if (erroSemModulo) return erroSemModulo;

  if (registro.acao === 'ai_text_to_sql' || _pareceAiSqlDinamico(registro)) {
    const modulo = _resolverModuloDinamico(intent, registro);
    const handlerPath = AI_SQL_HANDLERS[modulo];
    if (!handlerPath) {
      return {
        tipo: 'erro',
        subtipo: 'handler_ai_sql_nao_configurado',
        resposta_direta: `O modulo ${modulo} ainda nao foi migrado para o motor systemprompt.`,
        mensagem: `Handler systemprompt nao configurado para modulo "${modulo}".`,
      };
    }

    const erroAutorizacao = _verificarAutorizacaoModulo(intent, empresaId, modulo);
    if (erroAutorizacao) return erroAutorizacao;

    intent = _appendTrace(intent, {
      acao: 'acionar_modulo_dinamico',
      modulo,
      intencao: intent.intencao,
      detalhe: `handler=${handlerPath}`,
    });

    console.log(`[${LOG_PREFIX_MODULO[modulo] || 'IACommandAI'}] Caminho systemprompt: intencao=${intent.intencao} | handler=${handlerPath} | empresa=${empresaId}`);
    const AiSqlHandler = require(handlerPath);

    const sqlCanonicoHerdado = intent._escopoExecucao === 'whatsapp_all'
      && intent._usarSqlCanonicoWhatsappAll
      && intent._sqlCanonicoOriginal
      ? String(intent._sqlCanonicoOriginal).trim()
      : null;
    _tracePipeline('router_dinamico_inicio', {
      empresa_id: empresaId,
      modulo,
      intencao: intent?.intencao || null,
      handler: handlerPath,
      escopo: intent?._escopoExecucao || null,
      reuso_canonico: !!sqlCanonicoHerdado,
    });

    // Subtipos que indicam problema terminal (infra/conexão) — não faz sentido tentar novamente.
    const SUBTIPOS_TERMINAIS = new Set(['sem_conexao', 'erp_id_nao_configurado', 'nao_cadastrado']);

    let resultado;
    const _resultadoFallback = (origem) => ({ tipo: 'erro', subtipo: 'erro_erp', resposta_direta: 'Ocorreu um erro interno ao processar sua consulta. Tente novamente.', _pipeline_origem: origem });

    // Cross-module: detecta query comparativa multi-modulo e combina specs dinamicamente.
    // Quando ativado, substitui o caminho single-module sem alterar nenhuma outra logica.
    const _mensagemCross = intent._mensagemOriginal || '';
    const _crossInfo = crossModuleDetector.ehCrossModule(_mensagemCross);
    const _usarCrossModule = _crossInfo.ehCross
      && _crossInfo.modulos.length >= 2
      && _crossInfo.modulos.every(m => SPEC_LOADERS[m]);

    // SQL canônico tem prioridade absoluta: gerado uma vez pela primeira empresa,
    // reutilizado por todas as demais com substituição de sufixo — sem nova chamada à IA.
    // Para cross-module, usa o spec combinado (mesmas tabelas usadas na geração) para que
    // modosSX2 resolva SD1/SF1 corretamente em vez de depender do sufixo fallback.
    if (sqlCanonicoHerdado) {
      _tracePipeline('router_dinamico_sql_direto_inicio', { empresa_id: empresaId, modulo, sql_chars: sqlCanonicoHerdado.length });
      const _executarSqlDireto = _usarCrossModule
        ? () => iaOwnerRunner.executarSqlDireto(crossModuleSpecCombiner.combinarSpecs(_crossInfo.modulos.map(m => SPEC_LOADERS[m]())), sqlCanonicoHerdado, intent, empresaId)
        : () => AiSqlHandler.executarSqlDireto(sqlCanonicoHerdado, intent, empresaId);
      console.log(`[${LOG_PREFIX_MODULO[modulo] || 'IACommandAI'}] Reutilizando SQL canonico multi-empresa pelo motor systemprompt${_usarCrossModule ? ' (cross-module spec)' : ''}.`);
      resultado = await _executarSqlDireto();
      _tracePipeline('router_dinamico_sql_direto_fim', {
        empresa_id: empresaId,
        modulo,
        tipo: resultado?.tipo || null,
        subtipo: resultado?.subtipo || null,
        rows: Array.isArray(resultado?.rows) ? resultado.rows.length : null,
      });
      if (!resultado || typeof resultado !== 'object') resultado = _resultadoFallback('canonico_reuso');
      else resultado._pipeline_origem = 'canonico_reuso';
      // Fallback: se o reuso do SQL canônico falhar por razão recuperável, re-executa via IA-OWNER.
      // Garante que a empresa não seja descartada por incompatibilidade de SQL entre tenants.
      if (_deveFallbackAposFalhaCanonico(intent, resultado, SUBTIPOS_TERMINAIS)) {
        console.log(`[${LOG_PREFIX_MODULO[modulo] || 'IACommandAI'}] Fallback para execucao completa apos falha no reuso canonico (subtipo=${resultado.subtipo || 'n/a'}).`);
        const _fallbackHandler = _usarCrossModule
          ? () => iaOwnerRunner.executar(crossModuleSpecCombiner.combinarSpecs(_crossInfo.modulos.map(m => SPEC_LOADERS[m]())), intent, empresaId)
          : () => AiSqlHandler.executar(intent, empresaId);
        resultado = await _fallbackHandler();
        if (!resultado || typeof resultado !== 'object') resultado = _resultadoFallback('systemprompt_fallback');
        else resultado._pipeline_origem = 'systemprompt_fallback';
      }
    } else if (_usarCrossModule) {
      const _specs = _crossInfo.modulos.map(m => SPEC_LOADERS[m]());
      const _specCombinado = crossModuleSpecCombiner.combinarSpecs(_specs);
      console.log(`[CrossModule] Query cross-module: ${_crossInfo.modulos.join(' + ')} | empresa=${empresaId}`);
      _tracePipeline('router_dinamico_cross_inicio', { empresa_id: empresaId, modulos: _crossInfo.modulos });
      resultado = await iaOwnerRunner.executar(_specCombinado, intent, empresaId);
      _tracePipeline('router_dinamico_cross_fim', {
        empresa_id: empresaId,
        tipo: resultado?.tipo || null,
        subtipo: resultado?.subtipo || null,
        rows: Array.isArray(resultado?.rows) ? resultado.rows.length : null,
      });
      if (!resultado || typeof resultado !== 'object') resultado = _resultadoFallback('cross_module');
      else resultado._pipeline_origem = 'cross_module';
    } else {
      console.log(`[${LOG_PREFIX_MODULO[modulo] || 'IACommandAI'}] Executando pelo motor systemprompt.`);
      _tracePipeline('router_dinamico_handler_inicio', { empresa_id: empresaId, modulo });
      resultado = await AiSqlHandler.executar(intent, empresaId);
      _tracePipeline('router_dinamico_handler_fim', {
        empresa_id: empresaId,
        modulo,
        tipo: resultado?.tipo || null,
        subtipo: resultado?.subtipo || null,
        rows: Array.isArray(resultado?.rows) ? resultado.rows.length : null,
        duracao_ms: resultado?.duracao_ms ?? null,
      });
      if (!resultado || typeof resultado !== 'object') resultado = _resultadoFallback('systemprompt');
      else resultado._pipeline_origem = 'systemprompt';
    }

    const traceResultado = [
      ...(Array.isArray(intent._trace) ? intent._trace : []),
      ...(Array.isArray(resultado.trace) ? resultado.trace : []),
      {
        etapa: 'router',
        acao: 'resultado_modulo',
        modulo,
        intencao: intent.intencao,
        detalhe: `tipo=${resultado.tipo || 'n/a'}; subtipo=${resultado.subtipo || 'n/a'}; linhas=${Array.isArray(resultado.rows) ? resultado.rows.length : 'n/a'}; duracao_ms=${Date.now() - t0}`,
      },
    ];
    console.log(`[${LOG_PREFIX_MODULO[modulo] || 'IACommandAI'}] Resultado: tipo=${resultado.tipo || 'n/a'} | subtipo=${resultado.subtipo || 'n/a'} | linhas=${Array.isArray(resultado.rows) ? resultado.rows.length : 'n/a'} | duracao_ms=${Date.now() - t0}`);
    return { dataset_id: null, dataset_nome: registro.modulo || 'ai_sql', ...resultado, trace: traceResultado };
  }

  if (!registro.dataset_id) {
    return {
      tipo: 'erro',
      mensagem: `A intencao "${intent.intencao}" nao tem um dataset vinculado. Vincule um dataset no painel de Intencoes.`,
    };
  }

  const dataset = crud.buscarPorId('datasets', registro.dataset_id);
  if (!dataset || dataset.empresa_id !== empresaId) {
    return { tipo: 'erro', mensagem: 'Dataset vinculado nao encontrado.' };
  }

  const resultado = await DatasetEngine.executar(intent, dataset, empresaId);
  return {
    tipo: 'sucesso',
    dataset_id: dataset.id,
    dataset_nome: dataset.nome,
    ...resultado,
    trace: [
      ...(Array.isArray(intent._trace) ? intent._trace : []),
      {
        etapa: 'router',
        acao: 'acionar_dataset',
        intencao: intent.intencao,
        detalhe: `dataset=${dataset.nome}; duracao_ms=${Date.now() - t0}`,
      },
    ],
  };
}

module.exports = {
  rotear,
  _normalizarModuloDinamico,
  _verificarAutorizacaoModulo,
  _verificarAlgumModuloAutorizado,
  _dominioDinamicoForcadoPorTexto,
  _corrigirIntentDinamicoPorTexto,
  _temFiltroEntidadeDinamica,
  _extrairPossivelEntidadeDaPreposicao,
  _mensagemPedeFilialExplicitamente,
  _deveFallbackAposFalhaCanonico,
};
