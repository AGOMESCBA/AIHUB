'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { avaliar, expandirBusca } = require('../backend/services/base-conhecimento-avaliacao-service');
const atual = { descricao: 'Erro específico A120 na rotina de compras.' };
const candidato = { chamado: { descricao: 'Erro específico A120 na rotina de compras.' }, posicionamentos: [] };
const resolverConfig = () => ({ keys: {}, cfg: {} });

test('aceita avaliação apenas com citações literais e a identifica como preliminar', async () => {
  const resultado = await avaliar(1, atual, [candidato], { resolverConfig, chamarIA: async () => ({ provider: 'teste', model: 'modelo-teste', texto: JSON.stringify({ avaliacoes: [{ indice: 0, relevancia: 'mesmo_problema', trechoAtual: 'Erro específico A120', trechoCandidato: 'Erro específico A120', justificativa: 'mesma mensagem' }] }) }) });
  assert.equal(resultado.estado, 'avaliacao_preliminar');
  assert.equal(resultado.candidatos[0].avaliacaoIa.natureza, 'avaliacao_preliminar_ia');
  assert.equal(resultado.provider, 'teste');
  assert.equal(resultado.model, 'modelo-teste');
  assert.deepEqual(resultado.candidatos[0].avaliacaoIa.origemCandidato, { tipo: 'chamado', campo: 'descricao' });
  assert.deepEqual(resultado.candidatos[0].avaliacaoIa.origemAtual, { tipo: 'chamado', campo: 'descricao' });
});

test('descarta citação inventada e preserva candidatos quando IA falha', async () => {
  const falso = await avaliar(1, atual, [candidato], { resolverConfig, chamarIA: async () => ({ texto: JSON.stringify({ avaliacoes: [{ indice: 0, relevancia: 'mesmo_problema', trechoAtual: 'Erro específico A120', trechoCandidato: 'texto que não existe', justificativa: 'suposta evidência' }] }) }) });
  assert.equal(falso.estado, 'avaliacao_indisponivel');
  assert.deepEqual(falso.candidatos, [candidato]);
  const falha = await avaliar(1, atual, [candidato], { resolverConfig, chamarIA: async () => { throw new Error('indisponível'); } });
  assert.deepEqual(falha.candidatos, [candidato]);
});

test('um resultado de solução inventado não é aceito como evidência', async () => {
  const r = await avaliar(1, atual, [candidato], { resolverConfig, chamarIA: async () => ({ texto: JSON.stringify({ avaliacoes: [{ indice: 0, relevancia: 'relacionado', trechoAtual: 'Erro específico A120', trechoCandidato: 'Erro específico A120', trechoProcedimento: 'Foi aplicado um patch inexistente', trechoResultado: 'O problema foi resolvido definitivamente' }] }) }) });
  assert.equal(r.candidatos[0].avaliacaoIa.trechoProcedimento, null);
  assert.equal(r.candidatos[0].avaliacaoIa.trechoResultado, null);
});

test('expansão recusa URLs e credenciais e mantém fallback se o provedor falhar', async () => {
  const r = await expandirBusca(1, atual, { resolverConfig, chamarIA: async () => ({ texto: JSON.stringify({ consultas: ['falha de rateio financeiro', 'https://exemplo.test/', 'senha: segredo-teste'] }) }) });
  assert.deepEqual(r.termos, ['falha de rateio financeiro']);
  const falha = await expandirBusca(1, atual, { resolverConfig, chamarIA: async () => { throw new Error('indisponível'); } });
  assert.deepEqual(falha.termos, []);
  assert.equal(falha.estado, 'indisponivel');
});

test('comparação preserva a ordem de provedores configurada para o cliente de IA', async () => {
  const cfg = { provedorPrimario: 'openai', fallbackOrdem: 'groq,gemini' };
  let recebido;
  await avaliar(1, atual, [candidato], { resolverConfig: () => ({ keys: {}, cfg }), chamarIA: async (_keys, configuracao) => { recebido = configuracao; throw new Error('falha simulada'); } });
  assert.equal(recebido.provedorPrimario, 'openai');
  assert.equal(recebido.fallbackOrdem, 'groq,gemini');
});
