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
assert(systemPrompt.includes('data_atual') && systemPrompt.includes('Voce calcula o periodo EXCLUSIVAMENTE'), 'prompt deve delegar inteligencia cronologica a IA');
assert(systemPrompt.includes('DIRETRIZ DE SELECAO DE TABELAS') && systemPrompt.includes('Consultas por QUANTIDADE ou filtros de Produto/Item'), 'prompt deve diferenciar consulta geral de item');
assert(systemPrompt.includes("Quantidade faturada: SUM(SD2.D2_QUANT), filtrando SD2.D2_CF NOT LIKE '59%' AND SD2.D2_CF NOT LIKE '60%'"), 'prompt deve definir quantidade faturada excluindo CF 59/60');
assert(systemPrompt.includes("Quantidade carregada: SUM(SD2.D2_QUANT), filtrando SD2.D2_CF <> '5117'"), 'prompt deve definir quantidade carregada excluindo nota mae 5117');
assert(systemPrompt.includes("Entrega futura, venda para entrega futura ou nota mae: SUM(SD2.D2_QUANT), filtrando SD2.D2_CF = '5117'"), 'prompt deve definir entrega futura/nota mae como CF 5117');
assert(systemPrompt.includes('Movimentacao total, todas as saidas, volume total, sem filtro fiscal ou incluindo remessa/transferencia'), 'prompt deve permitir movimentacao total sem filtro fiscal');

const handlerSrc = fs.readFileSync(path.join(ROOT, 'modules/erp/faturamento/ai-sql-handler-v2.js'), 'utf8');
assert(handlerSrc.includes("require('../ia-owner/runner')"), 'handler deve usar runner IA-OWNER');
assert(handlerSrc.includes("require('./faturamento-ia-owner-spec')"), 'handler deve usar spec IA-OWNER de faturamento');
assert(!handlerSrc.includes('contract'), 'handler nao deve depender do contrato legado');

const intentServiceSrc = fs.readFileSync(path.join(ROOT, 'modules/ai/intent-service.js'), 'utf8');
assert(intentServiceSrc.includes("'carregada'") && intentServiceSrc.includes("'entrega futura'"), 'classificador deve rotear quantidade carregada e entrega futura para faturamento');
assert(intentServiceSrc.includes("'nota mae'") && intentServiceSrc.includes("'sem filtro fiscal'"), 'classificador deve reconhecer nota mae e movimentacao sem filtro fiscal');

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
