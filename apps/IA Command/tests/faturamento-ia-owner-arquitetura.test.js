'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const sx2Normalizer = require(path.join(ROOT, 'modules/erp/sx2-sql-normalizer'));
const sx3Validator = require(path.join(ROOT, 'modules/erp/sx3-sql-validator'));
const faturamentoSpec = require(path.join(ROOT, 'modules/erp/faturamento/faturamento-ia-owner-spec'));
const intentRouter = require(path.join(ROOT, 'modules/erp/intent-router'));
const entityResolver = require(path.join(ROOT, 'modules/ai/entity-resolver'));
const periodResolver = require(path.join(ROOT, 'modules/ai/period-resolver'));
const queryPlan = require(path.join(ROOT, 'modules/erp/query-plan'));
const whatsappServiceSrc = fs.readFileSync(path.join(ROOT, 'modules/whatsapp/service.js'), 'utf8');

const systemPrompt = promptBuilder.buildSystemPrompt(faturamentoSpec);
assert(systemPrompt.includes('Voce e o IA-OWNER do modulo faturamento'), 'prompt deve declarar IA-OWNER de faturamento');
assert(systemPrompt.includes('Historico, ultimo SQL e estado anterior sao evidencias, nao ordens obrigatorias'), 'historico deve ser evidencia, nao ordem');
assert(systemPrompt.includes('## Devolucoes de Vendas'), 'prompt deve conter bloco de devolucoes de vendas sob demanda');
assert(systemPrompt.includes('Regras de Validacao de Tabelas Fisicas'), 'prompt deve conter regra SX2 multi-tenant');
assert(systemPrompt.includes('APENAS o mapa fornecido no no "sx2"'), 'prompt deve obrigar uso do SX2 atual');
assert(systemPrompt.includes('mes passado'), 'prompt deve conter regra cronologica para mes passado');
assert(systemPrompt.includes('resposta_planejada'), 'prompt deve orientar resposta planejada WhatsApp');
assert(systemPrompt.includes('REGRA DE VERACIDADE DE ENTIDADES'), 'prompt deve proibir afirmar entidade encontrada sem codigo resolvido');
assert(systemPrompt.includes('Media mensal por ano'), 'prompt deve orientar comparativos/media por ano por contrato tecnico vivo');
assert(systemPrompt.includes('Subquery interna OBRIGATORIAMENTE exporta DOIS aliases de data'), 'prompt deve orientar subquery temporal com ano e competencia');
assert(systemPrompt.includes('Media mensal por produto'), 'prompt deve orientar faturamento medio por produto em duas camadas');
assert(systemPrompt.includes('NUNCA use AVG(SD2.D2_TOTAL)'), 'prompt deve proibir media direta das linhas de item');
assert(systemPrompt.includes('a SQL da IA ja deve calcular a media correta'), 'prompt deve deixar claro que o SQL da IA nasce com a media correta');
assert(systemPrompt.includes('o backend nao recalcula nem corrige a metrica'), 'prompt nao deve depender de ajuste posterior do backend');
assert(systemPrompt.includes('query externa agrupada somente por h.cod_produto, h.produto'), 'prompt deve orientar agrupamento externo correto por produto');
assert(systemPrompt.includes('Crescimento mensal / variacao mensal / evolucao mes a mes'), 'prompt deve orientar crescimento mensal explicitamente');
assert(systemPrompt.includes('crescimento_valor e crescimento_percentual'), 'prompt deve exigir valor e percentual quando crescimento mensal for pedido');
const planoCrescimentoMensal = queryPlan.buildQueryPlan({
  modulo: 'faturamento',
  mensagem: 'Faturamento por mes no ano de 2026 demonstrando o crescimento mensal',
  periodo: { tipo: 'ano', dataInicio: '20260101', dataFim: '20261231' },
});
assert.strictEqual(planoCrescimentoMensal.operacao, 'comparativo', 'faturamento com crescimento mensal deve ser comparativo');
assert.strictEqual(planoCrescimentoMensal.comparativo, true, 'faturamento com crescimento mensal deve sinalizar comparativo');
assert.strictEqual(planoCrescimentoMensal.calcularPercentualCrescimento, true, 'faturamento com crescimento mensal deve sinalizar calculo de crescimento');
assert(planoCrescimentoMensal.agrupamentos.includes('mes'), 'faturamento por mes deve preservar agrupamento mensal');
assert(
  queryPlan.formatQueryPlanForPrompt(planoCrescimentoMensal).includes('faturamento_crescimento_mensal'),
  'plano formatado deve orientar LAG mensal para o IA-owner',
);
assert.deepStrictEqual(
  entityResolver.extrairExplicitos('faturamento medio por produto de janeiro a junho de 2026'),
  [],
  'periodo apos "por produto" nao deve virar entidade produto pendente',
);
assert.strictEqual(
  runner._test.maxTentativasPrepararSql([]),
  3,
  'sem entidade resolvida o runner deve ter 3 tentativas de SQL (necessario para erros combinados D_E_L_E_T_+estrutura)',
);
assert.strictEqual(
  runner._test.maxTentativasPrepararSql([{ tipo: 'cliente', codigo: '000048', _todos: true }]),
  3,
  'com entidade resolvida o runner deve ter 3 tentativas de SQL',
);

