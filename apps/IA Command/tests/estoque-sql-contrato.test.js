'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const spec = require(path.join(ROOT, 'modules/erp/totvs_protheus/estoque/estoque-ia-owner-spec'));
const presentation = require(path.join(ROOT, 'modules/erp/core/presentation-contract'));

const sysPrompt = promptBuilder.buildSystemPrompt(spec);
assert(sysPrompt.includes('IA-OWNER do modulo estoque'), 'estoque deve usar IA-OWNER');
assert(sysPrompt.includes('data_atual') && sysPrompt.includes('Voce calcula o periodo EXCLUSIVAMENTE'), 'periodos relativos devem ser calculados pela IA a partir de data_atual e contexto');
assert(sysPrompt.includes('Regras de Validacao de Tabelas Fisicas'), 'estoque deve receber regras SX2 multi-tenant');
assert(sysPrompt.includes('Formato de Data Protheus') && sysPrompt.includes('data_atual'), 'estoque deve receber regras cronologicas');
assert(sysPrompt.includes('SB1.B1_DESC AS produto'), 'estoque deve retornar descricao de produto');
assert(sysPrompt.includes('SBM.BM_DESC AS grupo_produto'), 'estoque deve retornar descricao de grupo de produto');
assert(sysPrompt.includes('SB2.B2_QATU'), 'estoque deve documentar campo de saldo atual');
assert(sysPrompt.includes('SB2.B2_VATU1'), 'estoque deve documentar saldo financeiro moeda 1');
assert(sysPrompt.includes('saldo_fisico') && sysPrompt.includes('saldo_financeiro'), 'estoque deve orientar metricas separadas para fisico e financeiro');
assert(sysPrompt.includes('SD3.D3_QUANT'), 'estoque deve documentar quantidade movimentada');
assert(typeof spec.resolverEntidades === 'function', 'estoque IA-OWNER deve expor resolver tecnico de entidades');
assert.strictEqual(presentation.metricType('saldo_fisico'), 'quantity', 'saldo_fisico deve ser quantidade na apresentacao');
assert.strictEqual(presentation.metricType('saldo_financeiro'), 'money', 'saldo_financeiro deve ser moeda na apresentacao');

console.log('estoque-sql-contrato.test.js: ok (ia-owner)');
