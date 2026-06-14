'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const whatsappFormatPrompt = require(path.join(ROOT, 'modules/erp/whatsapp-format-prompt'));
const responseFormatter = require(path.join(ROOT, 'modules/erp/response-formatter'));
const chatFormatter = require(path.join(ROOT, 'modules/ai/chat/whatsapp-formatter'));

const systemPrompt = whatsappFormatPrompt.buildFormatSystemPrompt();
assert(!systemPrompt.includes('N un'), 'prompt de WhatsApp nao deve instruir quantidade como N un');
assert(!systemPrompt.includes('75 un'), 'prompt de WhatsApp nao deve exemplificar quantidade com un');
assert(!systemPrompt.includes('2.500 un'), 'prompt de WhatsApp nao deve exemplificar total de quantidade com un');
assert(systemPrompt.includes('quantidade / quant / qtd') && systemPrompt.includes('sem unidade/sufixo'), 'prompt deve instruir quantidade sem unidade/sufixo');

const rowsQuantidadeComUnidade = [
  { competencia: '202606', produto: 'PRODUTO A', quantidade_faturada: 1127.23, unidade: 'H' },
  { competencia: '202606', produto: 'PRODUTO B', quantidade_faturada: 850, unidade: 'KG' },
];

const respostaDireta = whatsappFormatPrompt.buildFormatCompetenciaEntidade(rowsQuantidadeComUnidade, { nomeModulo: 'Faturamento' });
assert(respostaDireta, 'formatter direto deve gerar resposta para competencia + produto + quantidade');
assert(respostaDireta.includes('1.127') || respostaDireta.includes('1127'), 'resposta deve conter o numero da quantidade');
assert(!/\b(?:un|UN|H|KG)\b/.test(respostaDireta), `resposta de quantidade nao deve conter unidade: ${respostaDireta}`);

const respostaLocal = responseFormatter.formatar({
  tipo: 'sucesso',
  rows: [{ quantidade: 2500 }],
}, {
  intencao: 'consultar_quantidade',
  periodo: { tipo: 'hoje' },
});
assert(respostaLocal.includes('2.500'), 'formatter local deve manter o numero da quantidade');
assert(!/unidades?\b/i.test(respostaLocal), `formatter local nao deve exibir unidade: ${respostaLocal}`);

const respostaFallbackChat = chatFormatter._formatarFallback([
  { produto: 'PRODUTO A', quantidade_faturada: 1200, valor_total: 84000 },
  { produto: 'PRODUTO B', quantidade_faturada: 850, valor_total: 46750 },
], 'Quantidade faturada por produto');
assert(respostaFallbackChat.includes('quantidade_faturada: 1200'), 'fallback de chat deve exibir quantidade como numero puro na linha');
assert(respostaFallbackChat.includes('*quantidade_faturada: 2.050*'), 'fallback de chat deve totalizar quantidade como numero puro');
assert(!/quantidade_faturada:[^|\n]*\b(?:un|unidade|unidades)\b/i.test(respostaFallbackChat), `fallback de chat nao deve exibir unidade: ${respostaFallbackChat}`);
assert(!/quantidade_faturada:[^|\n]*R\$/i.test(respostaFallbackChat), `fallback de chat nao deve formatar quantidade como moeda: ${respostaFallbackChat}`);

console.log('whatsapp-quantidade-sem-unidade.test.js: ok');
