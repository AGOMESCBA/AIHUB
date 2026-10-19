'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/fontes-advpl-sinteticas');
const { avaliarEvidencias } = require('../backend/services/evidencia-comportamento-fonte-service');
const { extrairAlteracoes, aplicarAlteracoes } = require('../backend/services/alteracao-ancorada-service');
const { avaliarResposta, temFalhaDeIntegridade } = require('../backend/services/quality-gate-service');

function args(c) { return { arquivo: fixture.arquivo, textoOriginal: fixture.fonteOriginal, pedido: c.pedido, diagnostico: c.resposta, alteracoes: extrairAlteracoes(c.resposta).alteracoes }; }

test('premissa falsa sintética rejeitada pelo fluxo do fonte, antes da âncora; QG registra bloqueio objetivo', () => {
  const c = fixture.cenarios[0], a = args(c);
  const prova = avaliarEvidencias(a);
  assert.equal(prova.status, 'contradicao'); assert.equal(prova.origem, 'evidencia_local');
  assert.match(prova.evidencia, /If !Empty\(cUser\)/); assert.match(prova.demonstracao, /não alcança MsSeek/);
  assert.equal(aplicarAlteracoes({ arquivo: a.arquivo, buffer: Buffer.from(a.textoOriginal), encoding: 'utf-8', alteracoes: a.alteracoes }).falhas[0].codigo, 'ANCORA_AUSENTE', 'falha técnica continua distinta da semântica');
  const gate = avaliarResposta({ textoResposta: c.resposta, pergunta: c.pedido, fontesOriginais: [{ arquivo: a.arquivo, textoOriginal: a.textoOriginal }] });
  const falha = gate.falhas.find(f => f.codigo === 'SOURCE_BEHAVIOR_CONTRADICTION');
  assert.ok(falha); assert.equal(falha.decisionKind, 'bloqueio_objetivo'); assert.equal(gate.aprovado, false); assert.equal(temFalhaDeIntegridade(gate), true);
});

test('alteração sintética necessária comprovada; parecer causal incorreto simulado não participa da decisão', async () => {
  const c = fixture.cenarios[1], a = args(c);
  assert.equal(JSON.parse(c.verificador).status, 'contradicao', 'parecer incorreto construído para regressão');
  const prova = avaliarEvidencias(a);
  assert.equal(prova.status, 'consistente'); assert.equal(prova.origem, 'evidencia_local');
  assert.match(prova.demonstracao, /Antes.*\.T\.; agora.*\.F\./);
  const provider = require('../backend/services/ai-provider-client'); const chamar = provider.chamarIA;
  provider.chamarIA = async () => { assert.fail('prova local não pode depender de novo palpite da IA'); };
  try {
    assert.equal((await require('../backend/services/verificacao-consistencia-fonte-service').verificar(a)).status, 'consistente');
  } finally { provider.chamarIA = chamar; }
  const gate = avaliarResposta({ textoResposta: c.resposta, pergunta: c.pedido, fontesOriginais: [{ arquivo: a.arquivo, textoOriginal: a.textoOriginal }] });
  assert.ok(!gate.falhas.some(f => f.codigo === 'SOURCE_BEHAVIOR_CONTRADICTION'));
});

test('provas usam nomes do fonte e funcionam com outras funções, variáveis e chamadas ADVPL/TLPP', () => {
  for (const [antes, depois] of [[fixture.rotina, 'OutraRotina'], ['cUser', 'cChave'], ['lRet', 'lAceito'], ['MsSeek', 'DbSeek']]) {
    const c = fixture.cenarios[0];
    const a = args(c);
    for (const k of ['textoOriginal', 'pedido', 'diagnostico']) a[k] = a[k].replaceAll(antes, depois);
    a.alteracoes = a.alteracoes.map(alt => ({ ...alt, original: alt.original.replaceAll(antes, depois), substituto: alt.substituto.replaceAll(antes, depois) }));
    a.arquivo = 'OutroArquivo.tlpp';
    assert.equal(avaliarEvidencias(a)?.status, 'contradicao', `${antes} -> ${depois}`);
  }
});

test('âncora ausente e ambígua não são promovidas a prova de consistência', () => {
  const a = args(fixture.cenarios[1]);
  const ausente = { ...a, alteracoes: a.alteracoes.map(x => ({ ...x, original: 'bloco inexistente' })) };
  assert.equal(avaliarEvidencias(ausente), null);
  const ambigua = { ...a, textoOriginal: a.textoOriginal + '\n' + a.alteracoes[0].original };
  assert.equal(avaliarEvidencias(ambigua), null);
  for (const [entrada, codigo] of [[ausente, 'ANCORA_AUSENTE'], [ambigua, 'ANCORA_DUPLICADA']]) {
    const r = aplicarAlteracoes({ arquivo: entrada.arquivo, buffer: Buffer.from(entrada.textoOriginal), encoding: 'utf-8', alteracoes: entrada.alteracoes });
    assert.equal(r.ok, false); assert.equal(r.falhas[0].codigo, codigo);
  }
});