const perguntaJunhoVariosAnos = 'Faturamento do mes de Junho dos anos de 2025 e 2026 por ANO E grupo de produto';
const periodoJunhoVariosAnos = periodResolver.identificarPeriodoTexto(perguntaJunhoVariosAnos, {
  hoje: new Date('2026-07-07T12:00:00'),
});
assert.deepStrictEqual(
  periodoJunhoVariosAnos,
  { tipo: 'personalizado', data_inicio: '20250101', data_fim: '20261231' },
  'periodo candidato nao deve reduzir junho dos anos 2025 e 2026 para apenas junho/2025',
);

const sqlJunhoVariosAnosErrado = `
SET ROWCOUNT 50000;
SELECT SBM.BM_DESC AS grupo_produto,
       COALESCE(SUM(SD2.D2_TOTAL), 0) AS valor_total,
       SUBSTRING(SF2.F2_EMISSAO, 1, 4) AS ano
FROM SF2010 SF2
JOIN SD2010 SD2 ON SD2.D2_FILIAL = SF2.F2_FILIAL
                 AND SD2.D2_DOC = SF2.F2_DOC
                 AND SD2.D2_SERIE = SF2.F2_SERIE
                 AND SD2.D2_CLIENTE = SF2.F2_CLIENTE
                 AND SD2.D2_LOJA = SF2.F2_LOJA
                 AND SD2.D_E_L_E_T_ = ' '
JOIN SB1010 SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
JOIN SBM010 SBM ON SB1.B1_GRUPO = SBM.BM_GRUPO AND SBM.D_E_L_E_T_ = ' '
WHERE SF2.D_E_L_E_T_ = ' '
  AND SF2.F2_EMISSAO BETWEEN '20250601' AND '20250630'
  AND SF2.F2_TIPO = 'N'
GROUP BY SBM.BM_GRUPO, SBM.BM_DESC, SUBSTRING(SF2.F2_EMISSAO, 1, 4);
`;
const validacaoJunhoVariosAnosErrado = runner._test.validarSqlIaOwnerBasico(sqlJunhoVariosAnosErrado, faturamentoSpec, {
  SF2010: 'E',
  SD2010: 'E',
  SB1010: 'E',
  SBM010: 'E',
}, perguntaJunhoVariosAnos);
assert.strictEqual(validacaoJunhoVariosAnosErrado.ok, false, 'SQL com BETWEEN de junho/2025 deve ser rejeitado quando pergunta pede 2025 e 2026');
assert(validacaoJunhoVariosAnosErrado.erros.some(e => e.includes('Nao use um unico intervalo continuo de datas')), 'erro deve orientar filtro separado de mes e anos');

const sqlJunhoVariosAnosCorreto = sqlJunhoVariosAnosErrado
  .replace("SF2.F2_EMISSAO BETWEEN '20250601' AND '20250630'", "SUBSTRING(SF2.F2_EMISSAO, 5, 2) = '06'\n  AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) IN ('2025', '2026')");
const validacaoJunhoVariosAnosCorreto = runner._test.validarSqlIaOwnerBasico(sqlJunhoVariosAnosCorreto, faturamentoSpec, {
  SF2010: 'E',
  SD2010: 'E',
  SB1010: 'E',
  SBM010: 'E',
}, perguntaJunhoVariosAnos);
assert.strictEqual(validacaoJunhoVariosAnosCorreto.ok, true, `SQL com mes+anos separados deve passar: ${validacaoJunhoVariosAnosCorreto.erros.join(' | ')}`);

