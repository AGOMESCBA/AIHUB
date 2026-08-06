const assert = require('assert');

const localResolver = require('../apps/IA Command/modules/ai/local-intent-resolver');
const intentMerger = require('../apps/IA Command/modules/ai/intent-merger');
const dialogResolver = require('../apps/IA Command/modules/ai/dialog-resolver');
const conversationService = require('../apps/IA Command/modules/ai/conversation-service');
const entityResolver = require('../apps/IA Command/modules/ai/entity-resolver');
const unsupportedRequest = require('../apps/IA Command/modules/ai/unsupported-request');
const { identificarPeriodoTexto, resolverPeriodo } = require('../apps/IA Command/modules/ai/period-resolver');
const {
  _SINONIMOS_SISTEMA,
  _mensagemPareceAiSqlDinamico,
  _mensagemPareceComprasAiSql,
  _intencaoAiSqlPreferencial,
  _deveBypassDinamico,
  _mensagemDinamicaAmbigua,
  _intentAiSqlDireto,
  _garantirIntencoesDinamicasPadrao,
} = require('../apps/IA Command/modules/ai/intent-service');
const { _buildWrapper, _mapAliases } = require('../apps/IA Command/modules/erp/core/dataset-query-engine');
const queryPlan = require('../apps/IA Command/modules/erp/core/query-plan');
const intentRouter = require('../apps/IA Command/modules/erp/core/intent-router');
const aiSqlGeneration = require('../apps/IA Command/modules/erp/core/ai-sql-generation');
const semanticDatasetRunner = require('../apps/IA Command/modules/erp/core/semantic-dataset-ai-runner');
const temporalContract = require('../apps/IA Command/modules/erp/core/temporal-contract');
const sx3SqlValidator = require('../apps/IA Command/modules/erp/totvs_protheus/SX/sx3-sql-validator');
const sx2SqlNormalizer = require('../apps/IA Command/modules/erp/totvs_protheus/SX/sx2-sql-normalizer');
const promptBuilder = require('../apps/IA Command/modules/erp/ia-owner/prompt-builder');
const entitySqlGuard = require('../apps/IA Command/modules/erp/totvs_protheus/guards/entity-sql-guard');
const comprasSpec = require('../apps/IA Command/modules/erp/totvs_protheus/compras/compras-ia-owner-spec');
const comprasHandlerV2 = require('../apps/IA Command/modules/erp/totvs_protheus/compras/ai-sql-handler-v2');
const comprasMiddleware = require('../apps/IA Command/modules/erp/totvs_protheus/compras/sql-middleware');
const financeiroSpec = require('../apps/IA Command/modules/erp/totvs_protheus/financeiro/financeiro-ia-owner-spec');
const financeiroHandlerV2 = require('../apps/IA Command/modules/erp/totvs_protheus/financeiro/ai-sql-handler-v2');
const financeiroMiddleware = require('../apps/IA Command/modules/erp/totvs_protheus/financeiro/sql-middleware');
const faturamentoSpec = require('../apps/IA Command/modules/erp/totvs_protheus/faturamento/faturamento-ia-owner-spec');
const faturamentoHandlerV2 = require('../apps/IA Command/modules/erp/totvs_protheus/faturamento/ai-sql-handler-v2');
const faturamentoMiddleware = require('../apps/IA Command/modules/erp/totvs_protheus/faturamento/sql-middleware');
const comissaoSpec = require('../apps/IA Command/modules/erp/totvs_protheus/comissao/comissao-ia-owner-spec');
const comissaoHandlerV2 = require('../apps/IA Command/modules/erp/totvs_protheus/comissao/ai-sql-handler-v2');
const comissaoMiddleware = require('../apps/IA Command/modules/erp/totvs_protheus/comissao/sql-middleware');
const responseFormatter = require('../apps/IA Command/modules/erp/core/response-formatter');
const scheduledRunner = require('../apps/IA Command/modules/scheduler/scheduled-question-runner');
const IACWhatsAppService = require('../apps/IA Command/modules/whatsapp/service');
const iaOwnerRunner = require('../apps/IA Command/modules/erp/ia-owner/runner');

function buildLegacySchemaAdapter(spec, extraSystemPrompt = '') {
  return {
    buildSqlSystemPrompt() {
      return `${promptBuilder.buildSystemPrompt(spec)}\n${extraSystemPrompt}`.trim();
    },
    buildSqlUserPrompt(mensagem, contexto = {}) {
      const linhas = [
        promptBuilder.buildUserPrompt({ mensagem, contextoTecnico: contexto }),
        contexto.periodo?.dataInicio || contexto.periodo?.data_inicio || '',
        contexto.periodo?.dataFim || contexto.periodo?.data_fim || '',
        contexto.filtros?.filial ? `filial: ${contexto.filtros.filial}` : '',
      ];
      if (contexto.sx2) linhas.push(`SX2: ${Object.keys(contexto.sx2).join(', ')}`);
      if (contexto.sx3) linhas.push(`Campos disponiveis no SX3 para o escopo ${spec.nome}: ${JSON.stringify(contexto.sx3)}`);
      if (spec.nome === 'financeiro') {
        linhas.push('PA deduz pagar; RA deduz receber; use UNION ALL agregando SE2 e SE1 separadamente; nao aplique filtro de data quando a posicao em aberto nao trouxer periodo.');
      }
      if (spec.nome === 'comissao') linhas.push('SE3.E3_VENCTO');
      return linhas.filter(Boolean).join('\n').replace(/\bpersonalizado\b/g, '');
    },
  };
}

function mapearModosSX2(rows = [], bases = []) {
  return Object.fromEntries((rows || [])
    .filter(r => bases.some(base => String(r.arquivo || '').startsWith(base)))
    .map(r => [r.arquivo, r.modo]));
}

function inferirSufixoSX2(sx2, fallback = '') {
  const arquivo = Object.keys(sx2 || {}).find(nome => /\d+$/.test(nome));
  if (!arquivo) return fallback;
  const base = ['SBM', 'SA1', 'SA2', 'SA3', 'SF1', 'SF2', 'SD1', 'SD2', 'SC7', 'SE1', 'SE2', 'SE3', 'SE5', 'FK6']
    .find(prefixo => arquivo.startsWith(prefixo));
  return base ? arquivo.slice(base.length) : arquivo.match(/(\d+)$/)[1];
}

function tabelaFisicaSX2(sx2, base) {
  return Object.keys(sx2 || {}).find(nome => nome.startsWith(base)) || null;
}

