'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const spec = require(path.join(ROOT, 'modules/erp/compras/compras-ia-owner-spec'));

const sysPrompt = promptBuilder.buildSystemPrompt(spec);
assert(sysPrompt.includes('IA-OWNER do modulo compras'), 'compras deve usar IA-OWNER');
assert(sysPrompt.includes('Voce e dono da decisao semantica'), 'IA deve decidir heranca/continuidade');
assert(sysPrompt.includes('data_atual') && sysPrompt.includes('Voce calcula o periodo EXCLUSIVAMENTE'), 'periodos relativos devem ser calculados pela IA a partir de data_atual e contexto');
assert(/devolu(?:cao|coes)|devolu[cç](?:ao|oes)/i.test(sysPrompt), 'prompt deve enviar regras de devolucao quando o usuario pedir');
assert(sysPrompt.includes('Regras de Validacao de Tabelas Fisicas'), 'compras deve receber regras SX2 multi-tenant');
assert(sysPrompt.includes('Formato de Data Protheus') && sysPrompt.includes('data_atual'), 'compras deve receber regras cronologicas');
assert(sysPrompt.includes('SA2.A2_NOME AS fornecedor'), 'compras deve retornar descricao de fornecedor');
assert(sysPrompt.includes('SB1.B1_DESC AS produto'), 'compras deve retornar descricao de produto');
assert(sysPrompt.includes('Se uma entidade estiver no GROUP BY'), 'compras deve retornar descricao de entidades agrupadas');
assert(sysPrompt.includes('SD1.D1_DTDIGIT'), 'compras deve documentar data padrao de entrada');
assert(sysPrompt.includes('SC7.C7_EMISSAO'), 'compras deve documentar data padrao de pedidos');
assert(typeof spec.resolverEntidades === 'function', 'compras IA-OWNER deve expor resolver tecnico de entidades');

console.log('compras-sql-contrato.test.js: ok (ia-owner)');