const perguntaJunhoDoisAnos = 'Faturamento do mes de Junho dos anos de 2024 e 2025';
const sqlJunhoDoisAnosGteLte = `
SET ROWCOUNT 30000;
SELECT SUBSTRING(SF2.F2_EMISSAO, 1, 6) AS competencia, COALESCE(SUM(SF2.F2_VALBRUT), 0) AS faturamento
FROM SF2010 SF2
WHERE SF2.F2_EMISSAO >= '20240601' AND SF2.F2_EMISSAO <= '20240630'
AND SF2.F2_TIPO = 'N'
AND SF2.D_E_L_E_T_ = ' '
GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 6)
ORDER BY SUBSTRING(SF2.F2_EMISSAO, 1, 6);
`;
const validacaoJunhoDoisAnosGteLte = runner._test.validarSqlIaOwnerBasico(sqlJunhoDoisAnosGteLte, faturamentoSpec, {
  SF2010: 'E',
}, perguntaJunhoDoisAnos);
assert.strictEqual(validacaoJunhoDoisAnosGteLte.ok, false, 'SQL com >=/<= restrito a um unico ano deve ser rejeitado quando pergunta pede 2024 e 2025 (nao so BETWEEN escapa da regra)');

const perguntaComparativoJanAJunVariosAnos = 'O Comparativo do faturamento dos meses de Janeiro a Junho dos anos de 2024 a 2026.';
const periodoComparativoJanAJunVariosAnos = periodResolver.identificarPeriodoTexto(perguntaComparativoJanAJunVariosAnos, {
  hoje: new Date('2026-07-07T12:00:00'),
});
assert.deepStrictEqual(
  periodoComparativoJanAJunVariosAnos,
  { tipo: 'personalizado', data_inicio: '20240101', data_fim: '20261231' },
  'comparativo de range de meses (jan-jun) com anos "de 2024 a 2026" nao deve perder o ano intermediario (2025) nem colapsar em comparacao_acumulado_mes de 2 anos',
);

const perguntaAcumuladoJanAJunVariosAnos = 'Faturamento Acumulado dos meses de Janeiro a Junho dos anos de 2024 a 2026';
const sqlAcumuladoJanAJunErrado = `
SET ROWCOUNT 30000;
SELECT SUBSTRING(SF2.F2_EMISSAO, 1, 6) AS competencia, COALESCE(SUM(SD2.D2_TOTAL), 0) AS faturamento_acumulado
FROM SD2010 SD2
JOIN SF2010 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
WHERE SF2.F2_EMISSAO BETWEEN '20240101' AND '20260630' AND SF2.F2_TIPO = 'N' AND SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' '
GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 6)
ORDER BY competencia;
`;
const validacaoAcumuladoJanAJunErrado = runner._test.validarSqlIaOwnerBasico(sqlAcumuladoJanAJunErrado, faturamentoSpec, {
  SF2010: 'E',
  SD2010: 'E',
}, perguntaAcumuladoJanAJunVariosAnos);
assert.strictEqual(validacaoAcumuladoJanAJunErrado.ok, false, 'BETWEEN continuo de 20240101 a 20260630 deve ser rejeitado: vaza para jul-dez de 2024 e 2025, fora do range jan-jun pedido');

const sqlAcumuladoJanAJunCorreto = sqlAcumuladoJanAJunErrado.replace(
  "SF2.F2_EMISSAO BETWEEN '20240101' AND '20260630'",
  "SUBSTRING(SF2.F2_EMISSAO, 5, 2) BETWEEN '01' AND '06' AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) IN ('2024', '2025', '2026')"
);
const validacaoAcumuladoJanAJunCorreto = runner._test.validarSqlIaOwnerBasico(sqlAcumuladoJanAJunCorreto, faturamentoSpec, {
  SF2010: 'E',
  SD2010: 'E',
}, perguntaAcumuladoJanAJunVariosAnos);
assert.strictEqual(validacaoAcumuladoJanAJunCorreto.ok, true, `SQL com mes(range)+anos separados deve passar: ${validacaoAcumuladoJanAJunCorreto.erros.join(' | ')}`);

const sqlGroupByInvalido = `
SET ROWCOUNT 50000;
SELECT
  CONVERT(VARCHAR(10), CAST(SF2.F2_EMISSAO AS DATE), 103) AS dia,
  MONTH(SF2.F2_EMISSAO) AS mes,
  SB1.B1_DESC AS produto,
  SUM(SD2.D2_TOTAL) AS valor_total
FROM SD2 SD2
JOIN SF2 SF2 ON SD2.D2_DOC = SF2.F2_DOC
JOIN SB1 SB1 ON SD2.D2_COD = SB1.B1_COD
GROUP BY MONTH(SF2.F2_EMISSAO), SB1.B1_DESC;
`;
const groupByInvalido = runner._test.validarSelectContraGroupBy(sqlGroupByInvalido);
assert.strictEqual(groupByInvalido.ok, false, 'SELECT com dia fora do GROUP BY deve ser rejeitado antes da execucao');
assert(groupByInvalido.erros.some(e => e.includes('CONVERT')), 'erro deve identificar a expressao ausente no GROUP BY');

