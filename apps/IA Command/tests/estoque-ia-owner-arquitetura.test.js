'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const estoqueSpec = require(path.join(ROOT, 'modules/erp/estoque/estoque-ia-owner-spec'));

const systemPrompt = promptBuilder.buildSystemPrompt(estoqueSpec);
assert(systemPrompt.includes('Voce e o IA-OWNER do modulo estoque'), 'prompt deve declarar IA-OWNER de estoque');
assert(systemPrompt.includes('Regras de Validacao de Tabelas Fisicas'), 'prompt deve conter regra SX2 multi-tenant');
assert(systemPrompt.includes('APENAS o mapa fornecido no no "sx2"'), 'prompt deve obrigar uso do SX2 atual');
assert(systemPrompt.includes('SB1.B1_DESC AS produto'), 'entidades devem retornar descricao de produto');
assert(systemPrompt.includes('SB2.B2_QATU'), 'prompt deve documentar campo de saldo atual');
assert(systemPrompt.includes('SD3'), 'prompt deve documentar movimentacao interna SD3');
assert(systemPrompt.includes('D3_TM'), 'prompt deve documentar tipo de movimento SD3');
assert(systemPrompt.includes('NUNCA use B1_FILIAL no ON'), 'prompt deve proibir JOIN SB2->SB1 por filial');

const userPrompt = promptBuilder.buildUserPrompt({
  mensagem: 'agora por armazem',
  historico: [{ pergunta: 'saldo em estoque do produto 000001', periodo: { tipo: 'nenhum' } }],
  estadoAnterior: runner._test.buildEstadoAnterior({
    intencao: 'estoque_dinamico',
    periodo: { tipo: 'nenhum' },
    filtros: {},
  }),
});
assert(userPrompt.includes('nao autoritativa'), 'estado previo deve ser marcado como nao autoritativo');
assert(userPrompt.includes('agora por armazem'), 'prompt deve conter mensagem atual');

const sx3Prompt = runner._test.sx3EssencialParaPrompt(estoqueSpec.camposSx3Essenciais);
assert(sx3Prompt.SB2.some(c => c.campo === 'B2_QATU'), 'SX3 essencial deve manter campo de saldo');
assert(sx3Prompt.SD3.some(c => c.campo === 'D3_TM'), 'SX3 essencial deve incluir D3_TM');

const sx2 = {
  SB2990: 'E',
  SB1990: 'E',
  SBM990: 'E',
  SD3990: 'E',
};

const sqlRuim = `
SELECT TOP 10000 SUM(SB2990.B2_QATU) AS saldo
FROM SB2990
WHERE SB2990.D_E_L_E_T_ = ' '
`;
const validacaoRuim = runner._test.validarSqlIaOwnerBasico(sqlRuim, estoqueSpec, sx2);
assert.strictEqual(validacaoRuim.ok, false, 'SQL ruim deve ser rejeitado antes da execucao');
assert(validacaoRuim.erros.some(e => e.includes('SELECT TOP')), 'deve rejeitar SELECT TOP');
assert(validacaoRuim.erros.some(e => e.includes('tabela fisica como qualificador')), 'deve rejeitar qualificador fisico');

const sqlJoinPorFilial = `
SET ROWCOUNT 50;
SELECT SB1.B1_DESC AS produto, SUM(SB2.B2_QATU) AS saldo
FROM SB2990 SB2
JOIN SB1990 SB1 ON SB2.B2_COD = SB1.B1_COD AND SB2.B2_FILIAL = SB1.B1_FILIAL AND SB1.D_E_L_E_T_ = ' '
WHERE SB2.D_E_L_E_T_ = ' '
GROUP BY SB1.B1_DESC
`;
const validacaoJoinFilial = runner._test.validarSqlIaOwnerBasico(sqlJoinPorFilial, estoqueSpec, sx2);
assert.strictEqual(validacaoJoinFilial.ok, false, 'JOIN SB2->SB1 por filial deve ser rejeitado');
assert(validacaoJoinFilial.erros.some(e => e.includes('B2_FILIAL = SB1.B1_FILIAL') || e.includes('nao deve casar por filial')), 'deve orientar remover filial do JOIN SB2->SB1');

const sqlSaldoPorSd2 = `
SET ROWCOUNT 50;
SELECT SUM(SD2.D2_QUANT) AS saldo
FROM SD2990 SD2
WHERE SD2.D_E_L_E_T_ = ' '
`;
const validacaoSaldoSd2 = runner._test.validarSqlIaOwnerBasico(sqlSaldoPorSd2, estoqueSpec, sx2, 'saldo em estoque do produto 000001');
assert.strictEqual(validacaoSaldoSd2.ok, false, 'saldo derivado de SD2 deve ser rejeitado');

const sqlBom = `
SET ROWCOUNT 50;
SELECT SB2.B2_FILIAL AS filial, SB1.B1_DESC AS produto, SUM(SB2.B2_QATU) AS saldo_atual
FROM SB2990 SB2
JOIN SB1990 SB1 ON SB2.B2_COD = SB1.B1_COD AND SB1.D_E_L_E_T_ = ' '
WHERE SB2.B2_COD = '000001' AND SB2.D_E_L_E_T_ = ' '
GROUP BY SB2.B2_FILIAL, SB1.B1_DESC
`;
const validacaoBoa = runner._test.validarSqlIaOwnerBasico(sqlBom, estoqueSpec, sx2);
assert.strictEqual(validacaoBoa.ok, true, `SQL bom nao deveria ser rejeitado: ${(validacaoBoa.erros || []).join(' | ')}`);

console.log('estoque-ia-owner-arquitetura.test.js: ok');
