'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aplicarAlteracoes, extrairAlteracoes } = require('../backend/services/alteracao-ancorada-service');

function aplicar(original, antes, depois, arquivo = 'Teste.tlpp') {
  return aplicarAlteracoes({ arquivo, buffer: Buffer.from(original), encoding: 'utf-8', alteracoes: [{ original: antes, substituto: depois }] });
}

test('ADVPL/TLPP: blocos aninhados, comentários e literais; fechamentos ausentes e cruzados são recusados', () => {
  const original = ['User Function Teste()', 'Local nI := 0', 'If .T.', 'For nI := 1 To 2', 'Do Case', 'Case nI == 1', 'While .F.', 'ConOut("If EndIf // Next")', 'EndDo', 'Otherwise', '/* EndIf', 'Next */', 'ConOut("ok")', 'EndCase', 'Next', 'EndIf', 'Return .T.'].join('\n');
  assert.equal(aplicar(original, 'ConOut("ok")', 'ConOut("novo")').ok, true);
  for (const token of ['EndDo', 'EndCase', 'Next\nEndIf', 'EndIf\nReturn']) {
    const r = aplicar(original, token, token.split('\n').slice(1).join('\n'));
    assert.equal(r.ok, false, token); assert.ok(r.falhas.some(f => f.codigo === 'ESTRUTURA_ADVPL_INVALIDA'));
  }
  const r = aplicar(original, 'EndCase\nNext', 'Next\nEndCase');
  assert.equal(r.ok, false); assert.equal(r.falhas[0].codigo, 'ESTRUTURA_ADVPL_INVALIDA');
});

test('SQL, TEXT, diretivas, continuação e defeitos preexistentes não causam falso bloqueio', () => {
  for (const corpo of [
    'BeginSql Alias cAlias\nIf Next EndIf\nEndSql',
    'BeginSql Alias cAlias\nSELECT \'/*\' AS literal\nEndSql',
    'TEXT\nIf Next EndIf\nENDTEXT',
    '* comentário com /* e aspas "\nIf .T.\nEndIf',
    '#ifdef TESTE\nIf .T.\n#else\nIf .F.\n#endif\nEndIf',
    'ConOut( ;\n"If")',
    'If .T. // defeito preexistente',
    'Begin Sequence\nConOut("ok")\nRecover\nEnd Sequence',
    'Try\nConOut("ok")\nCatch oError\nEndTry',
  ]) {
    const original = `User Function Teste()\n${corpo}\nReturn .T.`;
    const r = aplicar(original, 'Return .T.', 'Return .F.');
    assert.equal(r.ok, true, JSON.stringify(r));
  }
});

test('declarações múltiplas e FWRestArea são preservadas por rotina, não por contagem global', () => {
  const original = 'User Function A()\nLocal aArea := FWGetArea(), lOk := .T.\nFWRestArea(aArea)\nReturn lOk\nUser Function B()\nReturn .T.';
  for (const [antes, depois, codigo] of [
    ['Local aArea := FWGetArea(), lOk := .T.', 'Local aArea := FWGetArea()', 'DECLARACAO_REMOVIDA'],
    ['FWRestArea(aArea)\nReturn lOk\nUser Function B()', 'Return lOk\nUser Function B()\nFWRestArea(aArea)', 'RESTAURACAO_CONTEXTO_REMOVIDA'],
    ['User Function B()\nReturn .T.', '// removida', 'ROTINAS_ALTERADAS'],
  ]) {
    const r = aplicar(original, antes, depois); assert.equal(r.ok, false); assert.ok(r.falhas.some(f => f.codigo === codigo), JSON.stringify(r));
  }
});

test('outras linguagens continuam aceitas e CRLF recebido não é duplicado', () => {
  const original = 'class C {\r\n  int F() { return 1; }\r\n}\r\n';
  const r = aplicar(original, '  int F() { return 1; }\r\n}', '  int F() { return 2; }\r\n}', 'C.cs');
  assert.equal(r.ok, true); assert.equal(r.texto, original.replace('return 1', 'return 2'));
});

test('inclusão legítima de auxiliar e declaração com inicialização multilinha não são recusadas', () => {
  const original = 'User Function Teste()\nLocal cRet := Alltrim( ;\n    cValor), lOk := .T.\nReturn cRet';
  const r = aplicar(original, 'cValor), lOk := .T.', 'cOutroValor), lOk := .T.');
  assert.equal(r.ok, true, JSON.stringify(r));
  const helper = aplicar(original, 'Return cRet', 'Return cRet\nStatic Function Auxiliar()\nIf .T.\nReturn .T.\nEndIf');
  assert.equal(helper.ok, true, JSON.stringify(helper));
});

test('blocos incompletos e marcadores duplicados não desaparecem silenciosamente', () => {
  const bloco = '```iahub-alteracao\narquivo: A.prw\n[[ORIGINAL]]\nx\n[[SUBSTITUTO]]\ny\n[[FIM]]\n```';
  for (const texto of [bloco.slice(0, -3), bloco.replace('[[ORIGINAL]]', '[[ORIGINAL]]\n[[ORIGINAL]]'), `${bloco}\n\n${bloco.slice(0, -3)}`]) {
    assert.ok(extrairAlteracoes(texto).erros.some(e => e.codigo === 'BLOCO_MALFORMADO'));
  }
});
