'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const queryPlan = require(path.join(ROOT, 'modules/erp/query-plan'));
const sx2Normalizer = require(path.join(ROOT, 'modules/erp/sx2-sql-normalizer'));
const entitySqlGuard = require(path.join(ROOT, 'modules/erp/entity-sql-guard'));
const financeiroCatalog = require(path.join(ROOT, 'modules/erp/financeiro/entity-catalog'));
const financeiroSpec = require(path.join(ROOT, 'modules/erp/financeiro/financeiro-ia-owner-spec'));

const handlerFonte = fs.readFileSync(path.join(ROOT, 'modules/erp/financeiro/ai-sql-handler-v2.js'), 'utf8');
assert(handlerFonte.includes('../ia-owner/runner'), 'handler financeiro deve usar ia-owner/runner');
assert(handlerFonte.includes('./financeiro-ia-owner-spec'), 'handler financeiro deve usar financeiro-ia-owner-spec');
assert(!handlerFonte.includes(['financeiro', 'contract'].join('-')), 'handler financeiro nao deve usar contrato legado');

const systemPrompt = promptBuilder.buildSystemPrompt(financeiroSpec);
assert(systemPrompt.includes('Voce e o IA-OWNER do modulo financeiro'), 'prompt deve declarar IA-OWNER financeiro');
assert(systemPrompt.includes('Saldo a pagar/em aberto: SE2.E2_SALDO'), 'prompt deve orientar saldo a pagar');
assert(systemPrompt.includes('Saldo a receber/em aberto: SE1.E1_SALDO'), 'prompt deve orientar saldo a receber');
assert(systemPrompt.includes('## Antecipacoes PA/RA'), 'prompt deve conter regra de PA/RA');
assert(systemPrompt.includes('So considere/apresente PA ou RA quando o usuario pedir explicitamente'), 'PA/RA devem ser opt-in');
assert(systemPrompt.includes('somente quando a pergunta estiver por fornecedor ou por cliente'), 'PA/RA devem exigir entidade');
assert(systemPrompt.includes('Saldo bancario puro usa SOMENTE SE8 e SA6'), 'saldo bancario deve ficar separado');
assert(systemPrompt.includes('Fluxo de caixa projetado'), 'prompt deve preservar fluxo projetado');

assert.deepStrictEqual(
  financeiroSpec._test.gruposBuscaEntidade({ texto: 'ACME', tipo: 'desconhecido' }, { carteira: 'receber' }),
  [['cliente'], ['vendedor', 'natureza']],
  'receber deve priorizar cliente',
);
assert.deepStrictEqual(
  financeiroSpec._test.gruposBuscaEntidade({ texto: 'ACME', tipo: 'desconhecido' }, { carteira: 'pagar' }),
  [['fornecedor'], ['natureza']],
  'pagar deve priorizar fornecedor',
);
assert.deepStrictEqual(
  financeiroSpec._test.gruposBuscaEntidade({ texto: 'ACME', tipo: 'cliente' }, { carteira: 'pagar' }),
  [['cliente']],
  'tipo explicitamente informado deve ser respeitado',
);