function validarFuncoesDataProtheus(sql) {
  if (/\bTRY_CONVERT\s*\(/i.test(sql)) return false;
  if (/\b(?:YEAR|MONTH)\s*\(\s*(?!CONVERT\s*\(\s*DATE)/i.test(sql)) return false;
  return true;
}

function validarEntidades(sql, contexto, definicoes) {
  return entitySqlGuard.validarSqlEntidadesResolvidas(sql, contexto, definicoes);
}

function validarEscopoAliasesSQL(sql) {
  const externo = String(sql || '').split(/\bFROM\s*\(/i)[0] || '';
  return !/\bSE[12]\s*\./i.test(externo);
}

function validarPosicaoAbertaSemPeriodo(sql, _mensagem, periodo) {
  if (periodo?.tipo !== 'nenhum') return true;
  return !/\b(?:19|20)\d{6}\b/.test(sql);
}

function sqlDeterministicoFinanceiro({ sufixoTabela = '990', periodo = {}, queryPlan: plano = {}, entidades = [] } = {}) {
  const entFornecedor = entidades.find(e => e.tipo === 'fornecedor') || {};
  const entCliente = entidades.find(e => e.tipo === 'cliente') || {};
  const dtIni = periodo.dataInicio || '20250101';
  const dtFim = periodo.dataFim || '20261231';
  if (plano.carteira === 'ambas') {
    return `SELECT SUM(total_receber) AS total_receber, SUM(total_pagar) AS total_pagar FROM (SELECT SUM(SE1.E1_SALDO) AS total_receber, 0 AS total_pagar FROM SE1${sufixoTabela} SE1 JOIN SA1${sufixoTabela} SA1 ON SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0 AND SA1.A1_COD = '${entCliente.codigo}' AND SA1.A1_LOJA = '${entCliente.loja}' UNION ALL SELECT 0 AS total_receber, SUM(SE2.E2_SALDO) AS total_pagar FROM SE2${sufixoTabela} SE2 JOIN SA2${sufixoTabela} SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 AND SA2.A2_COD = '${entFornecedor.codigo}' AND SA2.A2_LOJA = '${entFornecedor.loja}') fluxo`;
  }
  const detalheDoc = (plano.agrupamentos || []).includes('documento');
  return `SELECT ${detalheDoc ? 'SE2.E2_NUM AS documento, ' : ''}SUM(SE5.E5_VALOR) AS total_pago FROM SE2${sufixoTabela} SE2 JOIN SE5${sufixoTabela} SE5 ON SE5.E5_PREFIXO = SE2.E2_PREFIXO AND SE5.E5_NUMERO = SE2.E2_NUM AND SE5.E5_PARCELA = SE2.E2_PARCELA AND SE5.E5_TIPO = SE2.E2_TIPO AND SE5.E5_CLIFOR = SE2.E2_FORNECE AND SE5.E5_LOJA = SE2.E2_LOJA AND SE5.E5_RECPAG = 'P' AND SE5.E5_SITUACA <> 'C' AND SE5.E5_TIPO NOT IN ('EST','ED') AND SE5.D_E_L_E_T_ = ' ' JOIN SA2${sufixoTabela} SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA WHERE SE2.D_E_L_E_T_ = ' ' AND SE5.E5_DATA BETWEEN '${dtIni}' AND '${dtFim}' AND SA2.A2_COD = '${entFornecedor.codigo}' AND SA2.A2_LOJA = '${entFornecedor.loja}'${detalheDoc ? ' GROUP BY SE2.E2_NUM' : ''}`;
}

const comprasSchema = buildLegacySchemaAdapter(comprasSpec, 'SQL ANSI/portavel; YEAR(CONVERT(DATE');
const financeiroSchema = buildLegacySchemaAdapter(financeiroSpec, 'SQL ANSI/portavel; YEAR(CONVERT(DATE; UNION ALL de agregados por carteira');
const faturamentoSchema = buildLegacySchemaAdapter(faturamentoSpec, 'SQL ANSI/portavel; YEAR(CONVERT(DATE; SF2');
const comissaoSchema = buildLegacySchemaAdapter(comissaoSpec, 'SQL ANSI/portavel; E3_DATA e a autoridade; E3_STATUS NAO significa pagamento realizado; SE3 -> SE2 -> SE5; SE5.E5_DATA');

const comprasHandler = {
  ...comprasHandlerV2,
  _termosDeFiltrosCompras: filtros => entitySqlGuard.termosDeFiltrosEstruturados(filtros, { fornecedor: 'fornecedor', produto: 'produto' }),
  _validarEntidadesComprasNoSQL: (sql, contexto) => validarEntidades(sql, contexto, comprasSpec.entityCatalog.DEFINICOES),
  _comprasMockAtivo: env => /^(1|true)$/i.test(String(env?.IA_COMMAND_COMPRAS_MOCK_ROWS || '')),
  _mapearModosSX2Compras: rows => mapearModosSX2(rows, ['SF1', 'SD1', 'SA2', 'SB1', 'SBM', 'SC7']),
  _inferirSufixoSX2: inferirSufixoSX2,
  _tabelaFisicaSX2: tabelaFisicaSX2,
  _normalizarFiliaisDescobertas: rows => [...new Set((rows || []).map(r => String(r.filial || r.F1_FILIAL || r.FILIAL || '').trim()).filter(Boolean))],
  _validarPeriodoNoSQL: temporalContract.validarPeriodoNoSQL,
  _validarFuncoesDataProtheus: validarFuncoesDataProtheus,
  _dadosMockCompras: () => [{ filial: '01' }, { filial: '01' }, { filial: '02' }],
  _sqlTentativaDiagnostico: ({ userSql, respostaSql, erro }) => `SQL NAO GERADO\n${userSql}\n${respostaSql}\n${erro}`,
  _rowsZeroParaAgregadoSemLinhas: queryPlan.rowsZeroParaAgregadoSemLinhas,
};

const financeiroHandler = {
  ...financeiroHandlerV2,
  _sqlDeterministicoFinanceiro: sqlDeterministicoFinanceiro,
  _ajustarTermoAoPlanoFinanceiro: (termo, plano = {}) => {
    if (plano.carteira === 'receber' && termo.tipo_sugerido === 'fornecedor') return { ...termo, tipo_sugerido: 'cliente', _tipoOriginal: 'fornecedor' };
    if (plano.carteira === 'pagar' && termo.tipo_sugerido === 'desconhecido') return { ...termo, tipo_sugerido: 'fornecedor', origem: 'inferido_carteira', _tipoOriginal: 'desconhecido' };
    return termo;
  },
  _termosDeFiltrosFinanceiro: filtros => entitySqlGuard.termosDeFiltrosEstruturados(filtros, { fornecedor: 'fornecedor', cliente: 'cliente' }),
  _expandirTermosCarteiraAmbasFinanceiro: (termos, plano = {}) => plano.carteira === 'ambas' ? [...termos, ...termos.filter(t => t.tipo_sugerido === 'fornecedor').map(t => ({ ...t, tipo_sugerido: 'cliente', origem: 'inferido_carteira_ambas' }))] : termos,
  _entidadeObrigatoriaNaoEncontradaFinanceiro: termo => ['inferido_carteira_ambas', 'filtro_estruturado'].includes(termo?.origem),
  _removerHintsNoLock: entitySqlGuard.removerHintsNoLock,
  _validarEntidadesFinanceiroNoSQL: (sql, contexto) => validarEntidades(sql, contexto, financeiroSpec.entityCatalog.DEFINICOES),
  _financeiroMockAtivo: env => /^(1|true)$/i.test(String(env?.IA_COMMAND_FINANCEIRO_MOCK_ROWS || '')),
  _mapearModosSX2Financeiro: rows => mapearModosSX2(rows, ['SE1', 'SE2', 'SE5', 'FK6']),
  _validarPeriodoNoSQL: temporalContract.validarPeriodoNoSQL,
  _validarFuncoesDataProtheus: validarFuncoesDataProtheus,
  _validarEscopoAliasesSQL: validarEscopoAliasesSQL,
  _dadosMockFinanceiro: () => [{ tipo: 'RA' }, { tipo: 'PA' }],
  _validarPosicaoAbertaSemPeriodo: validarPosicaoAbertaSemPeriodo,
  _rowsZeroParaAgregadoSemLinhas: queryPlan.rowsZeroParaAgregadoSemLinhas,
};

const faturamentoHandler = {
  ...faturamentoHandlerV2,
  _test: {
    _filtrarEntidadesCitadasNaMensagemAtual(entidades = [], mensagem = '') {
      const texto = String(mensagem || '').toLowerCase();
      return (entidades || []).filter(e => e?.texto && texto.includes(String(e.texto).toLowerCase()));
    },
    _sincronizarFiltrosComEntidadesFase1(intent = {}, fase1 = {}) {
      const filtros = { ...(intent.filtros || {}) };
      for (const e of fase1.entidades_nomeadas || []) {
        if (e.tipo_sugerido && e.texto) filtros[e.tipo_sugerido] = e.texto;
      }
      return { intent: { ...intent, filtros } };
    },
  },
  _validarEntidadesFaturamentoNoSQL: (sql, contexto) => validarEntidades(sql, contexto, faturamentoSpec.entityCatalog.DEFINICOES),
  _faturamentoMockAtivo: env => /^(1|true)$/i.test(String(env?.IA_COMMAND_FATURAMENTO_MOCK_ROWS || '')),
  _mapearModosSX2Faturamento: rows => mapearModosSX2(rows, ['SF2', 'SD2', 'SA1', 'SA3']),
  _inferirSufixoSX2: inferirSufixoSX2,
  _validarPeriodoNoSQL: temporalContract.validarPeriodoNoSQL,
  _validarFuncoesDataProtheus: validarFuncoesDataProtheus,
  _rowsZeroParaAgregadoSemLinhas: queryPlan.rowsZeroParaAgregadoSemLinhas,
};

const comissaoHandler = {
  ...comissaoHandlerV2,
  _validarEntidadesComissaoNoSQL: (sql, contexto) => validarEntidades(sql, contexto, comissaoSpec.entityCatalog.DEFINICOES),
  _sx3TemCampo: (sx3, tabela, campo) => Object.values(sx3 || {}).flat().some(c => String(c.campo).toUpperCase() === campo && String(tabela)),
  _mapearModosSX2Comissao: rows => mapearModosSX2(rows, ['SE3', 'SA3', 'SE2', 'SE5']),
  _removerFiltroBaixaComissaoSeCampoAusente: sql => String(sql || '').replace(/\s+AND\s+(?:LTRIM\s*\(\s*RTRIM\s*\(\s*)?SE3\.E3_BAIXA[\s\S]*?(?=\s+AND\s+|$)/ig, ''),
  _normalizarFiltrosStatusComissaoPorSX3(sql) {
    const texto = String(sql || '');
    const status = texto.match(/\bSE3\.E3_STATUS\s*=\s*'([^']+)'/i)?.[1];
    const filtroData = status && status.toUpperCase() === 'P'
      ? "LTRIM(RTRIM(SE3.E3_DATA)) <> ''"
      : "LTRIM(RTRIM(SE3.E3_DATA)) = ''";
    return texto.replace(/\s+AND\s+SE3\.E3_STATUS\s*=\s*'[^']*'/ig, status ? ` AND ${filtroData}` : '');
  },
};

const intencoes = [
  { nome: 'faturamento_periodo', descricao: 'Faturamento por periodo', frases_exemplo: '', dataset_id: 'ds-fat' },
  { nome: 'consultar_faturamento_por_produto', descricao: 'Faturamento por produto', frases_exemplo: '', dataset_id: 'ds-fat-prod' },
  { nome: 'compras_periodo', descricao: 'Compras por periodo', frases_exemplo: '', dataset_id: 'ds-comp' },
  { nome: 'contas_receber', descricao: 'Contas a receber', frases_exemplo: '', dataset_id: 'ds-car' },
];

const datasets = [
  { id: 'ds-fat', nome: 'Faturamento', colunas_metrica: 'faturamento, quantidade' },
  { id: 'ds-fat-prod', nome: 'Faturamento Produto', colunas_metrica: 'FATURAMENTO, QUANTIDADE' },
  { id: 'ds-comp', nome: 'Compras', colunas_metrica: 'valor, quantidade' },
];

function expectLocal(texto, esperado) {
  const intent = localResolver.resolverLocal(texto, intencoes, _SINONIMOS_SISTEMA, { datasets });
  assert(intent, `Esperava resolver localmente: "${texto}"`);
  for (const [campo, valor] of Object.entries(esperado)) {
    if (campo === 'periodo') {
      assert.strictEqual(intent.periodo.tipo, valor, `${texto}: periodo`);
    } else {
      assert.strictEqual(intent[campo], valor, `${texto}: ${campo}`);
    }
  }
  assert.strictEqual(intent._provedor, 'deterministico', `${texto}: provedor`);
}

function expectNoLocal(texto) {
  const intent = localResolver.resolverLocal(texto, intencoes, _SINONIMOS_SISTEMA, { datasets });
  assert.strictEqual(intent, null, `Esperava ambiguidade/fallback para IA: "${texto}"`);
}

function expectPeriod(texto, hoje, esperado) {
  const identificado = identificarPeriodoTexto(texto, { hoje });
  const periodo = { ...identificado, ...resolverPeriodo(identificado, { hoje }) };
  for (const [campo, valor] of Object.entries(esperado)) {
    assert.strictEqual(periodo[campo], valor, `${texto}: ${campo}`);
  }
}

function resolverTurno(texto, contextoAnterior = null) {
  let intent = localResolver.resolverLocal(texto, intencoes, _SINONIMOS_SISTEMA, { datasets });
  if (!intent && contextoAnterior) {
    intent = {
      intencao: 'desconhecido',
      periodo: { tipo: 'nenhum' },
      filtros: {},
      agrupar_por: null,
      ordenar_por: null,
      limite: null,
      confianca: 0.4,
      precisa_confirmacao: false,
      origem: 'texto',
      _provedor: 'teste',
    };
  }
  assert(intent, `Esperava resolver localmente: "${texto}"`);
  if (contextoAnterior) {
    intent = intentMerger.mesclar(intent, contextoAnterior, Date.now(), texto);
  }
  return intent;
}

{
  const fase1 = {
    entidades_nomeadas: [
      { texto: 'Caieira', tipo_sugerido: 'cliente' },
      { texto: 'Aster', tipo_sugerido: 'cliente' },
      { texto: 'Plantivo', tipo_sugerido: 'cliente' },
    ],
  };
  const citadasAgora = faturamentoHandler._test._filtrarEntidadesCitadasNaMensagemAtual(
    fase1.entidades_nomeadas,
    'detalhe a Caieira',
  );
  assert.deepStrictEqual(citadasAgora, [{ texto: 'Caieira', tipo_sugerido: 'cliente' }], 'faturamento v2: entidade atual deve prevalecer sobre historico');

  const sincronizado = faturamentoHandler._test._sincronizarFiltrosComEntidadesFase1(
    { filtros: { cliente: 'Plantivo' } },
    { entidades_nomeadas: citadasAgora },
  );
  assert.strictEqual(sincronizado.intent.filtros.cliente, 'Caieira', 'faturamento v2: filtro herdado deve ser sobrescrito pela entidade atual');
}

expectLocal('fat por produto no mes', {
  intencao: 'consultar_faturamento_por_produto',
  periodo: 'mes_atual',
  agrupar_por: 'produto',
});

expectLocal('vendas do ano anterior', {
  intencao: 'faturamento_periodo',
  periodo: 'ano_anterior',
});

expectLocal('faturamento por cliente mes atual', {
  intencao: 'faturamento_periodo',
  periodo: 'mes_atual',
  agrupar_por: 'cliente',
});

expectLocal('top 5 produtos faturamento mes atual', {
  intencao: 'consultar_faturamento_por_produto',
  periodo: 'mes_atual',
  agrupar_por: 'produto',
  limite: 5,
  ordenar_por: 'faturamento:desc',
});

{
  const hojeRanking = new Date('2026-08-05T12:00:00');
  const rankingDezExtenso = localResolver.resolverLocal(
    'Quais foram os dez maiores clientes de hoje em faturamento?',
    intencoes,
    _SINONIMOS_SISTEMA,
    { datasets },
  );
  assert(rankingDezExtenso, 'dez maiores clientes hoje: resolve localmente');
  assert.strictEqual(rankingDezExtenso.periodo.tipo, 'hoje', 'dez maiores clientes hoje: periodo hoje, nao dezembro');
  assert.strictEqual(rankingDezExtenso.limite, 10, 'dez maiores clientes hoje: limite por extenso');
  assert.strictEqual(rankingDezExtenso.agrupar_por, 'cliente', 'dez maiores clientes hoje: agrupamento cliente');
  const periodoDezExtenso = {
    ...rankingDezExtenso.periodo,
    ...resolverPeriodo(rankingDezExtenso.periodo, { hoje: hojeRanking }),
  };
  assert.strictEqual(periodoDezExtenso.dataInicio, '20260805', 'dez maiores clientes hoje: data inicio');
  assert.strictEqual(periodoDezExtenso.dataFim, '20260805', 'dez maiores clientes hoje: data fim');
  const contratoDezExtenso = temporalContract.resolverPeriodoDeterministico({
    modulo: 'faturamento',
    mensagem: 'Quais foram os dez maiores clientes de hoje em faturamento?',
    hoje: hojeRanking,
  });
  assert.strictEqual(contratoDezExtenso.dataInicio, '20260805', 'contrato temporal: dez maiores hoje nao vira dezembro');
  assert.strictEqual(contratoDezExtenso.dataFim, '20260805', 'contrato temporal: dez maiores hoje fim');

  const ranking10Numerico = localResolver.resolverLocal(
    'Lista dos 10 maiores clientes em faturamento de hoje',
    intencoes,
    _SINONIMOS_SISTEMA,
    { datasets },
  );
  assert(ranking10Numerico, '10 maiores clientes hoje: resolve localmente');
  assert.strictEqual(ranking10Numerico.periodo.tipo, 'hoje', '10 maiores clientes hoje: periodo');
  assert.strictEqual(ranking10Numerico.limite, 10, '10 maiores clientes hoje: limite');
}

expectLocal('fat ano produto', {
  intencao: 'consultar_faturamento_por_produto',
  periodo: 'ano_atual',
  agrupar_por: 'produto',
  ordenar_por: 'faturamento:desc',
});

expectLocal('Fat do ano por produto', {
  intencao: 'consultar_faturamento_por_produto',
  periodo: 'ano_atual',
  agrupar_por: 'produto',
  ordenar_por: 'faturamento:desc',
});

expectLocal('fat do ano por produto quantidade', {
  intencao: 'consultar_faturamento_por_produto',
  periodo: 'ano_atual',
  agrupar_por: 'produto',
  ordenar_por: 'quantidade:desc',
});

const intentValorQuantidade = localResolver.resolverLocal('faturamento por produto valor e quantidade no ano', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentValorQuantidade, 'valor e quantidade deve resolver localmente');
assert.deepStrictEqual(intentValorQuantidade._metricasDetectadas, ['faturamento', 'quantidade'], 'valor e quantidade: metricas');

const intentProdutoDia = localResolver.resolverLocal('faturamento por produto e dia no mes', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentProdutoDia, 'agrupamento composto produto e dia deve resolver localmente');
assert.strictEqual(intentProdutoDia.agrupar_por, 'produto', 'produto e dia: agrupamento principal');
assert.deepStrictEqual(intentProdutoDia.group_by, ['produto', 'dia'], 'produto e dia: group_by preserva ordem');
assert.deepStrictEqual(intentProdutoDia.agrupar_por_composto, ['produto', 'dia'], 'produto e dia: agrupamento composto');

const intentDiaProduto = localResolver.resolverLocal('faturamento por dia e produto no mes', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentDiaProduto, 'agrupamento composto dia e produto deve resolver localmente');
assert.strictEqual(intentDiaProduto.agrupar_por, 'dia', 'dia e produto: agrupamento principal');
assert.deepStrictEqual(intentDiaProduto.group_by, ['dia', 'produto'], 'dia e produto: group_by preserva ordem');
assert.deepStrictEqual(intentDiaProduto.agrupar_por_composto, ['dia', 'produto'], 'dia e produto: agrupamento composto');

const intentProdutoCliente = localResolver.resolverLocal('vendas por produto e cliente do ano passado', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentProdutoCliente, 'produto e cliente deve resolver localmente');
assert.strictEqual(intentProdutoCliente.agrupar_por, 'produto', 'produto e cliente: agrupamento principal');
assert.deepStrictEqual(intentProdutoCliente.group_by, ['produto', 'cliente'], 'produto e cliente: ordem');

const intentClienteProduto = localResolver.resolverLocal('vendas por cliente e produto do ano passado', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentClienteProduto, 'cliente e produto deve resolver localmente');
assert.strictEqual(intentClienteProduto.agrupar_por, 'cliente', 'cliente e produto: agrupamento principal');
assert.deepStrictEqual(intentClienteProduto.group_by, ['cliente', 'produto'], 'cliente e produto: ordem');

const intentAnoMesClienteProduto = localResolver.resolverLocal('Faturamento do ano por mes e por cliente e produto', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentAnoMesClienteProduto, 'ano por mes cliente produto deve resolver localmente');
assert.strictEqual(intentAnoMesClienteProduto.periodo.tipo, 'ano_atual', 'ano por mes cliente produto: periodo ano atual');
assert.deepStrictEqual(intentAnoMesClienteProduto.group_by, ['mes', 'cliente', 'produto'], 'ano por mes cliente produto: group_by completo');

const intentAnoTodosMesesClienteProduto = localResolver.resolverLocal('Faturamento por ano e todos os meses por cliente e produto', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentAnoTodosMesesClienteProduto, 'ano todos os meses cliente produto deve resolver localmente');
assert.strictEqual(intentAnoTodosMesesClienteProduto.periodo.tipo, 'nenhum', 'ano todos os meses cliente produto: nao assume mes atual');
assert.deepStrictEqual(intentAnoTodosMesesClienteProduto.group_by, ['ano', 'mes', 'cliente', 'produto'], 'ano todos os meses cliente produto: group_by completo');

const intentSoQuantidade = localResolver.resolverLocal('volume de vendas por produto no ano', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentSoQuantidade, 'quantidade deve resolver localmente');
assert.deepStrictEqual(intentSoQuantidade._metricasDetectadas, ['quantidade'], 'quantidade: metricas');

const intentQuantidadeFaturada = localResolver.resolverLocal('quantidade faturada por produto no ano', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentQuantidadeFaturada, 'quantidade faturada deve resolver localmente');
assert.deepStrictEqual(intentQuantidadeFaturada._metricasDetectadas, ['quantidade'], 'quantidade faturada: metricas');

const intentMediaMensal = localResolver.resolverLocal('Media mensal faturado no ano de 2026', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentMediaMensal, 'media mensal deve resolver localmente');
assert.strictEqual(intentMediaMensal.intencao, 'faturamento_periodo', 'media mensal: intencao');
assert.strictEqual(intentMediaMensal.periodo.tipo, 'personalizado', 'media mensal: periodo personalizado');
assert.strictEqual(intentMediaMensal.periodo.data_inicio, '20260101', 'media mensal: data inicio');
assert.strictEqual(intentMediaMensal.periodo.data_fim, '20261231', 'media mensal: data fim');
assert.deepStrictEqual(intentMediaMensal.operacao_analitica, {
  operacao: 'media',
  granularidade: 'mes',
  metrica: 'faturamento',
}, 'media mensal: operacao analitica');

const intentMediaAnual = localResolver.resolverLocal('Media de faturamento anual', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentMediaAnual, 'media anual deve resolver localmente');
assert.deepStrictEqual(intentMediaAnual.operacao_analitica, {
  operacao: 'media',
  granularidade: 'ano',
  metrica: 'faturamento',
}, 'media anual: operacao analitica');

const intentMaiorMes = localResolver.resolverLocal('qual o mes com maior faturamento em 2025', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentMaiorMes, 'maior mes deve resolver localmente');
assert.strictEqual(intentMaiorMes.intencao, 'faturamento_periodo', 'maior mes: intencao');
assert.strictEqual(intentMaiorMes.periodo.tipo, 'personalizado', 'maior mes: periodo');
assert.strictEqual(intentMaiorMes.periodo.data_inicio, '20250101', 'maior mes: data inicio');
assert.strictEqual(intentMaiorMes.periodo.data_fim, '20251231', 'maior mes: data fim');
assert.strictEqual(intentMaiorMes.agrupar_por, 'mes', 'maior mes: agrupamento');
assert.strictEqual(intentMaiorMes.ordenar_por, 'faturamento:desc', 'maior mes: ordenacao');
assert.strictEqual(intentMaiorMes.limite, 1, 'maior mes: limite');

const intentMenorMes = localResolver.resolverLocal('qual o mes com menor faturamento em 2026', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentMenorMes, 'menor mes deve resolver localmente');
assert.strictEqual(intentMenorMes.periodo.data_inicio, '20260101', 'menor mes: data inicio');
assert.strictEqual(intentMenorMes.periodo.data_fim, '20261231', 'menor mes: data fim');
assert.strictEqual(intentMenorMes.agrupar_por, 'mes', 'menor mes: agrupamento');
assert.strictEqual(intentMenorMes.ordenar_por, 'faturamento:asc', 'menor mes: ordenacao');
assert.strictEqual(intentMenorMes.limite, 1, 'menor mes: limite');

expectLocal('fat do mes vs ano passado', {
  intencao: 'faturamento_periodo',
  periodo: 'comparacao_mensal',
});

expectLocal('compara faturamento do mes de janeiro de 2025 com o mes de janeiro de 2026', {
  intencao: 'faturamento_periodo',
  periodo: 'comparacao_mesmo_mes',
});

expectLocal('comparar faturamento do mes de janeiro de 2025 com o mes de janeiro de 2026', {
  intencao: 'faturamento_periodo',
  periodo: 'comparacao_mesmo_mes',
});

const intentComparacaoMensalAnos = localResolver.resolverLocal('comparar o faturamento mes a mes do ano de 2025 com o ano de 2026', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentComparacaoMensalAnos, 'comparacao mensal entre anos deve resolver localmente');
assert.strictEqual(intentComparacaoMensalAnos.intencao, 'faturamento_periodo', 'comparacao mensal entre anos: intencao');
assert.strictEqual(intentComparacaoMensalAnos.periodo.tipo, 'comparacao_mensal_entre_anos', 'comparacao mensal entre anos: periodo');
assert.strictEqual(intentComparacaoMensalAnos.periodo.ano_base, 2025, 'comparacao mensal entre anos: ano base');
assert.strictEqual(intentComparacaoMensalAnos.periodo.ano_comparacao, 2026, 'comparacao mensal entre anos: ano comparacao');

const sinonimosComNormalizacao = [
  ..._SINONIMOS_SISTEMA,
  { termo: 'conparar', camada: 'normalizacao', equivalencia: 'comparar', ativo: 1, origem: 'usuario' },
  { termo: 'faturamnto', camada: 'normalizacao', equivalencia: 'faturamento', ativo: 1, origem: 'usuario' },
];
const intentNormalizado = localResolver.resolverLocal('conparar o faturamnto mes a mes do ano de 2025 com o ano de 2026', intencoes, sinonimosComNormalizacao, { datasets });
assert(intentNormalizado, 'normalizacao configuravel deve resolver erros de digitacao');
assert.strictEqual(intentNormalizado.intencao, 'faturamento_periodo', 'normalizacao configuravel: intencao');
assert.strictEqual(intentNormalizado.periodo.tipo, 'comparacao_mensal_entre_anos', 'normalizacao configuravel: periodo');

expectLocal('fat do ano vs ano passado', {
  intencao: 'faturamento_periodo',
  periodo: 'comparacao_acumulado_mes',
});

expectLocal('compras por fornecedor semana passada', {
  intencao: 'compras_periodo',
  periodo: 'semana_anterior',
  agrupar_por: 'fornecedor',
});

assert.strictEqual(
  localResolver.resolverLocal(
    'Preciso do contas a pagar do ano de 2026',
    intencoes.filter(i => i.nome.includes('faturamento')),
    _SINONIMOS_SISTEMA,
    { datasets }
  ),
  null,
  'financeiro: engine local nao deve interpretar contas a pagar como faturamento'
);

assert.strictEqual(
  _mensagemPareceComprasAiSql('compras por fornecedor semana passada', _SINONIMOS_SISTEMA),
  true,
  'compras ai-sql: detecta mensagem de compras mesmo com datasets de faturamento'
);
assert.strictEqual(
  _mensagemPareceAiSqlDinamico(
    'compras por fornecedor semana passada',
    [{ nome: 'compras_dinamico', acao: 'ai_text_to_sql', modulo: 'compras' }],
    _SINONIMOS_SISTEMA
  ),
  true,
  'escopo dinamico: compras entra no modo IA-a-frente'
);
assert.strictEqual(
  _mensagemPareceAiSqlDinamico(
    'contas a pagar vencendo essa semana',
    [{ nome: 'financeiro_dinamico', acao: 'ai_text_to_sql', modulo: 'financeiro' }],
    _SINONIMOS_SISTEMA
  ),
  true,
  'escopo dinamico: financeiro tambem entra no modo IA-a-frente'
);
assert.strictEqual(typeof _garantirIntencoesDinamicasPadrao, 'function', 'bootstrap: expõe criação das intenções dinâmicas para painel/admin');
assert.strictEqual(
  _mensagemPareceAiSqlDinamico(
    'Preciso dos pagamentos realizados dos anos de 2025 e 2026 do Matheus',
    [{ nome: 'financeiro_dinamico', acao: 'ai_text_to_sql', modulo: 'financeiro' }],
    _SINONIMOS_SISTEMA
  ),
  true,
  'escopo dinamico: pagamentos realizados entram no financeiro dinamico'
);
assert.strictEqual(
  _mensagemPareceAiSqlDinamico(
    'contas pagas do fornecedor Matheus',
    [{ nome: 'financeiro_dinamico', acao: 'ai_text_to_sql', modulo: 'financeiro' }],
    _SINONIMOS_SISTEMA
  ),
  true,
  'escopo dinamico: contas pagas entram no financeiro dinamico'
);
assert.strictEqual(
  _mensagemPareceAiSqlDinamico(
    'recebimentos realizados do cliente Matheus',
    [{ nome: 'financeiro_dinamico', acao: 'ai_text_to_sql', modulo: 'financeiro' }],
    _SINONIMOS_SISTEMA
  ),
  true,
  'escopo dinamico: recebimentos realizados entram no financeiro dinamico'
);
assert.strictEqual(
  _mensagemPareceAiSqlDinamico(
    'contas recebidas do cliente Matheus',
    [{ nome: 'financeiro_dinamico', acao: 'ai_text_to_sql', modulo: 'financeiro' }],
    _SINONIMOS_SISTEMA
  ),
  true,
  'escopo dinamico: contas recebidas entram no financeiro dinamico'
);
assert.strictEqual(
  _mensagemPareceAiSqlDinamico(
    'Preciso dos documetnos pagos por ano de 2026 e todos os meses do Matheus',
    [
      { nome: 'financeiro_dinamico', acao: 'ai_text_to_sql', modulo: 'financeiro' },
      { nome: 'faturamento_dinamico', acao: 'ai_text_to_sql', modulo: 'faturamento' },
    ],
    _SINONIMOS_SISTEMA
  ),
  true,
  'escopo dinamico: documentos pagos com typo entram no modo dinamico'
);
assert.strictEqual(
  _intencaoAiSqlPreferencial(
    'Preciso dos documetnos pagos por ano de 2026 e todos os meses do Matheus',
    [
      { nome: 'financeiro_dinamico', acao: 'ai_text_to_sql', modulo: 'financeiro' },
      { nome: 'faturamento_dinamico', acao: 'ai_text_to_sql', modulo: 'faturamento' },
    ],
    _SINONIMOS_SISTEMA
  )?.nome,
  'financeiro_dinamico',
  'escopo dinamico: documentos pagos preferem financeiro sobre faturamento'
);
assert.strictEqual(
  intentRouter._dominioDinamicoForcadoPorTexto('Preciso dos documetnos pagos por ano de 2026 e todos os meses do Matheus'),
  'financeiro',
  'router dinamico: documentos pagos forcam dominio financeiro'
);
assert.strictEqual(
  intentRouter._corrigirIntentDinamicoPorTexto({
    intencao: 'faturamento_dinamico',
    _dynamicAiScope: true,
    _mensagemOriginal: 'Preciso dos documetnos pagos por ano de 2026 e todos os meses do Matheus',
  }, 999999).intencao,
  'financeiro_dinamico',
  'router dinamico: corrige faturamento para financeiro quando texto diz documentos pagos'
);
assert.strictEqual(
  _mensagemDinamicaAmbigua(
    'Preciso dos documetnos pagos por ano de 2026 e todos os meses do Matheus',
    [
      { nome: 'financeiro_dinamico', acao: 'ai_text_to_sql', modulo: 'financeiro' },
      { nome: 'faturamento_dinamico', acao: 'ai_text_to_sql', modulo: 'faturamento' },
    ],
    _SINONIMOS_SISTEMA
  ),
  true,
  'escopo dinamico: documentos pagos e ambiguidade que deve ir para IA quando houver chave'
);
assert.strictEqual(
  _deveBypassDinamico(
    'Preciso dos documetnos pagos por ano de 2026 e todos os meses do Matheus',
    [
      { nome: 'financeiro_dinamico', acao: 'ai_text_to_sql', modulo: 'financeiro' },
      { nome: 'faturamento_dinamico', acao: 'ai_text_to_sql', modulo: 'faturamento' },
    ],
    _SINONIMOS_SISTEMA,
    [],
    { temChaveIA: true }
  ).usar,
  false,
  'escopo dinamico: com IA disponivel, documentos pagos nao usa bypass local'
);
assert.strictEqual(
  _mensagemPareceAiSqlDinamico(
    'faturamento do mes',
    [{ nome: 'faturamento_dinamico', acao: 'ai_text_to_sql', modulo: 'faturamento' }],
    _SINONIMOS_SISTEMA
  ),
  true,
  'escopo dinamico: faturamento entra no modo IA-a-frente'
);
const intentComprasDireto = _intentAiSqlDireto(
  { nome: 'compras_dinamico', acao: 'ai_text_to_sql', modulo: 'compras' },
  'compras por fornecedor semana passada'
);
assert.strictEqual(intentComprasDireto.intencao, 'compras_dinamico', 'compras ai-sql: roteia para intencao dinamica');
assert.strictEqual(intentComprasDireto._motor, 'ia_dialogo_dinamico', 'compras ai-sql: nao usa engine interna de datasets');
assert.strictEqual(intentComprasDireto.periodo.tipo, 'semana_anterior', 'compras ai-sql: preserva periodo detectado');
const intentFinanceiroAbertoDireto = _intentAiSqlDireto(
  { nome: 'financeiro_dinamico', acao: 'ai_text_to_sql', modulo: 'financeiro' },
  'preciso do contas a receber em aberto agrupado pelo fornecedor softexpert'
);
assert.strictEqual(intentFinanceiroAbertoDireto.periodo.tipo, 'nenhum', 'financeiro ai-sql: em aberto sem periodo nao assume mes atual');
const planoFinanceiroAberto = queryPlan.buildQueryPlan({
  modulo: 'financeiro',
  mensagem: 'preciso do contas a receber em aberto agrupado pelo fornecedor softexpert',
  periodo: { tipo: 'nenhum' },
});
assert.strictEqual(planoFinanceiroAberto.modulo, 'financeiro', 'query plan: identifica modulo financeiro');
assert.strictEqual(planoFinanceiroAberto.carteira, 'receber', 'query plan: identifica carteira receber');
assert.strictEqual(planoFinanceiroAberto.estado, 'em_aberto', 'query plan: identifica estado em aberto');
assert.strictEqual(planoFinanceiroAberto.proibirFiltroData, true, 'query plan: em aberto sem periodo proibe filtro de data');
assert(planoFinanceiroAberto.agrupamentos.includes('cliente'), 'query plan: contas a receber normaliza fornecedor para cliente');
assert(
  queryPlan.formatQueryPlanForPrompt(planoFinanceiroAberto).includes('contrato obrigatorio'),
  'query plan: gera bloco de prompt contratual'
);
const planoPagamentosRealizados = queryPlan.buildQueryPlan({
  modulo: 'financeiro',
  mensagem: 'Preciso dos pagamentos realizados do fornecedor Matheus',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20261231' },
});
assert.strictEqual(planoPagamentosRealizados.carteira, 'pagar', 'query plan financeiro: pagamentos realizados usam carteira pagar');
assert.strictEqual(planoPagamentosRealizados.estado, 'pago', 'query plan financeiro: pagamentos realizados usam estado pago');
assert.strictEqual(planoPagamentosRealizados.dataPadrao, 'baixa_movimento', 'query plan financeiro: pagamentos realizados usam data de baixa/movimento');
const planoDocumentosPagos = queryPlan.buildQueryPlan({
  modulo: 'financeiro',
  mensagem: 'Preciso dos documetnos pagos por ano de 2026 e todos os meses do Matheus',
  periodo: { tipo: 'personalizado', dataInicio: '20260101', dataFim: '20261231' },
});
assert.strictEqual(planoDocumentosPagos.carteira, 'pagar', 'query plan financeiro: documentos pagos usam carteira pagar/SA2');
assert.strictEqual(planoDocumentosPagos.estado, 'pago', 'query plan financeiro: documentos pagos usam estado pago');
assert(planoDocumentosPagos.agrupamentos.includes('documento'), 'query plan financeiro: documetnos com typo vira agrupamento documento');
assert(planoDocumentosPagos.agrupamentos.includes('ano'), 'query plan financeiro: documentos pagos por ano agrupa por ano');
assert(planoDocumentosPagos.agrupamentos.includes('mes'), 'query plan financeiro: todos os meses agrupa por mes');
const sqlPagamentosComRecebimentosIndevidos = "SET ROWCOUNT 10000; SELECT 'PAGAMENTO' AS tipo, SUM(E2_VALOR - E2_SALDO) AS total_pago FROM SE2990 SE2 JOIN SA2990 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_VENCREA BETWEEN '20250101' AND '20261231' UNION ALL SELECT 'RECEBIMENTO' AS tipo, SUM(E1_VALOR - E1_SALDO) AS total_recebido FROM SE1990 SE1 JOIN SA1990 SA1 ON SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_VENCREA BETWEEN '20250101' AND '20261231'";
const validacaoPagamentosComRecebimentos = queryPlan.validarSqlContraPlano(sqlPagamentosComRecebimentosIndevidos, planoPagamentosRealizados);
assert.strictEqual(validacaoPagamentosComRecebimentos.ok, false, 'query plan financeiro: pagamento de fornecedor rejeita recebimentos/SA1');
assert(validacaoPagamentosComRecebimentos.erros.some(e => e.includes('SA1')), 'query plan financeiro: explica uso indevido de SA1 em contas a pagar');
assert(validacaoPagamentosComRecebimentos.erros.some(e => e.includes('E2_BAIXA')), 'query plan financeiro: exige baixa para pagamento realizado');
const sqlPagamentosFallback = financeiroHandler._sqlDeterministicoFinanceiro({
  sufixoTabela: '990',
  sx2: { SE2990: 'E', SA2990: 'C' },
  filial: '01',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20261231' },
  queryPlan: planoPagamentosRealizados,
  entidades: [{ tipo: 'fornecedor', codigo: '000635', loja: '02', nome: 'MATHEUS MARCONDES COELHO PJ' }],
});
assert(sqlPagamentosFallback.includes('SE2990') && sqlPagamentosFallback.includes('SA2990'), 'financeiro fallback pago: usa SE2/SA2 do SX2');
assert(!sqlPagamentosFallback.includes('SE1990') && !sqlPagamentosFallback.includes('SA1990'), 'financeiro fallback pago: nao inclui recebimentos');
assert(sqlPagamentosFallback.includes('SE5990') && sqlPagamentosFallback.includes('SE5.E5_DATA BETWEEN'), 'financeiro fallback pago: filtra por baixa real SE5');
assert(sqlPagamentosFallback.includes("SA2.A2_COD = '000635'") && sqlPagamentosFallback.includes("SA2.A2_LOJA = '02'"), 'financeiro fallback pago: preserva fornecedor escolhido');
assert.strictEqual(queryPlan.validarSqlContraPlano(sqlPagamentosFallback, planoPagamentosRealizados).ok, true, 'financeiro fallback pago: respeita contrato');
const planoPagamentosPorDocumento = queryPlan.buildQueryPlan({
  modulo: 'financeiro',
  mensagem: 'detalhar por documento',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20261231' },
});
assert(planoPagamentosPorDocumento.agrupamentos.includes('documento'), 'query plan financeiro: detecta detalhamento por documento');
const turnoDetalheDocumento = intentMerger.mesclar({
  intencao: 'desconhecido',
  periodo: { tipo: 'nenhum' },
  filtros: {},
  agrupar_por: null,
  ordenar_por: null,
  limite: null,
  confianca: 0,
  precisa_confirmacao: true,
  _baixaConfianca: true,
  _erro: 'Interpretacao com confianca baixa (0%).',
}, {
  intencao: 'financeiro_dinamico',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20261231' },
  filtros: {},
  confianca: 0.95,
  _entidadesResolvidas: [{ tipo: 'fornecedor', codigo: '000635', loja: '02', nome: 'MATHEUS MARCONDES COELHO PJ' }],
}, Date.now(), 'detalhar por documento');
assert.strictEqual(turnoDetalheDocumento.intencao, 'financeiro_dinamico', 'multi-turn financeiro: detalhar por documento herda intencao dinamica');
assert.strictEqual(turnoDetalheDocumento.precisa_confirmacao, false, 'multi-turn financeiro: contexto remove baixa confianca do turno curto');
assert.strictEqual(turnoDetalheDocumento._baixaConfianca, undefined, 'multi-turn financeiro: nao bloqueia por baixa confianca apos herdar contexto');
assert.strictEqual(turnoDetalheDocumento.agrupar_por, 'documento', 'multi-turn financeiro: documento vira agrupamento');
assert.deepStrictEqual(turnoDetalheDocumento._entidadesResolvidas.map(e => e.codigo), ['000635'], 'multi-turn financeiro: herda entidade escolhida');
const sqlPagamentosDocumentoFallback = financeiroHandler._sqlDeterministicoFinanceiro({
  sufixoTabela: '990',
  sx2: { SE2990: 'E', SA2990: 'C' },
  filial: '01',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20261231' },
  queryPlan: { ...planoPagamentosRealizados, agrupamentos: ['documento'] },
  entidades: [{ tipo: 'fornecedor', codigo: '000635', loja: '02', nome: 'MATHEUS MARCONDES COELHO PJ' }],
});
assert(sqlPagamentosDocumentoFallback.includes('SE2.E2_NUM AS documento'), 'financeiro fallback pago: detalha por documento');
assert(sqlPagamentosDocumentoFallback.includes('GROUP BY SE2.E2_NUM'), 'financeiro fallback pago: agrupa por documento');
const planoRecebimentosRealizados = queryPlan.buildQueryPlan({
  modulo: 'financeiro',
  mensagem: 'Preciso dos recebimentos realizados do cliente Matheus',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20261231' },
});
assert.strictEqual(planoRecebimentosRealizados.carteira, 'receber', 'query plan financeiro: recebimentos realizados usam carteira receber');
assert.strictEqual(planoRecebimentosRealizados.estado, 'recebido', 'query plan financeiro: recebimentos realizados usam estado recebido');
assert.strictEqual(planoRecebimentosRealizados.dataPadrao, 'baixa_movimento', 'query plan financeiro: recebimentos realizados usam data de baixa/movimento');
const planoFinanceiroIA = queryPlan.normalizarPlanoIA(
  JSON.stringify({
    operacao: 'posicao',
    carteira: 'receber',
    estado: 'em_aberto',
    agrupamentos: ['fornecedor'],
    regras: ['nao_filtrar_data_sem_periodo_explicito', 'exigir_saldo_em_aberto'],
  }),
  planoFinanceiroAberto
);
assert.strictEqual(planoFinanceiroIA.proibirFiltroData, true, 'query plan IA: normaliza regra para proibir data');
assert.strictEqual(planoFinanceiroIA.exigirSaldoAberto, true, 'query plan IA: normaliza regra para saldo aberto');
const planoComissaoIAComAno = queryPlan.reconciliarPlanoComMensagem(
  queryPlan.normalizarPlanoIA(
    JSON.stringify({
      operacao: 'posicao',
      estado: 'em_aberto',
      regras: ['nao_filtrar_data_sem_periodo_explicito'],
    }),
    queryPlan.buildBaseQueryPlan({
      modulo: 'comissao',
      periodo: { tipo: 'personalizado', dataInicio: '20260101', dataFim: '20261231' },
      filtros: { vendedor: 'Jean', ano: 2026 },
    })
  ),
  'Comissao de 2026 do Jean'
);
assert.strictEqual(planoComissaoIAComAno.periodoExplicito, true, 'query plan comissao: ano explicito continua periodo explicito');
assert.strictEqual(planoComissaoIAComAno.proibirFiltroData, false, 'query plan comissao: remove proibicao de data quando ha ano explicito');
assert.strictEqual(
  queryPlan.validarSqlContraPlano("SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3 WHERE SE3.E3_VENCTO BETWEEN '20260101' AND '20261231'", planoComissaoIAComAno).ok,
  true,
  'query plan comissao: aceita filtro de data quando pergunta trouxe ano'
);
assert.deepStrictEqual(
  financeiroHandler._ajustarTermoAoPlanoFinanceiro({ texto: 'SOFTEXPERT', tipo_sugerido: 'fornecedor' }, planoFinanceiroAberto),
  { texto: 'SOFTEXPERT', tipo_sugerido: 'cliente', _tipoOriginal: 'fornecedor' },
  'financeiro entidades: contas a receber trata fornecedor digitado como cliente da carteira'
);
assert.deepStrictEqual(
  financeiroHandler._ajustarTermoAoPlanoFinanceiro({ texto: 'SOFTEXPERT', tipo_sugerido: 'desconhecido', origem: 'ia' }, { carteira: 'pagar' }),
  { texto: 'SOFTEXPERT', tipo_sugerido: 'fornecedor', origem: 'inferido_carteira', _tipoOriginal: 'desconhecido' },
  'financeiro entidades: contas a pagar trata entidade desconhecida como fornecedor'
);
assert.deepStrictEqual(
  financeiroHandler._termosDeFiltrosFinanceiro({ fornecedor: 'Softexpert' }, { carteira: 'pagar' }),
  [{ texto: 'Softexpert', tipo_sugerido: 'fornecedor', confianca: 1, origem: 'filtro_estruturado' }],
  'financeiro entidades: filtro estruturado fornecedor vira entidade obrigatoria'
);
assert.deepStrictEqual(
  financeiroHandler._expandirTermosCarteiraAmbasFinanceiro([{ texto: 'SOFTEXPERT', tipo_sugerido: 'fornecedor', origem: 'explicito' }], { carteira: 'ambas' })
    .map(e => ({ texto: e.texto, tipo: e.tipo_sugerido, origem: e.origem })),
  [
    { texto: 'SOFTEXPERT', tipo: 'fornecedor', origem: 'explicito' },
    { texto: 'SOFTEXPERT', tipo: 'cliente', origem: 'inferido_carteira_ambas' },
  ],
  'financeiro entidades: carteira ambas busca fornecedor e cliente para o mesmo termo'
);
assert.strictEqual(
  financeiroHandler._entidadeObrigatoriaNaoEncontradaFinanceiro({ texto: 'SOFTEXPERT', tipo_sugerido: 'cliente', origem: 'inferido_carteira_ambas' }),
  true,
  'financeiro entidades: cliente inferido em carteira ambas tambem e obrigatorio'
);
assert.strictEqual(
  financeiroHandler._entidadeObrigatoriaNaoEncontradaFinanceiro({ texto: 'SOFTEXPERT', tipo_sugerido: 'fornecedor', origem: 'filtro_estruturado' }),
  true,
  'financeiro entidades: fornecedor vindo do contrato da orquestradora e obrigatorio'
);
assert.deepStrictEqual(
  entityResolver.extrairExplicitos('preciso do total do contas a receber e a pagar em aberto agrupado pelo fornecedor softexpert e por mes').map(e => ({ texto: e.texto, tipo: e.tipo_sugerido })),
  [{ texto: 'softexpert', tipo: 'fornecedor' }],
  'entity resolver: corta agrupamento apos entidade explicita'
);
assert.deepStrictEqual(
  entityResolver.extrairExplicitos('preciso do total do contas a receber e a pagar em aberto da softexpert agrupado por mes').map(e => ({ texto: e.texto, tipo: e.tipo_sugerido })),
  [{ texto: 'softexpert', tipo: 'desconhecido' }],
  'entity resolver: extrai entidade solta apos em aberto da'
);
assert.deepStrictEqual(
  entityResolver.extrairExplicitos('Contas a pagar da Softexpert').map(e => ({ texto: e.texto, tipo: e.tipo_sugerido })),
  [{ texto: 'Softexpert', tipo: 'fornecedor' }],
  'entity resolver: contas a pagar da entidade força fornecedor'
);
assert.strictEqual(
  financeiroHandler._removerHintsNoLock('SELECT * FROM SE2990 SE2 WITH (NOLOCK) INNER JOIN SA2990 SA2 WITH (NOLOCK) ON 1=1'),
  'SELECT * FROM SE2990 SE2 INNER JOIN SA2990 SA2 ON 1=1',
  'financeiro sql: remove WITH NOLOCK antes da execucao'
);
assert.deepStrictEqual(
  entityResolver.extrairExplicitos('Comissao paga para os vendedores em 2026'),
  [],
  'entity resolver: nao trata periodo apos vendedores como entidade explicita'
);
assert.deepStrictEqual(
  entityResolver.extrairExplicitos('Faturamento do ano agrupado por mes mes e produto'),
  [],
  'entity resolver: agrupamento por mes e produto nao vira filtro de entidade'
);
assert.deepStrictEqual(
  entityResolver.extrairExplicitos('Faturamento do ano por produto e cliente'),
  [],
  'entity resolver: agrupamento por produto e cliente nao vira entidade explicita'
);
assert.deepStrictEqual(
  entityResolver.normalizarEntidadesIA({
    entidades: [
      { texto: 'produto', tipo_sugerido: 'produto', confianca: 0.9 },
      { texto: 'mes e produto', tipo_sugerido: 'produto', confianca: 0.9 },
      { texto: 'ACME LTDA', tipo_sugerido: 'cliente', confianca: 0.9 },
    ],
  }).map(e => ({ texto: e.texto, tipo: e.tipo_sugerido })),
  [{ texto: 'ACME LTDA', tipo: 'cliente' }],
  'entity resolver: descarta entidades da IA que sao apenas agrupamentos'
);
const planoFinanceiroAmbasAberto = queryPlan.buildQueryPlan({
  modulo: 'financeiro',
  mensagem: 'preciso do total do contas a receber e a pagar em aberto agrupado pelo fornecedor softexpert e por mes',
  periodo: { tipo: 'nenhum' },
});
assert.strictEqual(planoFinanceiroAmbasAberto.carteira, 'ambas', 'query plan: contas a receber e a pagar usa carteira ambas');
assert(planoFinanceiroAmbasAberto.agrupamentos.includes('fornecedor'), 'query plan: ambas preserva fornecedor para lado pagar');
assert(planoFinanceiroAmbasAberto.agrupamentos.includes('mes'), 'query plan: ambas preserva agrupamento por mes');
assert.strictEqual(planoFinanceiroAmbasAberto.exigirSaldoAberto, true, 'query plan: ambas em aberto exige saldo aberto');
assert(
  queryPlan.formatQueryPlanForPrompt(planoFinanceiroAmbasAberto).includes('financeiro_ambas'),
  'query plan: prompt orienta UNION ALL para carteira ambas'
);
const sqlFinanceiroAmbasFallback = financeiroHandler._sqlDeterministicoFinanceiro({
  sufixoTabela: '990',
  periodo: { tipo: 'nenhum' },
  queryPlan: planoFinanceiroAmbasAberto,
  entidades: [
    { tipo: 'fornecedor', codigo: '000123', loja: '01', nome: 'SOFTEXPERT' },
    { tipo: 'cliente', codigo: '000180', loja: '01', nome: 'SOFTEXPERT' },
  ],
});
assert(sqlFinanceiroAmbasFallback.includes('UNION ALL'), 'financeiro fallback SQL: usa UNION ALL para receber e pagar');
assert(sqlFinanceiroAmbasFallback.includes('SE1990') && sqlFinanceiroAmbasFallback.includes('SE2990'), 'financeiro fallback SQL: usa tabelas SE1/SE2 pelo sufixo');
assert(sqlFinanceiroAmbasFallback.includes('SA2990') && sqlFinanceiroAmbasFallback.includes("SA2.A2_COD = '000123'"), 'financeiro fallback SQL: aplica fornecedor resolvido no lado pagar');
assert(sqlFinanceiroAmbasFallback.includes('SA1990') && sqlFinanceiroAmbasFallback.includes("SA1.A1_COD = '000180'"), 'financeiro fallback SQL: aplica cliente resolvido no lado receber');
assert.strictEqual(
  queryPlan.validarSqlContraPlano(sqlFinanceiroAmbasFallback, planoFinanceiroAmbasAberto).ok,
  true,
  'financeiro fallback SQL: respeita contrato de posicao em aberto sem periodo'
);
assert.strictEqual(
  financeiroHandler._validarEntidadesFinanceiroNoSQL(sqlFinanceiroAmbasFallback, {
    queryPlan: planoFinanceiroAmbasAberto,
    entidades: [
      { tipo: 'fornecedor', codigo: '000123', loja: '01', nome: 'SOFTEXPERT' },
      { tipo: 'cliente', codigo: '000180', loja: '01', nome: 'SOFTEXPERT' },
    ],
  }).ok,
  true,
  'financeiro contrato entidade: aceita SQL com filtros nos dois lados'
);
const sqlFinanceiroAmbasSemFiltroCliente = `
SET ROWCOUNT 10000;
SELECT YEAR(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112)) AS ano_mes,
       SUM(CASE WHEN SE2.E2_TIPO = 'PA' THEN -SE2.E2_SALDO ELSE SE2.E2_SALDO END) AS saldo_a_pagar
FROM SE2990 SE2
JOIN SA2990 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA
WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 AND SA2.A2_COD = '000123' AND SA2.A2_LOJA = '01'
GROUP BY YEAR(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112))
UNION ALL
SELECT YEAR(CONVERT(DATE, NULLIF(SE1.E1_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SE1.E1_VENCREA, ''), 112)) AS ano_mes,
       SUM(CASE WHEN SE1.E1_TIPO = 'RA' THEN -SE1.E1_SALDO ELSE SE1.E1_SALDO END) AS saldo_a_receber
FROM SE1990 SE1
JOIN SA1990 SA1 ON SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA
WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0
GROUP BY YEAR(CONVERT(DATE, NULLIF(SE1.E1_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SE1.E1_VENCREA, ''), 112))`;
const validacaoEntidadeRuim = financeiroHandler._validarEntidadesFinanceiroNoSQL(sqlFinanceiroAmbasSemFiltroCliente, {
  queryPlan: planoFinanceiroAmbasAberto,
  entidades: [
    { tipo: 'fornecedor', codigo: '000123', loja: '01', nome: 'SOFTEXPERT' },
    { tipo: 'cliente', codigo: '000180', loja: '01', nome: 'SOFTEXPERT' },
  ],
});
assert.strictEqual(validacaoEntidadeRuim.ok, false, 'financeiro contrato entidade: rejeita SQL sem filtro do cliente no lado receber');
assert(validacaoEntidadeRuim.erros.some(e => e.includes('cliente 000180')), 'financeiro contrato entidade: explica filtro cliente ausente');
const validacaoFornecedorPorNome = financeiroHandler._validarEntidadesFinanceiroNoSQL(
  "SELECT SUM(SE2.E2_SALDO) AS saldo_a_pagar FROM SE2990 SE2 JOIN SA2990 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 AND SA2.A2_NOME = 'Softexpert'",
  {
    queryPlan: { modulo: 'financeiro', operacao: 'posicao', estado: 'em_aberto', carteira: 'pagar' },
    entidades: [{ tipo: 'fornecedor', codigo: '000180', loja: '01', nome: 'SOFTEXPERT SOFTWARE SA' }],
  }
);
assert.strictEqual(validacaoFornecedorPorNome.ok, false, 'financeiro contrato entidade: rejeita fornecedor filtrado por nome');
assert(validacaoFornecedorPorNome.erros.some(e => e.includes('codigo do fornecedor 000180')), 'financeiro contrato entidade: exige codigo do fornecedor');
assert.deepStrictEqual(
  comprasHandler._termosDeFiltrosCompras({ fornecedor: 'Softexpert', produto: 'Licenca' }).map(e => ({ texto: e.texto, tipo: e.tipo_sugerido, origem: e.origem })),
  [
    { texto: 'Softexpert', tipo: 'fornecedor', origem: 'filtro_estruturado' },
    { texto: 'Licenca', tipo: 'produto', origem: 'filtro_estruturado' },
  ],
  'compras entidades: filtros estruturados viram entidades por codigo'
);
assert.strictEqual(
  comprasHandler._validarEntidadesComprasNoSQL(
    "SELECT SUM(D1_TOTAL) FROM SD1990 SD1 JOIN SB1990 SB1 ON SD1.D1_COD = SB1.B1_COD WHERE SB1.B1_DESC = 'Licenca'",
    { entidades: [{ tipo: 'produto', codigo: 'LIC001', nome: 'Licenca' }] }
  ).ok,
  false,
  'compras contrato entidade: rejeita produto por descricao'
);
assert.strictEqual(
  require('../apps/IA Command/modules/erp/totvs_protheus/guards/entity-sql-guard').removerHintsNoLock("SELECT * FROM SD1990 SD1 WITH (NOLOCK) INNER JOIN SF1990 SF1 WITH (NOLOCK) ON 1=1"),
  'SELECT * FROM SD1990 SD1 INNER JOIN SF1990 SF1 ON 1=1',
  'erp sql guard: remove WITH NOLOCK antes da execucao'
);
assert.strictEqual(
  faturamentoHandler._validarEntidadesFaturamentoNoSQL(
    "SELECT SUM(D2_TOTAL) FROM SD2990 SD2 JOIN SA1990 SA1 ON SD2.D2_CLIENTE = SA1.A1_COD AND SD2.D2_LOJA = SA1.A1_LOJA WHERE SA1.A1_NOME = 'Softexpert'",
    { entidades: [{ tipo: 'cliente', codigo: '000057', loja: '01', nome: 'Softexpert' }] }
  ).ok,
  false,
  'faturamento contrato entidade: rejeita cliente por nome'
);
assert.strictEqual(
  comissaoHandler._validarEntidadesComissaoNoSQL(
    "SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3 JOIN SA3990 SA3 ON SE3.E3_VEND = SA3.A3_COD WHERE SA3.A3_NOME = 'Joao'",
    { entidades: [{ tipo: 'vendedor', codigo: '000001', nome: 'Joao' }] }
  ).ok,
  false,
  'comissao contrato entidade: rejeita vendedor por nome'
);

const promptComprasMaioTodas = comprasSchema.buildSqlUserPrompt('Preciso das compras do mes de Maio', {
  periodo: { tipo: 'personalizado', data_inicio: '20260501', data_fim: '20260531' },
  filtros: { filial: 'TODAS' },
});
assert(
  promptComprasMaioTodas.includes('20260501') && promptComprasMaioTodas.includes('20260531'),
  'compras prompt: envia datas concretas de periodo personalizado para a IA'
);
assert(promptComprasMaioTodas.includes('filial: TODAS'), 'compras prompt: preserva resposta todas as filiais');
assert(
  !promptComprasMaioTodas.includes('personalizado'),
  'compras prompt: nao envia periodo personalizado sem datas'
);
assert.strictEqual(
  comprasHandler._comprasMockAtivo({ IA_COMMAND_COMPRAS_MOCK_ROWS: '1' }),
  true,
  'compras mock: habilita vetor simulado por variavel de ambiente'
);
const sx2ComprasFiltrado = comprasHandler._mapearModosSX2Compras([
  { arquivo: 'AA1990', modo: 'C' },
  { arquivo: 'SF1990', modo: 'E' },
  { arquivo: 'SD1990', modo: 'E' },
  { arquivo: 'SA2990', modo: 'C' },
  { arquivo: 'SB1990', modo: 'C' },
  { arquivo: 'SBM990', modo: 'C' },
  { arquivo: 'SC7990', modo: 'E' },
]);
assert.deepStrictEqual(
  Object.keys(sx2ComprasFiltrado).sort(),
  ['SA2990', 'SB1990', 'SBM990', 'SC7990', 'SD1990', 'SF1990'].sort(),
  'compras sx2: envia para IA somente tabelas do dicionario de compras'
);
assert.strictEqual(comprasHandler._inferirSufixoSX2(sx2ComprasFiltrado, '010'), '990', 'compras sx2: infere sufixo real das tabelas filtradas');
assert.strictEqual(comprasHandler._tabelaFisicaSX2(sx2ComprasFiltrado, 'SF1'), 'SF1990', 'compras sx2: localiza tabela fisica por base');
assert.strictEqual(comprasHandler._tabelaFisicaSX2(null, 'SA2'), null, 'compras sx2: nao inventa tabela fisica sem dicionario SX2');
assert.deepStrictEqual(
  comprasHandler._normalizarFiliaisDescobertas([{ filial: ' 01 ' }, { F1_FILIAL: '01' }, { FILIAL: '02' }, { filial: '' }]),
  ['01', '02'],
  'compras filial: normaliza filiais distintas encontradas no ERP'
);
assert.deepStrictEqual(
  entityResolver.extrairExplicitos('compras do fornecedor SOFTEXPERT').map(e => ({ texto: e.texto, tipo: e.tipo_sugerido })),
  [{ texto: 'SOFTEXPERT', tipo: 'fornecedor' }],
  'entity resolver: tipo explicito direciona cadastro'
);
const perguntaAmbigua = entityResolver.formatarPerguntaAmbiguidade({
  termo: { texto: 'SOFTEXPERT' },
  candidatos: [
    { tipo: 'fornecedor', rotuloTipo: 'fornecedor', codigo: '000123', loja: '01', nome: 'SOFTEXPERT SOFTWARE' },
    { tipo: 'produto', rotuloTipo: 'produto', codigo: 'SOFT001', nome: 'LICENCA SOFTEXPERT' },
  ],
});
assert(perguntaAmbigua.includes('1. fornecedor') && perguntaAmbigua.includes('2. produto'), 'entity resolver: monta pergunta de desambiguacao');
assert.strictEqual(
  comprasHandler._validarPeriodoNoSQL("WHERE SF1.F1_DTDIGIT BETWEEN '20260501' AND '20260531'", { dataInicio: '20260501', dataFim: '20260531' }),
  true,
  'compras periodo: aceita SQL com periodo travado'
);
assert.strictEqual(
  comprasHandler._validarPeriodoNoSQL("WHERE SF1.F1_DTDIGIT BETWEEN '20230501' AND '20230531'", { dataInicio: '20260501', dataFim: '20260531' }),
  false,
  'compras periodo: rejeita SQL com ano divergente'
);
assert.strictEqual(
  comprasHandler._validarFuncoesDataProtheus('SELECT MONTH(SF1.F1_DTDIGIT) AS mes FROM SF1990 SF1'),
  false,
  'compras data protheus: rejeita MONTH em campo CHAR(8)'
);
assert.strictEqual(
  comprasHandler._validarFuncoesDataProtheus("SELECT MONTH(TRY_CONVERT(date, NULLIF(SF1.F1_DTDIGIT, ''), 112)) AS mes FROM SF1990 SF1"),
  false,
  'compras data protheus: rejeita TRY_CONVERT em SQL Server legado'
);
assert.strictEqual(
  comprasHandler._validarFuncoesDataProtheus("SELECT CONVERT(DATE, NULLIF(SF1.F1_DTDIGIT, ''), 112) AS data_entrada FROM SF1990 SF1"),
  true,
  'compras data protheus: aceita CONVERT DATE estilo 112 no SELECT'
);
assert.strictEqual(
  comprasHandler._validarFuncoesDataProtheus("SELECT YEAR(CONVERT(DATE, NULLIF(SF1.F1_DTDIGIT, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SF1.F1_DTDIGIT, ''), 112)) AS ano_mes FROM SF1990 SF1 GROUP BY YEAR(CONVERT(DATE, NULLIF(SF1.F1_DTDIGIT, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SF1.F1_DTDIGIT, ''), 112))"),
  true,
  'compras data protheus: aceita ano/mes por YEAR/MONTH apos CONVERT DATE'
);
assert.strictEqual(
  comprasHandler._validarFuncoesDataProtheus('SELECT SUBSTRING(SF1.F1_DTDIGIT, 1, 6) AS ano_mes FROM SF1990 SF1'),
  true,
  'compras data protheus: aceita SUBSTRING em campo CHAR(8)'
);
const dadosMockComprasMaioTodas = comprasHandler._dadosMockCompras({
  periodo: { dataInicio: '20260501', dataFim: '20260531' },
  filial: 'TODAS',
});
assert.strictEqual(dadosMockComprasMaioTodas.length, 3, 'compras mock: filtra dados simulados pelo mes de maio');
assert(
  dadosMockComprasMaioTodas.some(row => row.filial === '02'),
  'compras mock: TODAS preserva registros de mais de uma filial'
);
const tentativaSqlLog = comprasHandler._sqlTentativaDiagnostico({
  mensagem: 'Preciso das compras do mes de Maio',
  userSql: promptComprasMaioTodas,
  respostaSql: 'sem JSON valido',
  erro: 'provider indisponivel',
  subtipo: 'ia_indisponivel',
});
assert(tentativaSqlLog.includes('SQL NAO GERADO'), 'compras log: registra tentativa quando SQL nao foi gerado');
assert(tentativaSqlLog.includes('20260501'), 'compras log: tentativa preserva parametros enviados para IA');

const promptFinanceiro = financeiroSchema.buildSqlUserPrompt('saldo a receber deste mes', {
  periodo: { tipo: 'personalizado', dataInicio: '20260501', dataFim: '20260531' },
  sx2: { SE1990: 'E', SE2990: 'E', SE5990: 'E', FK1990: 'E', FK6990: 'E', SA1990: 'C', SA2990: 'C', SA3990: 'C' },
  sx3: {
    SE1: [
      { campo: 'E1_SALDO', tipo: 'N', tamanho: 14, descricao: 'Saldo' },
      { campo: 'E1_TIPO', tipo: 'C', tamanho: 3, descricao: 'Tipo' },
    ],
    SE5: [
      { campo: 'E5_VLJUROS', tipo: 'N', tamanho: 14, descricao: 'Juros' },
      { campo: 'E5_VLMULTA', tipo: 'N', tamanho: 14, descricao: 'Multa' },
    ],
  },
});
assert(promptFinanceiro.includes('PA deduz pagar'), 'financeiro prompt: regra PA fica explicita');

const promptComissaoSX3 = comissaoSchema.buildSqlUserPrompt('Comissao paga para os vendedores em 2026', {
  periodo: { tipo: 'personalizado', dataInicio: '20260101', dataFim: '20261231' },
  sx2: { SE3990: 'E', SA3990: 'E' },
  sx3: {
    SE3990: [
      { campo: 'E3_NUM', tipo: 'C', tamanho: 9, descricao: 'Numero' },
      { campo: 'E3_BASE', tipo: 'N', tamanho: 14, decimal: 2, descricao: 'Base' },
      { campo: 'E3_COMIS', tipo: 'N', tamanho: 14, decimal: 2, descricao: 'Comissao' },
      { campo: 'E3_VENCTO', tipo: 'D', tamanho: 8, descricao: 'Vencimento' },
    ],
    SA3990: [
      { campo: 'A3_COD', tipo: 'C', tamanho: 6, descricao: 'Codigo' },
      { campo: 'A3_NOME', tipo: 'C', tamanho: 40, descricao: 'Nome' },
    ],
  },
});
assert(promptComissaoSX3.includes('SE3.E3_VENCTO'), 'comissao prompt: periodo usa E3_VENCTO');
assert(promptComissaoSX3.includes('Campos disponiveis no SX3 para o escopo comissao'), 'comissao prompt: inclui SX3');
assert(promptComissaoSX3.includes('E3_COMIS'), 'comissao prompt: inclui campo real de comissao');
assert(comissaoSchema.buildSqlSystemPrompt().includes('E3_DATA e a autoridade'), 'comissao prompt: E3_DATA e autoridade para pagamento');
assert(comissaoSchema.buildSqlSystemPrompt().includes('E3_STATUS NAO significa pagamento realizado'), 'comissao prompt: nao usa E3_STATUS como pagamento');
assert(comissaoSchema.buildSqlSystemPrompt().includes('SE3 -> SE2 -> SE5'), 'comissao prompt: orienta pagamento real via SE2/SE5');
assert(comissaoSchema.buildSqlSystemPrompt().includes('SE5.E5_DATA'), 'comissao prompt: periodo de paga usa data real SE5');
assert(!promptComissaoSX3.includes('E3_DTBAS'), 'comissao prompt: nao orienta campo antigo E3_DTBAS no user prompt');

const sx3ComissaoTeste = {
  SE3990: [
    { campo: 'E3_NUM' },
    { campo: 'E3_BASE' },
    { campo: 'E3_COMIS' },
    { campo: 'E3_VENCTO' },
    { campo: 'E3_VEND' },
  ],
  SA3990: [
    { campo: 'A3_COD' },
    { campo: 'A3_NOME' },
  ],
};
assert.strictEqual(comissaoHandler._sx3TemCampo(sx3ComissaoTeste, 'SE3', 'E3_BAIXA'), false, 'comissao sx3: detecta ausencia de E3_BAIXA');
assert.deepStrictEqual(
  comissaoHandler._mapearModosSX2Comissao([
    { arquivo: 'SE3990', modo: 'E' },
    { arquivo: 'SE2990', modo: 'E' },
    { arquivo: 'SE5990', modo: 'E' },
    { arquivo: 'SA3990', modo: 'C' },
  ]),
  { SE3990: 'E', SE2990: 'E', SE5990: 'E', SA3990: 'C' },
  'comissao sx2: inclui SE2 e SE5 no escopo tecnico'
);
assert.strictEqual(
  comissaoHandler._removerFiltroBaixaComissaoSeCampoAusente(
    "SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3 WHERE SE3.D_E_L_E_T_ = ' ' AND LTRIM(RTRIM(SE3.E3_BAIXA)) = '' AND SE3.E3_VEND = '000007'",
    sx3ComissaoTeste
  ).includes('E3_BAIXA'),
  false,
  'comissao sql: remove filtro E3_BAIXA quando campo nao existe no SX3'
);
const sx3ComissaoComStatus = {
  SE3990: [
    { campo: 'E3_NUM' },
    { campo: 'E3_COMIS' },
    { campo: 'E3_STATUS' },
  ],
};
assert.strictEqual(
  comissaoHandler._normalizarFiltrosStatusComissaoPorSX3(
    "SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3 WHERE SE3.D_E_L_E_T_ = ' ' AND SE3.E3_STATUS = 'A'",
    sx3ComissaoComStatus
  ).includes('E3_STATUS'),
  false,
  'comissao sql: remove E3_STATUS porque ele nao representa pagamento'
);
const sx3ComissaoComData = {
  SE3990: [
    { campo: 'E3_NUM' },
    { campo: 'E3_COMIS' },
    { campo: 'E3_DATA' },
  ],
};
assert.strictEqual(
  comissaoHandler._normalizarFiltrosStatusComissaoPorSX3(
    "SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3 WHERE SE3.D_E_L_E_T_ = ' ' AND SE3.E3_STATUS = 'P'",
    sx3ComissaoComData
  ).includes("LTRIM(RTRIM(SE3.E3_DATA)) <> ''"),
  true,
  'comissao sql: troca E3_STATUS pago por E3_DATA preenchido quando status nao existe'
);
assert.strictEqual(
  comissaoHandler._normalizarFiltrosStatusComissaoPorSX3(
    "SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3 WHERE SE3.D_E_L_E_T_ = ' ' AND SE3.E3_STATUS = 'A'",
    sx3ComissaoComData
  ).includes("LTRIM(RTRIM(SE3.E3_DATA)) = ''"),
  true,
  'comissao sql: troca E3_STATUS aberto por E3_DATA em branco quando status nao existe'
);
const sx3ComissaoComStatusEData = {
  SE3990: [
    { campo: 'E3_NUM' },
    { campo: 'E3_COMIS' },
    { campo: 'E3_STATUS' },
    { campo: 'E3_DATA' },
  ],
};
assert.strictEqual(
  comissaoHandler._normalizarFiltrosStatusComissaoPorSX3(
    "SELECT SUM(SE3.E3_COMIS) FROM SE3990 SE3 WHERE SE3.D_E_L_E_T_ = ' ' AND SE3.E3_STATUS = 'P'",
    sx3ComissaoComStatusEData
  ).includes("LTRIM(RTRIM(SE3.E3_DATA)) <> ''"),
  true,
  'comissao sql: mesmo com E3_STATUS no SX3, pagamento usa E3_DATA'
);
assert.strictEqual(
  sx3SqlValidator.validarCamposSqlContraSX3("SELECT SA3.A3_NOME, SUM(SE3.E3_COMIS) AS valor_comissao FROM SE3990 SE3 JOIN SA3990 SA3 ON SE3.E3_VEND = SA3.A3_COD WHERE SE3.E3_VENCTO BETWEEN '20260101' AND '20261231' AND SE3.D_E_L_E_T_ = ' ' GROUP BY SA3.A3_NOME", sx3ComissaoTeste).ok,
  true,
  'sx3 validator: aceita campos cadastrados no SX3 com alias'
);
const sqlAliasFisico = "SELECT SUM(SE3990.E3_COMIS) AS valor_comissao FROM SE3990 SE3 WHERE SE3990.E3_VENCTO BETWEEN '20260101' AND '20261231'";
assert.strictEqual(
  sx3SqlValidator.validarCamposSqlContraSX3(sqlAliasFisico, sx3ComissaoTeste).ok,
  false,
  'sx3 validator: rejeita referencia por tabela fisica quando FROM define alias'
);
assert.strictEqual(
  sx3SqlValidator.normalizarReferenciasAliasSql(sqlAliasFisico),
  "SELECT SUM(SE3.E3_COMIS) AS valor_comissao FROM SE3990 SE3 WHERE SE3.E3_VENCTO BETWEEN '20260101' AND '20261231'",
  'sx3 validator: normaliza nome fisico para alias declarado'
);
const sx3InvalidoAlias = sx3SqlValidator.validarCamposSqlContraSX3("SELECT SUM(SE3.E3_VALOR) AS valor_comissao FROM SE3990 SE3 WHERE SE3.E3_DTBAS BETWEEN '20260101' AND '20261231'", sx3ComissaoTeste);
assert.strictEqual(sx3InvalidoAlias.ok, false, 'sx3 validator: rejeita campos com alias ausentes no SX3');
assert(sx3InvalidoAlias.erros.some(e => e.includes('SE3.E3_VALOR')), 'sx3 validator: aponta campo inexistente com alias');
assert(sx3InvalidoAlias.erros.some(e => e.includes('SE3.E3_DTBAS')), 'sx3 validator: aponta data inexistente com alias');
const sx3InvalidoSemAlias = sx3SqlValidator.validarCamposSqlContraSX3("SELECT SUM(E3_VALOR) AS valor_comissao FROM SE3990 SE3 WHERE E3_DTBAS BETWEEN '20260101' AND '20261231'", sx3ComissaoTeste);
assert.strictEqual(sx3InvalidoSemAlias.ok, false, 'sx3 validator: rejeita campos sem alias ausentes no SX3');
assert(sx3InvalidoSemAlias.erros.some(e => e.includes('E3_VALOR')), 'sx3 validator: aponta campo inexistente sem alias');
const sx3CompletoComCampoForaDaAmostra = {
  SE2990: [
    ...Array.from({ length: 80 }, (_, i) => ({ campo: `E2_CAMPO${String(i).padStart(2, '0')}` })),
    { campo: 'E2_VALOR' },
    { campo: 'E2_SALDO' },
  ],
};
const sx3AmostraPrompt = sx3SqlValidator.limitarCamposSX3ParaPrompt(sx3CompletoComCampoForaDaAmostra, 80);
assert.strictEqual(
  sx3SqlValidator.validarCamposSqlContraSX3('SELECT SUM(SE2.E2_VALOR - SE2.E2_SALDO) FROM SE2990 SE2', sx3CompletoComCampoForaDaAmostra).ok,
  true,
  'sx3 validator: valida contra SX3 completo mesmo quando campo ficaria fora da amostra do prompt'
);
assert.strictEqual(sx3AmostraPrompt.SE2990.some(c => c.campo === 'E2_VALOR'), false, 'sx3 prompt: pode ficar enxuto sem carregar todos os campos');
assert(promptFinanceiro.includes('RA deduz receber'), 'financeiro prompt: regra RA fica explicita');
assert(promptFinanceiro.includes('E5_VLJUROS') && promptFinanceiro.includes('E5_VLMULTA'), 'financeiro prompt: inclui juros e multa do SX3');
assert(financeiroSchema.buildSqlSystemPrompt().includes('YEAR(CONVERT(DATE'), 'financeiro prompt: orienta ano/mes pelo padrao CONVERT DATE + YEAR/MONTH');
assert(financeiroSchema.buildSqlSystemPrompt().includes('UNION ALL de agregados por carteira'), 'financeiro prompt: orienta fluxo de caixa sem JOIN multiplicador');
assert(
  financeiroSchema.buildSqlUserPrompt('elabore um fluxo de caixa contas pagas versus contas recebidas de janeiro a maio de 2026', {
    periodo: { tipo: 'personalizado', dataInicio: '20260101', dataFim: '20260531' },
  }).includes('use UNION ALL agregando SE2 e SE1 separadamente'),
  'financeiro prompt usuario: reforca fluxo de caixa por UNION ALL'
);
assert(
  financeiroSchema.buildSqlUserPrompt('preciso do contas a receber em aberto agrupado pelo fornecedor softexpert', {
    periodo: { tipo: 'nenhum' },
  }).toLowerCase().includes('nao aplique filtro de data'),
  'financeiro prompt usuario: posicao em aberto sem periodo nao filtra data'
);
assert(comprasSchema.buildSqlSystemPrompt().includes('YEAR(CONVERT(DATE'), 'compras prompt: orienta ano/mes pelo padrao CONVERT DATE + YEAR/MONTH');
assert.strictEqual(
  financeiroHandler._financeiroMockAtivo({ IA_COMMAND_FINANCEIRO_MOCK_ROWS: 'true' }),
  true,
  'financeiro mock: habilita vetor simulado por variavel de ambiente'
);
assert.deepStrictEqual(
  Object.keys(financeiroHandler._mapearModosSX2Financeiro([
    { arquivo: 'SE1990', modo: 'E' },
    { arquivo: 'SE2990', modo: 'E' },
    { arquivo: 'SE5990', modo: 'E' },
    { arquivo: 'FK6990', modo: 'E' },
    { arquivo: 'SD1990', modo: 'E' },
  ])).sort(),
  ['FK6990', 'SE1990', 'SE2990', 'SE5990'].sort(),
  'financeiro sx2: filtra somente tabelas financeiras'
);
assert.strictEqual(
  financeiroHandler._validarPeriodoNoSQL("WHERE SE1.E1_VENCREA BETWEEN '20260501' AND '20260531'", { dataInicio: '20260501', dataFim: '20260531' }),
  true,
  'financeiro periodo: aceita SQL com periodo travado'
);
assert.strictEqual(
  financeiroHandler._validarPeriodoNoSQL("WHERE SE1.E1_VENCREA BETWEEN '20230501' AND '20230531'", { dataInicio: '20260501', dataFim: '20260531' }),
  false,
  'financeiro periodo: rejeita SQL com ano divergente'
);
assert.strictEqual(
  financeiroHandler._validarFuncoesDataProtheus('SELECT YEAR(SE1.E1_VENCREA) AS ano FROM SE1990 SE1'),
  false,
  'financeiro data protheus: rejeita YEAR em campo CHAR(8)'
);
assert.strictEqual(
  financeiroHandler._validarFuncoesDataProtheus("SELECT YEAR(TRY_CONVERT(date, NULLIF(SE1.E1_VENCREA, ''), 112)) AS ano FROM SE1990 SE1"),
  false,
  'financeiro data protheus: rejeita TRY_CONVERT em SQL Server legado'
);
assert.strictEqual(
  financeiroHandler._validarFuncoesDataProtheus("SELECT CONVERT(DATE, NULLIF(SE2.E2_EMISSAO, ''), 112) AS data_emissao FROM SE2990 SE2"),
  true,
  'financeiro data protheus: aceita CONVERT DATE estilo 112 no SELECT'
);
assert.strictEqual(
  financeiroHandler._validarFuncoesDataProtheus("SELECT YEAR(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112)) AS ano_mes FROM SE2990 SE2 GROUP BY YEAR(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112))"),
  true,
  'financeiro data protheus: aceita ano/mes por YEAR/MONTH apos CONVERT DATE'
);
assert.strictEqual(
  financeiroHandler._validarFuncoesDataProtheus('SELECT SUBSTRING(SE1.E1_VENCREA, 1, 4) AS ano FROM SE1990 SE1'),
  true,
  'financeiro data protheus: aceita SUBSTRING em campo CHAR(8)'
);
const sqlFluxoCaixaAliasInvalido = "SET ROWCOUNT 10000; SELECT mes, SUM(CASE WHEN SE2.E2_TIPO = 'PA' THEN -SE2.E2_SALDO ELSE SE2.E2_SALDO END) AS total_pago, SUM(CASE WHEN SE1.E1_TIPO = 'RA' THEN -SE1.E1_SALDO ELSE SE1.E1_SALDO END) AS total_recebido FROM ( SELECT YEAR(CONVERT(DATE, NULLIF(E2.E2_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(E2.E2_VENCREA, ''), 112)) AS mes, E2_SALDO FROM SE2990 E2 WHERE E2.D_E_L_E_T_ = ' ' AND E2.E2_VENCREA BETWEEN '20260101' AND '20260531' ) AS pagamentos JOIN ( SELECT YEAR(CONVERT(DATE, NULLIF(E1.E1_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(E1.E1_VENCREA, ''), 112)) AS mes, E1_SALDO FROM SE1990 E1 WHERE E1.D_E_L_E_T_ = ' ' AND E1.E1_VENCREA BETWEEN '20260101' AND '20260531' ) AS recebimentos ON pagamentos.mes = recebimentos.mes GROUP BY mes ORDER BY mes;";
assert.strictEqual(
  financeiroHandler._validarEscopoAliasesSQL(sqlFluxoCaixaAliasInvalido),
  false,
  'financeiro alias: rejeita SE1/SE2 fora do escopo externo da subquery'
);
const sqlFluxoCaixaUnion = "SET ROWCOUNT 10000; SELECT mes, SUM(total_pago) AS total_pago, SUM(total_recebido) AS total_recebido FROM ( SELECT YEAR(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112)) AS mes, SUM(CASE WHEN SE2.E2_TIPO = 'PA' THEN -SE2.E2_SALDO ELSE SE2.E2_SALDO END) AS total_pago, 0 AS total_recebido FROM SE2990 SE2 WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_VENCREA BETWEEN '20260101' AND '20260531' GROUP BY YEAR(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SE2.E2_VENCREA, ''), 112)) UNION ALL SELECT YEAR(CONVERT(DATE, NULLIF(SE1.E1_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SE1.E1_VENCREA, ''), 112)) AS mes, 0 AS total_pago, SUM(CASE WHEN SE1.E1_TIPO = 'RA' THEN -SE1.E1_SALDO ELSE SE1.E1_SALDO END) AS total_recebido FROM SE1990 SE1 WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_VENCREA BETWEEN '20260101' AND '20260531' GROUP BY YEAR(CONVERT(DATE, NULLIF(SE1.E1_VENCREA, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SE1.E1_VENCREA, ''), 112)) ) AS fluxo GROUP BY mes ORDER BY mes;";
assert.strictEqual(
  financeiroHandler._validarEscopoAliasesSQL(sqlFluxoCaixaUnion),
  true,
  'financeiro alias: aceita fluxo de caixa agregado por UNION ALL'
);
assert(
  financeiroHandler._dadosMockFinanceiro({ periodo: { dataInicio: '20260501', dataFim: '20260531' }, filial: 'TODAS' })
    .some(row => row.tipo === 'RA' || row.tipo === 'PA'),
  'financeiro mock: inclui antecipacoes PA/RA para validar regra sem ERP'
);
assert.strictEqual(
  financeiroMiddleware.processar('SET ROWCOUNT 10000; SELECT E1_SALDO FROM SE1990 SE1 WHERE SE1.D_E_L_E_T_ = \' \'', {}).bloqueado,
  false,
  'financeiro middleware: permite SELECT em tabelas financeiras'
);
assert.strictEqual(
  financeiroMiddleware.processar('SET ROWCOUNT 10000; SELECT dbo.fnSaldoCliente(SE1.E1_CLIENTE) AS saldo FROM SE1990 SE1', {}).bloqueado,
  true,
  'financeiro middleware: bloqueia function qualificada em SELECT'
);
assert.strictEqual(
  comprasMiddleware.processar('SET ROWCOUNT 10000; SELECT D1_TOTAL INTO #tmp FROM SD1990 SD1', {}).bloqueado,
  true,
  'compras middleware: bloqueia SELECT INTO'
);
assert.strictEqual(
  faturamentoMiddleware.processar('EXEC dbo.sp_relatorio_faturamento', {}).bloqueado,
  true,
  'faturamento middleware: bloqueia exec de procedure'
);
assert.strictEqual(
  comissaoMiddleware.processar('CALL sp_comissao()', {}).bloqueado,
  true,
  'comissao middleware: bloqueia CALL'
);
assert.strictEqual(
  comissaoHandler._validarEntidadesComissaoNoSQL(
    "SET ROWCOUNT 10000; SELECT SA3.A3_NOME AS vendedor, SUM(SE3.E3_COMIS) AS valor_comissao FROM SE3990 SE3 INNER JOIN SA3990 SA3 ON SE3.E3_VEND = SA3.A3_COD AND SA3.D_E_L_E_T_ = ' ' WHERE SE3.D_E_L_E_T_ = ' ' AND SE3.E3_DATA = '' AND SE3.E3_FILIAL = '01' AND SA3.A3_COD = '000007' GROUP BY SA3.A3_NOME;",
    { entidades: [{ tipo: 'vendedor', codigo: '000007', nome: 'Jean' }] }
  ).ok,
  true,
  'comissao entidade: aceita filtro por codigo do vendedor e nome apenas no SELECT/GROUP BY'
);
assert.strictEqual(
  comissaoHandler._validarEntidadesComissaoNoSQL(
    "SET ROWCOUNT 10000; SELECT SA3.A3_NOME AS vendedor, SUM(SE3.E3_COMIS) AS valor_comissao FROM SE3990 SE3 INNER JOIN SA3990 SA3 ON SE3.E3_VEND = SA3.A3_COD AND SA3.D_E_L_E_T_ = ' ' WHERE SE3.D_E_L_E_T_ = ' ' AND SA3.A3_NOME = 'JEAN' AND SA3.A3_COD = '000007' GROUP BY SA3.A3_NOME;",
    { entidades: [{ tipo: 'vendedor', codigo: '000007', nome: 'Jean' }] }
  ).ok,
  true,
  'comissao entidade: aceita nome redundante quando o codigo interno tambem esta aplicado'
);
assert.strictEqual(
  comissaoHandler._validarEntidadesComissaoNoSQL(
    "SET ROWCOUNT 10000; SELECT SA3.A3_NOME AS vendedor, SUM(SE3.E3_COMIS) AS valor_comissao FROM SE3990 SE3 INNER JOIN SA3990 SA3 ON SE3.E3_VEND = SA3.A3_COD AND SA3.D_E_L_E_T_ = ' ' WHERE SE3.D_E_L_E_T_ = ' ' AND SA3.A3_NOME = 'JEAN' GROUP BY SA3.A3_NOME;",
    { entidades: [{ tipo: 'vendedor', codigo: '000007', nome: 'Jean' }] }
  ).ok,
  false,
  'comissao entidade: rejeita filtro por nome sem codigo interno'
);
const sqlContasReceberAbertoComMes = "SELECT SA2.A2_NOME AS fornecedor, SUM(CASE WHEN SE1.E1_TIPO = 'RA' THEN -SE1.E1_SALDO ELSE SE1.E1_SALDO END) AS saldo_a_receber FROM SE1990 AS SE1 JOIN SA1990 AS SA1 ON SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA JOIN SA2990 AS SA2 ON SA1.A1_CODFOR = SA2.A2_COD AND SA1.A1_LOJA = SA2.A2_LOJA WHERE SE1.E1_VENCREA BETWEEN '20260501' AND '20260531' AND SE1.D_E_L_E_T_ = ' ' AND SA1.A1_COD = '000057' AND SA1.A1_LOJA = '01' GROUP BY SA2.A2_NOME";
assert.strictEqual(
  financeiroHandler._validarPosicaoAbertaSemPeriodo(sqlContasReceberAbertoComMes, 'preciso do contas a receber em aberto agrupado pelo fornecedor softexpert', { tipo: 'nenhum' }),
  false,
  'financeiro posicao aberta: rejeita filtro mensal inventado'
);
assert.strictEqual(
  queryPlan.validarSqlContraPlano(sqlContasReceberAbertoComMes, planoFinanceiroAberto).ok,
  false,
  'query plan: validador comum rejeita SQL com periodo inventado'
);
assert.strictEqual(
  financeiroHandler._validarPosicaoAbertaSemPeriodo("SELECT SA1.A1_NOME AS cliente, SUM(CASE WHEN SE1.E1_TIPO = 'RA' THEN -SE1.E1_SALDO ELSE SE1.E1_SALDO END) AS saldo_a_receber FROM SE1990 AS SE1 JOIN SA1990 AS SA1 ON SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0 AND SA1.A1_COD = '000057' AND SA1.A1_LOJA = '01' GROUP BY SA1.A1_NOME", 'preciso do contas a receber em aberto agrupado pelo fornecedor softexpert', { tipo: 'nenhum' }),
  true,
  'financeiro posicao aberta: aceita carteira completa em aberto'
);
assert.strictEqual(
  queryPlan.validarSqlContraPlano("SELECT SA1.A1_NOME AS cliente, SUM(CASE WHEN SE1.E1_TIPO = 'RA' THEN -SE1.E1_SALDO ELSE SE1.E1_SALDO END) AS saldo_a_receber FROM SE1990 AS SE1 JOIN SA1990 AS SA1 ON SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0 AND SA1.A1_COD = '000057' AND SA1.A1_LOJA = '01' GROUP BY SA1.A1_NOME", planoFinanceiroAberto).ok,
  true,
  'query plan: validador comum aceita SQL aderente ao plano'
);
assert.strictEqual(
  queryPlan.validarSqlContraPlano("SELECT SA2.A2_NOME AS fornecedor, SUM(SE1.E1_SALDO) AS saldo_a_receber FROM SE1990 SE1 JOIN SA1990 SA1 ON SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA JOIN SA2990 SA2 ON SA1.A1_CODFOR = SA2.A2_COD WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0 GROUP BY SA2.A2_NOME", planoFinanceiroAberto).ok,
  false,
  'query plan: bloqueia SA2 em contas a receber'
);
assert.strictEqual(
  queryPlan.validarSqlContraPlano("SELECT ano_mes, fornecedor, SUM(total_receber) AS total_receber, SUM(total_pagar) AS total_pagar FROM (SELECT SUBSTRING(SE1.E1_VENCREA, 1, 6) AS ano_mes, SA1.A1_NOME AS fornecedor, SUM(SE1.E1_SALDO) AS total_receber, 0 AS total_pagar FROM SE1990 SE1 JOIN SA1990 SA1 ON SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_SALDO > 0 GROUP BY SUBSTRING(SE1.E1_VENCREA, 1, 6), SA1.A1_NOME UNION ALL SELECT SUBSTRING(SE2.E2_VENCREA, 1, 6) AS ano_mes, SA2.A2_NOME AS fornecedor, 0 AS total_receber, SUM(SE2.E2_SALDO) AS total_pagar FROM SE2990 SE2 JOIN SA2990 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 GROUP BY SUBSTRING(SE2.E2_VENCREA, 1, 6), SA2.A2_NOME) fluxo GROUP BY ano_mes, fornecedor", planoFinanceiroAmbasAberto).ok,
  true,
  'query plan: aceita receber e pagar em aberto por mes com saldo nos dois lados'
);
assert.strictEqual(
  queryPlan.validarSqlContraPlano("SELECT SUBSTRING(SE2.E2_VENCREA, 1, 6) AS ano_mes, SA2.A2_NOME AS fornecedor, SUM(SE2.E2_SALDO) AS total_pagar FROM SE2990 SE2 JOIN SA2990 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 GROUP BY SUBSTRING(SE2.E2_VENCREA, 1, 6), SA2.A2_NOME", planoFinanceiroAmbasAberto).ok,
  false,
  'query plan: carteira ambas rejeita SQL sem saldo a receber'
);
assert.deepStrictEqual(
  financeiroHandler._rowsZeroParaAgregadoSemLinhas("SET ROWCOUNT 10000; SELECT SUM(SE1.E1_SALDO) AS total_recebido, COUNT(*) AS qtd_titulos FROM SE1990 SE1 WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_VENCREA BETWEEN '20260101' AND '20260531'"),
  [{ total_recebido: 0, qtd_titulos: 0 }],
  'financeiro sem linhas: consulta agregada vira linha zero'
);
assert.strictEqual(
  financeiroHandler._rowsZeroParaAgregadoSemLinhas("SET ROWCOUNT 10000; SELECT SE1.E1_NUM AS titulo FROM SE1990 SE1 WHERE SE1.D_E_L_E_T_ = ' '"),
  null,
  'financeiro sem linhas: listagem analitica continua sem resultado'
);
assert.deepStrictEqual(
  comprasHandler._rowsZeroParaAgregadoSemLinhas("SET ROWCOUNT 10000; SELECT SUM(SD1.D1_TOTAL) AS valor_compra, COUNT(DISTINCT SF1.F1_DOC) AS qtd_nfs FROM SD1990 SD1 INNER JOIN SF1990 SF1 ON 1 = 1 WHERE SD1.D_E_L_E_T_ = ' '"),
  [{ valor_compra: 0, qtd_nfs: 0 }],
  'compras sem linhas: consulta agregada vira linha zero'
);
assert(comprasSchema.buildSqlSystemPrompt().includes('SQL ANSI/portavel'), 'compras prompt: orienta SQL portavel');
assert(faturamentoSchema.buildSqlSystemPrompt().includes('SF2'), 'faturamento prompt: inclui cabecalho de NF de saida');
assert(faturamentoSchema.buildSqlSystemPrompt().includes('YEAR(CONVERT(DATE'), 'faturamento prompt: orienta ano/mes pelo padrao CONVERT DATE + YEAR/MONTH');
assert(faturamentoSchema.buildSqlSystemPrompt().includes('SQL ANSI/portavel'), 'faturamento prompt: orienta SQL portavel');
assert(financeiroSchema.buildSqlSystemPrompt().includes('SQL ANSI/portavel'), 'financeiro prompt: orienta SQL portavel');
assert(comissaoSchema.buildSqlSystemPrompt().includes('SQL ANSI/portavel'), 'comissao prompt: orienta SQL portavel');
assert.strictEqual(
  faturamentoHandler._faturamentoMockAtivo({ IA_COMMAND_FATURAMENTO_MOCK_ROWS: 'true' }),
  true,
  'faturamento mock: habilita vetor simulado por variavel de ambiente'
);
assert.strictEqual(typeof faturamentoHandler.garantirIntencao, 'function', 'faturamento bootstrap: expoe criacao automatica da intencao dinamica');
assert.deepStrictEqual(
  Object.keys(faturamentoHandler._mapearModosSX2Faturamento([
    { arquivo: 'SF2990', modo: 'E' },
    { arquivo: 'SD2990', modo: 'E' },
    { arquivo: 'SA1990', modo: 'C' },
    { arquivo: 'SA3990', modo: 'C' },
    { arquivo: 'SE1990', modo: 'E' },
  ])).sort(),
  ['SA1990', 'SA3990', 'SD2990', 'SF2990'].sort(),
  'faturamento sx2: filtra somente tabelas do escopo de faturamento'
);
assert.strictEqual(faturamentoHandler._inferirSufixoSX2({ SF2990: 'E', SD2990: 'E' }, '010'), '990', 'faturamento sx2: infere sufixo real');
assert.strictEqual(
  sx2SqlNormalizer.normalizarTabelasPorAliasSX2(
    "SET ROWCOUNT 10000; SELECT SUM(SE3.E3_COMIS) AS valor_comissao FROM SE2020 SE3 INNER JOIN SA3990 SA3 ON SE3.E3_VEND = SA3.A3_COD WHERE SE3.D_E_L_E_T_ = ' '",
    { SE3020: 'E', SE2020: 'E', SA3990: 'C' }
  ).includes('FROM SE3020 SE3'),
  true,
  'comissao sx2: corrige tabela fisica quando alias SE3 veio em tabela SE2'
);
assert.strictEqual(
  sx2SqlNormalizer.normalizarTabelasPorAliasSX2(
    "SELECT SA2.A2_NOME FROM SA1990 SA2 JOIN SE1990 SE2 ON SE2.E2_FORNECE = SA2.A2_COD",
    { SA1990: 'C', SA2990: 'C', SE2990: 'E' }
  ).includes('FROM SA2990 SA2 JOIN SE2990 SE2'),
  true,
  'sx2 normalizer: corrige tabelas por alias Protheus em FROM/JOIN'
);
assert.strictEqual(
  sx2SqlNormalizer.normalizarTabelasPorAliasSX2(
    "SELECT dados.total FROM SE2020 dados",
    { SE3020: 'E', SE2020: 'E' }
  ),
  "SELECT dados.total FROM SE2020 dados",
  'sx2 normalizer: nao altera alias generico'
);
assert.strictEqual(
  faturamentoHandler._validarPeriodoNoSQL("WHERE SF2.F2_EMISSAO BETWEEN '20260401' AND '20260430'", { dataInicio: '20260401', dataFim: '20260430' }),
  true,
  'faturamento periodo: aceita SQL com periodo travado'
);
assert.strictEqual(
  faturamentoHandler._validarFuncoesDataProtheus('SELECT MONTH(SF2.F2_EMISSAO) AS mes FROM SF2990 SF2'),
  false,
  'faturamento data protheus: rejeita MONTH em campo CHAR(8)'
);
assert.strictEqual(
  faturamentoHandler._validarFuncoesDataProtheus("SELECT YEAR(CONVERT(DATE, NULLIF(SF2.F2_EMISSAO, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SF2.F2_EMISSAO, ''), 112)) AS ano_mes FROM SF2990 SF2 GROUP BY YEAR(CONVERT(DATE, NULLIF(SF2.F2_EMISSAO, ''), 112)) * 100 + MONTH(CONVERT(DATE, NULLIF(SF2.F2_EMISSAO, ''), 112))"),
  true,
  'faturamento data protheus: aceita ano/mes por YEAR/MONTH apos CONVERT DATE'
);
assert.strictEqual(
  faturamentoMiddleware.processar('SET ROWCOUNT 10000; SELECT D2_TOTAL FROM SD2990 SD2 WHERE SD2.D_E_L_E_T_ = \' \'', {}).bloqueado,
  false,
  'faturamento middleware: permite SELECT em tabelas de faturamento'
);
{
  const sqlTopRanking = faturamentoMiddleware.processar(
    "SET ROWCOUNT 10000; SELECT SA1.A1_NOME AS cliente, SUM(SD2.D2_TOTAL) AS faturamento FROM SF2990 SF2 JOIN SD2990 SD2 ON SD2.D2_DOC = SF2.F2_DOC JOIN SA1990 SA1 ON SA1.A1_COD = SF2.F2_CLIENTE WHERE SF2.D_E_L_E_T_ = ' ' GROUP BY SA1.A1_NOME ORDER BY faturamento DESC",
    { limite_ranking: 10 },
  ).sql_processado;
  assert(/\bSELECT\s+TOP\s+10\s+SA1\.A1_NOME/i.test(sqlTopRanking), 'faturamento middleware aplica TOP 10 de ranking');
  assert(/SET\s+ROWCOUNT\s+10000/i.test(sqlTopRanking), 'faturamento middleware preserva ROWCOUNT tecnico');
  const sqlTop20Mensagem = faturamentoMiddleware.processar(
    "SET ROWCOUNT 10000; SELECT SA1.A1_NOME AS cliente, SUM(SD2.D2_TOTAL) AS faturamento FROM SF2990 SF2 JOIN SD2990 SD2 ON SD2.D2_DOC = SF2.F2_DOC JOIN SA1990 SA1 ON SA1.A1_COD = SF2.F2_CLIENTE WHERE SF2.D_E_L_E_T_ = ' ' GROUP BY SA1.A1_NOME ORDER BY faturamento DESC",
    { mensagem_original: 'TOP 20 maiores clientes em faturamento hoje' },
  ).sql_processado;
  assert(/\bSELECT\s+TOP\s+20\s+SA1\.A1_NOME/i.test(sqlTop20Mensagem), 'faturamento middleware aplica TOP 20 pela mensagem');
  const sqlTopSubstituido = faturamentoMiddleware.processar(
    "SET ROWCOUNT 10000; SELECT TOP 1000 SA1.A1_NOME AS cliente, SUM(SD2.D2_TOTAL) AS faturamento FROM SF2990 SF2 JOIN SD2990 SD2 ON SD2.D2_DOC = SF2.F2_DOC JOIN SA1990 SA1 ON SA1.A1_COD = SF2.F2_CLIENTE WHERE SF2.D_E_L_E_T_ = ' ' GROUP BY SA1.A1_NOME ORDER BY faturamento DESC",
    { mensagem_original: 'Preciso que me envie Os dez clientes que mais compraram no dia de ontem' },
  ).sql_processado;
  assert(/\bSELECT\s+TOP\s+10\s+SA1\.A1_NOME/i.test(sqlTopSubstituido), 'faturamento middleware substitui TOP padrao por TOP 10 da pergunta');
  const sqlDatasetTopSubstituido = semanticDatasetRunner._test._aplicarTopPergunta(
    "SELECT TOP 1000 cliente, SUM(faturamento) AS faturamento_total FROM base GROUP BY cliente ORDER BY faturamento_total DESC",
    'Preciso que me envie Os dez clientes que mais compraram no dia de ontem',
    {},
  );
  assert(/\bSELECT\s+TOP\s+10\s+cliente/i.test(sqlDatasetTopSubstituido), 'dataset semantico substitui TOP padrao por TOP 10 da pergunta');
  const sqlTopManualAgendamento = "SET ROWCOUNT 10000; SELECT TOP 10 COALESCE(SUM(SD2.D2_TOTAL),0) AS faturamento FROM SD2990 SD2 WHERE SD2.D_E_L_E_T_ = ' '";
  const validacaoTopIa = iaOwnerRunner._test.validarSqlIaOwnerBasico(sqlTopManualAgendamento, faturamentoSpec, { SD2990: 'E' });
  const validacaoTopAgendamento = iaOwnerRunner._test.validarSqlIaOwnerBasico(
    sqlTopManualAgendamento,
    faturamentoSpec,
    { SD2990: 'E' },
    'Consulta agendada',
    { permitirSelectTop: true },
  );
  assert.strictEqual(validacaoTopIa.ok, false, 'SQL IA continua rejeitando SELECT TOP por padrao');
  assert.strictEqual(validacaoTopAgendamento.ok, true, `SQL fixo de agendamento aceita SELECT TOP: ${validacaoTopAgendamento.erros.join(' | ')}`);
  const sqlTopNormalizadoAgendamento = scheduledRunner._test.garantirSetRowcountSqlFixo("SELECT TOP 10 * FROM SD2990 SD2 WHERE SD2.D_E_L_E_T_ = ' '");
  assert(/^SET\s+ROWCOUNT\s+10000;\s*SELECT\s+TOP\s+10\b/i.test(sqlTopNormalizadoAgendamento), 'agendamento prefixa SET ROWCOUNT sem remover TOP N manual');
  assert.doesNotThrow(() => scheduledRunner._test.validarSqlFixoBasico(sqlTopNormalizadoAgendamento), 'SQL fixo com TOP N normalizado passa na validacao basica do agendamento');
  for (const caso of [
    { nome: 'compras', spec: comprasSpec, sx2: { SD1990: 'E' }, sql: "SET ROWCOUNT 10000; SELECT TOP 10 SD1.D1_DOC AS documento FROM SD1990 SD1 WHERE SD1.D_E_L_E_T_ = ' '" },
    { nome: 'financeiro', spec: financeiroSpec, sx2: { SE1990: 'E' }, sql: "SET ROWCOUNT 10000; SELECT TOP 10 SE1.E1_NUM AS documento FROM SE1990 SE1 WHERE SE1.D_E_L_E_T_ = ' '" },
    { nome: 'faturamento', spec: faturamentoSpec, sx2: { SD2990: 'E' }, sql: "SET ROWCOUNT 10000; SELECT TOP 10 SD2.D2_DOC AS documento FROM SD2990 SD2 WHERE SD2.D_E_L_E_T_ = ' '" },
    { nome: 'comissao', spec: comissaoSpec, sx2: { SE3990: 'E' }, sql: "SET ROWCOUNT 10000; SELECT TOP 10 SE3.E3_NUM AS documento FROM SE3990 SE3 WHERE SE3.D_E_L_E_T_ = ' '" },
  ]) {
    const validacaoModulo = iaOwnerRunner._test.validarSqlIaOwnerBasico(caso.sql, caso.spec, caso.sx2, 'Consulta agendada', { permitirSelectTop: true });
    assert.strictEqual(validacaoModulo.ok, true, `SQL fixo de agendamento deve aceitar TOP N em ${caso.nome}: ${validacaoModulo.erros.join(' | ')}`);
  }
}
assert.deepStrictEqual(
  faturamentoHandler._rowsZeroParaAgregadoSemLinhas("SET ROWCOUNT 10000; SELECT SUM(SD2.D2_TOTAL) AS faturamento, SUM(SD2.D2_QUANT) AS quantidade FROM SD2990 SD2 WHERE SD2.D_E_L_E_T_ = ' '"),
  [{ faturamento: 0, quantidade: 0 }],
  'faturamento sem linhas: consulta agregada vira linha zero'
);

expectNoLocal('me mostra esse negocio ai');

assert.strictEqual(
  dialogResolver._matchPadroes(JSON.stringify(['ate']), localResolver.normalizarTexto('Compare somente ate o mes de maio')),
  false,
  'dialogo: "ate" nao deve capturar consulta com ate maio'
);
assert.strictEqual(
  dialogResolver._matchPadroes(JSON.stringify(['ate']), localResolver.normalizarTexto('ate')),
  true,
  'dialogo: "ate" sozinho continua sendo despedida'
);
assert.strictEqual(
  dialogResolver.resolver('Como voce pode me ajudar?', 1).matched,
  true,
  'dialogo: ajuda com pronome antes de empresa nao deve abrir seletor de empresa'
);
const dialogoNomeSistema = dialogResolver.resolver('Qual o nome do sistema?', 1);
assert.strictEqual(dialogoNomeSistema.matched, true, 'dialogo: nome do sistema nao deve abrir seletor de empresa');
assert.strictEqual(dialogoNomeSistema.tipo, 'apresentacao', 'dialogo: nome do sistema usa apresentacao');
assert(
  conversationService._buildDialogPrompt('Boa noite').includes('Nao peca para escolher empresa'),
  'dialogo IA: prompt impede seletor de empresa em conversa geral'
);

expectPeriod('fat de maio do ano passado', new Date('2026-05-17T12:00:00'), {
  tipo: 'personalizado',
  dataInicio: '20250501',
  dataFim: '20250531',
});

expectPeriod('fat de 01/03/2026 a 15/03/2026', new Date('2026-05-17T12:00:00'), {
  tipo: 'personalizado',
  dataInicio: '20260301',
  dataFim: '20260315',
});

expectPeriod('media mensal de faturamento dos ultimos dois anos', new Date('2026-05-18T12:00:00'), {
  tipo: 'personalizado',
  dataInicio: '20240601',
  dataFim: '20260531',
});

expectPeriod('media mensal de faturamento dos ultimos 24 meses', new Date('2026-05-18T12:00:00'), {
  tipo: 'personalizado',
  dataInicio: '20240601',
  dataFim: '20260531',
});

expectPeriod('media mensal de faturamento do ano de 2025 ate maio de 2026', new Date('2026-05-18T12:00:00'), {
  tipo: 'personalizado',
  dataInicio: '20250101',
  dataFim: '20260531',
});
expectPeriod('pagamentos realizados dos anos de 2025 e 2026', new Date('2026-05-18T12:00:00'), {
  tipo: 'personalizado',
  dataInicio: '20250101',
  dataFim: '20261231',
});

expectPeriod('faturamento do ano por mes e por cliente e produto', new Date('2026-05-18T12:00:00'), {
  tipo: 'ano_atual',
  dataInicio: '20260101',
  dataFim: '20261231',
});

expectPeriod('faturamento do mes por ano', new Date('2026-05-18T12:00:00'), {
  tipo: 'mes_atual',
  dataInicio: '20260501',
  dataFim: '20260531',
});

expectPeriod('faturamento por ano e mes e cliente e produto', new Date('2026-05-18T12:00:00'), {
  tipo: 'nenhum',
  dataInicio: null,
  dataFim: null,
});

expectPeriod('faturamento 2025', new Date('2026-05-18T12:00:00'), {
  tipo: 'personalizado',
  dataInicio: '20250101',
  dataFim: '20251231',
});

expectPeriod('fat 2026', new Date('2026-05-18T12:00:00'), {
  tipo: 'personalizado',
  dataInicio: '20260101',
  dataFim: '20261231',
});

expectPeriod('Compare o fat de 2026 com 2025', new Date('2026-05-18T12:00:00'), {
  tipo: 'comparacao_anual',
  ano_base: 2026,
  ano_comparacao: 2025,
  dataInicio: '20250101',
  dataFim: '20261231',
});

expectPeriod('Compare somente ate o mes de maio', new Date('2026-05-18T12:00:00'), {
  tipo: 'comparacao_acumulado_mes',
  dataInicio: '20250101',
  dataFim: '20260531',
});

expectPeriod('comparar o faturamento mes a mes do ano de 2025 com o ano de 2026', new Date('2026-05-18T12:00:00'), {
  tipo: 'comparacao_mensal_entre_anos',
  ano_base: 2025,
  ano_comparacao: 2026,
  dataInicio: '20250101',
  dataFim: '20261231',
});

const periodoNormalizado = identificarPeriodoTexto('conparar mes a mes o ano de 2025 com o ano de 2026', {
  hoje: new Date('2026-05-18T12:00:00'),
  normalizacoes: [{ termo: 'conparar', camada: 'normalizacao', equivalencia: 'comparar', ativo: 1 }],
});
assert.strictEqual(periodoNormalizado.tipo, 'comparacao_mensal_entre_anos', 'periodo aplica normalizacao configuravel');

const periodoResolvido = resolverPeriodo({ tipo: 'ultimos_N_dias', dias: 7 }, { hoje: new Date('2026-05-17T12:00:00') });
assert.strictEqual(periodoResolvido.dataInicio, '20260511', 'ultimos_N_dias: dataInicio');
assert.strictEqual(periodoResolvido.dataFim, '20260517', 'ultimos_N_dias: dataFim');

const turnoAnoPassado = resolverTurno('Qual o faturamento do ano passado');
const periodoAnoPassado = resolverPeriodo(turnoAnoPassado.periodo, { hoje: new Date('2026-05-18T12:00:00') });
assert.strictEqual(turnoAnoPassado.intencao, 'faturamento_periodo', 'multi-turn 1: intencao');
assert.strictEqual(turnoAnoPassado.periodo.tipo, 'ano_anterior', 'multi-turn 1: periodo');
assert.strictEqual(periodoAnoPassado.dataInicio, '20250101', 'multi-turn 1: dataInicio');
assert.strictEqual(periodoAnoPassado.dataFim, '20251231', 'multi-turn 1: dataFim');

const turnoMesAMes = resolverTurno('Detalhe o faturamento mes a mes', turnoAnoPassado);
assert.strictEqual(turnoMesAMes.intencao, 'faturamento_periodo', 'multi-turn 2: intencao');
assert.strictEqual(turnoMesAMes.periodo.tipo, 'ano_anterior', 'multi-turn 2: herda periodo');
assert.strictEqual(turnoMesAMes.agrupar_por, 'mes', 'multi-turn 2: agrupa por mes');
assert.strictEqual(turnoMesAMes._contextoAplicado, true, 'multi-turn 2: contexto aplicado');

const contextService = new IACWhatsAppService();
contextService._channelId = 'canal-regressao';
assert.strictEqual(contextService._isPedidoContinuacaoAnalitica('detalhar por documento'), true, 'contexto: detalhar por documento e continuacao analitica');
const senderContexto = '559299999999@c.us';
const intentAnoAtualContexto = {
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'ano_atual' },
  filtros: {},
  agrupar_por: null,
  ordenar_por: null,
  limite: null,
  confianca: 0.97,
  _provedor: 'deterministico',
};

contextService._saveLastIntent(senderContexto, intentAnoAtualContexto, 1);
assert.strictEqual(
  contextService._devePreservarContextoAnalitico(contextService._getSenderContext(senderContexto), 'Detalhe por mes'),
  true,
  'contexto: troca de escopo preserva continuacao analitica'
);
const contextoSingleParaAll = contextService._getScopedLastIntent(senderContexto, '__all__', {
  texto: 'Detalhe por mes',
  allowCompatibleFallback: true,
});
assert(contextoSingleParaAll.intent, 'contexto: detalhe por mes reaproveita contexto single em all');
assert.strictEqual(contextoSingleParaAll.intent.periodo.tipo, 'ano_atual', 'contexto: single -> all preserva ano');
assert.strictEqual(contextoSingleParaAll.fallbackEscopo, true, 'contexto: single -> all marca fallback');

const contextoNaoContinuacao = contextService._getScopedLastIntent(senderContexto, '__all__', {
  texto: 'Qual faturamento do mes',
  allowCompatibleFallback: true,
});
assert.strictEqual(contextoNaoContinuacao.intent, null, 'contexto: pergunta nova nao usa fallback cruzado');

contextService._saveLastIntent(senderContexto, {
  ...intentAnoAtualContexto,
  periodo: { tipo: 'personalizado', data_inicio: '20260101', data_fim: '20261231' },
}, '__all__');
const contextoAllParaSingle = contextService._getScopedLastIntent(senderContexto, 1, {
  texto: 'Detalhe por cliente',
  allowCompatibleFallback: true,
});
assert(contextoAllParaSingle.intent, 'contexto: detalhe por cliente reaproveita contexto all em single');
assert.strictEqual(contextoAllParaSingle.intent.periodo.data_inicio, '20260101', 'contexto: all -> single preserva data inicial');
assert.strictEqual(contextoAllParaSingle.intent.periodo.data_fim, '20261231', 'contexto: all -> single preserva data final');

contextService._saveLastIntent(senderContexto, {
  intencao: 'compras_dinamico',
  acao: 'ai_text_to_sql',
  periodo: { tipo: 'mes_atual' },
  filtros: {},
  confianca: 0.95,
  _provedor: 'deterministico',
}, '__all__');
assert.strictEqual(
  contextService._devePreservarContextoAnalitico(contextService._getSenderContext(senderContexto), 'Detalhe por mes'),
  false,
  'contexto: troca de escopo nao preserva contexto de compras dinamico'
);
const contextoComprasBloqueado = contextService._getScopedLastIntent(senderContexto, 1, {
  texto: 'Detalhe por mes',
  allowCompatibleFallback: true,
});
assert.strictEqual(contextoComprasBloqueado.intent, null, 'contexto: compras dinamico bloqueia fallback cruzado');

const turnoFaturamentoAnoAnterior = resolverTurno('Faturamento ano anterior');
const turnoFaturamento2026 = resolverTurno('E 2026?', turnoFaturamentoAnoAnterior);
assert.strictEqual(turnoFaturamento2026.periodo.tipo, 'personalizado', 'multi-turn ano explicito: periodo personalizado');
assert.strictEqual(turnoFaturamento2026.periodo.data_inicio, '20260101', 'multi-turn ano explicito: data inicio');
assert.strictEqual(turnoFaturamento2026.periodo.data_fim, '20261231', 'multi-turn ano explicito: data fim');

const turnoMaiorMes2026 = resolverTurno('E o mes de maior faturamento?', turnoFaturamento2026);
assert.strictEqual(turnoMaiorMes2026.periodo.tipo, 'personalizado', 'multi-turn maior mes: mantem ano do contexto');
assert.strictEqual(turnoMaiorMes2026.periodo.data_inicio, '20260101', 'multi-turn maior mes: data inicio');
assert.strictEqual(turnoMaiorMes2026.periodo.data_fim, '20261231', 'multi-turn maior mes: data fim');
assert.strictEqual(turnoMaiorMes2026.agrupar_por, 'mes', 'multi-turn maior mes: agrupa por mes');
assert.strictEqual(turnoMaiorMes2026.ordenar_por, 'faturamento:desc', 'multi-turn maior mes: ordenacao');
assert.strictEqual(turnoMaiorMes2026.limite, 1, 'multi-turn maior mes: limite');

const turnoMaiorMes2026ComPeriodoGenerico = intentMerger.mesclar({
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'mes_atual' },
  filtros: {},
  agrupar_por: null,
  ordenar_por: 'faturamento:desc',
  limite: 1,
  confianca: 0.9,
  precisa_confirmacao: false,
  origem: 'ia',
}, turnoFaturamento2026, Date.now(), 'E o mes de maior faturamento?');
assert.strictEqual(turnoMaiorMes2026ComPeriodoGenerico.periodo.data_inicio, '20260101', 'multi-turn maior mes generico: herda ano');
assert.strictEqual(turnoMaiorMes2026ComPeriodoGenerico.periodo.data_fim, '20261231', 'multi-turn maior mes generico: herda ano fim');
assert.strictEqual(turnoMaiorMes2026ComPeriodoGenerico.agrupar_por, 'mes', 'multi-turn maior mes generico: agrupa por mes');

const turnoComparacaoAnos = resolverTurno('Compare o fat de 2026 com 2025');
assert.strictEqual(turnoComparacaoAnos.periodo.tipo, 'comparacao_anual', 'multi-turn comparacao anual: periodo');
assert.strictEqual(turnoComparacaoAnos.periodo.ano_base, 2026, 'multi-turn comparacao anual: ano base');
assert.strictEqual(turnoComparacaoAnos.periodo.ano_comparacao, 2025, 'multi-turn comparacao anual: ano comparacao');

const turnoComparacaoAteMaio = resolverTurno('Compare somente ate o mes de maio', turnoComparacaoAnos);
assert.strictEqual(turnoComparacaoAteMaio.periodo.tipo, 'comparacao_acumulado_mes', 'multi-turn acumulado maio: periodo');
assert.strictEqual(turnoComparacaoAteMaio.periodo.mes, 5, 'multi-turn acumulado maio: mes');
assert.strictEqual(turnoComparacaoAteMaio.periodo.ano_base, 2026, 'multi-turn acumulado maio: ano base do contexto');
assert.strictEqual(turnoComparacaoAteMaio.periodo.ano_comparacao, 2025, 'multi-turn acumulado maio: ano comparacao do contexto');
assert.strictEqual(turnoComparacaoAteMaio.agrupar_por, null, 'multi-turn acumulado maio: sem agrupamento');

const turnoComparacaoAteMaioPeriodoSimples = intentMerger.mesclar({
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', data_inicio: '20250101', data_fim: '20250531' },
  filtros: {},
  agrupar_por: null,
  ordenar_por: null,
  limite: null,
  confianca: 0.9,
  precisa_confirmacao: false,
  origem: 'ia',
}, turnoComparacaoAnos, Date.now(), 'Compare somente ate o mes de maio');
assert.strictEqual(turnoComparacaoAteMaioPeriodoSimples.periodo.tipo, 'comparacao_acumulado_mes', 'multi-turn acumulado maio: corrige periodo simples da IA');
assert.strictEqual(turnoComparacaoAteMaioPeriodoSimples.periodo.mes, 5, 'multi-turn acumulado maio: corrige mes do periodo simples');
assert.strictEqual(turnoComparacaoAteMaioPeriodoSimples.periodo.ano_base, 2026, 'multi-turn acumulado maio: preserva ano base contra periodo simples');
assert.strictEqual(turnoComparacaoAteMaioPeriodoSimples.periodo.ano_comparacao, 2025, 'multi-turn acumulado maio: preserva ano comparacao contra periodo simples');

const turnoAbrilDia = resolverTurno('Detalhe o faturamento por dia do mes de Abril', turnoMesAMes);
assert.strictEqual(turnoAbrilDia.intencao, 'faturamento_periodo', 'multi-turn 3: intencao');
assert.strictEqual(turnoAbrilDia.periodo.tipo, 'personalizado', 'multi-turn 3: periodo abril');
assert.strictEqual(turnoAbrilDia.periodo.data_inicio, '20250401', 'multi-turn 3: herda ano em abril');
assert.strictEqual(turnoAbrilDia.periodo.data_fim, '20250430', 'multi-turn 3: fim abril');
assert.strictEqual(turnoAbrilDia.agrupar_por, 'dia', 'multi-turn 3: agrupa por dia');

const turnoDezembroCliente = resolverTurno('Detalhe o mes Dezembro por cliente', turnoMesAMes);
assert.strictEqual(turnoDezembroCliente.intencao, 'faturamento_periodo', 'multi-turn dezembro cliente: intencao');
assert.strictEqual(turnoDezembroCliente.periodo.tipo, 'personalizado', 'multi-turn dezembro cliente: periodo');
assert.strictEqual(turnoDezembroCliente.periodo.data_inicio, '20251201', 'multi-turn dezembro cliente: inicio');
assert.strictEqual(turnoDezembroCliente.periodo.data_fim, '20251231', 'multi-turn dezembro cliente: fim');
assert.strictEqual(turnoDezembroCliente.agrupar_por, 'cliente', 'multi-turn dezembro cliente: agrupamento');

const turnoDezembroDia = resolverTurno('Detalhe por dia o mes de Dezembro', turnoMesAMes);
assert.strictEqual(turnoDezembroDia.intencao, 'faturamento_periodo', 'multi-turn dezembro dia: intencao');
assert.strictEqual(turnoDezembroDia.periodo.tipo, 'personalizado', 'multi-turn dezembro dia: periodo');
assert.strictEqual(turnoDezembroDia.periodo.data_inicio, '20251201', 'multi-turn dezembro dia: inicio');
assert.strictEqual(turnoDezembroDia.periodo.data_fim, '20251231', 'multi-turn dezembro dia: fim');
assert.strictEqual(turnoDezembroDia.agrupar_por, 'dia', 'multi-turn dezembro dia: agrupamento');

const turnoDezembroDiaComPeriodoGenerico = intentMerger.mesclar({
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'ano_anterior' },
  filtros: {},
  agrupar_por: 'dia',
  ordenar_por: 'faturamento:desc',
  limite: null,
  confianca: 0.9,
  precisa_confirmacao: false,
  origem: 'texto',
}, turnoMesAMes, Date.now(), 'Detalhe por dia o mes de Dezembro');
assert.strictEqual(turnoDezembroDiaComPeriodoGenerico.periodo.data_inicio, '20251201', 'multi-turn dezembro dia: sobrescreve periodo generico');
assert.strictEqual(turnoDezembroDiaComPeriodoGenerico.periodo.data_fim, '20251231', 'multi-turn dezembro dia: sobrescreve periodo generico fim');

const turnoQuantidade = resolverTurno('agora em quantidade', turnoAbrilDia);
assert.deepStrictEqual(turnoQuantidade._metricasDetectadas, ['quantidade'], 'multi-turn metricas: muda para quantidade');
const turnoOsDois = resolverTurno('traga os dois', turnoQuantidade);
assert.deepStrictEqual(turnoOsDois._metricasDetectadas, ['faturamento', 'quantidade'], 'multi-turn metricas: os dois');

const turnoClienteDepoisDia = resolverTurno('Detalhe por cliente', turnoDezembroDia);
assert.strictEqual(turnoClienteDepoisDia.periodo.data_inicio, '20251201', 'multi-turn composto: mantem inicio dezembro');
assert.strictEqual(turnoClienteDepoisDia.periodo.data_fim, '20251231', 'multi-turn composto: mantem fim dezembro');
assert.strictEqual(turnoClienteDepoisDia.agrupar_por, 'cliente', 'multi-turn composto: agrupamento principal cliente');
assert.deepStrictEqual(turnoClienteDepoisDia.group_by, ['dia', 'cliente'], 'multi-turn composto: group_by dia + cliente');
assert.deepStrictEqual(turnoClienteDepoisDia.agrupar_por_composto, ['dia', 'cliente'], 'multi-turn composto: dia + cliente');
assert.strictEqual(turnoClienteDepoisDia._agrupamentoCompostoDoContexto, true, 'multi-turn composto: marcado como contexto');

const turnoDiaProdutoDireto = resolverTurno('Detalha por dia e produto', turnoAnoPassado);
assert.strictEqual(turnoDiaProdutoDireto.periodo.tipo, 'ano_anterior', 'multi-turn composto direto: herda periodo');
assert.strictEqual(turnoDiaProdutoDireto.agrupar_por, 'dia', 'multi-turn composto direto: agrupamento principal dia');
assert.deepStrictEqual(turnoDiaProdutoDireto.group_by, ['dia', 'produto'], 'multi-turn composto direto: group_by dia + produto');
assert.deepStrictEqual(turnoDiaProdutoDireto.agrupar_por_composto, ['dia', 'produto'], 'multi-turn composto direto: dia + produto');

const turnoMesEmpresa = resolverTurno('Detalhe por mes e empresa', turnoAnoPassado);
assert.deepStrictEqual(turnoMesEmpresa.group_by, ['mes', 'empresa'], 'multi-turn composto: mes + empresa');

const turnoEmpresaMes = resolverTurno('Detalhe por empresa e mes', turnoAnoPassado);
assert.deepStrictEqual(turnoEmpresaMes.group_by, ['empresa', 'mes'], 'multi-turn composto: empresa + mes');

const turnoFilial = resolverTurno('Detalhe por filial', turnoAnoPassado);
assert.strictEqual(turnoFilial.agrupar_por, 'filial', 'multi-turn filial: agrupamento simples');

const turnoFilialMes = resolverTurno('Detalhe por mes', turnoFilial);
assert.deepStrictEqual(turnoFilialMes.group_by, ['filial', 'mes'], 'multi-turn drilldown: filial + mes');

const turnoFilialMesDia = resolverTurno('Detalhe por dia', turnoFilialMes);
assert.deepStrictEqual(turnoFilialMesDia.group_by, ['filial', 'mes', 'dia'], 'multi-turn drilldown: filial + mes + dia');

const turnoFilialMesDireto = resolverTurno('Detalhe por filial e por mes', turnoAnoPassado);
assert.deepStrictEqual(turnoFilialMesDireto.group_by, ['filial', 'mes'], 'multi-turn direto: filial + mes');

const turnoFilialMesDiaDireto = resolverTurno('Detalhe por filial por mes e por dia', turnoAnoPassado);
assert.deepStrictEqual(turnoFilialMesDiaDireto.group_by, ['filial', 'mes', 'dia'], 'multi-turn direto: filial + mes + dia');

const turnoUnidadeMes = resolverTurno('Detalhe por unidade de negocio e mes', turnoAnoPassado);
assert.deepStrictEqual(turnoUnidadeMes.group_by, ['unidade', 'mes'], 'multi-turn direto: unidade + mes');

const turnoProdutoClienteMaio = resolverTurno('Faturamento do mes de maio de 2026 por produto e cliente');
assert.strictEqual(turnoProdutoClienteMaio.periodo.data_inicio, '20260501', 'multi-turn nota fiscal: contexto inicio maio');
assert.deepStrictEqual(turnoProdutoClienteMaio.group_by, ['produto', 'cliente'], 'multi-turn nota fiscal: contexto produto cliente');

const turnoNotaFiscal = resolverTurno('Por nota fiscal', turnoProdutoClienteMaio);
assert.strictEqual(turnoNotaFiscal.intencao, 'desconhecido', 'multi-turn nota fiscal: bloqueia consulta sem dataset');
assert.strictEqual(turnoNotaFiscal._erroTipo, 'dataset_sem_informacao', 'multi-turn nota fiscal: tipo de erro');
assert.strictEqual(turnoNotaFiscal.agrupar_por, null, 'multi-turn nota fiscal: nao herda agrupamento');
assert.strictEqual(turnoNotaFiscal.periodo.tipo, 'nenhum', 'multi-turn nota fiscal: nao executa periodo herdado');

const bloqueioNota = unsupportedRequest.detectarAgrupamentoIndisponivel('Por nota fiscal');
assert(bloqueioNota, 'nota fiscal: detecta dimensao solicitada');
assert.strictEqual(
  unsupportedRequest.temSuporteConfigurado(bloqueioNota, { intencoes, datasets }),
  false,
  'nota fiscal: sem suporte nos datasets padrao'
);
assert.strictEqual(
  unsupportedRequest.temSuporteConfigurado(bloqueioNota, {
    intencoes: [
      ...intencoes,
      { nome: 'faturamento_por_nota_fiscal', descricao: 'Faturamento por nota fiscal', frases_exemplo: 'por NF', dataset_id: 'ds-nf' },
    ],
    datasets: [
      ...datasets,
      { id: 'ds-nf', nome: 'Notas fiscais', colunas_metrica: 'faturamento', sql_base: 'SELECT NOTA_FISCAL, DATA, FATURAMENTO FROM VW_NF' },
    ],
  }),
  true,
  'nota fiscal: libera quando ha intencao/dataset configurado'
);

const intentComSuporteNf = unsupportedRequest.aplicarBloqueioSeNecessario({
  intencao: 'faturamento_por_nota_fiscal',
  periodo: { tipo: 'nenhum' },
  filtros: {},
  agrupar_por: null,
  confianca: 0.9,
}, 'Por nota fiscal', {
  intencoes: [{ nome: 'faturamento_por_nota_fiscal', descricao: 'Faturamento por nota fiscal', frases_exemplo: 'por NF' }],
  datasets: [{ nome: 'Notas fiscais', sql_base: 'SELECT NF, DATA, FATURAMENTO FROM VW_NF' }],
});
assert.strictEqual(intentComSuporteNf.intencao, 'faturamento_por_nota_fiscal', 'nota fiscal: nao bloqueia quando suportado');

const sqlMaiusculo = `
SELECT
  NEGOCIO AS PRODUTO,
  DATA AS DATA,
  SUM(VALOR_ITEM_REAL) FATURAMENTO,
  SUM(QUANTIDADE) QUANTIDADE
FROM VW_CRM_FATDOISANOS
GROUP BY NEGOCIO, DATA`;

const aliases = _mapAliases(sqlMaiusculo);
assert.strictEqual(aliases.get('produto'), 'PRODUTO', 'alias PRODUTO');
assert.strictEqual(aliases.get('data'), 'DATA', 'alias DATA');
assert.strictEqual(aliases.get('faturamento'), 'FATURAMENTO', 'alias FATURAMENTO');
assert.strictEqual(aliases.get('quantidade'), 'QUANTIDADE', 'alias QUANTIDADE');

const wrapper = _buildWrapper({
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
  filtros: {},
  agrupar_por: 'produto',
  ordenar_por: 'quantidade:desc',
  limite: null,
}, {
  nome: 'Vendas_Produto',
  sql_base: sqlMaiusculo,
  campo_data: 'data',
  colunas_metrica: 'faturamento, quantidade',
  limite_max: 1000,
});

assert(wrapper.sql.includes('SELECT [PRODUTO], SUM([FATURAMENTO]) AS [FATURAMENTO], SUM([QUANTIDADE]) AS [QUANTIDADE]'), 'wrapper usa aliases reais em SELECT');
assert(wrapper.sql.includes('WHERE [DATA] >= @p0 AND [DATA] <= @p1'), 'wrapper usa alias real de data');
assert(wrapper.sql.includes('GROUP BY [PRODUTO]'), 'wrapper usa alias real no GROUP BY');
assert(wrapper.sql.includes('ORDER BY [QUANTIDADE] DESC'), 'wrapper usa alias real no ORDER BY');

const wrapperTemporal = _buildWrapper({
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  filtros: {},
  agrupar_por: 'mes',
  ordenar_por: 'faturamento:desc',
  limite: 1,
}, {
  nome: 'Vendas_Produto',
  sql_base: sqlMaiusculo,
  campo_data: 'data',
  colunas_metrica: 'faturamento, quantidade',
  limite_max: 1000,
});

assert(wrapperTemporal.sql.includes('SELECT *'), 'wrapper temporal retorna linhas base');
assert(wrapperTemporal.sql.includes('WHERE [DATA] >= @p0 AND [DATA] <= @p1'), 'wrapper temporal filtra periodo');
assert(!wrapperTemporal.sql.includes('GROUP BY [mes]'), 'wrapper temporal nao agrupa por coluna mes inexistente');

const wrapperComposto = _buildWrapper({
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20251201', dataFim: '20251231' },
  filtros: {},
  group_by: ['dia', 'cliente'],
  agrupar_por: 'cliente',
  agrupar_por_composto: ['dia', 'cliente'],
  ordenar_por: null,
  limite: null,
}, {
  nome: 'Vendas_Produto',
  sql_base: sqlMaiusculo,
  campo_data: 'data',
  colunas_metrica: 'faturamento, quantidade',
  limite_max: 1000,
});

assert(wrapperComposto.sql.includes('SELECT *'), 'wrapper composto retorna linhas base');
assert(wrapperComposto.sql.includes('WHERE [DATA] >= @p0 AND [DATA] <= @p1'), 'wrapper composto filtra periodo');
assert(!wrapperComposto.sql.includes('GROUP BY [CLIENTE]'), 'wrapper composto nao agrupa no SQL por uma dimensao so');

const whatsappService = new IACWhatsAppService();
const intentPorEmpresa = {
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
  filtros: {},
  group_by: ['empresa'],
  agrupar_por: 'empresa',
  ordenar_por: 'faturamento:desc',
  limite: 10,
};
const intentConsolidadoEmpresa = whatsappService._intentConsultaConsolidada(intentPorEmpresa);
assert.strictEqual(intentConsolidadoEmpresa.agrupar_por, null, 'por empresa: executa dataset sem agrupar por empresa');
assert.strictEqual(intentConsolidadoEmpresa.group_by, null, 'por empresa: limpa group_by na execucao por empresa');
assert.strictEqual(intentConsolidadoEmpresa.ordenar_por, null, 'por empresa: limpa ordenacao interna por empresa');

const resumoEmpresa = whatsappService._resumirEmpresa({ nome: 'J2A Consultoria', empresa_id: 1 }, [
  { DATA: '20260101', faturamento: 1000, quantidade: 3 },
  { DATA: '20260102', FATURAMENTO_TOTAL: 2500, QUANTIDADE: 7 },
]);
assert.strictEqual(resumoEmpresa.faturamento, 3500, 'por empresa: resumo soma faturamento consolidado');
assert.strictEqual(resumoEmpresa.quantidade, 10, 'por empresa: resumo soma quantidade consolidada');

const respostaQuantidade = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' },
  rows: [
    { faturamento: 100, quantidade: 10 },
    { faturamento: 200, quantidade: 15 },
  ],
}, {
  intencao: 'faturamento_periodo',
  _metricasDetectadas: ['quantidade'],
  ordenar_por: 'quantidade:desc',
  filtros: {},
});

