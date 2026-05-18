const assert = require('assert');

const localResolver = require('../apps/IA Command/modules/ai/local-intent-resolver');
const { identificarPeriodoTexto, resolverPeriodo } = require('../apps/IA Command/modules/ai/period-resolver');
const { _SINONIMOS_SISTEMA } = require('../apps/IA Command/modules/ai/intent-service');
const { _buildWrapper, _mapAliases } = require('../apps/IA Command/modules/erp/dataset-query-engine');

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

expectLocal('fat do mes vs ano passado', {
  intencao: 'faturamento_periodo',
  periodo: 'comparacao_mensal',
});

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

const periodoResolvido = resolverPeriodo({ tipo: 'ultimos_N_dias', dias: 7 }, new Date('2026-05-17T12:00:00'));
assert.strictEqual(periodoResolvido.dataInicio, '20260511', 'ultimos_N_dias: dataInicio');
assert.strictEqual(periodoResolvido.dataFim, '20260517', 'ultimos_N_dias: dataFim');

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

console.log('IA Command intent regression: ok');
