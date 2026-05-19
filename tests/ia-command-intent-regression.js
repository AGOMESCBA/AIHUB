const assert = require('assert');

const localResolver = require('../apps/IA Command/modules/ai/local-intent-resolver');
const intentMerger = require('../apps/IA Command/modules/ai/intent-merger');
const { identificarPeriodoTexto, resolverPeriodo } = require('../apps/IA Command/modules/ai/period-resolver');
const { _SINONIMOS_SISTEMA } = require('../apps/IA Command/modules/ai/intent-service');
const { _buildWrapper, _mapAliases } = require('../apps/IA Command/modules/erp/dataset-query-engine');
const responseFormatter = require('../apps/IA Command/modules/erp/response-formatter');

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
assert.deepStrictEqual(intentProdutoDia.agrupar_por_composto, ['dia', 'produto'], 'produto e dia: agrupamento composto');

const intentDiaProduto = localResolver.resolverLocal('faturamento por dia e produto no mes', intencoes, _SINONIMOS_SISTEMA, { datasets });
assert(intentDiaProduto, 'agrupamento composto dia e produto deve resolver localmente');
assert.strictEqual(intentDiaProduto.agrupar_por, 'produto', 'dia e produto: agrupamento principal');
assert.deepStrictEqual(intentDiaProduto.agrupar_por_composto, ['dia', 'produto'], 'dia e produto: agrupamento composto');

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

expectNoLocal('me mostra esse negocio ai');

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
assert.deepStrictEqual(turnoClienteDepoisDia.agrupar_por_composto, ['dia', 'cliente'], 'multi-turn composto: dia + cliente');
assert.strictEqual(turnoClienteDepoisDia._agrupamentoCompostoDoContexto, true, 'multi-turn composto: marcado como contexto');

const turnoDiaProdutoDireto = resolverTurno('Detalha por dia e produto', turnoAnoPassado);
assert.strictEqual(turnoDiaProdutoDireto.periodo.tipo, 'ano_anterior', 'multi-turn composto direto: herda periodo');
assert.strictEqual(turnoDiaProdutoDireto.agrupar_por, 'produto', 'multi-turn composto direto: agrupamento principal produto');
assert.deepStrictEqual(turnoDiaProdutoDireto.agrupar_por_composto, ['dia', 'produto'], 'multi-turn composto direto: dia + produto');

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
  agrupar_por: 'cliente',
  agrupar_por_composto: ['dia', 'cliente'],
  _metricasDetectadas: ['faturamento'],
});

assert(respostaComposta.includes('*Por Dia e Cliente*'), 'formatter composto: titulo');
assert(respostaComposta.indexOf('*01/12*') < respostaComposta.indexOf('*02/12*'), 'formatter composto: ordem por dia');
assert(respostaComposta.includes('*Cliente A*'), 'formatter composto: cliente');

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

console.log('IA Command intent regression: ok');