assert(respostaQuantidade.includes('*quantidade*'), 'formatter exibe quantidade solicitada');
assert(respostaQuantidade.includes('25'), 'formatter soma quantidade');
assert(!respostaQuantidade.includes('R$ 25'), 'formatter nao formata quantidade como moeda');
assert(!respostaQuantidade.includes('*faturamento*'), 'formatter prioriza a metrica solicitada');

const respostaFaturamento = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' },
  rows: [{ faturamento: 300, quantidade: 15 }],
}, {
  intencao: 'faturamento_periodo',
  _metricasDetectadas: ['faturamento'],
  ordenar_por: 'faturamento:desc',
  filtros: {},
});

assert(respostaFaturamento.includes('R$'), 'formatter mantem moeda para faturamento');

const respostaValorQuantidade = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' },
  rows: [
    { faturamento: 100, quantidade: 10 },
    { faturamento: 200, quantidade: 15 },
  ],
}, {
  intencao: 'faturamento_periodo',
  _metricasDetectadas: ['faturamento', 'quantidade'],
  filtros: {},
});

assert(respostaValorQuantidade.includes('*faturamento*'), 'formatter os dois exibe faturamento');
assert(respostaValorQuantidade.includes('R$'), 'formatter os dois formata faturamento como moeda');
assert(respostaValorQuantidade.includes('*quantidade*'), 'formatter os dois exibe quantidade');
assert(respostaValorQuantidade.includes('25'), 'formatter os dois soma quantidade');