const sx2 = { SE1990: 'E', SE2990: 'E', SA1990: 'C', SA2990: 'C', SE8990: 'E', SA6990: 'E', SED990: 'E' };
const sqlSaldoPagar = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE2.E2_SALDO),0) AS saldo_a_pagar
FROM SE2990 SE2
WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_SALDO > 0 AND SE2.E2_TIPO <> 'PA'
`;
const validacaoSaldo = runner._test.validarSqlIaOwnerBasico(sqlSaldoPagar, financeiroSpec, sx2);
assert.strictEqual(validacaoSaldo.ok, true, `saldo a pagar nao deveria ser rejeitado: ${validacaoSaldo.erros.join(' | ')}`);

const sqlFornecedorJ2A = "SET ROWCOUNT 50000; SELECT SUM(SE2.E2_SALDO) FROM SE2990 SE2 JOIN SA2990 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA WHERE SA2.A2_COD = '000123' AND SA2.A2_LOJA = '01'";
const canonicoParam = entitySqlGuard.parametrizarSqlEntidadesResolvidas(
  sqlFornecedorJ2A,
  [{ tipo: 'fornecedor', codigo: '000123', loja: '01' }],
  financeiroCatalog.DEFINICOES,
);
assert(canonicoParam.alterou, 'sql canonico com entidade deve parametrizar codigo/loja');
assert(canonicoParam.sql.includes("SA2.A2_COD = '{{iac:fornecedor:codigo}}'"), 'deve criar placeholder de codigo');

const sqlCanonicoJ2A = "SET ROWCOUNT 50000; SELECT SUM(SE2.E2_SALDO) AS saldo_a_pagar FROM SE2990 SE2 INNER JOIN SA2990 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA WHERE SE2.D_E_L_E_T_ = ' ' AND SA2.D_E_L_E_T_ = ' '";
const sqlAdaptadoC3I = sx2Normalizer.adaptarSqlCanonicoPorSX2(sqlCanonicoJ2A, { SE2020: 'E', SA2020: 'C' });
assert(sqlAdaptadoC3I.includes('FROM SE2020 SE2'), 'sql canonico deve adaptar SE2 para empresa alvo');
assert(sqlAdaptadoC3I.includes('JOIN SA2020 SA2'), 'sql canonico deve adaptar SA2 para empresa alvo');

const sqlEmpresaComoFornecedorOuFilialFinanceiro = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE2.E2_SALDO), 0) AS saldo
FROM SE2990 SE2
INNER JOIN SA2990 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA AND SA2.D_E_L_E_T_ = ' '
WHERE SE2.D_E_L_E_T_ = ' '
  AND SE2.E2_VENCTO BETWEEN '20260101' AND '20261231'
  AND SE2.E2_FILIAL = '01'
  AND SA2.A2_CGC IN ('C3I', 'J2A')
GROUP BY SA2.A2_CGC;
`;
const sqlFinanceiroSemEmpresaComoFiltro = financeiroSpec._test.removerFiltrosEmpresaComoEntidade(sqlEmpresaComoFornecedorOuFilialFinanceiro, {
  empresaMencionadaTexto: 'C3I | J2A',
  empresasMencionadasTextos: ['C3I', 'J2A'],
}, {
  campos: ['SE2.E2_FILIAL', 'SA2.A2_CGC'],
});
assert(!/E2_FILIAL\s*=\s*'01'/i.test(sqlFinanceiroSemEmpresaComoFiltro), 'financeiro nao deve manter filial padrao quando pedido foi empresa');
assert(!/A2_CGC\s+IN\s*\(/i.test(sqlFinanceiroSemEmpresaComoFiltro), 'financeiro nao deve filtrar empresa por CGC de fornecedor');
assert(/E2_VENCTO BETWEEN '20260101' AND '20261231'/i.test(sqlFinanceiroSemEmpresaComoFiltro), 'financeiro deve preservar periodo');

const planoRecebidasMes = runner._test.construirQueryPlanTecnico({
  spec: financeiroSpec,
  mensagem: 'contas recebidas no mês',
  periodo: { tipo: 'mes_atual', dataInicio: '20260601', dataFim: '20260630' },
  filtros: {},
  entidades: [],
});
assert.strictEqual(planoRecebidasMes.carteira, 'receber', 'contas recebidas deve ser carteira receber');
assert.strictEqual(planoRecebidasMes.estado, 'recebido', 'contas recebidas deve ser estado recebido');
assert.strictEqual(planoRecebidasMes.dataPadrao, 'baixa_movimento', 'contas recebidas deve usar baixa/movimento');

const sqlRecebidasPorEmissao = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE1.E1_VALOR - SE1.E1_SALDO), 0) AS valor_recebido
FROM SE1020 SE1
WHERE SE1.D_E_L_E_T_ = ' ' AND SUBSTRING(SE1.E1_EMISSAO, 1, 6) = '202606'
`;
const validacaoRecebidasEmissao = queryPlan.validarSqlContraPlano(sqlRecebidasPorEmissao, planoRecebidasMes);
assert.strictEqual(validacaoRecebidasEmissao.ok, false, 'recebidas no mes nao pode filtrar por E1_EMISSAO');
assert(validacaoRecebidasEmissao.erros.join(' ').includes('FK1'), 'erro deve orientar baixa/movimento com FK1/SE5/E1_BAIXA');

const planoPagasMes = runner._test.construirQueryPlanTecnico({
  spec: financeiroSpec,
  mensagem: 'contas pagas no mes',
  periodo: { tipo: 'mes_atual', dataInicio: '20260601', dataFim: '20260630' },
  filtros: {},
  entidades: [],
});
assert.strictEqual(planoPagasMes.carteira, 'pagar', 'contas pagas deve ser carteira pagar');
assert.strictEqual(planoPagasMes.estado, 'pago', 'contas pagas deve ser estado pago');
assert.strictEqual(planoPagasMes.dataPadrao, 'baixa_movimento', 'contas pagas deve usar baixa/movimento');

const sqlPagasPorEmissao = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE2.E2_VALOR - SE2.E2_SALDO), 0) AS valor_pago
FROM SE2020 SE2
WHERE SE2.D_E_L_E_T_ = ' ' AND SUBSTRING(SE2.E2_EMISSAO, 1, 6) = '202606'
`;
const validacaoPagasEmissao = queryPlan.validarSqlContraPlano(sqlPagasPorEmissao, planoPagasMes);
assert.strictEqual(validacaoPagasEmissao.ok, false, 'pagas no mes nao pode filtrar por E2_EMISSAO');
assert(validacaoPagasEmissao.erros.join(' ').includes('FK2'), 'erro deve orientar baixa/movimento com FK2/SE5/E2_BAIXA');

