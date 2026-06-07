'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const faturamentoSpec = require(path.join(ROOT, 'modules/erp/faturamento/faturamento-ia-owner-spec'));

const systemPrompt = promptBuilder.buildSystemPrompt(faturamentoSpec);
assert(systemPrompt.includes('Para cliente SEM LOJA ou todos os registros do mesmo codigo'), 'prompt deve preservar regra de cliente sem loja');
assert(systemPrompt.includes('faturamento_liquido'), 'prompt deve orientar regras de devolucao/liquido quando solicitado');
assert(systemPrompt.includes('Regras de Inteligencia Cronologica'), 'prompt deve delegar inteligencia cronologica a IA');
assert(systemPrompt.includes('Consultas por produto/grupo/quantidade/valor medio devem usar SD2 JOIN SF2'), 'prompt deve diferenciar consulta geral de item');

const handlerSrc = fs.readFileSync(path.join(ROOT, 'modules/erp/faturamento/ai-sql-handler-v2.js'), 'utf8');
assert(handlerSrc.includes("require('../ia-owner/runner')"), 'handler deve usar runner IA-OWNER');
assert(handlerSrc.includes("require('./faturamento-ia-owner-spec')"), 'handler deve usar spec IA-OWNER de faturamento');
assert(!handlerSrc.includes('contract'), 'handler nao deve depender do contrato legado');

const routerSrc = fs.readFileSync(path.join(ROOT, 'modules/erp/intent-router.js'), 'utf8');
assert(routerSrc.includes("'filial'"), 'router deve enviar filtro de filial ao pipeline dinamico');
assert(!routerSrc.includes('chat' + 'Resultado'), 'router deve ir direto ao motor dinamico nos modulos dinamicos');
assert(routerSrc.includes("_pipeline_origem = 'systemprompt'"), 'router deve marcar origem historica systemprompt no caminho dinamico');

const intentRouter = require(path.join(ROOT, 'modules/erp/intent-router'));
assert.strictEqual(
  intentRouter._extrairPossivelEntidadeDaPreposicao('Detalhe por mes da Caieira'),
  'Caieira',
  'helper deve recuperar nome textual em frase com preposicao'
);
assert.strictEqual(
  intentRouter._mensagemPedeFilialExplicitamente('Detalhe por mes da Caieira'),
  false,
  'da Caieira sem palavra filial/loja/unidade deve ser tratado como entidade de negocio'
);
assert.strictEqual(
  intentRouter._temFiltroEntidadeDinamica({ filtros: { filial: 'Caieira' } }),
  true,
  'filial textual suspeita deve ir ao pipeline para ser resolvida como entidade'
);
assert.strictEqual(
  intentRouter._temFiltroEntidadeDinamica({ filtros: { filial: '01' } }),
  false,
  'filial codigo continua sendo filtro operacional'
);

console.log('faturamento-sql-contrato.test.js: ok (ia-owner)');
