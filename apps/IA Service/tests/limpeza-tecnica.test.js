'use strict';
// Limpeza conservadora da Técnica (sem IA): só a lista final que repete o
// corpo e o fecho genérico. Conteúdo técnico nunca sai. Casos sintéticos no
// padrão das respostas reais (#036566, #036668).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { limparTecnica } = require('../backend/services/limpeza-tecnica-service');
const { referencias } = require('../backend/services/validacao-preservacao-service');

const CORPO = [
  'Para resolver o problema de colaboradores não aparecendo na manutenção da DIRF:',
  '',
  '1. **Atualização de Binários**: atualize o AppServer e o SmartClient (AppServer a partir de 14/01/2019).',
  '',
  '2. **Configuração de Verbas**: confira a incidência de DIRF em Atualizações > Definições de cálculos > Verbas.',
  '',
  '3. **Ficha Financeira**: gere a ficha financeira para conferir as incidências.',
].join('\n');

function refsPreservadas(original, limpo) {
  const depois = referencias(limpo);
  for (const r of referencias(original)) assert.ok(depois.has(r), `referência técnica perdida: ${r}`);
}

test('lista final que só repete o corpo e fecho genérico saem; nenhuma referência técnica se perde', () => {
  const original = `${CORPO}\n\nPróximos Passos\n- Atualize os binários do AppServer e SmartClient.\n- Confira as verbas e gere a ficha financeira.\n\nSe precisar de mais detalhes sobre algum desses passos, estou à disposição para ajudar.`;
  const r = limparTecnica(original);
  assert.equal(r.texto, CORPO);
  assert.deepEqual(r.removidos.map(x => x.tipo).sort(), ['conclusao_generica', 'resumo_repetido']);
  refsPreservadas(original, r.texto);
});

test('item com informação nova mantém a lista inteira', () => {
  const original = `${CORPO}\n\nPróximos Passos\n- Atualize os binários do AppServer.\n- Execute a rotina GPEM550 para o ano-base 2025.`;
  const r = limparTecnica(original);
  assert.equal(r.texto, original);
  assert.deepEqual(r.removidos, []);
});

test('fecho com ressalva ou condição técnica não sai', () => {
  for (const final of ['Não aplique em produção antes de validar em homologação.', 'Essas ações devem ajudar, desde que o pacote 12.1.2310 esteja aplicado.']) {
    const original = `${CORPO}\n\n${final}`;
    assert.equal(limparTecnica(original).texto, original, final);
  }
});

test('lista no meio, seção seguida de parágrafo e resposta com código não são alteradas', () => {
  const meio = `Próximos Passos\n- Atualize os binários do AppServer.\n\n${CORPO}`;
  assert.equal(limparTecnica(meio).texto, meio);
  const comParagrafo = `${CORPO}\n\nPróximos Passos\n- Atualize os binários do AppServer.\nDepois disso, reprocesse a DIRF do ano-base.`;
  assert.equal(limparTecnica(comParagrafo).texto, comParagrafo);
  const codigo = `${CORPO}\n\n\`\`\`advpl\nReturn .T.\n\`\`\`\n\nEstou à disposição.`;
  assert.equal(limparTecnica(codigo).texto, codigo);
});

test('resposta só com fecho genérico nunca é esvaziada', () => {
  const original = 'Estou à disposição.';
  assert.equal(limparTecnica(original).texto, original);
});

test('perguntas de continuidade preservam a resposta original inteira', () => {
  const original = 'A rotina falhou ao carregar.\n\nSe precisar de mais informações, pode enviar a mensagem completa?';
  assert.equal(limparTecnica(original).texto, original);
  assert.deepEqual(limparTecnica(original).removidos, []);
});
