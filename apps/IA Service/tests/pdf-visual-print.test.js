// node --test "apps/IA Service/tests/pdf-visual-print.test.js"
// PDF que é só um print (#036912): as linhas fixas da extração não contam como
// texto, e o PDF vai para a IA como imagem.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectarNecessidadeVisualPdf } = require('../backend/services/pdf-visual-service');

const SO_PRINT = '[PDF extraido textualmente]\nPaginas: 1\nObservacao: imagens, prints, graficos e diagramas internos do PDF nao foram extraidos nesta etapa; o arquivo original permanece preservado.';

test('PDF só com print vai como imagem mesmo sem pedir na pergunta', () => {
  assert.equal(detectarNecessidadeVisualPdf({ conteudoExtraido: SO_PRINT, pergunta: 'Revise todo o historico e pesquise uma solucao.', nomeOriginal: 'Doc1.pdf' }), true);
});

test('PDF com texto de verdade continua só como texto', () => {
  const texto = `[PDF extraido textualmente]\nPaginas: 3\n${'Erro no pedido de compra ao gravar o fornecedor. '.repeat(10)}`;
  assert.equal(detectarNecessidadeVisualPdf({ conteudoExtraido: texto, pergunta: 'analise', nomeOriginal: 'log.pdf' }), false);
});