const retryQueryPlan = runner._test.buildRetryTecnicoIaOwner({
  erro: Object.assign(new Error(validacaoRecebidasEmissao.erros.join(' | ')), { _tipo: 'contrato_query_plan_invalido' }),
  entidadesResolvidas: [],
});
assert(retryQueryPlan.includes('query_plan'), 'retry deve citar query_plan');
assert(retryQueryPlan.includes('baixa_movimento'), 'retry deve preservar campo_data_semantico baixa_movimento');

// ── Novo contrato: recebidas devem usar FK1 ou SE5, nunca E1_BAIXA ────────────

// SQL correto modelo FK1
const sqlRecebidasFk1 = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(FK1.FK1_VALOR), 0) AS valor_recebido
FROM SE1020 SE1
JOIN FK1010 FK1 ON FK1.FK1_FILIAL = SE1.E1_FILIAL AND FK1.FK1_PREFIXO = SE1.E1_PREFIXO
  AND FK1.FK1_NUM = SE1.E1_NUM AND FK1.FK1_PARCELA = SE1.E1_PARCELA AND FK1.FK1_TIPO = SE1.E1_TIPO
  AND FK1.D_E_L_E_T_ = ' '
WHERE SE1.D_E_L_E_T_ = ' '
  AND FK1.FK1_DATA BETWEEN '20260601' AND '20260630'
`;
const validacaoFk1 = queryPlan.validarSqlContraPlano(sqlRecebidasFk1, planoRecebidasMes);
assert.strictEqual(validacaoFk1.ok, true, `SQL com FK1 deve ser aceito: ${validacaoFk1.erros.join(' | ')}`);

// SQL correto modelo SE5 fallback (sem E1_SITUACAO — titulo pode ter baixa parcial)
const sqlRecebidasSe5 = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE5.E5_VALOR), 0) AS valor_recebido
FROM SE1020 SE1
JOIN SE5020 SE5 ON SE5.E5_FILIAL = SE1.E1_FILIAL AND SE5.E5_PREFIXO = SE1.E1_PREFIXO
  AND SE5.E5_NUMERO = SE1.E1_NUM AND SE5.E5_PARCELA = SE1.E1_PARCELA AND SE5.E5_TIPO = SE1.E1_TIPO
  AND SE5.E5_CLIFOR = SE1.E1_CLIENTE AND SE5.E5_LOJA = SE1.E1_LOJA
  AND SE5.E5_RECPAG = 'R' AND SE5.E5_SITUACAO <> 'C'
  AND SE5.E5_TIPO NOT IN ('EST','ED') AND SE5.D_E_L_E_T_ = ' '
WHERE SE1.D_E_L_E_T_ = ' '
  AND SE5.E5_DATA BETWEEN '20260601' AND '20260630'
`;
const validacaoSe5 = queryPlan.validarSqlContraPlano(sqlRecebidasSe5, planoRecebidasMes);
assert.strictEqual(validacaoSe5.ok, true, `SQL com SE5 deve ser aceito: ${validacaoSe5.erros.join(' | ')}`);