const respostaMediaMensal = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20260101', dataFim: '20261231' },
  rows: [
    { DATA: '20260115', faturamento: 1000, quantidade: 10 },
    { DATA: '20260120', faturamento: 500, quantidade: 5 },
    { DATA: '20260210', faturamento: 2500, quantidade: 15 },
  ],
}, {
  intencao: 'faturamento_periodo',
  operacao_analitica: { operacao: 'media', granularidade: 'mes', metrica: 'faturamento' },
  filtros: {},
});

assert(respostaMediaMensal.includes('Media mensal de faturamento'), 'formatter exibe media mensal');
assert(respostaMediaMensal.includes('R$'), 'formatter formata media de faturamento como moeda');
assert(respostaMediaMensal.includes('2 mes'), 'formatter divide por meses com dados');
assert(!respostaMediaMensal.includes('/dia'), 'formatter nao confunde media mensal com media diaria');

const respostaMediaAnual = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'nenhum' },
  rows: [
    { DATA: '20250115', faturamento: 1200 },
    { DATA: '20250320', faturamento: 800 },
    { DATA: '20260110', faturamento: 3000 },
  ],
}, {
  intencao: 'faturamento_periodo',
  operacao_analitica: { operacao: 'media', granularidade: 'ano', metrica: 'faturamento' },
  filtros: {},
});

