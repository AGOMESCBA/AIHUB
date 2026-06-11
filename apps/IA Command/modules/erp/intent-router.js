'use strict';

const DatasetEngine = require('./dataset-query-engine');
const crud = require('../database/crud');
const crossModuleDetector = require('./cross-module-detector');
const crossModuleSpecCombiner = require('./cross-module-spec-combiner');
const iaOwnerRunner = require('./ia-owner/runner');

const AI_SQL_HANDLERS = {
  compras: './compras/ai-sql-handler-v2',
  financeiro: './financeiro/ai-sql-handler-v2',
  faturamento: './faturamento/ai-sql-handler-v2',
  comissao: './comissao/ai-sql-handler-v2',
};

// Loaders lazy dos specs — usados pelo combinador cross-module
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

async function rotear(intent, empresaId) {
  intent = _corrigirIntentDinamicoPorTexto(intent, empresaId);
  const t0 = Date.now();

  if (intent.intencao === 'desconhecido') {
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
      const _executarSqlDireto = _usarCrossModule
        ? () => iaOwnerRunner.executarSqlDireto(crossModuleSpecCombiner.combinarSpecs(_crossInfo.modulos.map(m => SPEC_LOADERS[m]())), sqlCanonicoHerdado, intent, empresaId)
        : () => AiSqlHandler.executarSqlDireto(sqlCanonicoHerdado, intent, empresaId);
      console.log(`[${LOG_PREFIX_MODULO[modulo] || 'IACommandAI'}] Reutilizando SQL canonico multi-empresa pelo motor systemprompt${_usarCrossModule ? ' (cross-module spec)' : ''}.`);
      resultado = await _executarSqlDireto();
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
      resultado = await iaOwnerRunner.executar(_specCombinado, intent, empresaId);
      if (!resultado || typeof resultado !== 'object') resultado = _resultadoFallback('cross_module');
      else resultado._pipeline_origem = 'cross_module';
    } else {
      console.log(`[${LOG_PREFIX_MODULO[modulo] || 'IACommandAI'}] Executando pelo motor systemprompt.`);
      resultado = await AiSqlHandler.executar(intent, empresaId);
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
  _dominioDinamicoForcadoPorTexto,
  _corrigirIntentDinamicoPorTexto,
  _temFiltroEntidadeDinamica,
  _extrairPossivelEntidadeDaPreposicao,
  _mensagemPedeFilialExplicitamente,
  _deveFallbackAposFalhaCanonico,
};