// SQL errado: usa E1_BAIXA (proibido)
const sqlRecebidasBaixa = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE1.E1_VALOR), 0) AS valor_recebido
FROM SE1020 SE1
WHERE SE1.D_E_L_E_T_ = ' ' AND SE1.E1_BAIXA BETWEEN '20260601' AND '20260630'
`;
const validacaoBaixa = queryPlan.validarSqlContraPlano(sqlRecebidasBaixa, planoRecebidasMes);
assert.strictEqual(validacaoBaixa.ok, false, 'SQL com E1_BAIXA deve ser rejeitado');
assert(validacaoBaixa.erros.join(' ').includes('FK1'), 'erro deve orientar uso de FK1 ou SE5');

// SQL errado: usa E1_EMISSAO sem FK1/SE5
const sqlRecebidasSemJoin = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE1.E1_VALOR), 0) AS valor_recebido
FROM SE1020 SE1
WHERE SE1.D_E_L_E_T_ = ' ' AND SUBSTRING(SE1.E1_EMISSAO, 1, 6) = '202606'
`;
const validacaoSemJoin = queryPlan.validarSqlContraPlano(sqlRecebidasSemJoin, planoRecebidasMes);
assert.strictEqual(validacaoSemJoin.ok, false, 'SQL sem FK1/SE5 deve ser rejeitado');

// SQL errado pagas: usa E2_BAIXA (proibido)
const sqlPagasBaixa = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE2.E2_VALOR), 0) AS valor_pago
FROM SE2020 SE2
WHERE SE2.D_E_L_E_T_ = ' ' AND SE2.E2_BAIXA BETWEEN '20260601' AND '20260630'
`;
const validacaoPagasBaixa = queryPlan.validarSqlContraPlano(sqlPagasBaixa, planoPagasMes);
assert.strictEqual(validacaoPagasBaixa.ok, false, 'SQL com E2_BAIXA deve ser rejeitado');
assert(validacaoPagasBaixa.erros.join(' ').includes('FK2'), 'erro deve orientar uso de FK2 ou SE5');

// SQL correto pagas modelo FK2
const sqlPagasFk2 = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(FK2.FK2_VALOR), 0) AS valor_pago
FROM SE2020 SE2
JOIN FK2010 FK2 ON FK2.FK2_FILIAL = SE2.E2_FILIAL AND FK2.FK2_PREFIXO = SE2.E2_PREFIXO
  AND FK2.FK2_NUM = SE2.E2_NUM AND FK2.FK2_PARCELA = SE2.E2_PARCELA AND FK2.FK2_TIPO = SE2.E2_TIPO
  AND FK2.D_E_L_E_T_ = ' '
WHERE SE2.D_E_L_E_T_ = ' '
  AND FK2.FK2_DATA BETWEEN '20260601' AND '20260630'
`;
const validacaoFk2 = queryPlan.validarSqlContraPlano(sqlPagasFk2, planoPagasMes);
assert.strictEqual(validacaoFk2.ok, true, `SQL com FK2 deve ser aceito: ${validacaoFk2.erros.join(' | ')}`);

const planoRecebidasMesFk7 = { ...planoRecebidasMes, modelo_baixas_receber: 'FK7_FK1' };
const contratoReceberFk7 = queryPlan.formatQueryPlanForPrompt(planoRecebidasMesFk7);
assert(contratoReceberFk7.includes('modelo_baixas_receber=FK7_FK1'), 'query_plan deve declarar modelo FK7_FK1');
assert(contratoReceberFk7.includes('Use SE1 -> FK7 -> FK1'), 'query_plan deve orientar cadeia SE1 -> FK7 -> FK1');
assert(contratoReceberFk7.includes('PROIBIDO JOIN direto SE1 -> FK1'), 'query_plan deve proibir FK1 direto quando modelo usa FK7');

const sqlRecebidasFk7Fk1 = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(FK1.FK1_VALOR), 0) AS valor_recebido
FROM SE1020 SE1
JOIN FK7020 FK7 ON FK7.FK7_FILIAL = SE1.E1_FILIAL
  AND FK7.FK7_PREFIX = SE1.E1_PREFIXO
  AND FK7.FK7_NUM = SE1.E1_NUM
  AND FK7.FK7_PARCEL = SE1.E1_PARCELA
  AND FK7.FK7_TIPO = SE1.E1_TIPO
  AND FK7.FK7_CLIFOR = SE1.E1_CLIENTE
  AND FK7.FK7_LOJA = SE1.E1_LOJA
  AND FK7.D_E_L_E_T_ = ' '