test('chamada fora da guarda, reatribuição e pré-processador não permitem prova causal falsa', () => {
  const a = args(fixture.cenarios[0]);
  const corpo = 'User Function Rotina()\nLocal cUser := M->CAMPO\nIf !Empty(cUser)\nMsSeek(cUser)\nEndIf\nReturn .T.';
  for (const texto of [corpo.replace('Return .T.', 'MsSeek(cUser)\nReturn .T.'), corpo.replace('MsSeek(cUser)', 'cUser := ""\nMsSeek(cUser)'), corpo.replace('MsSeek(cUser)', '++cUser\nMsSeek(cUser)'), corpo.replace('Local cUser', 'Private cUser'), `#ifdef TESTE\n${corpo}\n#endif`]) {
    const proposta = { ...a, textoOriginal: texto, alteracoes: [{ original: texto, substituto: texto + '\n' }], diagnostico: 'MsSeek executa mesmo com cUser vazio.' };
    assert.equal(avaliarEvidencias(proposta), null);
  }
});

test('pedido para valor não vazio não é confundido com nova regra para vazio', () => {
  const a = args(fixture.cenarios[1]);
  assert.equal(avaliarEvidencias({ ...a, pedido: 'Quando cUser não estiver vazio, a função deve retornar .F.' }), null);
  const renomeada = JSON.parse(JSON.stringify(a).replaceAll('cUser', 'cReferencia').replaceAll('lRet', 'lValido').replaceAll(fixture.rotina, 'OutraFuncao'));
  assert.equal(avaliarEvidencias(renomeada)?.status, 'consistente');
});

test('correção que altera outros caminhos ou contexto não recebe prova positiva local', () => {
  const a = args(fixture.cenarios[1]);
  for (const mudar of [s => s.replace('FWRestArea(aArea)', ''), s => s.replace('Local lRet  := .T.', 'Local lRet  := .F.'), s => s.replace('MsSeek(cUser)', 'MsSeek("outro")'), s => s.replace('nao encontrado em CAD_TESTE.', 'mensagem alterada')]) {
    const original = a.textoOriginal;
    const antesDaMutacao = original.replace(a.alteracoes[0].original, () => a.alteracoes[0].substituto);
    const candidata = mudar(antesDaMutacao);
    assert.notEqual(candidata, antesDaMutacao, 'a mutação negativa precisa alterar efetivamente a proposta válida');
    const p = { ...a, alteracoes: [{ original, substituto: candidata }] };
    assert.equal(avaliarEvidencias(p), null);
  }
});

test('arquivos de mesmo nome não permitem atribuir prova semântica a um alvo ambíguo', () => {
  const a = args(fixture.cenarios[0]);
  const gate = avaliarResposta({ textoResposta: a.diagnostico, pergunta: a.pedido, fontesOriginais: [{ arquivo: a.arquivo, textoOriginal: a.textoOriginal }, { arquivo: a.arquivo, textoOriginal: 'User Function Outro()\nReturn .T.' }] });
  assert.ok(!gate.falhas.some(f => f.codigo === 'SOURCE_BEHAVIOR_CONTRADICTION'));
});

test('diagnóstico explicativo sem patch também é conferido; outras linguagens não recebem prova ADVPL', () => {
  const a = args(fixture.cenarios[0]);
  const semPatch = { ...a, diagnostico: a.diagnostico.replace(/```[\s\S]*?```/g, ''), alteracoes: [] };
  assert.equal(avaliarEvidencias(semPatch)?.status, 'contradicao');
  assert.equal(avaliarEvidencias({ ...a, arquivo: 'Calculo.cs' }), null);
  const correta = { ...a, diagnostico: 'A proteção já existe; MsSeek não executa com cUser vazio.', alteracoes: [] };
  assert.equal(avaliarEvidencias(correta), null);
  for (const diagnostico of ['O analista alega que MsSeek executa mesmo com cUser vazio. Isso está incorreto.', 'A premissa de que MsSeek executa mesmo com cUser vazio é falsa.', 'A verificação de permissões não é feita antes do MsSeek, embora cUser vazio esteja protegido.']) {
    assert.equal(avaliarEvidencias({ ...a, diagnostico }), null, diagnostico);
  }
});
