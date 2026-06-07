'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const comissaoSpec = require(path.join(ROOT, 'modules/erp/comissao/comissao-ia-owner-spec'));

const systemPrompt = promptBuilder.buildSystemPrompt(comissaoSpec);
assert(systemPrompt.includes('Voce e o IA-OWNER do modulo comissao'), 'prompt deve declarar IA-OWNER de comissao');
assert(systemPrompt.includes('Voce decide se a pergunta atual e uma nova consulta'), 'IA deve decidir contexto/heranca');
assert(systemPrompt.includes('Para "em aberto", "a receber" ou "pendente" sem periodo explicito, nao assuma mes atual'), 'em aberto nao deve herdar mes atual automaticamente');
assert(systemPrompt.includes('vendedorFixo'), 'prompt deve conter regra de vendedor fixo');
assert(systemPrompt.includes('SE3.E3_COMIS'), 'prompt deve conter metrica principal');
assert(systemPrompt.includes('SE3.E3_BASE'), 'prompt deve conter base de comissao');
assert(systemPrompt.includes('SE3.E3_STATUS nao significa pagamento realizado'), 'prompt deve prevenir uso indevido de E3_STATUS');
assert(systemPrompt.includes('FROM SE3990 SE3'), 'prompt deve ensinar tabela fisica com alias base');
assert(systemPrompt.includes('Quando precisar filtrar vendedor ou cliente'), 'prompt deve resolver entidades antes de filtrar por nome');

const sx3Prompt = runner._test.sx3EssencialParaPrompt(comissaoSpec.camposSx3Essenciais);
assert(sx3Prompt.SE3.some(c => c.campo === 'E3_COMIS'), 'SX3 essencial deve incluir E3_COMIS');
assert(sx3Prompt.SE3.some(c => c.campo === 'E3_VENCTO'), 'SX3 essencial deve incluir E3_VENCTO');
assert(sx3Prompt.SE3.some(c => c.campo === 'E3_VEND'), 'SX3 essencial deve incluir E3_VEND');
assert(sx3Prompt.SA3.some(c => c.campo === 'A3_NOME'), 'SX3 essencial deve incluir A3_NOME');
assert(sx3Prompt.SA1.some(c => c.campo === 'A1_NOME'), 'SX3 essencial deve incluir A1_NOME');

const sqlPorVendedor = `
SET ROWCOUNT 50000;
SELECT SA3.A3_NOME AS vendedor, COALESCE(SUM(SE3.E3_COMIS),0) AS valor_comissao
FROM SE3990 SE3
INNER JOIN SA3990 SA3 ON SE3.E3_VEND = SA3.A3_COD
WHERE SE3.D_E_L_E_T_ = ' ' AND SA3.D_E_L_E_T_ = ' ' AND SE3.E3_VENCTO BETWEEN '20260601' AND '20260630'
GROUP BY SA3.A3_NOME
ORDER BY valor_comissao DESC
`;
const validacaoBoa = runner._test.validarSqlIaOwnerBasico(sqlPorVendedor, comissaoSpec, { SE3990: 'E', SA3990: 'E' });
assert.strictEqual(validacaoBoa.ok, true, `SQL por vendedor nao deveria ser rejeitado: ${validacaoBoa.erros.join(' | ')}`);

const sqlSemAlias = `
SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE3.E3_COMIS),0) AS valor_comissao
FROM SE3
WHERE SE3.D_E_L_E_T_ = ' '
`;
const validacaoRuim = runner._test.validarSqlIaOwnerBasico(sqlSemAlias, comissaoSpec, { SE3990: 'E' });
assert.strictEqual(validacaoRuim.ok, false, 'FROM SE3 sem alias explicito deve ser rejeitado');
assert(validacaoRuim.erros.some(e => /alias SE3/i.test(e)), 'deve orientar alias SE3');

console.log('comissao-ia-owner-arquitetura.test.js: ok');
