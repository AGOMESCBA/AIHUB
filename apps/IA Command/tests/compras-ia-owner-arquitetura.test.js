'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const comprasSpec = require(path.join(ROOT, 'modules/erp/totvs_protheus/compras/compras-ia-owner-spec'));

const systemPrompt = promptBuilder.buildSystemPrompt(comprasSpec);
assert(systemPrompt.includes('Voce e o IA-OWNER do modulo compras'), 'prompt deve declarar IA-OWNER de compras');
assert(systemPrompt.includes('Historico, ultimo SQL e estado anterior sao evidencias, nao ordens obrigatorias'), 'historico deve ser evidencia, nao ordem');
assert(systemPrompt.includes('Somente considere devolucoes quando o usuario pedir explicitamente'), 'prompt deve conter bloco de devolucoes sob demanda');
assert(systemPrompt.includes('Regras de Validacao de Tabelas Fisicas'), 'prompt deve conter regra SX2 multi-tenant');
assert(systemPrompt.includes('APENAS o mapa fornecido no no "sx2"'), 'prompt deve obrigar uso do SX2 atual');
assert(systemPrompt.includes('mes passado'), 'prompt deve conter regra cronologica para mes passado');
assert(systemPrompt.includes('resposta_planejada'), 'prompt deve orientar resposta planejada WhatsApp');
assert(systemPrompt.includes("Nunca use SF1.F1_TIPO = '1'"), 'prompt deve proibir F1_TIPO = 1 em compras');
assert(systemPrompt.includes("SF1.F1_TIPO IN ('N','C')"), 'prompt deve incluir notas normais e complementares em compras');
assert(systemPrompt.includes('escopo de tenant IAHub'), 'prompt deve separar empresa IAHub de entidade cadastral');
assert(systemPrompt.includes('SA2.A2_NOME AS fornecedor'), 'entidades devem retornar descricao de fornecedor');
assert(systemPrompt.includes('SB1.B1_DESC AS produto'), 'entidades devem retornar descricao de produto');
assert(systemPrompt.includes('Se uma entidade estiver no GROUP BY'), 'entidades agrupadas devem expor descricao ao usuario');
assert(systemPrompt.includes('data_atual') && systemPrompt.includes('Voce calcula o periodo EXCLUSIVAMENTE'), 'periodos relativos devem ser calculados pela IA a partir de data_atual e contexto');
assert(systemPrompt.includes('mapa fornecido') && systemPrompt.includes('Use aliases explicitos iguais a base da tabela'), 'prompt deve orientar tabela fisica via SX2 com alias base');