JOIN FK1020 FK1 ON FK1.FK1_FILIAL = FK7.FK7_FILIAL
  AND FK1.FK1_IDDOC = FK7.FK7_IDDOC
  AND FK1.D_E_L_E_T_ = ' '
WHERE SE1.D_E_L_E_T_ = ' '
  AND FK1.FK1_DATA BETWEEN '20260601' AND '20260630'
`;
const validacaoFk7Fk1 = queryPlan.validarSqlContraPlano(sqlRecebidasFk7Fk1, planoRecebidasMesFk7);
assert.strictEqual(validacaoFk7Fk1.ok, true, `SQL com FK7_FK1 deve ser aceito: ${validacaoFk7Fk1.erros.join(' | ')}`);

const sqlRecebidasFk7Fk1SemJoinSa1 = `
SET ROWCOUNT 50000;
SELECT SA1.A1_NOME AS cliente, COALESCE(SUM(FK1.FK1_VALOR), 0) AS valor_recebido
FROM SE1020 SE1
JOIN FK7020 FK7 ON FK7.FK7_FILIAL = SE1.E1_FILIAL
  AND FK7.FK7_PREFIX = SE1.E1_PREFIXO
  AND FK7.FK7_NUM = SE1.E1_NUM
  AND FK7.FK7_PARCEL = SE1.E1_PARCELA
  AND FK7.FK7_TIPO = SE1.E1_TIPO
  AND FK7.FK7_CLIFOR = SE1.E1_CLIENTE
  AND FK7.FK7_LOJA = SE1.E1_LOJA
  AND FK7.D_E_L_E_T_ = ' '
JOIN FK1020 FK1 ON FK1.FK1_FILIAL = FK7.FK7_FILIAL
  AND FK1.FK1_IDDOC = FK7.FK7_IDDOC
  AND FK1.D_E_L_E_T_ = ' '
WHERE SE1.D_E_L_E_T_ = ' '
  AND FK1.FK1_DATA BETWEEN '20260601' AND '20260630'
GROUP BY SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME
ORDER BY SA1.A1_NOME
`;
const validacaoSemJoinSa1Runner = runner._test.validarSqlIaOwnerBasico(sqlRecebidasFk7Fk1SemJoinSa1, financeiroSpec, {
  SE1020: 'E',
  FK7020: 'E',
  FK1020: 'E',
  SA1020: 'C',
});
assert.strictEqual(validacaoSemJoinSa1Runner.ok, false, 'runner deve rejeitar SA1.A1_* sem FROM/JOIN SA1');
assert(validacaoSemJoinSa1Runner.erros.join(' ').includes('SA1.A1_NOME'), 'erro deve citar alias/campo SA1 usado sem JOIN');

const sqlRecebidasFk7Fk1ComJoinSa1 = `
SET ROWCOUNT 50000;
SELECT SA1.A1_NOME AS cliente, COALESCE(SUM(FK1.FK1_VALOR), 0) AS valor_recebido
FROM SE1020 SE1
JOIN FK7020 FK7 ON FK7.FK7_FILIAL = SE1.E1_FILIAL
  AND FK7.FK7_PREFIX = SE1.E1_PREFIXO
  AND FK7.FK7_NUM = SE1.E1_NUM
  AND FK7.FK7_PARCEL = SE1.E1_PARCELA
  AND FK7.FK7_TIPO = SE1.E1_TIPO
  AND FK7.FK7_CLIFOR = SE1.E1_CLIENTE
  AND FK7.FK7_LOJA = SE1.E1_LOJA
  AND FK7.D_E_L_E_T_ = ' '
JOIN FK1020 FK1 ON FK1.FK1_FILIAL = FK7.FK7_FILIAL
  AND FK1.FK1_IDDOC = FK7.FK7_IDDOC
  AND FK1.D_E_L_E_T_ = ' '
JOIN SA1020 SA1 ON SA1.A1_COD = SE1.E1_CLIENTE
  AND SA1.A1_LOJA = SE1.E1_LOJA
  AND SA1.D_E_L_E_T_ = ' '
WHERE SE1.D_E_L_E_T_ = ' '
  AND FK1.FK1_DATA BETWEEN '20260601' AND '20260630'
