'use strict';
// Regressao 2026-10-26 (producao): "favor resumir o texto acima" era tratado
// como fora_de_escopo e a IA recusava; "só resuma o seu retorno técnico" ia
// para a investigação completa e o resumo perdia orientações. Pedido sobre a
// última resposta vira "reformulacao" e é aplicado sobre ela.
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

test('prompt leva a última resposta INTEIRA, o pedido e a instrução de não recusar nem perder orientações', () => {
  const p = investigacao._montarPromptReformulacao(historico, 'favor resumir o texto acima');
  assert.ok(p.includes(RESPOSTA), 'resposta inteira, com as 3 orientações');
  assert.ok(!p.includes('Primeira análise antiga'), 'só a última resposta');
  assert.match(p, /Pedido atual do analista\nfavor resumir o texto acima/);
  assert.match(p, /mantenha TODAS as orientações/);
  assert.match(p, /nunca diga que não consegue/);
  assert.match(p, /não faça nova análise/);
  assert.equal(investigacao._montarPromptReformulacao([{ papel: 'user', conteudo: 'x' }], 'resume'), null, 'sem resposta anterior segue o fluxo normal');
});

test('classificador aceita "reformulacao" e o prompt dele explica o contexto do chamado', async () => {
  const original = aiProviderClient.chamarIA;
  try {
    for (const tipo of ['reformulacao', 'pergunta_processo', 'fora_de_escopo', 'investigacao']) {
      aiProviderClient.chamarIA = async () => ({ texto: JSON.stringify({ tipo }) });
      assert.equal(await investigacao._classificarTurno('favor resumir o texto acima', { keys: {}, cfg: {} }), tipo);
    }
    aiProviderClient.chamarIA = async () => ({ texto: '{"tipo":"desconhecido"}' });
    assert.equal(await investigacao._classificarTurno('resume', { keys: {}, cfg: {} }), 'investigacao', 'falha aberta');
  } finally { aiProviderClient.chamarIA = original; }
  const prompt = investigacao.SYSTEM_PROMPT_CLASSIFICACAO_TURNO;
  assert.match(prompt, /"O texto acima".*ÚLTIMA RESPOSTA DA IA/s);
  assert.match(prompt, /favor resumir o texto acima/);
  assert.match(prompt, /só resuma o seu retorno técnico/);
  assert.match(prompt, /Pedido sobre o texto da conversa NUNCA é "fora_de_escopo"/);
});