const sqlGroupByValido = sqlGroupByInvalido.replace(
  'CONVERT(VARCHAR(10), CAST(SF2.F2_EMISSAO AS DATE), 103) AS dia,\n  ',
  '',
);
assert.strictEqual(
  runner._test.validarSelectContraGroupBy(sqlGroupByValido).ok,
  true,
  'consulta por mes e produto com SELECT coerente deve ser aceita',
);

const sqlYoyWindowInvalido = `
SET ROWCOUNT 50000;
SELECT SUBSTRING(SF2.F2_EMISSAO, 1, 6) AS competencia,
       COALESCE(SUM(SF2.F2_VALBRUT), 0) AS faturamento,
       LAG(COALESCE(SUM(SF2.F2_VALBRUT), 0)) OVER (PARTITION BY SUBSTRING(SF2.F2_EMISSAO, 5, 2) ORDER BY SUBSTRING(SF2.F2_EMISSAO, 1, 6)) AS faturamento_anterior
FROM SF2990 SF2
WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 6)
ORDER BY competencia;
`;
const yoyWindowInvalido = runner._test.validarSelectContraGroupBy(sqlYoyWindowInvalido);
assert.strictEqual(yoyWindowInvalido.ok, false, 'YoY com PARTITION BY mes fora do GROUP BY deve ser rejeitado');
assert(yoyWindowInvalido.erros.some(e => e.includes('OVER') && e.includes('SUBSTRING(SF2.F2_EMISSAO, 5, 2)')), 'erro deve identificar expressao do OVER ausente no GROUP BY');

const sqlYoySubqueryValido = `
SET ROWCOUNT 50000;
SELECT h.ano, h.mes, h.faturamento,
       LAG(h.faturamento) OVER (PARTITION BY h.mes ORDER BY h.ano) AS faturamento_anterior
FROM (
  SELECT SUBSTRING(SF2.F2_EMISSAO, 1, 4) AS ano,
         SUBSTRING(SF2.F2_EMISSAO, 5, 2) AS mes,
         COALESCE(SUM(SF2.F2_VALBRUT), 0) AS faturamento
  FROM SF2990 SF2
  WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
  GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 4), SUBSTRING(SF2.F2_EMISSAO, 5, 2)
) h
ORDER BY h.ano, h.mes;
`;
assert.strictEqual(
  runner._test.validarSelectContraGroupBy(sqlYoySubqueryValido).ok,
  true,
  'YoY em duas camadas deve ser aceito',
);

const sqlSelfJoinSemDelete = `
SET ROWCOUNT 50000;
SELECT SUBSTRING(SF2.F2_EMISSAO, 1, 6) AS competencia,
       COALESCE(SUM(SF2.F2_VALBRUT), 0) AS faturamento_2025,
       COALESCE(SUM(SF2_2026.F2_VALBRUT), 0) AS faturamento_2026
FROM SF2990 SF2
LEFT JOIN SF2990 SF2_2026 ON SUBSTRING(SF2.F2_EMISSAO, 5, 2) = SUBSTRING(SF2_2026.F2_EMISSAO, 5, 2)
WHERE SF2.D_E_L_E_T_ = ' '
GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 6)
ORDER BY competencia;
`;
const selfJoinSemDelete = runner._test.validarSqlIaOwnerBasico(sqlSelfJoinSemDelete, faturamentoSpec, { SF2990: 'E' });
assert.strictEqual(selfJoinSemDelete.ok, false, 'self-join sem D_E_L_E_T_ no alias unido deve ser rejeitado');
assert(selfJoinSemDelete.erros.some(e => e.includes("SF2_2026.D_E_L_E_T_ = ' '")), 'erro deve exigir D_E_L_E_T_ do alias sufixado');

