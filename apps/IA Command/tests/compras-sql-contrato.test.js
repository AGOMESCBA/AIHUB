'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const spec = require(path.join(ROOT, 'modules/erp/compras/compras-ia-owner-spec'));

const sysPrompt = promptBuilder.buildSystemPrompt(spec);
assert(sysPrompt.includes('IA-OWNER do modulo compras'), 'compras deve usar IA-OWNER');
assert(sysPrompt.includes('Voce decide se a pergunta atual e uma nova consulta'), 'IA deve decidir heranca/continuidade');
assert(sysPrompt.includes('Se o usuario disser "ano" sem ano explicito, use o ano atual completo'), 'ano sem ano explicito deve ser ano atual');
assert(/devolu(?:cao|coes)|devolu[cç](?:ao|oes)/i.test(sysPrompt), 'prompt deve enviar regras de devolucao quando o usuario pedir');
assert(sysPrompt.includes('Regras de Validacao de Tabelas Fisicas'), 'compras deve receber regras SX2 multi-tenant');
assert(sysPrompt.includes('Regras de Inteligencia Cronologica'), 'compras deve receber regras cronologicas');
assert(sysPrompt.includes('Sempre retorne nome/descricao para o usuario'), 'compras deve retornar nome/descricao de entidades');
assert(sysPrompt.includes('SD1.D1_DTDIGIT'), 'compras deve documentar data padrao de entrada');
assert(sysPrompt.includes('SC7.C7_EMISSAO'), 'compras deve documentar data padrao de pedidos');
assert(typeof spec.resolverEntidades === 'function', 'compras IA-OWNER deve expor resolver tecnico de entidades');

console.log('compras-sql-contrato.test.js: ok (ia-owner)');