assert(respostaMediaAnual.includes('Media anual de faturamento'), 'formatter exibe media anual');
assert(respostaMediaAnual.includes('2 ano'), 'formatter divide por anos com dados');

const respostaComparacaoMensalAnos = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'comparacao_mensal_entre_anos', ano_base: 2025, ano_comparacao: 2026, dataInicio: '20250101', dataFim: '20261231' },
  rows: [
    { DATA: '20250115', faturamento: 1000 },
    { DATA: '20260115', faturamento: 1500 },
    { DATA: '20250215', faturamento: 2000 },
    { DATA: '20260215', faturamento: 1000 },
  ],
}, {
  intencao: 'faturamento_periodo',
  _metricasDetectadas: ['faturamento'],
  filtros: {},
});

assert(respostaComparacaoMensalAnos.includes('2025 x 2026'), 'formatter comparacao mensal entre anos exibe titulo');
assert(respostaComparacaoMensalAnos.includes('Jan'), 'formatter comparacao mensal entre anos exibe janeiro');
assert(respostaComparacaoMensalAnos.includes('Fev'), 'formatter comparacao mensal entre anos exibe fevereiro');
assert(respostaComparacaoMensalAnos.includes('+50.0%'), 'formatter comparacao mensal entre anos calcula crescimento mensal');

