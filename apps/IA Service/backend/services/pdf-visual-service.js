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
  // Marcadores e linhas fixas da extração ("Paginas: 1", "Observacao: imagens...")
  // não são conteúdo: sem descontá-las, um PDF só com print passava de 120
  // caracteres e não era enviado como imagem (achado real, #036912, 2026-11-02).
  const poucoTexto = texto
    .replace(/\[[^\]]+\]/g, '')
    .replace(/^\s*(Paginas|Páginas|Pages?)\s*:.*$/gim, '')
    .replace(/^\s*Observacao\s*:.*$/gim, '')
    .trim().length < 120;
  // "pdf" fica de fora da regex: casaria com a extensao de todo arquivo .pdf
  // e forcaria rasterizacao visual mesmo com texto extraido de sobra.
  const pedeVisual = /\b(print|screenshot|imagem|tela|visual|grafico|gr[aá]fico|diagrama|scan|escanead)\b/i.test(`${perguntaTexto} ${nomeOriginal}`);
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

// Navegador instalado no servidor. Como serviço do Windows, o Chrome baixado pelo
// puppeteer fica no perfil de outro usuário e não é achado (erro real em produção,
// 2026-11-02, #036912). Mesma ordem do WhatsApp do IA Command, com o Edge, que vem
// no Windows Server, como último recurso.
function _navegadoresInstalados() {
  const encontrados = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean).filter(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
  // Por último, o navegador próprio do puppeteer (quando instalado).
  return [...new Set(encontrados), null];
}

// Tenta cada navegador até um abrir: um caminho quebrado não derruba a análise.
async function _abrirNavegador(puppeteer) {
  const falhas = [];
  for (const executablePath of _navegadoresInstalados()) {
    try {
      return await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'], ...(executablePath ? { executablePath } : {}) });
    } catch (err) {
      falhas.push(`${executablePath || 'navegador do puppeteer'}: ${String(err.message).split('\n')[0]}`);
    }
  }
  throw new Error(`Nenhum navegador disponível para converter o PDF em imagem (${falhas.join('; ')}). Instale o Google Chrome no servidor ou informe CHROME_PATH no .env.`);
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
    browser = await _abrirNavegador(puppeteer);
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