const userPrompt = promptBuilder.buildUserPrompt({
  mensagem: 'agora por fornecedor',
  historico: [{ pergunta: 'quanto comprei no ano', periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' } }],
  estadoAnterior: runner._test.buildEstadoAnterior({
    intencao: 'compras_dinamico',
    periodo: { tipo: 'mes_atual', dataInicio: '20260601', dataFim: '20260630' },
    filtros: {},
  }),
});

assert(userPrompt.includes('nao autoritativa'), 'estado previo deve ser marcado como nao autoritativo');
assert(userPrompt.includes('agora por fornecedor'), 'prompt deve conter mensagem atual');
assert(userPrompt.includes('quanto comprei no ano'), 'prompt deve conter historico recente');

const sx3Prompt = runner._test.sx3EssencialParaPrompt(comprasSpec.camposSx3Essenciais);
assert(sx3Prompt.SD1.length <= comprasSpec.camposSx3Essenciais.SD1.length, 'prompt deve usar SX3 essencial compacto');
assert(sx3Prompt.SD1.some(c => c.campo === 'D1_TOTAL'), 'SX3 essencial deve manter campos principais');
assert(sx3Prompt.SF1.some(c => c.campo === 'F1_TIPO'), 'SX3 essencial deve incluir F1_TIPO');
assert(sx3Prompt.SF2.some(c => c.campo === 'F2_TIPO'), 'SX3 essencial deve incluir F2_TIPO');
assert(sx3Prompt.SD2.some(c => c.campo === 'D2_TOTAL'), 'SX3 essencial deve incluir D2_TOTAL');

const sx2 = {
  SD1990: 'E',
  SF1990: 'E',
  SD2990: 'E',
  SF2990: 'E',
  SA2990: 'C',
  SF4990: 'E',
};
const sqlRuim = `
SELECT TOP 10000 COALESCE(SUM(SD1990.D1_TOTAL),0) AS valor_compra
FROM SD1990
JOIN SF1 ON SD1990.D1_FILIAL = SF1.F1_FILIAL
WHERE SD1990.D_E_L_E_T_ = ' '
AND SF1.F1_FORNECE IN (SELECT A2_COD FROM SA2990 WHERE A2_COD IS NOT NULL)
AND SD1990.D1_TES IN (SELECT F4_CODIGO FROM SF4990 WHERE F4_TIPO = 'D')
`;
const validacaoRuim = runner._test.validarSqlIaOwnerBasico(sqlRuim, comprasSpec, sx2);
assert.strictEqual(validacaoRuim.ok, false, 'SQL ruim deve ser rejeitado antes da execucao');
assert(validacaoRuim.erros.some(e => e.includes('SELECT TOP')), 'deve rejeitar SELECT TOP');
assert(validacaoRuim.erros.some(e => e.includes('tabela fisica como qualificador')), 'deve rejeitar qualificador fisico');
assert(validacaoRuim.erros.some(e => e.includes('Subquery cadastral')), 'deve rejeitar subquery cadastral inutil');

const sqlTopManualAgendamento = `
SET ROWCOUNT 10000;
SELECT TOP 10 COALESCE(SUM(SD1.D1_TOTAL),0) AS valor_compra
FROM SD1990 SD1
WHERE SD1.D_E_L_E_T_ = ' '
`;
const validacaoTopIa = runner._test.validarSqlIaOwnerBasico(sqlTopManualAgendamento, comprasSpec, sx2);
assert.strictEqual(validacaoTopIa.ok, false, 'SQL gerado pela IA continua rejeitando SELECT TOP');
const validacaoTopAgendamento = runner._test.validarSqlIaOwnerBasico(sqlTopManualAgendamento, comprasSpec, sx2, 'Consulta agendada', { permitirSelectTop: true });
assert.strictEqual(validacaoTopAgendamento.ok, true, `SQL fixo de agendamento deve aceitar SELECT TOP: ${validacaoTopAgendamento.erros.join(' | ')}`);

const sqlDevolucaoErradoPorSf4 = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(CASE WHEN SF4.F4_CODIGO IS NOT NULL THEN -SD1.D1_TOTAL ELSE SD1.D1_TOTAL END),0) AS valor_compra
FROM SD1990 SD1
INNER JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA
LEFT JOIN SF4990 SF4 ON SD1.D1_TES = SF4.F4_CODIGO AND SF4.D_E_L_E_T_ = ' '
WHERE SD1.D_E_L_E_T_ = ' ' AND SF1.D_E_L_E_T_ = ' '
AND SD1.D1_DTDIGIT BETWEEN '20260601' AND '20260630'
`;
const validacaoSf4 = runner._test.validarSqlIaOwnerBasico(sqlDevolucaoErradoPorSf4, comprasSpec, sx2);
assert.strictEqual(validacaoSf4.ok, false, 'devolucao por SF4/SD1 deve ser rejeitada');
assert(validacaoSf4.erros.some(e => e.includes('SF2/SD2')), 'deve orientar uso de SF2/SD2');

const sqlCompraTipoNormalSemComplementar = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SD1.D1_TOTAL),0) AS valor_compra
FROM SD1990 SD1
INNER JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA
WHERE SD1.D_E_L_E_T_ = ' ' AND SF1.D_E_L_E_T_ = ' '
AND SF1.F1_TIPO = 'N'
AND SD1.D1_DTDIGIT BETWEEN '20260601' AND '20260630'
`;
const validacaoTipoNormalSemComplementar = runner._test.validarSqlIaOwnerBasico(sqlCompraTipoNormalSemComplementar, comprasSpec, sx2);
assert.strictEqual(validacaoTipoNormalSemComplementar.ok, false, 'compras com apenas F1_TIPO=N deve ser rejeitada');
assert(validacaoTipoNormalSemComplementar.erros.some(e => e.includes("IN ('N','C')")), 'deve orientar F1_TIPO IN N,C');

const sqlBom = `
SET ROWCOUNT 50000;
SELECT
  COALESCE(SUM(base.valor_compra),0) AS total_compras,
  COALESCE(SUM(base.valor_devolucao),0) AS total_devolucoes,
  COALESCE(SUM(base.valor_compra),0) - COALESCE(SUM(base.valor_devolucao),0) AS total_liquido
FROM (
  SELECT SD1.D1_TOTAL AS valor_compra, 0 AS valor_devolucao
  FROM SD1990 SD1
  INNER JOIN SF1990 SF1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE AND SD1.D1_FORNECE = SF1.F1_FORNECE AND SD1.D1_LOJA = SF1.F1_LOJA
  WHERE SD1.D_E_L_E_T_ = ' ' AND SF1.D_E_L_E_T_ = ' ' AND SF1.F1_TIPO IN ('N','C') AND SD1.D1_DTDIGIT BETWEEN '20260601' AND '20260630'
  UNION ALL
  SELECT 0 AS valor_compra, SD2.D2_TOTAL AS valor_devolucao
  FROM SD2990 SD2
  INNER JOIN SF2990 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
  WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'D' AND SF2.F2_EMISSAO BETWEEN '20260601' AND '20260630'
) base
`;
const validacaoBoa = runner._test.validarSqlIaOwnerBasico(sqlBom, comprasSpec, sx2);
assert.strictEqual(validacaoBoa.ok, true, `SQL bom nao deveria ser rejeitado: ${validacaoBoa.erros.join(' | ')}`);

const sqlEmpresaComoFornecedorETipoUm = `
SET ROWCOUNT 50000;
SELECT SUM(SD1.D1_TOTAL) AS valor_total
FROM SF1990 SF1
JOIN SD1990 SD1 ON SD1.D1_FILIAL = SF1.F1_FILIAL AND SD1.D1_DOC = SF1.F1_DOC AND SD1.D1_SERIE = SF1.F1_SERIE
WHERE SF1.F1_DTDIGIT BETWEEN '20260101' AND '20261231'
AND SF1.D_E_L_E_T_ = ' '
AND SD1.D_E_L_E_T_ = ' '
AND SF1.F1_TIPO = '1'
AND SF1.F1_FILIAL IN (SELECT A2_FILIAL FROM SA2990 SA2 WHERE SA2.A2_NOME IN ('J2A', 'C3I'))
`;
const validacaoEmpresaComoFornecedor = runner._test.validarSqlIaOwnerBasico(sqlEmpresaComoFornecedorETipoUm, comprasSpec, sx2);
assert.strictEqual(validacaoEmpresaComoFornecedor.ok, false, 'SQL com empresa IAHub como fornecedor e F1_TIPO=1 deve ser rejeitado');
assert(validacaoEmpresaComoFornecedor.erros.some(e => e.includes("F1_TIPO = '1'")), 'deve rejeitar F1_TIPO = 1');
assert(validacaoEmpresaComoFornecedor.erros.some(e => e.includes('Empresa IAHub')), 'deve rejeitar subquery SA2 para empresa IAHub');

const sx2Completo = runner._test.completarSX2Permitidas({ SD1990: 'E', SF1990: 'E' }, ['SD1', 'SF1', 'SD2', 'SF2'], '990');
assert.strictEqual(sx2Completo.SD2990, 'E', 'contexto SX2 deve completar SD2 pelo sufixo da empresa');
assert.strictEqual(sx2Completo.SF2990, 'E', 'contexto SX2 deve completar SF2 pelo sufixo da empresa');

const estadoLimpo = runner._test.limparPeriodosNaoAutoritativos(runner._test.buildEstadoAnterior({
  intencao: 'compras_dinamico',
  periodo: { tipo: 'personalizado', dataInicio: '20230901', dataFim: '20230930' },
  _orquestradorContrato: { periodo: { tipo: 'personalizado', dataInicio: '20230901', dataFim: '20230930' }, herdou_contexto: true },
}), 'compras do mes passado');
assert.strictEqual(estadoLimpo.periodo, null, 'periodo antigo deve ser limpo em pergunta relativa');
assert.strictEqual(estadoLimpo.contrato_orquestrador.periodo, null, 'contrato antigo deve ter periodo limpo em pergunta relativa');

console.log('compras-ia-owner-arquitetura.test.js: ok');