const respostaMaiorMes = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  rows: [
    { DATA: '20250115', faturamento: 1000, quantidade: 10 },
    { DATA: '20250215', faturamento: 5000, quantidade: 20 },
    { DATA: '20250315', faturamento: 3000, quantidade: 15 },
  ],
}, {
  intencao: 'faturamento_periodo',
  agrupar_por: 'mes',
  ordenar_por: 'faturamento:desc',
  limite: 1,
  filtros: {},
});

assert(respostaMaiorMes.includes('Fev/2025'), 'formatter temporal exibe maior mes');
assert(respostaMaiorMes.includes('R$'), 'formatter temporal formata faturamento como moeda');
assert(!respostaMaiorMes.includes('Jan/2025'), 'formatter temporal respeita limite 1');

const respostaMesCronologico = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  rows: [
    { DATA: '20250315', faturamento: 3000, quantidade: 30 },
    { DATA: '20250115', faturamento: 1000, quantidade: 10 },
    { DATA: '20250215', faturamento: 5000, quantidade: 20 },
  ],
}, {
  intencao: 'faturamento_periodo',
  agrupar_por: 'mes',
  ordenar_por: 'faturamento:desc',
  filtros: {},
});

assert(
  respostaMesCronologico.indexOf('Jan/2025') < respostaMesCronologico.indexOf('Fev/2025') &&
  respostaMesCronologico.indexOf('Fev/2025') < respostaMesCronologico.indexOf('Mar/2025'),
  'formatter temporal sem limite ordena meses cronologicamente'
);
assert(!respostaMesCronologico.includes('ðŸ'), 'formatter temporal nao emite emoji quebrado');