const sqlSelfJoinAliasSufixadoValido = `
SET ROWCOUNT 50000;
SELECT SUBSTRING(SF2.F2_EMISSAO, 5, 2) AS mes,
       COALESCE(SUM(SF2.F2_VALBRUT), 0) AS faturamento_2025,
       COALESCE(SUM(SF2_2026.F2_VALBRUT), 0) AS faturamento_2026
FROM SF2990 SF2
LEFT JOIN SF2990 SF2_2026 ON SUBSTRING(SF2.F2_EMISSAO, 5, 2) = SUBSTRING(SF2_2026.F2_EMISSAO, 5, 2)
  AND SF2_2026.D_E_L_E_T_ = ' '
  AND SF2_2026.F2_TIPO = 'N'
  AND SUBSTRING(SF2_2026.F2_EMISSAO, 1, 4) = '2026'
WHERE SF2.D_E_L_E_T_ = ' '
  AND SF2.F2_TIPO = 'N'
  AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) = '2025'
GROUP BY SUBSTRING(SF2.F2_EMISSAO, 5, 2)
ORDER BY mes;
`;
assert.strictEqual(
  runner._test.validarSqlIaOwnerBasico(sqlSelfJoinAliasSufixadoValido, faturamentoSpec, { SF2990: 'E' }).ok,
  true,
  'self-join com alias SF2_<sufixo> e filtros completos deve ser aceito pelo contrato',
);
assert.strictEqual(
  intentRouter._deveFallbackAposFalhaCanonico(
    { _usarSqlCanonicoWhatsappAll: true },
    { tipo: 'erro', subtipo: 'contrato_sx3_invalido' },
    new Set(),
  ),
  false,
  'whatsapp_all nunca deve gerar segundo SQL quando o canonico falhar em outro tenant',
);
assert.strictEqual(
  intentRouter._deveFallbackAposFalhaCanonico(
    {},
    { tipo: 'erro', subtipo: 'contrato_sx3_invalido' },
    new Set(),
  ),
  true,
  'fora do whatsapp_all o fallback recuperavel pode continuar existindo',
);
assert(
  whatsappServiceSrc.includes('pendentesRetryCanonico')
    && whatsappServiceSrc.includes('_usarSqlCanonicoWhatsappAll: true')
    && whatsappServiceSrc.includes('all_retry_canonico'),
  'whatsapp_all deve manter fila de retry canonico para empresas que falharam antes do primeiro SQL reutilizavel',
);
assert(
  whatsappServiceSrc.includes('retry_canonico_motivo'),
  'auditoria consolidada deve indicar quando uma empresa foi recuperada por retry canonico',
);
assert(systemPrompt.includes('escopo de tenant IAHub'), 'prompt deve separar empresa IAHub de entidade cadastral');
assert(systemPrompt.includes("Nunca use SF2.F2_TIPO = '1'"), 'prompt deve proibir F2_TIPO = 1 em faturamento');
assert(systemPrompt.includes('SA1.A1_NOME AS cliente') && systemPrompt.includes('SB1.B1_DESC AS produto'), 'entidades devem retornar descricoes ao usuario');
assert(systemPrompt.includes('data_atual') && systemPrompt.includes('Voce calcula o periodo EXCLUSIVAMENTE'), 'periodos relativos devem ser calculados pela IA a partir de data_atual e contexto');
assert(systemPrompt.includes('mapa fornecido') && systemPrompt.includes('Use aliases explicitos iguais a base da tabela'), 'prompt deve orientar tabela fisica via SX2 com alias base');

const sx3Prompt = runner._test.sx3EssencialParaPrompt(faturamentoSpec.camposSx3Essenciais);
assert(sx3Prompt.SF1.some(c => c.campo === 'F1_TIPO'), 'SX3 essencial deve incluir F1_TIPO');
assert(sx3Prompt.SD1.some(c => c.campo === 'D1_TOTAL'), 'SX3 essencial deve incluir D1_TOTAL');
assert(sx3Prompt.SF2.some(c => c.campo === 'F2_TIPO'), 'SX3 essencial deve incluir F2_TIPO');
assert(sx3Prompt.SD2.some(c => c.campo === 'D2_TOTAL'), 'SX3 essencial deve incluir D2_TOTAL');

const sx2 = {
  SD2990: 'E',
  SF2990: 'E',
  SD1990: 'E',
  SF1990: 'E',
  SA1990: 'C',
  SF4990: 'E',
};

