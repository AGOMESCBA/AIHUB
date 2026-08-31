'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const datasetRunner = require(path.join(ROOT, 'modules/erp/core/semantic-dataset-ai-runner'));
const queryPlan = require(path.join(ROOT, 'modules/erp/core/query-plan'));
const faturamentoSpec = require(path.join(ROOT, 'modules/erp/totvs_protheus/faturamento/faturamento-ia-owner-spec'));

const systemPrompt = promptBuilder.buildSystemPrompt(faturamentoSpec);
assert(systemPrompt.includes('Para cliente SEM LOJA ou todos os registros do mesmo codigo'), 'prompt deve preservar regra de cliente sem loja');
assert(systemPrompt.includes('faturamento_liquido'), 'prompt deve orientar regras de devolucao/liquido quando solicitado');
assert(systemPrompt.includes('data_atual') && systemPrompt.includes('GUIA TECNICO DE SQL'), 'prompt deve manter ancora cronologica e respeitar guia tecnico');
assert(systemPrompt.includes('DIRETRIZ DE SELECAO DE TABELAS') && systemPrompt.includes('Consultas por QUANTIDADE ou filtros de Produto/Item'), 'prompt deve diferenciar consulta geral de item');
assert(systemPrompt.includes('REGRA FISCAL BRASILEIRA DE CFOP PARA RECEITA'), 'prompt deve definir receita excluindo saidas sem receita operacional por padrao');
assert(systemPrompt.includes("SD2.D2_CF NOT IN ('5151','6151','5152','6152','5155','6155','5156','6156')"), 'prompt deve excluir transferencia do faturamento/vendas por padrao');
assert(systemPrompt.includes("AND NOT (SD2.D2_CF LIKE '52%' OR SD2.D2_CF LIKE '62%')"), 'prompt deve excluir devolucao de compra do faturamento/vendas por padrao');
assert(systemPrompt.includes("SD2.D2_CF NOT IN ('5410','6410','5411','6411','5412','6412','5413','6413')"), 'prompt deve excluir devolucao de compra ST do faturamento/vendas por padrao');
assert(systemPrompt.includes("AND NOT (SD2.D2_CF LIKE '55%' OR SD2.D2_CF LIKE '65%')"), 'prompt deve excluir ativo/material de uso e consumo do faturamento/vendas por padrao');
assert(systemPrompt.includes("AND NOT (SD2.D2_CF LIKE '56%' OR SD2.D2_CF LIKE '66%')"), 'prompt deve excluir credito/ressarcimento de ICMS do faturamento/vendas por padrao');
assert(systemPrompt.includes('prefixo 7 = operacao para exterior/exportacao'), 'prompt deve explicar CFOP 7xxx como saida/exportacao');
assert(systemPrompt.includes("LIKE '59%' OR LIKE '69%'"), 'prompt deve permitir filtro invertido quando a pergunta pedir simples remessa especificamente');
assert(systemPrompt.includes("IN ('5151','6151','5152','6152','5155','6155','5156','6156')"), 'prompt deve permitir filtro de lista fixa quando a pergunta pedir transferencia especificamente');
assert(systemPrompt.includes("Quantidade carregada: SUM(SD2.D2_QUANT), com JOIN adicional SD2 -> SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' ' AND SF4.F4_ESTOQUE = 'S'"), 'prompt deve definir quantidade carregada usando JOIN SF4/F4_ESTOQUE=S em vez de filtro de CF');
assert(systemPrompt.includes("Entrega futura, venda para entrega futura ou nota mae: SUM(SD2.D2_QUANT), filtrando SD2.D2_CF IN ('5117', '6117')"), 'prompt deve definir entrega futura/nota mae como CF 5117 e 6117 (estadual e interestadual)');
assert(systemPrompt.includes('Movimentacao total, todas as saidas, volume total, sem filtro fiscal ou incluindo remessa/transferencia'), 'prompt deve permitir movimentacao total sem filtro fiscal');
assert(systemPrompt.includes('Continuidade e Periodo no Faturamento'), 'prompt deve conter regra modular de continuidade/periodo');
assert(systemPrompt.includes('periodo_base e periodo_comparacao'), 'prompt deve exigir dois periodos em comparativo de continuidade');
assert(systemPrompt.includes('"por grupo de produto"') && systemPrompt.includes('NAO inclua SB1.B1_COD/produto'), 'prompt deve orientar grupo de produto sem granularidade extra por produto');

