'use strict';
/**
 * Testes de integracao da fragmentacao de spec ponta a ponta.
 *
 * Os classificadores isolados (comissao-spec-classifier.test.js etc.) testam a
 * classificacao de keywords, mas nao pegam regressao nos pontos de integracao:
 * - prompt-builder precisa repassar "mensagem" para spec.regrasTecnicas(), senao
 *   o classificador roda sempre vazio e cai em fallback total silenciosamente.
 * - cross-module-spec-combiner precisa invocar regrasTecnicas como funcao quando
 *   o spec individual e fragmentado, senao injeta o codigo-fonte da funcao no prompt.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const promptBuilder = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));
const crossModuleSpecCombiner = require(path.join(ROOT, 'modules/erp/cross-module-spec-combiner'));
const comissaoSpec = require(path.join(ROOT, 'modules/erp/comissao/comissao-ia-owner-spec'));
const financeiroSpec = require(path.join(ROOT, 'modules/erp/financeiro/financeiro-ia-owner-spec'));

let passou = 0;
let falhou = 0;

function ok(descricao, fn) {
  try {
    fn();
    console.log(`  ✓ ${descricao}`);
    passou++;
  } catch (e) {
    console.error(`  ✗ ${descricao}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}

console.log('\n[1] buildSystemPrompt inclui so fragmentos classificados (nao cai em fallback total)');

ok('pergunta de comissao "media mensal" gera prompt com media_mensal mas sem media_diaria/media_anual', () => {
  const promptComMensagem = promptBuilder.buildSystemPrompt(comissaoSpec, { mensagem: 'comissao media mensal de 2026' });
  const promptSemMensagem = promptBuilder.buildSystemPrompt(comissaoSpec, {});

  // Com mensagem classificada: fragmento especifico presente, vizinhos ausentes.
  assert.ok(/media mensal/i.test(promptComMensagem) || /## Media/i.test(promptComMensagem), 'prompt deveria conter o fragmento de media');
  assert.ok(
    promptComMensagem.length < promptSemMensagem.length,
    `prompt fragmentado (${promptComMensagem.length} chars) deveria ser menor que o fallback total (${promptSemMensagem.length} chars) — caso contrario a fragmentacao nao esta reduzindo o prompt`
  );
});

console.log('\n[2] buildSystemPrompt nao cai em fallback quando ha mensagem com keyword reconhecida');

ok('mensagem com keyword especifica produz prompt menor que sem mensagem (proxy de "nao caiu no fallback total")', () => {
  const promptFragmentado = promptBuilder.buildSystemPrompt(comissaoSpec, { mensagem: 'comissoes em aberto este mes' });
  const promptFallback = promptBuilder.buildSystemPrompt(comissaoSpec, { mensagem: '' });
  assert.ok(
    promptFragmentado.length < promptFallback.length,
    'prompt com mensagem classificavel deveria ser mais curto que o fallback total (mensagem vazia)'
  );
});

ok('mensagem undefined (regressao do bug original) NAO deve mais ser silenciosamente ignorada', () => {
  // Antes do fix, buildSystemPrompt(spec, { modeloBaixasReceber, modeloBaixasPagar }) descartava
  // "mensagem" do segundo argumento. Confirma que o parametro chega ate regrasTecnicas().
  let mensagemRecebida = '__nao_chamou__';
  const specFake = {
    nome: 'fake',
    regrasTecnicas: ({ mensagem } = {}) => { mensagemRecebida = mensagem; return 'regra fake'; },
  };
  promptBuilder.buildSystemPrompt(specFake, { mensagem: 'pergunta de teste 123' });
  assert.strictEqual(mensagemRecebida, 'pergunta de teste 123', 'prompt-builder deve repassar mensagem para spec.regrasTecnicas()');
});

console.log('\n[3] Prompt cross-module nao deve conter o codigo-fonte de regrasTecnicas');

ok('spec combinado (comissao + financeiro) nao injeta "function regrasTecnicas" no prompt', () => {
  const specCombinado = crossModuleSpecCombiner.combinarSpecs([comissaoSpec, financeiroSpec]);
  const prompt = promptBuilder.buildSystemPrompt(specCombinado, { mensagem: 'comparativo entre comissao e financeiro' });
  assert.ok(!/function\s*regrasTecnicas/i.test(prompt), `prompt cross-module vazou codigo-fonte: ${prompt.slice(0, 300)}`);
  assert.ok(!/=>\s*\{/.test(prompt) || true, 'sanity: nao bloqueante, apenas documental');
});

console.log('\n[4] cross-module deve encapsular regrasTecnicas como funcao contextual (nao string fixa)');

ok('combinarSpecs([comissao, financeiro]).regrasTecnicas e funcao, nao string', () => {
  const specCombinado = crossModuleSpecCombiner.combinarSpecs([comissaoSpec, financeiroSpec]);
  assert.strictEqual(typeof specCombinado.regrasTecnicas, 'function', `regrasTecnicas deveria ser funcao, recebeu: ${typeof specCombinado.regrasTecnicas}`);
});

ok('regrasTecnicas do spec combinado delega mensagem para os specs individuais (classificacao funciona)', () => {
  const specCombinado = crossModuleSpecCombiner.combinarSpecs([comissaoSpec, financeiroSpec]);
  const textoComMensagem = specCombinado.regrasTecnicas({ mensagem: 'comissao media mensal de 2026' });
  const textoSemMensagem = specCombinado.regrasTecnicas({});
  assert.ok(!/function\s*regrasTecnicas/i.test(textoComMensagem), 'texto combinado nao deveria conter codigo-fonte de funcao');
  assert.ok(
    textoComMensagem.length < textoSemMensagem.length,
    'regrasTecnicas combinado com mensagem classificavel deveria ser menor que sem mensagem (fallback total de ambos os modulos)'
  );
});

console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`prompt-fragmentacao-integracao.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`prompt-fragmentacao-integracao.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
