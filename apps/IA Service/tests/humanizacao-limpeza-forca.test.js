'use strict';
// Limpeza determinística de conclusão genérica e força das afirmações no
// validador de preservação, usado pela limpeza técnica.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analisarPreservacao, limparConclusaoGenerica, ehConclusaoGenerica, forcaAfirmacao } = require('../backend/services/validacao-preservacao-service');

const GENERICA = 'Essas ações devem ajudar a esclarecer a situação e, quem sabe, resolver as rejeições das notas fiscais.';
const tecnicaBase = [
  'A rejeição 1031 persiste após os ajustes nas regras do IBS/CBS e a atualização de pacotes.',
  '',
  'O fornecedor sugere que a rejeição 1031 pode estar relacionada ao `cClassTrib` 510002.',
  '',
  'Próximos passos:',
  '1. Confira no SIGAFIS a Regra de Escrituração vinculada ao `cClassTrib` 510002.',
  '2. Continue aguardando o retorno do fornecedor.',
  '',
  'Essas ações devem ajudar a esclarecer a situação e, possivelmente, resolver as rejeições das notas fiscais.',
].join('\n');
const objetivaBase = [
  'A rejeição 1031 continua mesmo depois dos ajustes nas regras do IBS/CBS e da atualização de pacotes.',
  '',
  'Pelo fornecedor, a rejeição 1031 pode estar ligada ao `cClassTrib` 510002.',
  '',
  'Próximos passos:',
  '1. No SIGAFIS, confira a Regra de Escrituração vinculada ao `cClassTrib` 510002.',
  '2. Siga aguardando o retorno do fornecedor.',
].join('\n');

const tecnica = tecnicaBase, objetiva = objetivaBase;

test('remove somente a conclusão genérica final e preserva todo o restante', () => {
  for (const final of [GENERICA, 'Se precisar de mais alguma coisa, estou à disposição!']) {
    const r = limparConclusaoGenerica(`${objetiva}\n\n${final}`);
    assert.deepEqual(r.removidas, [final]);
    assert.equal(r.texto, objetiva, 'texto anterior intacto');
  }
  const duas = limparConclusaoGenerica(`${objetiva}\n\n${GENERICA} Fico à disposição.`);
  assert.equal(duas.removidas.length, 2);
  assert.equal(duas.texto, objetiva);
});

test('frase final aparentemente genérica com conteúdo relevante não é removida', () => {
  const relevantes = [
    'Essas ações devem ajudar, mas não aplique em produção antes de validar em homologação.',
    'Essas verificações devem ajudar a confirmar o `cClassTrib` 510002.',
    'Essas ações podem ajudar enquanto aguardamos o retorno da TOTVS.',
    'Essas medidas devem ajudar a reduzir o risco de perda de dados.',
    'Essas ações devem ajudar, desde que o pacote 12.1.2310 esteja aplicado.',
    'Fico à disposição para validar em homologação o fluxo da nota 4369.',
  ];
  for (const final of relevantes) {
    assert.equal(ehConclusaoGenerica(final), false, final);
    const r = limparConclusaoGenerica(`${objetiva}\n\n${final}`);
    assert.deepEqual(r.removidas, [], final);
    assert.equal(r.texto, `${objetiva}\n\n${final}`, final);
  }
  // Genérica no meio do texto nunca é removida; resposta só genérica não é esvaziada.
  const meio = `${GENERICA}\n\n${objetiva}`;
  assert.equal(limparConclusaoGenerica(meio).texto, meio);
  assert.equal(limparConclusaoGenerica(GENERICA).texto, GENERICA);
});

test('força: associação, hipótese, causalidade e certeza', () => {
  assert.equal(forcaAfirmacao('pode estar relacionada ao cClassTrib'), 1);
  assert.equal(forcaAfirmacao('pode ser causada pelo cClassTrib'), 2);
  assert.equal(forcaAfirmacao('pode levar a resultados inesperados'), 2);
  assert.equal(forcaAfirmacao('a causa foi confirmada no log'), 3);
  // Gate mínimo (2026-10-19): mudança de força é detectada e registrada como aviso, sem bloquear.
  const detectar = [
    ['A rejeição 1031 pode estar relacionada ao cClassTrib 510002.', 'A rejeição 1031 pode ser causada pelo cClassTrib 510002.'],
    ['A rejeição 1031 está relacionada ao cClassTrib 510002.', 'A rejeição 1031 é causada pelo cClassTrib 510002.'],
    ['O log 4369 confirmou o cClassTrib 510002 como origem da rejeição 1031.', 'O log 4369 sugere que o cClassTrib 510002 talvez provoque a rejeição 1031.'],
  ];
  for (const [original, candidata] of detectar) {
    const r = analisarPreservacao(original, candidata);
    assert.equal(r.aprovado, true, candidata);
    assert.ok(r.avisos.some(f => f.codigo === 'FORCA_AFIRMACAO_ALTERADA' || f.codigo === 'ESTADO_OU_CERTEZA_ALTERADO' || f.codigo === 'INCERTEZA_REMOVIDA'), candidata);
  }
  // Gate final: hipótese apresentada como confirmada é registrada como aviso.
  const confirmada = analisarPreservacao('A rejeição 1031 pode ser causada pelo cClassTrib 510002.', 'Foi confirmado que o cClassTrib 510002 provoca a rejeição 1031.');
  assert.equal(confirmada.aprovado, true);
  assert.ok(confirmada.avisos.length > 0);
  const aceitar = [
    ['A rejeição 1031 pode estar relacionada ao cClassTrib 510002.', 'A rejeição 1031 pode estar ligada ao cClassTrib 510002.'],
    ['A rejeição 1031 pode estar relacionada ao cClassTrib 510002.', 'É possível que a rejeição 1031 tenha relação com o cClassTrib 510002.'],
    ['Às vezes, um erro na passagem de parâmetros pode levar a resultados inesperados.', 'Às vezes, um erro na passagem de parâmetros pode causar resultados inesperados.'],
  ];
  for (const [original, candidata] of aceitar) assert.equal(analisarPreservacao(original, candidata).aprovado, true, candidata);
});