const periodoDiretoJunhoJulho = runner._test.periodoDeterministicoMensagem(
  'Compare o faturamento de junho do ano passado com julho do ano passado'
);
assert.strictEqual(periodoDiretoJunhoJulho.dataInicio, '20250601');
assert.strictEqual(periodoDiretoJunhoJulho.dataFim, '20250731');
assert.strictEqual(periodoDiretoJunhoJulho.periodos_comparativos.length, 2, 'runner deve resolver comparativo direto com dois periodos');

const sqlPeriodoErradoFaturamento = `
SET ROWCOUNT 50000;
SELECT SUM(SD2.D2_TOTAL) AS faturamento_julho
FROM SD2990 SD2
JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL
  AND SD2.D2_DOC = SF2.F2_DOC
  AND SD2.D2_SERIE = SF2.F2_SERIE
  AND SD2.D2_CLIENTE = SF2.F2_CLIENTE
  AND SD2.D2_LOJA = SF2.F2_LOJA
WHERE SF2.F2_EMISSAO BETWEEN '20230701' AND '20230731'
  AND SF2.D_E_L_E_T_ = ' '
  AND SD2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO = 'N';
`;
const validacaoPeriodoErradoFaturamento = runner._test.validarPeriodoDeclaradoNoSql(
  sqlPeriodoErradoFaturamento,
  faturamentoSpec,
  { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
);
assert.strictEqual(validacaoPeriodoErradoFaturamento.ok, false, 'faturamento deve rejeitar julho/2023 quando contrato exige julho/2025');
assert(validacaoPeriodoErradoFaturamento.erros.join(' ').includes('20250701'), 'erro deve citar periodo autoritativo de faturamento');

const sqlPeriodoCorretoFaturamento = sqlPeriodoErradoFaturamento.replace(/202307/g, '202507');
const validacaoPeriodoCorretoFaturamento = runner._test.validarPeriodoDeclaradoNoSql(
  sqlPeriodoCorretoFaturamento,
  faturamentoSpec,
  { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
);
assert.strictEqual(validacaoPeriodoCorretoFaturamento.ok, true, `faturamento deve aceitar periodo autoritativo correto: ${validacaoPeriodoCorretoFaturamento.erros.join(' | ')}`);

const planoComparativo = runner._test.aplicarPeriodosComparativoContinuidade(
  runner._test.construirQueryPlanTecnico({
    spec: faturamentoSpec,
    mensagem: 'Compare esse resultado com julho do ano passado.',
    periodo: { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
    filtros: {},
    entidades: [],
  }),
  {
    _contextoUsadoOrquestrador: {
      periodo: { tipo: 'mensal', dataInicio: '20250601', dataFim: '20250630' },
    },
  },
  { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
);
const planoComparativoTexto = queryPlan.formatQueryPlanForPrompt(planoComparativo);
assert(planoComparativoTexto.includes('periodo_base: 20250601 a 20250630'), 'query_plan deve expor periodo base herdado');
assert(planoComparativoTexto.includes('periodo_comparacao: 20250701 a 20250731'), 'query_plan deve expor periodo de comparacao');
const planoComparativoCliente = { ...planoComparativo, agrupamentos: ['cliente'] };
const planoComparativoClienteTexto = queryPlan.formatQueryPlanForPrompt(planoComparativoCliente);
assert(planoComparativoClienteTexto.includes('agrupamentos_sugeridos: cliente'), 'query_plan comparativo deve expor agrupamento herdado como sugestao');
assert(planoComparativoClienteTexto.includes('leitura semantica auxiliar'), 'query_plan deve orientar agrupamento como leitura auxiliar em continuidade');
assert(planoComparativoTexto.includes('comparativo_continuidade'), 'query_plan deve orientar SQL com dois periodos');

const planoComparativoClienteViaIntent = runner._test.prepararPlanoConsultaTecnico({
  spec: faturamentoSpec,
  mensagem: 'Compare esse resultado com julho do ano passado.',
  periodo: { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
  filtros: {},
  entidades: [],
  intent: {
    group_by: ['cliente'],
    _contextoUsadoOrquestrador: {
      periodo: { tipo: 'mensal', dataInicio: '20250601', dataFim: '20250630' },
    },
  },
});
const planoComparativoClienteViaIntentTexto = queryPlan.formatQueryPlanForPrompt(planoComparativoClienteViaIntent);
assert(planoComparativoClienteViaIntentTexto.includes('agrupamentos_sugeridos: cliente'), 'runner deve propagar group_by do Intent Canonico para o query_plan como sugestao');
assert(Array.isArray(planoComparativoClienteViaIntent.periodos_comparativos) && planoComparativoClienteViaIntent.periodos_comparativos.length === 2, 'runner deve manter periodos comparativos junto com agrupamento do intent');

const planoGrupoProdutoDia = queryPlan.buildQueryPlan({
  modulo: 'faturamento',
  mensagem: 'Faturamento do dia por grupo de produto',
  periodo: { tipo: 'hoje', dataInicio: '20260824', dataFim: '20260824' },
});
assert.deepStrictEqual(
  planoGrupoProdutoDia.agrupamentos,
  ['grupo_produto'],
  'query_plan nao deve transformar "grupo de produto" em agrupamento adicional por produto',
);
const sqlGrupoProdutoDia = `
SET ROWCOUNT 50000;
WITH faturamento AS (
  SELECT COALESCE(SUM(SD2.D2_TOTAL), 0) AS valor_total, SBM.BM_DESC AS grupo_produto
  FROM SD2010 SD2
  JOIN SF2010 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
  JOIN SB1010 SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
  JOIN SBM010 SBM ON SB1.B1_GRUPO = SBM.BM_GRUPO AND SBM.D_E_L_E_T_ = ' '
  WHERE SF2.F2_TIPO = 'N' AND SF2.F2_EMISSAO = '20260824' AND SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' '
  GROUP BY SBM.BM_GRUPO, SBM.BM_DESC
)
SELECT * FROM faturamento;
`;
const validacaoGrupoProdutoDia = queryPlan.validarSqlContraPlano(sqlGrupoProdutoDia, planoGrupoProdutoDia);
assert.strictEqual(validacaoGrupoProdutoDia.ok, true, `query_plan deve aceitar faturamento por grupo de produto sem exigir produto: ${validacaoGrupoProdutoDia.erros.join(' | ')}`);

const validacaoComparativoIncompleto = runner._test.validarPeriodosComparativosNoSql(
  sqlPeriodoCorretoFaturamento,
  faturamentoSpec,
  planoComparativo,
);
assert.strictEqual(validacaoComparativoIncompleto.ok, false, 'comparativo deve rejeitar SQL que retornou apenas julho');
assert(/periodo|competencia|comparativo/i.test(validacaoComparativoIncompleto.erros.join(' ')), 'erro do comparativo deve explicar falha temporal/comparativa');

const sqlComparativoCompleto = `
SET ROWCOUNT 10000;
SELECT '202506' AS competencia, SUM(SD2.D2_TOTAL) AS faturamento_total
FROM SF2990 SF2
JOIN SD2990 SD2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
WHERE SF2.F2_EMISSAO BETWEEN '20250601' AND '20250630' AND SF2.F2_TIPO = 'N' AND SF2.D_E_L_E_T_ = ' ' AND SD2.D_E_L_E_T_ = ' '
UNION ALL
SELECT '202507' AS competencia, SUM(SD2.D2_TOTAL) AS faturamento_total
FROM SF2990 SF2
JOIN SD2990 SD2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
WHERE SF2.F2_EMISSAO BETWEEN '20250701' AND '20250731' AND SF2.F2_TIPO = 'N' AND SF2.D_E_L_E_T_ = ' ' AND SD2.D_E_L_E_T_ = ' ';
`;
const validacaoComparativoCompleto = runner._test.validarPeriodosComparativosNoSql(
  sqlComparativoCompleto,
  faturamentoSpec,
  planoComparativo,
);
assert.strictEqual(validacaoComparativoCompleto.ok, true, `comparativo deve aceitar SQL com os dois periodos: ${validacaoComparativoCompleto.erros.join(' | ')}`);

const sqlComparativoSobreposto = `
SET ROWCOUNT 10000;
SELECT SUBSTRING(SF2.F2_EMISSAO, 1, 6) AS competencia, SUM(SD2.D2_TOTAL) AS faturamento
FROM SF2990 SF2
JOIN SD2990 SD2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SD2.D_E_L_E_T_ = ' '
WHERE SF2.F2_TIPO = 'N'
  AND SF2.D_E_L_E_T_ = ' '
  AND (SUBSTRING(SF2.F2_EMISSAO, 5, 2) = '06' AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) = '2025' OR SUBSTRING(SF2.F2_EMISSAO, 5, 2) = '07' AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) = '2025')
GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 6)
UNION ALL
SELECT SUBSTRING(SF2.F2_EMISSAO, 1, 6) AS competencia, SUM(SD2.D2_TOTAL) AS faturamento
FROM SF2990 SF2
JOIN SD2990 SD2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SD2.D_E_L_E_T_ = ' '
WHERE SF2.F2_TIPO = 'N'
  AND SF2.D_E_L_E_T_ = ' '
  AND SUBSTRING(SF2.F2_EMISSAO, 5, 2) = '07' AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) = '2025'
GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 6);
`;
const validacaoComparativoSobreposto = runner._test.validarPeriodosComparativosNoSql(
  sqlComparativoSobreposto,
  faturamentoSpec,
  planoComparativo,
);
assert.strictEqual(validacaoComparativoSobreposto.ok, false, 'comparativo deve rejeitar UNION ALL que duplica ou sobrepoe competencias');
const validacaoPeriodoComparativoCompleto = runner._test.validarPeriodoDeclaradoNoSql(
  sqlComparativoCompleto,
  faturamentoSpec,
  { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
  { periodosPermitidos: planoComparativo.periodos_comparativos },
);
assert.strictEqual(validacaoPeriodoComparativoCompleto.ok, true, `periodo principal deve aceitar periodo_base no comparativo: ${validacaoPeriodoComparativoCompleto.erros.join(' | ')}`);

const periodosDatasetDeclarados = datasetRunner._test._periodosComparativosDataset({
  periodo: {
    tipo: 'personalizado',
    dataInicio: '20250601',
    dataFim: '20250731',
    periodos_comparativos: [
      { label: '202506', dataInicio: '20250601', dataFim: '20250630' },
      { label: '202507', dataInicio: '20250701', dataFim: '20250731' },
    ],
  },
  _mensagemOriginal: 'Agora detalhe por cliente',
}, {});
assert.strictEqual(periodosDatasetDeclarados.length, 2, 'dataset deve preservar comparativo declarado mesmo em refinamento por cliente');
assert.strictEqual(periodosDatasetDeclarados[0].dataInicio, '20250601');
assert.strictEqual(periodosDatasetDeclarados[1].dataFim, '20250731');
const sqlDatasetQuebrado = `
SELECT TOP 10000 SUBSTRING(F2_EMISSAO, 1, 6) AS competencia, COALESCE(SUM(D2_TOTAL), 0) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250601' AND '20250630'
GROUP BY SUBSTRING(F2_EMISSAO, 1, 6 UNION ALL SELECT SUBSTRING(F2_EMISSAO, 1, 6) AS competencia
`;
const validacaoSintaxeDataset = datasetRunner._test._validarSintaxeBasicaSqlDataset(sqlDatasetQuebrado);
assert.strictEqual(validacaoSintaxeDataset.ok, false, 'dataset deve rejeitar SQL com parenteses quebrado antes de executar');

const validacaoComparativoSemCliente = queryPlan.validarSqlContraPlano(sqlComparativoCompleto, planoComparativoCliente);
assert.strictEqual(validacaoComparativoSemCliente.ok, false, 'faturamento deve rejeitar comparativo que remove agrupamento herdado por cliente');
assert(validacaoComparativoSemCliente.erros.join(' ').includes('agrupamento por cliente'), 'erro deve citar agrupamento por cliente');

const planoComparativoReuso = runner._test.aplicarPeriodosComparativoContinuidade(
  runner._test.construirQueryPlanTecnico({
    spec: faturamentoSpec,
    mensagem: 'Compare esse resultado com julho do ano passado.',
    periodo: { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
    filtros: {},
    entidades: [],
  }),
  {
    periodo: { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
    _contextoUsadoOrquestrador: {
      periodo: { tipo: 'mensal', dataInicio: '20250601', dataFim: '20250630' },
    },
  },
  { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
);
const sqlJ2aReusoComparativo = sqlComparativoCompleto.replace(/SF2020/g, 'SF2990').replace(/SD2020/g, 'SD2990');
const validacaoJ2aReusoComparativo = runner._test.validarPeriodoDeclaradoNoSql(
  sqlJ2aReusoComparativo,
  faturamentoSpec,
  { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
  { periodosPermitidos: planoComparativoReuso.periodos_comparativos },
);
assert.strictEqual(validacaoJ2aReusoComparativo.ok, true, `reuso multiempresa deve aceitar SQL com periodo_base e periodo_comparacao: ${validacaoJ2aReusoComparativo.erros.join(' | ')}`);

const handlerSrc = fs.readFileSync(path.join(ROOT, 'modules/erp/totvs_protheus/faturamento/ai-sql-handler-v2.js'), 'utf8');
assert(handlerSrc.includes("require('../../ia-owner/runner')"), 'handler deve usar runner IA-OWNER');
assert(handlerSrc.includes("require('./faturamento-ia-owner-spec')"), 'handler deve usar spec IA-OWNER Protheus de faturamento');
assert(!handlerSrc.includes('contract'), 'handler nao deve depender do contrato legado');

const intentServiceSrc = fs.readFileSync(path.join(ROOT, 'modules/ai/intent-service.js'), 'utf8');
assert(intentServiceSrc.includes("'carregada'") && intentServiceSrc.includes("'entrega futura'"), 'classificador deve rotear quantidade carregada e entrega futura para faturamento');
assert(intentServiceSrc.includes("'nota mae'") && intentServiceSrc.includes("'sem filtro fiscal'"), 'classificador deve reconhecer nota mae e movimentacao sem filtro fiscal');

const routerSrc = fs.readFileSync(path.join(ROOT, 'modules/erp/core/intent-router.js'), 'utf8');
assert(routerSrc.includes("'filial'"), 'router deve enviar filtro de filial ao pipeline dinamico');
assert(!routerSrc.includes('chat' + 'Resultado'), 'router deve ir direto ao motor dinamico nos modulos dinamicos');
assert(routerSrc.includes("_pipeline_origem = 'systemprompt'"), 'router deve marcar origem historica systemprompt no caminho dinamico');

const intentRouter = require(path.join(ROOT, 'modules/erp/core/intent-router'));
assert.strictEqual(
  intentRouter._extrairPossivelEntidadeDaPreposicao('Detalhe por mes da Caieira'),
  'Caieira',
  'helper deve recuperar nome textual em frase com preposicao'
);
assert.strictEqual(
  intentRouter._mensagemPedeFilialExplicitamente('Detalhe por mes da Caieira'),
  false,
  'da Caieira sem palavra filial/loja/unidade deve ser tratado como entidade de negocio'
);
assert.strictEqual(
  intentRouter._temFiltroEntidadeDinamica({ filtros: { filial: 'Caieira' } }),
  true,
  'filial textual suspeita deve ir ao pipeline para ser resolvida como entidade'
);
assert.strictEqual(
  intentRouter._temFiltroEntidadeDinamica({ filtros: { filial: '01' } }),
  false,
  'filial codigo continua sendo filtro operacional'
);

console.log('faturamento-sql-contrato.test.js: ok (ia-owner)');