GROUP BY SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME
ORDER BY SA1.A1_NOME
`;
const validacaoComJoinSa1Runner = runner._test.validarSqlIaOwnerBasico(sqlRecebidasFk7Fk1ComJoinSa1, financeiroSpec, {
  SE1020: 'E',
  FK7020: 'E',
  FK1020: 'E',
  SA1020: 'C',
});
assert.strictEqual(validacaoComJoinSa1Runner.ok, true, `runner deve aceitar SA1.A1_* com JOIN SA1: ${validacaoComJoinSa1Runner.erros.join(' | ')}`);

const validacaoFk1DiretoEmFk7 = queryPlan.validarSqlContraPlano(sqlRecebidasFk1, planoRecebidasMesFk7);
assert.strictEqual(validacaoFk1DiretoEmFk7.ok, false, 'modelo FK7_FK1 deve rejeitar JOIN FK1 direto sem FK7');
assert(validacaoFk1DiretoEmFk7.erros.join(' ').includes('FK7_FK1'), 'erro deve citar modelo FK7_FK1');

const planoPagasMesFk7 = { ...planoPagasMes, modelo_baixas_pagar: 'FK7_FK2' };
const contratoPagarFk7 = queryPlan.formatQueryPlanForPrompt(planoPagasMesFk7);
assert(contratoPagarFk7.includes('modelo_baixas_pagar=FK7_FK2'), 'query_plan deve declarar modelo FK7_FK2');
assert(contratoPagarFk7.includes('Use SE2 -> FK7 -> FK2'), 'query_plan deve orientar cadeia SE2 -> FK7 -> FK2');
assert(contratoPagarFk7.includes('PROIBIDO JOIN direto SE2 -> FK2'), 'query_plan deve proibir FK2 direto quando modelo usa FK7');

const sqlPagasFk7Fk2 = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(FK2.FK2_VALOR), 0) AS valor_pago
FROM SE2020 SE2
JOIN FK7020 FK7 ON FK7.FK7_FILIAL = SE2.E2_FILIAL
  AND FK7.FK7_PREFIX = SE2.E2_PREFIXO
  AND FK7.FK7_NUM = SE2.E2_NUM
  AND FK7.FK7_PARCEL = SE2.E2_PARCELA
  AND FK7.FK7_TIPO = SE2.E2_TIPO
  AND FK7.FK7_CLIFOR = SE2.E2_FORNECE
  AND FK7.FK7_LOJA = SE2.E2_LOJA
  AND FK7.D_E_L_E_T_ = ' '
JOIN FK2020 FK2 ON FK2.FK2_FILIAL = FK7.FK7_FILIAL
  AND FK2.FK2_IDDOC = FK7.FK7_IDDOC
  AND FK2.D_E_L_E_T_ = ' '
WHERE SE2.D_E_L_E_T_ = ' '
  AND FK2.FK2_DATA BETWEEN '20260601' AND '20260630'
`;
const validacaoFk7Fk2 = queryPlan.validarSqlContraPlano(sqlPagasFk7Fk2, planoPagasMesFk7);
assert.strictEqual(validacaoFk7Fk2.ok, true, `SQL com FK7_FK2 deve ser aceito: ${validacaoFk7Fk2.erros.join(' | ')}`);

const validacaoFk2DiretoEmFk7 = queryPlan.validarSqlContraPlano(sqlPagasFk2, planoPagasMesFk7);
assert.strictEqual(validacaoFk2DiretoEmFk7.ok, false, 'modelo FK7_FK2 deve rejeitar JOIN FK2 direto sem FK7');
assert(validacaoFk2DiretoEmFk7.erros.join(' ').includes('FK7_FK2'), 'erro deve citar modelo FK7_FK2');

