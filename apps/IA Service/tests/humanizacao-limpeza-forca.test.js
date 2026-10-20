'use strict';
// Limpeza determinística de conclusão genérica e força das afirmações no
// validador de preservação (estilo Objetiva). Sem rede: provider simulado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const aiProvider = require('../backend/services/ai-provider-client');
const aiConfig = require('../backend/services/ai-config-service');
const { analisarPreservacao, limparConclusaoGenerica, ehConclusaoGenerica, forcaAfirmacao } = require('../backend/services/validacao-preservacao-service');
const { humanizar } = require('../backend/services/resposta-humanizada-service');

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
  // Opção A: hipótese de causa apresentada como confirmada bloqueia.
  const confirmada = analisarPreservacao('A rejeição 1031 pode ser causada pelo cClassTrib 510002.', 'Foi confirmado que o cClassTrib 510002 provoca a rejeição 1031.');
  assert.equal(confirmada.aprovado, false);
  const aceitar = [
    ['A rejeição 1031 pode estar relacionada ao cClassTrib 510002.', 'A rejeição 1031 pode estar ligada ao cClassTrib 510002.'],
    ['A rejeição 1031 pode estar relacionada ao cClassTrib 510002.', 'É possível que a rejeição 1031 tenha relação com o cClassTrib 510002.'],
    ['Às vezes, um erro na passagem de parâmetros pode levar a resultados inesperados.', 'Às vezes, um erro na passagem de parâmetros pode causar resultados inesperados.'],
  ];
  for (const [original, candidata] of aceitar) assert.equal(analisarPreservacao(original, candidata).aprovado, true, candidata);
});

test('humanização: limpa a conclusão, revalida e só então entrega; senão volta à Técnica', async () => {
  // Sem trechos entre crases: a humanização os troca por marcadores protegidos
  // antes da IA, e o provider simulado devolve texto já pronto.
  const tecnica = tecnicaBase.replace(/`/g, ''), objetiva = objetivaBase.replace(/`/g, '');
  const anteriores = { chamarIA: aiProvider.chamarIA, resolver: aiConfig.resolverKeysEOrdem };
  aiConfig.resolverKeysEOrdem = () => ({ keys: {}, cfg: {} });
  let saida = '';
  aiProvider.chamarIA = async () => ({ texto: saida, provider: 'fixture', model: 'fixture', usage: { total_tokens: 1 } });
  try {
    saida = `${objetiva}\n\n${GENERICA}`;
    const limpa = await humanizar({ empresaId: 1, respostaOriginal: tecnica, estilo: 'NATURAL' });
    assert.equal(limpa.status, 'aplicada');
    assert.equal(limpa.respostaFinal, objetiva);
    assert.deepEqual(limpa.conclusaoGenericaRemovida, [GENERICA]);
    assert.equal(limpa.validacaoPreservacao.aprovado, true);
    assert.equal(limpa.respostaOriginal, tecnica, 'Técnica preservada para Detalhes Técnicos');

    const ressalva = 'Essas ações devem ajudar, mas não aplique em produção antes de validar em homologação.';
    const tecnicaComRessalva = `${tecnica}\n${ressalva}`;
    saida = `${objetiva}\n\n${ressalva}`;
    const mantida = await humanizar({ empresaId: 1, respostaOriginal: tecnicaComRessalva, estilo: 'NATURAL' });
    assert.equal(mantida.status, 'aplicada');
    assert.ok(mantida.respostaFinal.endsWith(ressalva), 'ressalva final não é removida');
    assert.equal(mantida.conclusaoGenericaRemovida, undefined);

    // Associação promovida a causalidade: aviso registrado, Objetiva entregue (gate mínimo).
    saida = `${objetiva.replace('pode estar ligada ao', 'pode ser causada pelo')}\n\n${GENERICA}`;
    const forte = await humanizar({ empresaId: 1, respostaOriginal: tecnica, estilo: 'NATURAL' });
    assert.equal(forte.status, 'aplicada');
    assert.ok(forte.validacaoPreservacao.avisos.some(f => f.codigo === 'FORCA_AFIRMACAO_ALTERADA'));

    // Referência técnica trocada: entrega a Técnica.
    saida = `${objetiva.replace('510002', '510003')}\n\n${GENERICA}`;
    const trocada = await humanizar({ empresaId: 1, respostaOriginal: tecnica, estilo: 'NATURAL' });
    assert.equal(trocada.status, 'fallback');
    assert.equal(trocada.motivo, 'preservacao_tecnica');
    assert.equal(trocada.respostaFinal, tecnica);
    assert.ok(trocada.validacaoPreservacao.falhas.some(f => f.codigo === 'REFERENCIA_TECNICA_NOVA' || f.codigo === 'REFERENCIA_TECNICA_REMOVIDA'));
  } finally {
    aiProvider.chamarIA = anteriores.chamarIA;
    aiConfig.resolverKeysEOrdem = anteriores.resolver;
  }
});
