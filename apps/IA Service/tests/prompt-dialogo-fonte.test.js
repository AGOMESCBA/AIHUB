'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const prompt = require('../backend/services/prompt-builder');
test('print e log mantêm instruções de diálogo; código recebe as regras completas de alteração', () => {
  assert.equal(prompt.selecionarSystemPrompt([{ nomeOriginal: 'erro.jpeg' }, { nomeOriginal: 'error.log' }]), prompt.SYSTEM_PROMPT);
  for (const anexo of [{ nomeOriginal: 'ponto.PRW' }, { nomeOriginal: 'script.py' }, { eCodigo: true, nomeOriginal: 'fonte.txt' }]) {
    const system = prompt.selecionarSystemPrompt([anexo]);
    assert.ok(system.includes(prompt.INSTRUCOES_FONTE));
    assert.match(system, /\[FONTE INTEGRAL\]/);
    assert.match(system, /\[\[ORIGINAL\]\]/);
    assert.match(system, /\[ANALISE PARCIAL\]/);
    assert.match(system, /finaliza[çc][ãa]o/);
  }
  assert.match(prompt.SYSTEM_PROMPT, /senhas, tokens ou credenciais/);
  assert.match(prompt.SYSTEM_PROMPT, /CONTEÚDO DO CHAMADO/);
});