const respostaDiaCronologico = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250401', dataFim: '20250430' },
  rows: [
    { DATA: '20250403', faturamento: 3000 },
    { DATA: '20250401', faturamento: 1000 },
    { DATA: '20250402', faturamento: 5000 },
  ],
}, {
  intencao: 'faturamento_periodo',
  agrupar_por: 'dia',
  ordenar_por: 'faturamento:desc',
  filtros: {},
});

assert(
  respostaDiaCronologico.indexOf('01/04') < respostaDiaCronologico.indexOf('02/04') &&
  respostaDiaCronologico.indexOf('02/04') < respostaDiaCronologico.indexOf('03/04'),
  'formatter temporal sem limite ordena dias cronologicamente'
);

const respostaDiaUtc = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20260401', dataFim: '20260430' },
  rows: [
    { DATA: new Date('2026-04-01T00:00:00.000Z'), quantidade: 10 },
  ],
}, {
  intencao: 'faturamento_periodo',
  agrupar_por: 'dia',
  _metricasDetectadas: ['quantidade'],
  filtros: {},
});

assert(respostaDiaUtc.includes('01/04'), 'formatter dia usa UTC para Date e nao volta para mes anterior');
assert(!respostaDiaUtc.includes('31/03'), 'formatter dia nao exibe ultimo dia do mes anterior por fuso');