const sqlDevolucaoErradoPorSf4 = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(CASE WHEN SF4.F4_CODIGO IS NOT NULL THEN -SD2.D2_TOTAL ELSE SD2.D2_TOTAL END),0) AS faturamento
FROM SD2990 SD2
INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
LEFT JOIN SF4990 SF4 ON SD2.D2_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' '
WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' '
AND SF2.F2_EMISSAO BETWEEN '20260601' AND '20260630'
`;
const validacaoSf4 = runner._test.validarSqlIaOwnerBasico(sqlDevolucaoErradoPorSf4, faturamentoSpec, sx2);
assert.strictEqual(validacaoSf4.ok, false, 'devolucao por SF4/SD2 deve ser rejeitada');
assert(validacaoSf4.erros.some(e => e.includes('SF1/SD1')), 'deve orientar uso de SF1/SD1');

const sqlBom = `
SET ROWCOUNT 50000;
SELECT
  COALESCE(SUM(base.valor_faturamento),0) AS total_faturamento,
  COALESCE(SUM(base.valor_devolucao),0) AS total_devolucoes,
  COALESCE(SUM(base.valor_faturamento),0) - COALESCE(SUM(base.valor_devolucao),0) AS faturamento_liquido
FROM (
  SELECT SD2.D2_TOTAL AS valor_faturamento, 0 AS valor_devolucao
  FROM SD2990 SD2
  INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
  WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO IN ('N','C','I') AND SF2.F2_EMISSAO BETWEEN '20260601' AND '20260630'
  UNION ALL
  SELECT 0 AS valor_faturamento, SD1.D1_TOTAL AS valor_devolucao
  FROM SD1990 SD1
  INNER JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA
  WHERE SD1.D_E_L_E_T_ = ' ' AND SF1.D_E_L_E_T_ = ' ' AND SF1.F1_TIPO = 'D' AND SF1.F1_DTDIGIT BETWEEN '20260601' AND '20260630'
) base
`;
const validacaoBoa = runner._test.validarSqlIaOwnerBasico(sqlBom, faturamentoSpec, sx2);
assert.strictEqual(validacaoBoa.ok, true, `SQL bom nao deveria ser rejeitado: ${validacaoBoa.erros.join(' | ')}`);

const sqlMediaProdutoErradoLinha = `
SET ROWCOUNT 50000;
SELECT SB1.B1_DESC AS produto, AVG(SD2.D2_TOTAL) AS faturamento_medio
FROM SD2990 SD2
INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SF2.D_E_L_E_T_ = ' '
INNER JOIN SB1990 SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N' AND SF2.F2_EMISSAO BETWEEN '20260101' AND '20260630'
GROUP BY SB1.B1_DESC;
`;
const validacaoMediaProdutoErrada = runner._test.validarSqlIaOwnerBasico(sqlMediaProdutoErradoLinha, faturamentoSpec, {
  SD2990: 'E',
  SF2990: 'E',
  SB1990: 'E',
});
assert.strictEqual(validacaoMediaProdutoErrada.ok, false, 'AVG direto de SD2.D2_TOTAL deve ser rejeitado para faturamento medio');
assert(validacaoMediaProdutoErrada.erros.some(e => e.includes('media por item/linha')), 'erro deve orientar media mensal em duas camadas');

const sqlMediaProdutoSemCompetencia = `
SET ROWCOUNT 50000;
SELECT SB1.B1_DESC AS produto, AVG(h.faturamento_mes) AS faturamento_medio
FROM (
    SELECT SD2.D2_COD, SUM(SD2.D2_TOTAL) AS faturamento_mes
    FROM SD2
    JOIN SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE
    WHERE SF2.F2_TIPO = 'N'
    AND SF2.D_E_L_E_T_ = ' '
    AND SUBSTRING(SF2.F2_EMISSAO, 1, 4) = '2026'
    AND SUBSTRING(SF2.F2_EMISSAO, 5, 2) IN ('01', '02', '03', '04', '05', '06')
    GROUP BY SD2.D2_COD
) AS h
JOIN SB1 ON h.D2_COD = SB1.B1_COD
GROUP BY SB1.B1_DESC;
`;
const sqlMediaProdutoSemCompetenciaNormalizado = runner._test.normalizarAliasesBaseAusentes(sqlMediaProdutoSemCompetencia, faturamentoSpec);
assert(sqlMediaProdutoSemCompetenciaNormalizado.includes('FROM SD2 SD2'), 'normalizador deve adicionar alias SD2 ausente');
assert(sqlMediaProdutoSemCompetenciaNormalizado.includes('JOIN SF2 SF2 ON'), 'normalizador deve adicionar alias SF2 ausente');
assert(sqlMediaProdutoSemCompetenciaNormalizado.includes('JOIN SB1 SB1 ON'), 'normalizador deve adicionar alias SB1 ausente');
const validacaoMediaProdutoSemCompetencia = runner._test.validarSqlIaOwnerBasico(sqlMediaProdutoSemCompetenciaNormalizado, faturamentoSpec, {
  SD2990: 'E',
  SF2990: 'E',
  SB1990: 'E',
});
assert.strictEqual(validacaoMediaProdutoSemCompetencia.ok, false, 'media por produto sem competencia interna deve ser rejeitada');
assert(validacaoMediaProdutoSemCompetencia.erros.some(e => e.includes('media dos totais mensais')), 'erro deve exigir competencia mensal na subquery');

const sqlMediaProdutoCorreto = `
SET ROWCOUNT 50000;
SELECT h.cod_produto, h.produto, COALESCE(AVG(h.faturamento_mes), 0) AS faturamento_medio
FROM (
  SELECT SB1.B1_COD AS cod_produto,
         SB1.B1_DESC AS produto,
         SUBSTRING(SF2.F2_EMISSAO, 1, 6) AS competencia,
         COALESCE(SUM(SD2.D2_TOTAL), 0) AS faturamento_mes
  FROM SD2990 SD2
  INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SF2.D_E_L_E_T_ = ' '
  INNER JOIN SB1990 SB1 ON SD2.D2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
  WHERE SD2.D_E_L_E_T_ = ' '
    AND SF2.F2_TIPO = 'N'
    AND SF2.F2_EMISSAO BETWEEN '20260101' AND '20260630'
  GROUP BY SB1.B1_COD, SB1.B1_DESC, SUBSTRING(SF2.F2_EMISSAO, 1, 6)
) AS h
GROUP BY h.cod_produto, h.produto
ORDER BY faturamento_medio DESC;
`;
const validacaoMediaProdutoCorreta = runner._test.validarSqlIaOwnerBasico(sqlMediaProdutoCorreto, faturamentoSpec, {
  SD2990: 'E',
  SF2990: 'E',
  SB1990: 'E',
});
assert.strictEqual(validacaoMediaProdutoCorreta.ok, true, `media mensal por produto em duas camadas deve ser aceita: ${validacaoMediaProdutoCorreta.erros.join(' | ')}`);

const sqlEmpresaComoClienteETipoUm = `
SET ROWCOUNT 50000;
SELECT SUM(SD2.D2_TOTAL) AS valor_total
FROM SF2990 SF2
JOIN SD2990 SD2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE
WHERE SF2.F2_EMISSAO BETWEEN '20260101' AND '20261231'
AND SF2.D_E_L_E_T_ = ' '
AND SD2.D_E_L_E_T_ = ' '
AND SF2.F2_TIPO = '1'
AND SF2.F2_FILIAL IN (SELECT A1_FILIAL FROM SA1990 SA1 WHERE SA1.A1_NOME IN ('J2A', 'C3I'))
`;
const validacaoEmpresaComoCliente = runner._test.validarSqlIaOwnerBasico(sqlEmpresaComoClienteETipoUm, faturamentoSpec, sx2);
assert.strictEqual(validacaoEmpresaComoCliente.ok, false, 'SQL com empresa IAHub como cliente e F2_TIPO=1 deve ser rejeitado');
assert(validacaoEmpresaComoCliente.erros.some(e => e.includes("F2_TIPO = '1'")), 'deve rejeitar F2_TIPO = 1');
assert(validacaoEmpresaComoCliente.erros.some(e => e.includes('Empresa IAHub')), 'deve rejeitar subquery SA1 para empresa IAHub');

const sx2Completo = runner._test.completarSX2Permitidas({ SD2990: 'E', SF2990: 'E' }, ['SD2', 'SF2', 'SD1', 'SF1'], '990');
assert.strictEqual(sx2Completo.SD1990, 'E', 'contexto SX2 deve completar SD1 pelo sufixo da empresa');
assert.strictEqual(sx2Completo.SF1990, 'E', 'contexto SX2 deve completar SF1 pelo sufixo da empresa');

const sqlJ2AEmContextoC3I = `
SET ROWCOUNT 50000;
SELECT SUM(SF2.F2_VALBRUT) AS total_faturamento
FROM SF2990 SF2
WHERE SF2.F2_EMISSAO BETWEEN '20260501' AND '20260531'
AND SF2.D_E_L_E_T_ = ' ';
`;
const sqlC3IAdaptado = sx2Normalizer.adaptarSqlCanonicoPorSX2(sqlJ2AEmContextoC3I, { SF2020: 'E' }, { sufixoFallback: '2020' });
assert(sqlC3IAdaptado.includes('FROM SF2020 SF2'), 'SQL de J2A deve trocar SF2990 por SF2020 no contexto C3I');
assert(!sqlC3IAdaptado.includes('FROM SF2990 SF2'), 'SQL C3I adaptado nao deve manter tabela fisica da J2A');
const validacaoSx3C3I = sx3Validator.validarCamposSqlContraSX3(sqlC3IAdaptado, {
  SF2: [{ campo: 'F2_VALBRUT' }, { campo: 'F2_EMISSAO' }, { campo: 'D_E_L_E_T_' }],
});
assert.strictEqual(validacaoSx3C3I.ok, true, `SX3 base SF2 deve validar SQL fisico SF2020: ${validacaoSx3C3I.erros.join(' | ')}`);

const estadoLimpo = runner._test.limparPeriodosNaoAutoritativos(runner._test.buildEstadoAnterior({
  intencao: 'faturamento_dinamico',
  periodo: { tipo: 'personalizado', dataInicio: '20230901', dataFim: '20230930' },
  _orquestradorContrato: { periodo: { tipo: 'personalizado', dataInicio: '20230901', dataFim: '20230930' }, herdou_contexto: true },
  _contextoIAAnterior: { periodo: { tipo: 'personalizado', dataInicio: '20230901', dataFim: '20230930' }, periodo_mantido: true },
}), 'Faturamento do mes passado?');
assert.strictEqual(estadoLimpo.periodo, null, 'periodo antigo deve ser limpo em pergunta relativa');
assert.strictEqual(estadoLimpo.contrato_orquestrador.periodo, null, 'contrato antigo deve ter periodo limpo em pergunta relativa');
assert.strictEqual(estadoLimpo.contexto_ia_anterior.periodo, null, 'contexto IA antigo deve ter periodo limpo em pergunta relativa');

const estadoLimpoMaio = runner._test.limparPeriodosNaoAutoritativos(runner._test.buildEstadoAnterior({
  intencao: 'faturamento_dinamico',
  periodo: { tipo: 'personalizado', dataInicio: '20230501', dataFim: '20230531' },
  _orquestradorContrato: { periodo: { tipo: 'personalizado', dataInicio: '20230501', dataFim: '20230531' }, herdou_contexto: true },
}), 'Faturamento somente de maio deste ano');
assert.strictEqual(estadoLimpoMaio.periodo, null, 'mes isolado/deste ano deve limpar periodo antigo');
assert.strictEqual(estadoLimpoMaio.contrato_orquestrador.periodo, null, 'mes isolado/deste ano deve limpar contrato antigo');

const estadoComEmpresas = runner._test.buildEstadoAnterior({
  intencao: 'faturamento_dinamico',
  _empresasMencionadasTextos: ['J2A', 'C3I'],
  _empresasMencionadasIds: [1, 2],
});
assert.deepStrictEqual(estadoComEmpresas.empresas_iahub_mencionadas, ['J2A', 'C3I'], 'estado deve expor empresas IAHub mencionadas para a IA-OWNER');
assert(estadoComEmpresas.aviso_empresas_iahub.includes('nao filtre SA1'), 'estado deve alertar que empresas IAHub nao sao clientes');

const respostaPlanejada = runner._test.interpolarRespostaPlanejada(
  'Aqui esta o resumo:\n\n*Faturamento Bruto:* {total_faturamento}',
  [{ total_faturamento: 277208.46 }]
);
assert(respostaPlanejada.includes('R$'), 'resposta planejada deve formatar moeda');
assert(!respostaPlanejada.includes('{total_faturamento}'), 'placeholder de resposta planejada deve ser preenchido');
assert.strictEqual(
  runner._test.interpolarRespostaPlanejada('Total: {total_faturamento}', [{ total_faturamento: null }]).includes('R$'),
  true,
  'valor null de metrica deve ser tratado como zero monetario'
);
assert.strictEqual(
  runner._test.interpolarRespostaPlanejada('Total: {total_faturamento}', []).includes('R$'),
  true,
  'sem registros deve preencher metrica planejada como zero'
);
assert.strictEqual(
  runner._test.interpolarRespostaPlanejada('Cliente: {cliente}', []),
  null,
  'placeholder nao-metrico desconhecido deve cair para formatacao normal'
);

console.log('faturamento-ia-owner-arquitetura.test.js: ok');
