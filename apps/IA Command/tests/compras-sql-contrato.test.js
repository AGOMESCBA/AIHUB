'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const queryPlan = require(path.join(ROOT, 'modules/erp/core/query-plan'));
const spec = require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/compras-ia-owner-spec'));

const sysPrompt = promptBuilder.buildSystemPrompt(spec);
assert(sysPrompt.includes('IA-OWNER do modulo compras'), 'compras deve usar IA-OWNER');
assert(sysPrompt.includes('Voce e dono da decisao semantica'), 'IA deve decidir heranca/continuidade');
assert(sysPrompt.includes('data_atual') && sysPrompt.includes('GUIA TECNICO DE SQL'), 'compras deve manter ancora cronologica e respeitar guia tecnico');
assert(/devolu(?:cao|coes)|devolu[cç](?:ao|oes)/i.test(sysPrompt), 'prompt deve enviar regras de devolucao quando o usuario pedir');
assert(sysPrompt.includes('Regras de Validacao de Tabelas Fisicas'), 'compras deve receber regras SX2 multi-tenant');
assert(sysPrompt.includes('Formato de Data Protheus') && sysPrompt.includes('data_atual'), 'compras deve receber regras cronologicas');
assert(sysPrompt.includes('SA2.A2_NOME AS fornecedor'), 'compras deve retornar descricao de fornecedor');
assert(sysPrompt.includes('SB1.B1_DESC AS produto'), 'compras deve retornar descricao de produto');
assert(sysPrompt.includes('Se uma entidade estiver no GROUP BY'), 'compras deve retornar descricao de entidades agrupadas');
assert(sysPrompt.includes('SD1.D1_DTDIGIT'), 'compras deve documentar data padrao de entrada');
assert(sysPrompt.includes('SC7.C7_EMISSAO'), 'compras deve documentar data padrao de pedidos');
assert(sysPrompt.includes('Continuidade e Periodo em Compras'), 'compras deve conter regra modular de continuidade/periodo');
assert(sysPrompt.includes('periodo_base e periodo_comparacao'), 'compras deve exigir dois periodos em comparativo de continuidade');
assert.deepStrictEqual(spec.camposPeriodoObrigatorios, ['D1_DTDIGIT', 'F1_DTDIGIT', 'F1_EMISSAO', 'C7_EMISSAO', 'CR_EMISSAO', 'CR_DATALIB'], 'compras deve declarar campos temporais para o guard (inclui CR_EMISSAO/CR_DATALIB usados pelo fragmento de aprovacao via SCR)');
assert(typeof spec.resolverEntidades === 'function', 'compras IA-OWNER deve expor resolver tecnico de entidades');