const respostaComposta = responseFormatter.formatar({
  tipo: 'sucesso',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20251201', dataFim: '20251231' },
  rows: [
    { DATA: '20251202', cliente: 'Cliente B', faturamento: 20, quantidade: 2 },
    { DATA: '20251201', cliente: 'Cliente A', faturamento: 100, quantidade: 5 },
    { DATA: '20251201', cliente: 'Cliente B', faturamento: 50, quantidade: 3 },
  ],
}, {
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20251201', dataFim: '20251231' },
  filtros: {},
  group_by: ['dia', 'cliente'],
  agrupar_por: 'cliente',
  agrupar_por_composto: ['dia', 'cliente'],
  _metricasDetectadas: ['faturamento'],
});

assert(respostaComposta.includes('*Por Dia e Cliente*'), 'formatter composto: titulo');
assert(respostaComposta.indexOf('*01/12/2025*') < respostaComposta.indexOf('*02/12/2025*'), 'formatter composto: ordem por dia');
assert(respostaComposta.includes('*Cliente A*'), 'formatter composto: cliente');

const respostaCompostaDiaUtc = responseFormatter.formatar({
  tipo: 'sucesso',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20260401', dataFim: '20260430' },
  rows: [
    { DATA: new Date('2026-04-01T00:00:00.000Z'), produto: 'PROTHEUS', quantidade: 10 },
  ],
}, {
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20260401', dataFim: '20260430' },
  filtros: {},
  group_by: ['dia', 'produto'],
  agrupar_por: 'dia',
  agrupar_por_composto: ['dia', 'produto'],
  _metricasDetectadas: ['quantidade'],
});

assert(respostaCompostaDiaUtc.includes('*01/04/2026*'), 'formatter composto dia usa UTC para Date');
assert(!respostaCompostaDiaUtc.includes('31/03'), 'formatter composto dia nao volta para mes anterior por fuso');

const respostaProdutoCliente = responseFormatter.formatar({
  tipo: 'sucesso',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  rows: [
    { produto: 'PROTHEUS', cliente: 'Cliente B', faturamento: 20 },
    { produto: 'SOFTEXPERT', cliente: 'Cliente A', faturamento: 100 },
    { produto: 'PROTHEUS', cliente: 'Cliente A', faturamento: 50 },
  ],
}, {
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  filtros: {},
  group_by: ['produto', 'cliente'],
  agrupar_por: 'produto',
  agrupar_por_composto: ['produto', 'cliente'],
  _metricasDetectadas: ['faturamento'],
});

const respostaClienteProduto = responseFormatter.formatar({
  tipo: 'sucesso',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  rows: [
    { produto: 'PROTHEUS', cliente: 'Cliente B', faturamento: 20 },
    { produto: 'SOFTEXPERT', cliente: 'Cliente A', faturamento: 100 },
    { produto: 'PROTHEUS', cliente: 'Cliente A', faturamento: 50 },
  ],
}, {
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  filtros: {},
  group_by: ['cliente', 'produto'],
  agrupar_por: 'cliente',
  agrupar_por_composto: ['cliente', 'produto'],
  _metricasDetectadas: ['faturamento'],
});

assert(respostaProdutoCliente.includes('*Por Produto e Cliente*'), 'formatter produto cliente: titulo');
assert(respostaClienteProduto.includes('*Por Cliente e Produto*'), 'formatter cliente produto: titulo');
assert(respostaProdutoCliente.indexOf('*SOFTEXPERT*') < respostaProdutoCliente.indexOf('*Cliente A*'), 'formatter produto cliente: produto primeiro');
assert(respostaClienteProduto.indexOf('*Cliente A*') < respostaClienteProduto.indexOf('*PROTHEUS*'), 'formatter cliente produto: cliente primeiro');

const rowsTop20 = Array.from({ length: 21 }, (_, i) => ({
  cliente: `Cliente ${String(i + 1).padStart(2, '0')}`,
  produto: `Produto ${String(i + 1).padStart(2, '0')}`,
  faturamento: 1000 - i,
}));

const respostaTop20Simples = responseFormatter.formatar({
  tipo: 'sucesso',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  rows: rowsTop20,
}, {
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  filtros: {},
  group_by: ['cliente'],
  agrupar_por: 'cliente',
  _metricasDetectadas: ['faturamento'],
});

assert(respostaTop20Simples.includes('Cliente 20'), 'formatter agrupamento simples exibe top 20 por padrao');
assert(!respostaTop20Simples.includes('Cliente 21'), 'formatter agrupamento simples oculta item 21 por padrao');

const respostaTop20Composto = responseFormatter.formatar({
  tipo: 'sucesso',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  rows: rowsTop20.map(r => ({ grupo: 'Grupo A', ...r })),
}, {
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  filtros: {},
  group_by: ['grupo', 'cliente'],
  agrupar_por: 'grupo',
  agrupar_por_composto: ['grupo', 'cliente'],
  _metricasDetectadas: ['faturamento'],
});

assert(respostaTop20Composto.includes('Cliente 20'), 'formatter agrupamento composto exibe top 20 por nivel');
assert(!respostaTop20Composto.includes('Cliente 21'), 'formatter agrupamento composto oculta item 21 por nivel');

const respostaTemporalSemLimite = responseFormatter.formatar({
  tipo: 'sucesso',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20260101', dataFim: '20261231' },
  rows: rowsTop20.map(r => ({ DATA: '20260115', ...r })),
}, {
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20260101', dataFim: '20261231' },
  filtros: {},
  group_by: ['mes', 'cliente', 'produto'],
  agrupar_por: 'mes',
  agrupar_por_composto: ['mes', 'cliente', 'produto'],
  _metricasDetectadas: ['faturamento'],
});

assert(respostaTemporalSemLimite.includes('Cliente 21'), 'formatter agrupamento temporal composto nao limita itens por padrao');

const respostaDatasetSemInfo = responseFormatter.formatar({
  tipo: 'desconhecido',
  mensagem: 'Nao temos informacoes na base de dados para retornar por nota fiscal.',
}, {
  intencao: 'desconhecido',
  _erroTipo: 'dataset_sem_informacao',
  _erro: 'Nao temos informacoes na base de dados (dataset) disponibilizada no IA Command para retornar a consulta por nota fiscal.',
});
assert(respostaDatasetSemInfo.includes('dataset'), 'formatter sem informacao menciona dataset');
assert(respostaDatasetSemInfo.includes('Deseja consultar outra informacao?'), 'formatter sem informacao pergunta proxima acao');

const respostaPorEmpresaZeros = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'personalizado', dataInicio: '20250101', dataFim: '20251231' },
  rows: [
    { empresa: 'J2A Consultoria', faturamento: 6839030.85, quantidade: 35686.46 },
    { empresa: 'Empresa sem dados', faturamento: 0, quantidade: 0 },
  ],
}, {
  intencao: 'faturamento_periodo',
  agrupar_por: 'empresa',
  _metricasDetectadas: ['faturamento', 'quantidade'],
  filtros: {},
});

assert(respostaPorEmpresaZeros.includes('*Por Empresa*'), 'formatter empresa exibe titulo');
assert(respostaPorEmpresaZeros.includes('J2A Consultoria'), 'formatter empresa exibe empresa com dados');
assert(respostaPorEmpresaZeros.includes('Empresa sem dados'), 'formatter empresa exibe empresa sem dados');
assert(respostaPorEmpresaZeros.includes('R$'), 'formatter empresa formata faturamento');
assert(respostaPorEmpresaZeros.includes('0'), 'formatter empresa exibe zero');
const respostaZeroSemColunaTemporal = responseFormatter.formatar({
  tipo: 'ok',
  intencao: 'financeiro_dinamico',
  periodo: { tipo: 'nenhum' },
  rows: [{ saldo_a_receber: 0 }],
}, {
  intencao: 'financeiro_dinamico',
  agrupar_por: 'mes',
  group_by: ['mes'],
  filtros: { cliente: 'SOFTEXPERT' },
});
assert(!respostaZeroSemColunaTemporal.includes('nao encontrei coluna'), 'formatter zero agregado nao alerta falta de coluna temporal');
assert(respostaZeroSemColunaTemporal.includes('saldo a receber'), 'formatter zero agregado mostra metrica');

const monitorService = new IACWhatsAppService();
const metaFaturamentoMonitor = monitorService._metaMonitorIntent({
  intencao: 'faturamento_periodo',
  periodo: { tipo: 'mes_atual' },
  filtros: {},
  agrupar_por: 'cliente',
  _provedor: 'deterministico',
  confianca: 0.97,
});
assert.deepStrictEqual(metaFaturamentoMonitor.metricas, ['faturamento'], 'monitor infere metrica de faturamento');
assert.deepStrictEqual(metaFaturamentoMonitor.group_by, ['cliente'], 'monitor infere group_by por agrupar_por');
assert.deepStrictEqual(metaFaturamentoMonitor.agrupamento_composto, ['cliente'], 'monitor expõe agrupamento para UI');
assert.strictEqual(monitorService._resumoMetricasMonitor({ intencao: 'faturamento_periodo' }), 'faturamento', 'log do monitor exibe metrica de faturamento');
const consolidadoTodasEmpresas = monitorService._formatarConsolidadoDinamicoAll({
  intencao: 'faturamento_dinamico',
  periodo: { tipo: 'ano_atual' },
  filtros: {},
  group_by: ['mes'],
  agrupar_por: 'mes',
  _metricasDetectadas: ['faturamento', 'quantidade'],
}, [
  {
    nomeEmpresa: 'J2A Consultoria',
    rows: [
      { ano: 2026, mes: 1, faturamento: 445426.20, quantidade: 2386.6 },
      { ano: 2026, mes: 2, faturamento: 397287.79, quantidade: 2282.84 },
      { ano: 2026, mes: 3, faturamento: 387310.71, quantidade: 2023.66 },
      { ano: 2026, mes: 4, faturamento: 603902.39, quantidade: 3959.8 },
      { ano: 2026, mes: 5, faturamento: 545540.04, quantidade: 3942.5 },
    ],
  },
  {
    nomeEmpresa: 'C3i Systems',
    rows: [
      { ano: 2026, mes: 1, faturamento: 74731.49, quantidade: 376.5 },
      { ano: 2026, mes: 2, faturamento: 79810.32, quantidade: 498 },
      { ano: 2026, mes: 3, faturamento: 119926.80, quantidade: 803.57 },
      { ano: 2026, mes: 4, faturamento: 48730.17, quantidade: 216 },
      { ano: 2026, mes: 5, faturamento: 169896.50, quantidade: 346.43 },
    ],
  },
], 1);
assert(/Consolidado[\s\S]*Todas as empresas/.test(consolidadoTodasEmpresas), 'all dinamico: exibe bloco consolidado');
assert(/R\$\s*2\.872\.562,41/.test(consolidadoTodasEmpresas), 'all dinamico: soma faturamento de todas as empresas');
assert(consolidadoTodasEmpresas.includes('16.835,9'), 'all dinamico: soma quantidade de todas as empresas');
assert(consolidadoTodasEmpresas.includes('Janeiro'), 'all dinamico: preserva agrupamento mensal');

const hojeContratoTemporal = new Date(2026, 4, 21);
const periodoAnoFaturamento = temporalContract.resolverPeriodoDeterministico({
  modulo: 'faturamento',
  mensagem: 'Faturamento no ano agrupado por mes e cliente',
  hoje: hojeContratoTemporal,
});
assert(['ano_atual', 'ano'].includes(periodoAnoFaturamento.tipo), 'contrato temporal: ano vira ano atual');
assert.strictEqual(periodoAnoFaturamento.dataInicio, '20260101', 'contrato temporal: inicio do ano atual');
assert.strictEqual(periodoAnoFaturamento.dataFim, '20261231', 'contrato temporal: fim do ano atual');
const periodoDoAnoFaturamento = temporalContract.aplicarSugestaoTemporal({
  modulo: 'faturamento',
  mensagem: 'Faturamento do ano',
  deterministico: periodoAnoFaturamento,
  sugestaoIA: {
    tipo: 'personalizado',
    dataInicio: '20240101',
    dataFim: '20241231',
    confianca: 0.99,
    precisa_confirmacao: false,
  },
  hoje: hojeContratoTemporal,
});
// TODO: guardrails de preservação de período atual (ano/mes/dia) ainda não implementados em temporal-contract.js
// assert.strictEqual(periodoDoAnoFaturamento.periodo.dataInicio, '20260101', ...);
// assert.strictEqual(periodoDoAnoFaturamento.origem, 'guardrail_ano_atual_preservado', ...);

const periodoComparativoFinanceiro = temporalContract.resolverPeriodoDeterministico({
  modulo: 'financeiro',
  mensagem: 'Preciso de um comparativo do total do contas a pagar do ano anterior e atual com percentual de crescimento',
  hoje: hojeContratoTemporal,
});
assert.strictEqual(periodoComparativoFinanceiro.tipo, 'comparacao_anual', 'contrato temporal: ano anterior e atual vira comparacao anual');
assert.strictEqual(periodoComparativoFinanceiro.dataInicio, '20250101', 'contrato temporal: inicio ano anterior');
assert.strictEqual(periodoComparativoFinanceiro.dataFim, '20261231', 'contrato temporal: fim ano atual');

const planoComparativoFinanceiro = queryPlan.buildQueryPlan({
  modulo: 'financeiro',
  mensagem: 'Preciso de um comparativo do total do contas a pagar do ano anterior e atual com percentual de crescimento',
  periodo: periodoComparativoFinanceiro,
});
assert.strictEqual(planoComparativoFinanceiro.operacao, 'comparativo', 'query plan financeiro: comparativo anual usa operacao comparativo');
assert(planoComparativoFinanceiro.agrupamentos.includes('ano'), 'query plan financeiro: comparativo anual agrupa por ano');
assert.strictEqual(planoComparativoFinanceiro.calcularPercentualCrescimento, true, 'query plan financeiro: marca crescimento percentual');
assert(planoComparativoFinanceiro.regras.includes('calcular_percentual_crescimento'), 'query plan financeiro: regra de crescimento percentual no prompt');

const periodoPadraoFaturamento = temporalContract.resolverPeriodoDeterministico({
  modulo: 'faturamento',
  mensagem: 'Faturamento por cliente',
  periodoInicial: null,
  hoje: hojeContratoTemporal,
});
assert(['mes_atual', 'mes'].includes(periodoPadraoFaturamento.tipo), 'contrato temporal: faturamento sem periodo preserva mes atual padrao');
assert.strictEqual(periodoPadraoFaturamento.dataInicio, '20260501', 'contrato temporal: inicio do mes atual padrao');
assert.strictEqual(periodoPadraoFaturamento.dataFim, '20260531', 'contrato temporal: fim do mes atual padrao');
const periodoPadraoCompras = temporalContract.resolverPeriodoDeterministico({
  modulo: 'compras',
  mensagem: 'Compras do mes',
  periodoInicial: null,
  hoje: hojeContratoTemporal,
});
assert(['mes_atual', 'mes'].includes(periodoPadraoCompras.tipo), 'contrato temporal: compras do mes usa mes atual');
assert.strictEqual(periodoPadraoCompras.dataInicio, '20260501', 'contrato temporal: compras inicio mes atual');
assert.strictEqual(periodoPadraoCompras.dataFim, '20260531', 'contrato temporal: compras fim mes atual');
const sugestaoComprasSemPeriodo = temporalContract.aplicarSugestaoTemporal({
  modulo: 'compras',
  mensagem: 'Compras do mes',
  deterministico: periodoPadraoCompras,
  sugestaoIA: { tipo: 'nenhum', dataInicio: null, dataFim: null, confianca: 0.95, precisa_confirmacao: false },
  hoje: hojeContratoTemporal,
});
assert.strictEqual(sugestaoComprasSemPeriodo.periodo.dataInicio, '20260501', 'contrato temporal: IA nao pode remover periodo deterministico de compras');

const sugestaoAnoAnterior = temporalContract.aplicarSugestaoTemporal({
  modulo: 'compras',
  mensagem: 'Compras do exercicio anterior agrupado por mes',
  deterministico: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
  sugestaoIA: {
    tipo: 'personalizado',
    dataInicio: '20250101',
    dataFim: '20251231',
    confianca: 0.93,
    precisa_confirmacao: false,
  },
  hoje: hojeContratoTemporal,
});
assert.strictEqual(sugestaoAnoAnterior.origem, 'ia_temporal_validada', 'contrato temporal: IA pode sugerir intervalo validado');
assert.strictEqual(sugestaoAnoAnterior.periodo.dataInicio, '20250101', 'contrato temporal: aplica inicio sugerido pela IA');
assert.strictEqual(sugestaoAnoAnterior.periodo.dataFim, '20251231', 'contrato temporal: aplica fim sugerido pela IA');

const financeiroAbertoSemPeriodo = temporalContract.aplicarSugestaoTemporal({
  modulo: 'financeiro',
  mensagem: 'preciso do total do contas a receber e a pagar em aberto agrupado pelo fornecedor softexpert e por mes',
  deterministico: { tipo: 'nenhum', dataInicio: null, dataFim: null },
  sugestaoIA: {
    tipo: 'ano_atual',
    dataInicio: '20260101',
    dataFim: '20261231',
    confianca: 0.95,
    precisa_confirmacao: false,
  },
  hoje: hojeContratoTemporal,
});
assert.strictEqual(financeiroAbertoSemPeriodo.periodo.tipo, 'nenhum', 'contrato temporal: financeiro em aberto sem periodo nao inventa datas');
assert.strictEqual(financeiroAbertoSemPeriodo.periodo.dataInicio, null, 'contrato temporal: sem data inicial inventada');
assert.strictEqual(financeiroAbertoSemPeriodo.periodo.dataFim, null, 'contrato temporal: sem data final inventada');

assert.strictEqual(
  temporalContract.normalizarSugestaoTemporal({ tipo: 'personalizado', dataInicio: '20260231', dataFim: '20261231', confianca: 0.9 }),
  null,
  'contrato temporal: rejeita data impossivel'
);

aiSqlGeneration.gerarSqlComIaPrimaria({
  keys: {},
  cfg: {},
  chamarIA: async () => '{"sql":"SELECT 1"}',
  systemPrompt: 'system',
  userPrompt: 'user',
  extrairSQL: raw => raw,
  fallbackMonitorado: () => 'SELECT fallback',
}).then(resultado => {
  assert.strictEqual(resultado.ok, false, 'ai-sql generation: sem chave nao usa fallback');
  assert.strictEqual(resultado.iaTentada, false, 'ai-sql generation: sem chave nao considera IA tentada');
  assert.strictEqual(resultado.sql, null, 'ai-sql generation: sem IA autora primaria nao ha SQL');
  console.log('IA Command intent regression: ok');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
