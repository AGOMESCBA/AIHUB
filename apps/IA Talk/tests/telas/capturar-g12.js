'use strict';

// G12 (Antigravity) — gera capturas da seção Regras do canal + API para integradores
// em apps/IA Talk/tests/telas/capturas/ (1440 e 390 px, claro e escuro).

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturar(browser, { url, arquivo, largura, altura, tema = 'light', seletorScroll = '#api' }) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    try {
      if (t === 'dark') localStorage.setItem('talk_tema', 'dark');
      else localStorage.removeItem('talk_tema');
    } catch (_) {}
  }, tema);

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector(seletorScroll);
  await page.evaluate((sel) => { document.querySelector(sel)?.scrollIntoView({ block: 'start' }); }, seletorScroll);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(DIR_CAPTURAS, arquivo), fullPage: false });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const sim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const url = `http://127.0.0.1:${addr.port}/app/ia-talk/guia.html`;
  const browser = await chromium.launch({ headless: true });

  try {
    await capturar(browser, { url, arquivo: 'g12-guia-api-1440-claro.png',    largura: 1440, altura: 900, tema: 'light', seletorScroll: '#api' });
    await capturar(browser, { url, arquivo: 'g12-guia-api-1440-escuro.png',   largura: 1440, altura: 900, tema: 'dark',  seletorScroll: '#api' });
    await capturar(browser, { url, arquivo: 'g12-guia-api-390-claro.png',     largura: 390,  altura: 844, tema: 'light', seletorScroll: '#api' });
    await capturar(browser, { url, arquivo: 'g12-guia-api-390-escuro.png',    largura: 390,  altura: 844, tema: 'dark',  seletorScroll: '#api' });
    await capturar(browser, { url, arquivo: 'g12-guia-erros-1440-claro.png',  largura: 1440, altura: 900, tema: 'light', seletorScroll: '#api-erros' });
    await capturar(browser, { url, arquivo: 'g12-guia-regras-1440-claro.png', largura: 1440, altura: 900, tema: 'light', seletorScroll: '#teste' });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g12-') && f.endsWith('.png')).sort();
    console.log(`Capturas G12 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
