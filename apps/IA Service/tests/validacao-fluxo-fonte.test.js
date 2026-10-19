'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarFluxoFonte } = require('../backend/services/validacao-fluxo-fonte-service');
const fixture = require('./fixtures/fontes-advpl-sinteticas');
const { aplicarAlteracoes, extrairAlteracoes } = require('../backend/services/alteracao-ancorada-service');
const original = ['User Function OutraRotina(cValor, lSair)', 'Local aContexto := FWGetArea()', 'Local lValido := .T.', 'If !Empty(cValor)', '    ConOut(cValor)', 'EndIf', 'FWRestArea(aContexto)', 'Return lValido'].join('\n');
const validar = (antes, depois, operacoesObrigatorias = []) => validarFluxoFonte({ arquivo: 'Outro.tlpp', original: antes, corrigido: depois, operacoesObrigatorias });

test('retorno que pula FWRestArea tem caminho concreto e operação desviada', () => {
  const corrigido = original.replace('If !Empty(cValor)', 'If Empty(cValor)\nReturn .F.\nEndIf\nIf !Empty(cValor)');
  const r = validar(original, corrigido);
  assert.equal(r.estado, 'reprovado'); assert.equal(r.codigo, 'FINALIZACAO_DESVIADA');
  assert.match(r.evidencias[0].operacao, /fwrestarea\(acontexto\)/);
  assert.ok(Object.keys(r.evidencias[0].condicoes).some(k => k.startsWith('empty(cvalor)')));
});

test('atribuição do resultado no ramo vazio preserva epílogo', () => {
  const depois = original.replace('EndIf\nFWRestArea', 'Else\nlValido := .F.\nEndIf\nFWRestArea');
  assert.equal(validar(original, depois).estado, 'aprovado');
});

test('retorno antecipado legítimo executa finalização antes de sair, inclusive em outro ramo', () => {
  const depois = original.replace('If !Empty(cValor)', 'If Empty(cValor)\nFWRestArea(aContexto)\nReturn .F.\nEndIf\nIf !Empty(cValor)');
  assert.equal(validar(original, depois).estado, 'aprovado');
  const outroRamo = original.replace('If !Empty(cValor)', 'If lSair\nFWRestArea(aContexto)\nReturn .F.\nElse\nConOut("continuar")\nEndIf\nIf !Empty(cValor)');
  assert.equal(validar(original, outroRamo).estado, 'aprovado');
});

test('Return em condicionais aninhadas mantém o escopo e não ignora a combinação afetada', () => {
  const depois = original.replace('If !Empty(cValor)', 'If lSair\nIf Empty(cValor)\nReturn .F.\nEndIf\nEndIf\nIf !Empty(cValor)');
  const r = validar(original, depois);
  assert.equal(r.estado, 'reprovado'); assert.ok(Object.keys(r.evidencias[0].condicoes).some(k => k.startsWith('lsair')));
  assert.equal(validar(original, depois.replace('Return .F.', 'FWRestArea(aContexto)\nReturn .F.')).estado, 'aprovado');
});

test('finalização customizada do epílogo e método de objeto são preservados por caminho', () => {
  for (const operacao of ['LiberarContexto(oCtx)', 'oCtx:Close()', 'FClose(nHandle)', 'TMP->(DbCloseArea())']) {
    const antes = `User Function Exemplo(lSair)\nConOut("trabalho")\n${operacao}\nReturn .T.`;
    const depois = antes.replace('ConOut("trabalho")', 'If lSair\nReturn .F.\nEndIf\nConOut("trabalho")');
    assert.equal(validar(antes, depois, [operacao]).estado, 'reprovado', operacao);
    assert.equal(validar(antes, depois.replace('Return .F.', `${operacao}\nReturn .F.`)).estado, 'aprovado', operacao);
  }
});

test('epílogo customizado sem contrato não vira contradição inventada', () => {
  const antes = 'User Function Caso(lSair)\nOperacaoCustomizada(oCtx)\nReturn .T.';
  const depois = antes.replace('OperacaoCustomizada(oCtx)', 'If lSair\nReturn .F.\nEndIf\nOperacaoCustomizada(oCtx)');
  const r = validar(antes, depois);
  assert.equal(r.estado, 'inconclusivo'); assert.match(r.motivos[0], /contrato/);
});

