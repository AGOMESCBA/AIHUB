'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const LIMITES = {
  maxPaginas: Number(process.env.IA_SERVICE_PDF_VISUAL_MAX_PAGES || 3),
  viewportWidth: Number(process.env.IA_SERVICE_PDF_VISUAL_WIDTH || 1100),
  viewportHeight: Number(process.env.IA_SERVICE_PDF_VISUAL_HEIGHT || 1500),
  timeoutMs: Number(process.env.IA_SERVICE_PDF_VISUAL_TIMEOUT_MS || 20000),
};

function detectarNecessidadeVisualPdf({ conteudoExtraido, pergunta = '', nomeOriginal = '' } = {}) {
  const texto = String(conteudoExtraido || '');
  const perguntaTexto = String(pergunta || '');
  const poucoTexto = texto.replace(/\[[^\]]+\]/g, '').trim().length < 120;
  const pedeVisual = /\b(print|screenshot|imagem|tela|visual|grafico|gr[aá]fico|diagrama|scan|escanead|pdf)\b/i.test(`${perguntaTexto} ${nomeOriginal}`);
  const extracaoFalhou = /\[PDF detectado\]|nao foi possivel extrair texto|parser principal nao conseguiu/i.test(texto);
  return poucoTexto || pedeVisual || extracaoFalhou;
}

function selecionarPaginasPdf({ conteudoExtraido, pergunta = '', maxPaginas = LIMITES.maxPaginas } = {}) {
  const texto = String(conteudoExtraido || '');
  const paginas = [];
  const pageMatches = [...texto.matchAll(/\b(?:Pagina|Page)\s*[:#-]?\s*(\d{1,4})\b/gi)].map(m => Number(m[1])).filter(Boolean);
  for (const p of pageMatches) if (!paginas.includes(p)) paginas.push(p);
  const perguntaPaginas = [...String(pergunta || '').matchAll(/\b(?:pagina|p[aá]gina|page)\s*(\d{1,4})\b/gi)].map(m => Number(m[1])).filter(Boolean);
  for (const p of perguntaPaginas.reverse()) {
    const idx = paginas.indexOf(p);
    if (idx >= 0) paginas.splice(idx, 1);
    paginas.unshift(p);
  }
  if (!paginas.length) paginas.push(1);
  return paginas.filter(p => p > 0).slice(0, maxPaginas);
}

async function rasterizarPdfPaginas(buffer, paginas = [1], opts = {}) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (err) {
    return { imagens: [], erro: `Puppeteer indisponivel: ${err.message}` };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-service-pdf-visual-'));
  const pdfPath = path.join(dir, 'documento.pdf');
  fs.writeFileSync(pdfPath, buffer);
  const imagens = [];
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(opts.timeoutMs || LIMITES.timeoutMs);
    await page.setViewport({ width: opts.viewportWidth || LIMITES.viewportWidth, height: opts.viewportHeight || LIMITES.viewportHeight, deviceScaleFactor: 1 });
    for (const numero of paginas.slice(0, opts.maxPaginas || LIMITES.maxPaginas)) {
      const url = `file:///${pdfPath.replace(/\\/g, '/')}#page=${numero}`;
      await page.goto(url, { waitUntil: 'networkidle0', timeout: opts.timeoutMs || LIMITES.timeoutMs });
      const bufferPng = await page.screenshot({ type: 'png', fullPage: false });
      imagens.push({
        pagina: numero,
        mimeType: 'image/png',
        base64: bufferPng.toString('base64'),
        bytes: bufferPng.length,
        origem: 'pdf_rasterizado',
      });
    }
    return { imagens, erro: null };
  } catch (err) {
    return { imagens, erro: err.message };
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
    try { fs.unlinkSync(pdfPath); fs.rmdirSync(dir); } catch (_) {}
  }
}

module.exports = {
  LIMITES,
  detectarNecessidadeVisualPdf,
  selecionarPaginasPdf,
  rasterizarPdfPaginas,
};
