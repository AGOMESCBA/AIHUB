'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const routerSrc = fs.readFileSync(path.join(ROOT, 'modules/erp/core/intent-router.js'), 'utf8');
const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const financeiroSpec = require(path.join(ROOT, 'modules/erp/totvs_protheus/financeiro/financeiro-ia-owner-spec'));

assert(routerSrc.includes("financeiro: './totvs_protheus/financeiro/ai-sql-handler-v2'"), 'financeiro deve estar habilitado no roteador');
assert.strictEqual(financeiroSpec.nome, 'financeiro', 'spec financeiro deve identificar o modulo');
assert.strictEqual(typeof financeiroSpec.resolverEntidades, 'function', 'spec financeiro deve resolver entidades');

const systemPrompt = promptBuilder.buildSystemPrompt(financeiroSpec);
assert(systemPrompt.includes('Fluxo de caixa projetado'), 'spec deve reconhecer fluxo projetado');
assert(systemPrompt.includes('Fluxo de caixa realizado'), 'spec deve reconhecer fluxo realizado');
assert(systemPrompt.includes('Saldo bancario puro usa SOMENTE SE8 e SA6'), 'saldo bancario puro nao deve misturar carteiras');
assert(systemPrompt.includes('Fluxo projetado usa titulos em aberto'), 'fluxo projetado deve usar titulos em aberto');
assert(systemPrompt.includes('valor_recebido') && systemPrompt.includes('valor_pago'), 'fluxo realizado deve usar baixas/movimentos reais');
assert(systemPrompt.includes('saldo_bancario_base') && systemPrompt.includes('fluxo_liquido'), 'fluxo deve retornar componentes claros');
assert(systemPrompt.includes('PA = pagamento antecipado'), 'spec deve orientar PA');
assert(systemPrompt.includes('RA = recebimento antecipado'), 'spec deve orientar RA');
assert(systemPrompt.includes('Sem fornecedor/cliente, marque precisa_confirmacao=true'), 'PA/RA sem entidade devem pedir confirmacao');

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

const sx3Prompt = runner._test.sx3EssencialParaPrompt(financeiroSpec.camposSx3Essenciais);
assert(sx3Prompt.SE1.some(c => c.campo === 'E1_SALDO'), 'SX3 essencial deve incluir E1_SALDO');
assert(sx3Prompt.SE2.some(c => c.campo === 'E2_SALDO'), 'SX3 essencial deve incluir E2_SALDO');
assert(sx3Prompt.SE1.some(c => c.campo === 'E1_TIPO'), 'SX3 essencial deve incluir E1_TIPO para RA');
assert(sx3Prompt.SE2.some(c => c.campo === 'E2_TIPO'), 'SX3 essencial deve incluir E2_TIPO para PA');
assert(sx3Prompt.SE8.some(c => c.campo === 'E8_SALATUA'), 'SX3 essencial deve incluir E8_SALATUA');

console.log('financeiro-systemprompt-contract.test.js: ok (ia-owner)');
