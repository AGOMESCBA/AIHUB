'use strict';
// Regressao 2026-10-26 (producao): "favor resumir o texto acima" era tratado
// como fora_de_escopo e a IA recusava; "só resuma o seu retorno técnico" ia
// para a investigação completa e o resumo perdia orientações. Desde 2026-11-02
// o pedido é conversa (caminho único) e a última resposta da IA vai inteira.
// Sem rede e sem IA: o provider é simulado. Dados sintéticos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const aiProviderClient = require('../backend/services/ai-provider-client');
const investigacao = require('../backend/services/investigacao-service');

const RESPOSTA = [
  'Pelo que foi descrito, alguns títulos da Destino Agro não aparecem no borderô de pagamento.',
  '1. Verifique se a empresa está configurada como IAGRO (e não APROSOJA).',
  '2. Confira portador e centro de custo dos títulos.',
  '3. Revise filtros e parâmetros da rotina de borderô (FINA240).',
].join('\n');

const historico = [
  { id: 'm1', papel: 'user', conteudo: 'Chamado: títulos fora do borderô' },
  { id: 'm2', papel: 'assistant', conteudo: 'Primeira análise antiga.' },
  { id: 'm3', papel: 'user', conteudo: 'segue o print' },
  { id: 'm4', papel: 'assistant', conteudo: RESPOSTA },
];

test('a última resposta da IA é o "texto acima"', () => {
  assert.equal(investigacao._ultimaRespostaDaIA(historico).id, 'm4');
  assert.equal(investigacao._ultimaRespostaDaIA([{ papel: 'user', conteudo: 'oi' }]), null);
  assert.equal(investigacao._ultimaRespostaDaIA([{ papel: 'assistant', conteudo: '   ' }]), null);
  assert.equal(investigacao._ultimaRespostaDaIA(null), null);
});

test('conversa leva a última resposta INTEIRA e a instrução de não recusar nem perder orientações', () => {
  const conversa = investigacao._montarConversaCurta({ historico, texto: 'favor resumir o texto acima', codigoAtendimento: 'AI-1' });
  const ultimaIA = conversa.filter(m => m.role === 'assistant').at(-1);
  assert.equal(ultimaIA.content, RESPOSTA, 'resposta inteira, com as 3 orientações');
  assert.equal(conversa.at(-1).content, 'favor resumir o texto acima');
  const instrucao = investigacao.INSTRUCAO_CONVERSA;
  assert.match(instrucao, /"texto acima"/);
  assert.match(instrucao, /mantenha todas as orientações/);
  assert.match(instrucao, /nunca diga que não consegue/);
  assert.match(instrucao, /Não faça nova análise/);
});

test('classificador trata pedido sobre o texto acima como conversa e explica o contexto do chamado', async () => {
  const original = aiProviderClient.chamarIA;
  try {
    aiProviderClient.chamarIA = async () => ({ texto: '{"tipo":"conversa"}' });
    assert.equal(await investigacao._classificarTurnoConversa('favor resumir o texto acima', { keys: {}, cfg: {} }), 'conversa');
    aiProviderClient.chamarIA = async () => ({ texto: '{"tipo":"desconhecido"}' });
    assert.equal(await investigacao._classificarTurnoConversa('resume', { keys: {}, cfg: {} }), 'investigacao', 'falha aberta');
  } finally { aiProviderClient.chamarIA = original; }
  const prompt = investigacao.SYSTEM_PROMPT_CLASSIFICACAO_CONVERSA;
  assert.match(prompt, /"O texto acima".*ÚLTIMA RESPOSTA DA IA/s);
  assert.match(prompt, /favor resumir o texto acima/);
  assert.match(prompt, /só resuma o seu retorno técnico/);
  assert.match(prompt, /regra de negócio/);
});
