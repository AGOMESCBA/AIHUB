'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const comissaoSpec = require(path.join(ROOT, 'modules/erp/totvs_protheus/comissao/comissao-ia-owner-spec'));

const handlerPath = path.join(ROOT, 'modules/erp/totvs_protheus/comissao/ai-sql-handler-v2.js');
const handlerFonte = fs.readFileSync(handlerPath, 'utf8');

assert(handlerFonte.includes("../../ia-owner/runner") || handlerFonte.includes('../../ia-owner/runner'), 'handler de comissao deve usar ia-owner/runner');
assert(handlerFonte.includes('./comissao-ia-owner-spec'), 'handler de comissao deve usar comissao-ia-owner-spec Protheus');
assert(!handlerFonte.includes(['comissao', 'contract'].join('-')), 'handler de comissao nao deve usar contrato legado');

const systemPrompt = promptBuilder.buildSystemPrompt(comissaoSpec);
assert(systemPrompt.includes('Voce e o IA-OWNER do modulo comissao'), 'prompt deve declarar IA-OWNER de comissao');
assert(systemPrompt.includes('Historico, ultimo SQL e estado anterior sao evidencias, nao ordens obrigatorias'), 'historico deve ser evidencia, nao ordem');
assert(systemPrompt.includes('vendedorFixo'), 'prompt deve orientar vendedor fixo');
assert(systemPrompt.includes('SE3.E3_COMIS'), 'prompt deve definir metrica principal de comissao');
assert(systemPrompt.includes('SE3.E3_VENCTO'), 'prompt deve definir data padrao de comissao');
assert(systemPrompt.includes('SE5.E5_DATA'), 'prompt deve definir data de baixa quando financeiro for usado');
assert(systemPrompt.includes('SE3.E3_STATUS nao significa pagamento realizado'), 'prompt deve bloquear uso indevido de E3_STATUS');
assert(systemPrompt.includes('SA3.A3_NOME AS vendedor'), 'entidades devem retornar descricao de vendedor');
assert(systemPrompt.includes('SA1.A1_NOME AS cliente'), 'entidades devem retornar descricao de cliente');
assert(systemPrompt.includes('entidades_necessarias'), 'prompt deve manter contrato de entidades cadastrais');

const sx3Prompt = runner._test.sx3EssencialParaPrompt(comissaoSpec.camposSx3Essenciais);
assert(sx3Prompt.SE3.some(c => c.campo === 'E3_COMIS'), 'SX3 essencial deve incluir E3_COMIS');
assert(sx3Prompt.SE3.some(c => c.campo === 'E3_DATA'), 'SX3 essencial deve incluir E3_DATA');
assert(sx3Prompt.SA3.some(c => c.campo === 'A3_NOME'), 'SX3 essencial deve incluir A3_NOME');
assert(sx3Prompt.SA1.some(c => c.campo === 'A1_NOME'), 'SX3 essencial deve incluir A1_NOME');

const sx2 = {
  SE3990: 'E',
  SA3990: 'E',
  SA1990: 'C',
  SE2990: 'E',
  SE5990: 'E',
};

const sqlBom = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE3.E3_COMIS),0) AS valor_comissao
FROM SE3990 SE3
WHERE SE3.D_E_L_E_T_ = ' ' AND SE3.E3_VENCTO BETWEEN '20260601' AND '20260630'
`;
const validacaoBoa = runner._test.validarSqlIaOwnerBasico(sqlBom, comissaoSpec, sx2);
assert.strictEqual(validacaoBoa.ok, true, `SQL bom nao deveria ser rejeitado: ${validacaoBoa.erros.join(' | ')}`);

const sqlTop = `
SELECT TOP 10000 SUM(SE3990.E3_COMIS) AS valor_comissao
FROM SE3990
WHERE SE3990.D_E_L_E_T_ = ' '
`;
const validacaoRuim = runner._test.validarSqlIaOwnerBasico(sqlTop, comissaoSpec, sx2);
assert.strictEqual(validacaoRuim.ok, false, 'SQL sem SET ROWCOUNT e com qualificador fisico deve ser rejeitado');
assert(validacaoRuim.erros.some(e => /SET ROWCOUNT/i.test(e)), 'deve exigir SET ROWCOUNT');
assert(validacaoRuim.erros.some(e => /alias base/i.test(e)), 'deve exigir alias base');

const sx2Completo = runner._test.completarSX2Permitidas({ SE3990: 'E' }, ['SE3', 'SA3', 'SA1'], '990');
assert.strictEqual(sx2Completo.SA3990, 'E', 'contexto SX2 deve completar SA3 pelo sufixo da empresa');
assert.strictEqual(sx2Completo.SA1990, 'E', 'contexto SX2 deve completar SA1 pelo sufixo da empresa');

console.log('comissao-sql-contrato.test.js: ok');