test('Exit em For limitado desvia finalização da iteração; saída limpa é legítima', () => {
  const antes = 'User Function Iteracao(lSair)\nLocal nI := 0\nFor nI := 1 To 1\nConOut(nI)\nFClose(nHandle)\nNext\nReturn .T.';
  const depois = antes.replace('ConOut(nI)', 'If lSair\nExit\nEndIf\nConOut(nI)');
  assert.equal(validar(antes, depois).estado, 'reprovado');
  assert.equal(validar(antes, depois.replace('Exit', 'FClose(nHandle)\nExit')).estado, 'aprovado');
});

test('Break/Sequence, macros, laços não limitados e predicado externo ficam inconclusivos, não reprovados', () => {
  for (const prefixo of ['Begin Sequence\nIf lSair\nBreak\nEndIf\nEnd Sequence', '#ifdef HOMOLOG\nReturn .F.\n#endif', 'While lSair\nExit\nEndDo', 'If &cCondicao\nReturn .F.\nEndIf', 'If AutorizaSaida()\nReturn .F.\nEndIf']) {
    const r = validar(original, original.replace('If !Empty(cValor)', prefixo + '\nIf !Empty(cValor)'));
    assert.equal(r.estado, 'inconclusivo', JSON.stringify(r)); assert.equal(r.codigo, 'FLUXO_NAO_COMPROVADO');
  }
});

test('retorno comprovadamente inalcançável não é rejeitado; retorno preexistente sem limpeza não cria obrigação nova', () => {
  const depois = original.replace('If !Empty(cValor)', 'If .F.\nReturn .F.\nEndIf\nIf !Empty(cValor)');
  assert.equal(validar(original, depois).estado, 'aprovado');
  const antes = original.replace('Local aContexto := FWGetArea()', 'If Empty(cValor)\nReturn .T.\nEndIf\nLocal aContexto := FWGetArea()');
  assert.equal(validar(antes, antes.replace('Return .T.', 'Return .F.')).estado, 'aprovado');
});

test('mudança do vínculo de recurso não é aprovada por contagem de chamadas', () => {
  const r = validar(original, original.replace('FWRestArea(aContexto)', 'aContexto := {}\nFWRestArea(aContexto)'));
  assert.equal(r.estado, 'inconclusivo');
});

test('condição derivada de expressão não resolvida não sustenta reprovação comprovada', () => {
  const depois = original.replace('If !Empty(cValor)', 'Local lPossivel := .F. .And. OutraCondicao()\nIf lPossivel\nReturn .F.\nEndIf\nIf !Empty(cValor)');
  assert.equal(validar(original, depois).estado, 'inconclusivo');
  const constante = original.replace('If !Empty(cValor)', 'Local lPossivel := .F.\nIf lPossivel\nReturn .F.\nEndIf\nIf !Empty(cValor)');
  assert.equal(validar(original, constante).estado, 'aprovado');
});

test('casos sintéticos distinguem âncora ausente, correção válida e finalização desviada', () => {
  const a = extrairAlteracoes(fixture.cenarios[0].resposta);
  assert.equal(aplicarAlteracoes({ arquivo: fixture.arquivo, buffer: Buffer.from(fixture.fonteOriginal), encoding: 'utf-8', alteracoes: a.alteracoes }).falhas[0].codigo, 'ANCORA_AUSENTE');
  const b = aplicarAlteracoes({ arquivo: fixture.arquivo, buffer: Buffer.from(fixture.fonteOriginal), encoding: 'utf-8', alteracoes: extrairAlteracoes(fixture.cenarios[1].resposta).alteracoes });
  assert.equal(b.ok, true); assert.equal(validar(fixture.fonteOriginal, b.texto).estado, 'aprovado');
  const insegura = aplicarAlteracoes({ arquivo: fixture.arquivo, buffer: Buffer.from(fixture.fonteOriginal), encoding: 'utf-8', alteracoes: extrairAlteracoes(fixture.saidaAntecipada.resposta).alteracoes });
  assert.equal(insegura.ok, true, 'estrutura e âncora válidas não comprovam segurança do fluxo');
  assert.equal(validar(fixture.fonteOriginal, insegura.texto).codigo, 'FINALIZACAO_DESVIADA');
});
