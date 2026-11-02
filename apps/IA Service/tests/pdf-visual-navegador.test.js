// node --test "apps/IA Service/tests/pdf-visual-navegador.test.js"
// Conversão de PDF em imagem: um caminho de navegador quebrado não pode
// impedir a análise; tenta o próximo navegador instalado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PDF_MINIMO = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const navegadores = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((p) => fs.existsSync(p));

test('CHROME_PATH quebrado: usa o próximo navegador e gera a imagem', { skip: !navegadores.length && 'sem navegador nesta máquina' }, async () => {
  const anterior = process.env.CHROME_PATH;
  process.env.CHROME_PATH = 'C:\\nao\\existe\\chrome.exe';
  try {
    const { rasterizarPdfPaginas } = require('../backend/services/pdf-visual-service');
    const r = await rasterizarPdfPaginas(PDF_MINIMO, [1]);
    assert.equal(r.erro, null);
    assert.equal(r.imagens.length, 1);
    assert.equal(r.imagens[0].mimeType, 'image/png');
  } finally {
    if (anterior === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = anterior;
  }
});
