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

// Texto real extraído do anexo do #036974: o erro (tipo NF x CC/CRT) só aparece nos prints.
const REMETE_PRINT = '[PDF extraido textualmente]\nPaginas: 1\nObservacao: imagens, prints, graficos e diagramas internos do PDF nao foram extraidos nesta etapa; o arquivo original permanece preservado.\n\nA venda cartão tem que ser assim, como na imagem abaixo. \n \n \n \nVendas cartão que estão errados, pois no tipo esta NF e era para esta como CC ou CD com CRT, como na imagem acima.';

test('PDF curto que remete à imagem vai como imagem mesmo sem pedir na pergunta', () => {
  assert.equal(detectarNecessidadeVisualPdf({ conteudoExtraido: REMETE_PRINT, pergunta: 'Analise o chamado', nomeOriginal: 'Venda cartão.pdf' }), true);
  assert.equal(detectarNecessidadeVisualPdf({ conteudoExtraido: REMETE_PRINT.replace(/como na imagem (abaixo|acima)/g, 'no sistema'), pergunta: 'Analise o chamado', nomeOriginal: 'Venda cartão.pdf' }), false);
});

test('PDF longo que cita imagem continua só como texto', () => {
  const longo = `[PDF extraido textualmente]\nPaginas: 12\nConforme imagem abaixo, configure o parametro. ${'Procedimento de configuracao do modulo financeiro passo a passo. '.repeat(30)}`;
  assert.equal(detectarNecessidadeVisualPdf({ conteudoExtraido: longo, pergunta: 'analise', nomeOriginal: 'manual.pdf' }), false);
});

test('PDF com texto de verdade continua só como texto', () => {
  const texto = `[PDF extraido textualmente]\nPaginas: 3\n${'Erro no pedido de compra ao gravar o fornecedor. '.repeat(10)}`;
  assert.equal(detectarNecessidadeVisualPdf({ conteudoExtraido: texto, pergunta: 'analise', nomeOriginal: 'log.pdf' }), false);
});

test('Word só com prints: extrai as imagens de word/media na ordem e ignora formatos que a IA não lê', async () => {
  const { extrairImagensDocx, imagensDoDocumentoVisual, ehDocx } = require('../backend/services/pdf-visual-service');
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document/>');
  zip.file('word/media/image10.png', Buffer.from('png-10'));
  zip.file('word/media/image2.jpeg', Buffer.from('jpeg-2'));
  zip.file('word/media/image3.emf', Buffer.from('emf'));
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const r = await extrairImagensDocx(buffer, [1, 2, 3, 4, 5, 6]);
  assert.equal(r.erro, null);
  assert.deepEqual(r.imagens.map(i => [i.pagina, i.mimeType, Buffer.from(i.base64, 'base64').toString()]), [[1, 'image/jpeg', 'jpeg-2'], [2, 'image/png', 'png-10']]);
  assert.equal(ehDocx({ nomeOriginal: 'Tela.DOCX' }), true);
  assert.equal((await imagensDoDocumentoVisual(buffer, { nomeOriginal: 'tela.docx' }, [1])).imagens.length, 1);
});