// Verifica que system prompt proíbe E1_BAIXA/E2_BAIXA explicitamente (modelo SE5 — padrão)
assert(systemPrompt.includes('NUNCA use SE1.E1_BAIXA'), 'system prompt deve proibir E1_BAIXA');
assert(systemPrompt.includes('NUNCA use SE2.E2_BAIXA'), 'system prompt deve proibir E2_BAIXA');
assert(systemPrompt.includes('E5_RECPAG'), 'system prompt SE5 deve documentar E5_RECPAG');
assert(!systemPrompt.includes('FK1.FK1_DATA'), 'system prompt SE5 nao deve documentar FK1.FK1_DATA');
assert(!systemPrompt.includes("E1_SITUACAO = 'B'"), 'system prompt nao deve exigir E1_SITUACAO=B (titulo pode ter baixa parcial)');
assert(!systemPrompt.includes("E2_SITUACAO = 'B'"), 'system prompt nao deve exigir E2_SITUACAO=B (titulo pode ter baixa parcial)');
assert(systemPrompt.includes('Modelo de baixas deste tenant'), 'system prompt deve orientar IA a usar o modelo de baixas do tenant');
assert(contratoReceberFk7.includes('modelo_baixas_receber'), 'query_plan deve expor modelo_baixas_receber do contexto');
assert(contratoPagarFk7.includes('modelo_baixas_pagar'), 'query_plan deve expor modelo_baixas_pagar do contexto');

// Verifica que system prompt com modelo FK1/FK2 documenta os joins FK corretos
const systemPromptFk = promptBuilder.buildSystemPrompt(financeiroSpec, { modeloBaixasReceber: 'FK1', modeloBaixasPagar: 'FK2' });
assert(systemPromptFk.includes('FK1.FK1_DATA'), 'system prompt FK1 deve documentar FK1.FK1_DATA');
assert(systemPromptFk.includes('FK2.FK2_DATA'), 'system prompt FK2 deve documentar FK2.FK2_DATA');
assert(!systemPromptFk.includes('E5_RECPAG'), 'system prompt FK nao deve documentar E5_RECPAG');