const sqlPeriodoErradoCompras = `
SET ROWCOUNT 50000;
SELECT SUM(SD1.D1_TOTAL) AS total_compras
FROM SD1990 SD1
JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL
  AND SD1.D1_DOC = SF1.F1_DOC
  AND SD1.D1_SERIE = SF1.F1_SERIE
  AND SD1.D1_FORNECE = SF1.F1_FORNECE
  AND SD1.D1_LOJA = SF1.F1_LOJA
  AND SF1.D_E_L_E_T_ = ' '
WHERE SD1.D1_DTDIGIT BETWEEN '20230701' AND '20230731'
  AND SF1.F1_TIPO IN ('N','C')
  AND SD1.D_E_L_E_T_ = ' ';
`;
const validacaoPeriodoErradoCompras = runner._test.validarPeriodoDeclaradoNoSql(
  sqlPeriodoErradoCompras,
  spec,
  { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
);
assert.strictEqual(validacaoPeriodoErradoCompras.ok, false, 'compras deve rejeitar julho/2023 quando contrato exige julho/2025');

const sqlPeriodoCorretoCompras = sqlPeriodoErradoCompras.replace(/202307/g, '202507');
const validacaoPeriodoCorretoCompras = runner._test.validarPeriodoDeclaradoNoSql(
  sqlPeriodoCorretoCompras,
  spec,
  { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
);
assert.strictEqual(validacaoPeriodoCorretoCompras.ok, true, `compras deve aceitar periodo autoritativo correto: ${validacaoPeriodoCorretoCompras.erros.join(' | ')}`);

const planoComparativo = runner._test.aplicarPeriodosComparativoContinuidade(
  runner._test.construirQueryPlanTecnico({
    spec,
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
assert(planoComparativoTexto.includes('periodo_base: 20250601 a 20250630'), 'query_plan de compras deve expor periodo base herdado');
assert(planoComparativoTexto.includes('periodo_comparacao: 20250701 a 20250731'), 'query_plan de compras deve expor periodo de comparacao');

const planoComparativoViaHistorico = runner._test.aplicarPeriodosComparativoContinuidade(
  runner._test.construirQueryPlanTecnico({
    spec,
    mensagem: 'Compare esse resultado com julho do ano passado.',
    periodo: { tipo: 'personalizado', dataInicio: '20250701', dataFim: '20250731' },
    filtros: {},
    entidades: [],
  }),
  {
    _contextoUsadoOrquestrador: { modulo: 'compras' },
    _historicoResumido: [
      { periodo: { tipo: 'personalizado', dataInicio: '20250601', dataFim: '20250630' } },
    ],
  },
  { tipo: 'personalizado', dataInicio: '20250701', dataFim: '20250731' },
);
assert.strictEqual(planoComparativoViaHistorico.periodos_comparativos?.[0]?.dataInicio, '20250601', 'compras deve herdar periodo_base do historico resumido quando contexto formal vier sem periodo');
assert.strictEqual(planoComparativoViaHistorico.periodos_comparativos?.[1]?.dataFim, '20250731', 'compras deve manter periodo de comparacao explicitamente pedido');

const sqlComparativoCompras = `
SET ROWCOUNT 50000;
SELECT '202506' AS competencia, SUM(SD1.D1_TOTAL) AS total_compras
FROM SD1990 SD1
JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA AND SF1.D_E_L_E_T_ = ' '
WHERE SD1.D1_DTDIGIT BETWEEN '20250601' AND '20250630' AND SF1.F1_TIPO IN ('N','C') AND SD1.D_E_L_E_T_ = ' '
UNION ALL
SELECT '202507' AS competencia, SUM(SD1.D1_TOTAL) AS total_compras
FROM SD1990 SD1
JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA AND SF1.D_E_L_E_T_ = ' '
WHERE SD1.D1_DTDIGIT BETWEEN '20250701' AND '20250731' AND SF1.F1_TIPO IN ('N','C') AND SD1.D_E_L_E_T_ = ' ';
`;
const validacaoComparativoCompras = runner._test.validarPeriodoDeclaradoNoSql(
  sqlComparativoCompras,
  spec,
  { tipo: 'mensal', dataInicio: '20250701', dataFim: '20250731' },
  { periodosPermitidos: planoComparativo.periodos_comparativos },
);
assert.strictEqual(validacaoComparativoCompras.ok, true, `compras deve aceitar periodo_base no comparativo: ${validacaoComparativoCompras.erros.join(' | ')}`);
const validacaoComparativoCompletoCompras = runner._test.validarPeriodosComparativosNoSql(sqlComparativoCompras, spec, planoComparativo);
assert.strictEqual(validacaoComparativoCompletoCompras.ok, true, `compras deve aceitar SQL com os dois periodos: ${validacaoComparativoCompletoCompras.erros.join(' | ')}`);

const sqlComparativoSemCompetenciaCompras = `
SET ROWCOUNT 50000;
SELECT SA2.A2_NOME AS fornecedor, SUM(SD1.D1_TOTAL) AS total_compras
FROM SD1990 SD1
JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA AND SF1.D_E_L_E_T_ = ' '
JOIN SA2990 SA2 ON SF1.F1_FORNECE = SA2.A2_COD AND SF1.F1_LOJA = SA2.A2_LOJA AND SA2.D_E_L_E_T_ = ' '
WHERE SD1.D1_DTDIGIT BETWEEN '20250601' AND '20250630' AND SF1.F1_TIPO IN ('N','C') AND SD1.D_E_L_E_T_ = ' '
GROUP BY SA2.A2_NOME
UNION ALL
SELECT SA2.A2_NOME AS fornecedor, SUM(SD1.D1_TOTAL) AS total_compras
FROM SD1990 SD1
JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA AND SF1.D_E_L_E_T_ = ' '
JOIN SA2990 SA2 ON SF1.F1_FORNECE = SA2.A2_COD AND SF1.F1_LOJA = SA2.A2_LOJA AND SA2.D_E_L_E_T_ = ' '
WHERE SD1.D1_DTDIGIT BETWEEN '20250701' AND '20250731' AND SF1.F1_TIPO IN ('N','C') AND SD1.D_E_L_E_T_ = ' '
GROUP BY SA2.A2_NOME;
`;
const validacaoComparativoSemCompetencia = runner._test.validarPeriodosComparativosNoSql(sqlComparativoSemCompetenciaCompras, spec, planoComparativo);
assert.strictEqual(validacaoComparativoSemCompetencia.ok, false, 'compras deve rejeitar comparativo que mistura periodos sem coluna competencia/periodo');
assert(validacaoComparativoSemCompetencia.erros.join(' ').includes('competencia'), 'erro deve orientar coluna competencia/periodo');

const validacaoComparativoComMesesAnosLegado = runner._test.validarPeriodoDeclaradoNoSql(
  sqlComparativoCompras,
  spec,
  {
    tipo: 'mensal',
    dataInicio: '20250701',
    dataFim: '20250731',
    meses: [6, 7],
    anos: [2025, 2026],
  },
  { periodosPermitidos: planoComparativo.periodos_comparativos },
);
assert.strictEqual(
  validacaoComparativoComMesesAnosLegado.ok,
  true,
  `compras deve priorizar periodos_comparativos sobre meses/anos legado: ${validacaoComparativoComMesesAnosLegado.erros.join(' | ')}`,
);

const sqlComparativoComprasSemGroupBy = `
SET ROWCOUNT 50000;
SELECT SUM(SD1.D1_TOTAL) AS total_compras, SUBSTRING(SD1.D1_DTDIGIT, 1, 6) AS competencia
FROM SD1990 SD1
JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA AND SF1.D_E_L_E_T_ = ' '
WHERE SF1.F1_TIPO IN ('N','C') AND SUBSTRING(SD1.D1_DTDIGIT, 1, 6) = '202507' AND SD1.D_E_L_E_T_ = ' '
UNION ALL
SELECT SUM(SD1.D1_TOTAL) AS total_compras, SUBSTRING(SD1.D1_DTDIGIT, 1, 6) AS competencia
FROM SD1990 SD1
JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA AND SF1.D_E_L_E_T_ = ' '
WHERE SF1.F1_TIPO IN ('N','C') AND SUBSTRING(SD1.D1_DTDIGIT, 1, 6) = '202506' AND SD1.D_E_L_E_T_ = ' ';
`;
const validacaoAgregadoSemGroup = runner._test.validarAgregadoSemGroupBy(sqlComparativoComprasSemGroupBy);
assert.strictEqual(validacaoAgregadoSemGroup.ok, false, 'compras deve rejeitar SUM + SUBSTRING sem GROUP BY em comparativo UNION ALL');
assert(validacaoAgregadoSemGroup.erros.join(' ').includes('GROUP BY'), 'erro deve orientar GROUP BY ou literal de periodo');

const fragmentosSpec = require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/compras-fragmentos-spec'));
const { classificarFragmentos } = require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/compras-spec-classifier'));

assert(spec.camposSx3Essenciais.SC7.includes('C7_CONAPRO'), 'compras deve expor C7_CONAPRO (bloqueio por alcada) nos campos essenciais de SC7');

const chavesBloqueado = classificarFragmentos('Me diga quantos pedido de compras estão em aberto e bloqueados');
assert(chavesBloqueado && chavesBloqueado.includes('status_pedido_compra'), 'pergunta sobre pedidos bloqueados deve acionar o fragmento status_pedido_compra');

const textoStatusPedidoCompra = fragmentosSpec.FRAGMENTOS.status_pedido_compra.texto();
assert(/C7_CONAPRO\s*=\s*'B'/.test(textoStatusPedidoCompra), 'fragmento de status deve ensinar C7_CONAPRO = \'B\' como bloqueio por alcada');
assert(/nunca\s+como\s+sinonimo\s+de\s+"bloqueado"|bloqueio\s+e\s+sempre\s+C7_CONAPRO/i.test(textoStatusPedidoCompra), 'fragmento de status deve deixar explicito que C7_APROV nao e sinonimo de bloqueado');

const textoAprovador = spec.regrasTecnicas({
  mensagem: 'Pedidos de compra aprovados neste mes agrupado por nome do aprovador, por dia e por numero do pedido de compra',
  temAprovacaoPedidoCompra: true,
  temNomeAprovador: true,
});
assert(textoAprovador.includes("SCR.CR_TIPO = 'PC' AND SCR.CR_STATUS = '03'"), 'prompt de aprovador deve exigir CR_TIPO=PC e CR_STATUS=03 no JOIN/WHERE');
assert(/PROIBIDO fazer LEFT JOIN SCR somente por numero\/filial/i.test(textoAprovador), 'prompt deve bloquear o padrao de LEFT JOIN SCR incompleto');
assert(textoAprovador.includes('SCR.CR_DATALIB'), 'prompt deve orientar data de liberacao para pedidos aprovados');
assert(textoAprovador.includes('NAO some SC7.C7_TOTAL depois do JOIN com SCR'), 'prompt deve proibir soma de SC7.C7_TOTAL depois do JOIN direto com SCR');
assert(/ROW_NUMBER\(\)\s+OVER\s*\(\s*PARTITION BY SCR\.CR_FILIAL, SCR\.CR_NUM/.test(textoAprovador), 'prompt deve orientar uma unica liberacao final por pedido via ROW_NUMBER/rn=1, nao SELECT DISTINCT');
assert(!/liste\s+de\s+liberacoes\s+DISTINCT|junte com uma lista DISTINCT/i.test(textoAprovador), 'prompt nao deve mais orientar SELECT DISTINCT como forma de deduplicar liberacoes (bug real da CAIEIRA)');
assert(textoAprovador.includes('PROIBIDO incluir SC7.C7_ITEM'), 'prompt deve impedir item/fornecedor/produto sem pedido explicito nessa consulta');

console.log('compras-sql-contrato.test.js: ok (ia-owner)');