// Verifica que buildContextoTecnico detecta FK1/FK2 pelo SX2
const { buildContextoTecnicoTest } = runner._test;
if (buildContextoTecnicoTest) {
  // sx3 com FK e sem FK para simular o que chegaria da camada real
  const sx3ComFk = { SE1: [{ campo: 'E1_NUM' }], FK1: [{ campo: 'FK1_DATA' }], FK2: [{ campo: 'FK2_DATA' }], FK5: [{ campo: 'FK5_DATA' }] };
  const sx3SemFk = { SE1: [{ campo: 'E1_NUM' }], SE5: [{ campo: 'E5_DATA' }] };
  const tabelasEspec = ['SE1', 'SE2', 'SE5', 'FK1', 'FK2', 'FK5', 'FK6', 'FK7', 'FKA', 'FKB'];

  // ── Cenário 1: tenant COM FK cadastrada no SX2 (ex: tenant que usa modelo FK moderno) ──
  const ctxComFk = buildContextoTecnicoTest({
    spec: { tabelas: tabelasEspec },
    sx2: { SE1010: 'E', SE5010: 'E', FK1010: 'E', FK2010: 'E', FK5010: 'E' },
    sx2Puro: { SE1010: 'E', SE5010: 'E', FK1010: 'E', FK2010: 'E', FK5010: 'E' },
    sx3Prompt: sx3ComFk,
  });
  assert.strictEqual(ctxComFk.modelo_baixas_receber, 'FK1', '[C1] modelo_baixas_receber deve ser FK1');
  assert.strictEqual(ctxComFk.modelo_baixas_pagar, 'FK2', '[C1] modelo_baixas_pagar deve ser FK2');
  assert.ok(ctxComFk.tabelas_permitidas.includes('FK1'), '[C1] FK1 deve aparecer em tabelas_permitidas');
  assert.ok(ctxComFk.tabelas_permitidas.includes('FK2'), '[C1] FK2 deve aparecer em tabelas_permitidas');
  assert.ok('FK1010' in ctxComFk.sx2, '[C1] FK1010 deve aparecer no sx2 exposto');
  assert.ok('FK2010' in ctxComFk.sx2, '[C1] FK2010 deve aparecer no sx2 exposto');
  assert.ok('FK1' in ctxComFk.sx3, '[C1] FK1 deve aparecer no sx3 exposto');

  const ctxComFk7 = buildContextoTecnicoTest({
    spec: { tabelas: tabelasEspec },
    sx2: { SE1010: 'E', SE5010: 'E', FK1010: 'E', FK2010: 'E', FK7010: 'E' },
    sx2Puro: { SE1010: 'E', SE5010: 'E', FK1010: 'E', FK2010: 'E', FK7010: 'E' },
    sx3Prompt: { ...sx3ComFk, FK7: [{ campo: 'FK7_IDDOC' }] },
  });
  assert.strictEqual(ctxComFk7.modelo_baixas_receber, 'FK7_FK1', '[C1-FK7] modelo_baixas_receber deve ser FK7_FK1');
  assert.strictEqual(ctxComFk7.modelo_baixas_pagar, 'FK7_FK2', '[C1-FK7] modelo_baixas_pagar deve ser FK7_FK2');
  assert.ok(ctxComFk7.tabelas_permitidas.includes('FK7'), '[C1-FK7] FK7 deve aparecer em tabelas_permitidas');
  assert.ok('FK7010' in ctxComFk7.sx2, '[C1-FK7] FK7010 deve aparecer no sx2 exposto');

  // ── Cenário 2: J2A/C3I — FK injetada pelo completarSX2Permitidas mas ausente no SX2 puro ──
  const ctxFkInjetada = buildContextoTecnicoTest({
    spec: { tabelas: tabelasEspec },
    sx2: { SE1990: 'E', SE5990: 'E', FK1990: 'E', FK2990: 'E', FK5990: 'E' }, // completar injetou
    sx2Puro: { SE1990: 'E', SE5990: 'E' },                                       // SX2 real: sem FK
    sx3Prompt: sx3ComFk, // sx3 pode ter FK nos campos essenciais mesmo sem SX2
  });
  assert.strictEqual(ctxFkInjetada.modelo_baixas_receber, 'SE5', '[C2] modelo_baixas_receber deve ser SE5');
  assert.strictEqual(ctxFkInjetada.modelo_baixas_pagar, 'SE5', '[C2] modelo_baixas_pagar deve ser SE5');
  assert.ok(!ctxFkInjetada.tabelas_permitidas.includes('FK1'), '[C2] FK1 NAO deve aparecer em tabelas_permitidas');
  assert.ok(!ctxFkInjetada.tabelas_permitidas.includes('FK2'), '[C2] FK2 NAO deve aparecer em tabelas_permitidas');
  assert.ok(!ctxFkInjetada.tabelas_permitidas.includes('FK5'), '[C2] FK5 NAO deve aparecer em tabelas_permitidas');
  assert.ok(!('FK1990' in ctxFkInjetada.sx2), '[C2] FK1990 NAO deve aparecer no sx2 exposto');
  assert.ok(!('FK2990' in ctxFkInjetada.sx2), '[C2] FK2990 NAO deve aparecer no sx2 exposto');
  assert.ok(!('FK1' in ctxFkInjetada.sx3), '[C2] FK1 NAO deve aparecer no sx3 exposto');
  assert.ok(!('FK2' in ctxFkInjetada.sx3), '[C2] FK2 NAO deve aparecer no sx3 exposto');
  assert.ok('SE1' in ctxFkInjetada.sx3, '[C2] SE1 deve permanecer no sx3 exposto');

  // ── Cenário 3: Caieira — sem SX2 cadastrado, sx2Puro null ──
  const ctxSemSx2 = buildContextoTecnicoTest({
    spec: { tabelas: tabelasEspec },
    sx2: { SE1990: 'E', SE5990: 'E', FK1990: 'E', FK2990: 'E' }, // completar montou tudo
    sx2Puro: null,
    sx3Prompt: sx3SemFk,
  });
  assert.strictEqual(ctxSemSx2.modelo_baixas_receber, 'SE5', '[C3] modelo_baixas_receber deve ser SE5');
  assert.strictEqual(ctxSemSx2.modelo_baixas_pagar, 'SE5', '[C3] modelo_baixas_pagar deve ser SE5');
  assert.ok(!ctxSemSx2.tabelas_permitidas.includes('FK1'), '[C3] FK1 NAO deve aparecer em tabelas_permitidas');
  assert.ok(!ctxSemSx2.tabelas_permitidas.includes('FK2'), '[C3] FK2 NAO deve aparecer em tabelas_permitidas');
  assert.ok(!('FK1990' in ctxSemSx2.sx2), '[C3] FK1990 NAO deve aparecer no sx2 exposto');
  assert.ok(!('FK2990' in ctxSemSx2.sx2), '[C3] FK2990 NAO deve aparecer no sx2 exposto');
  assert.ok('SE1990' in ctxSemSx2.sx2, '[C3] SE1990 deve permanecer no sx2 exposto');
}

console.log('financeiro-sql-contrato.test.js: ok (ia-owner)');
