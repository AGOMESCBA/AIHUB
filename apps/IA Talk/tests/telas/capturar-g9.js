'use strict';

// G9 (Antigravity) — gera capturas de frontend/guia.html em 1440 e 390 px, claro e escuro.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturar(browser, { url, arquivo, largura, altura, tema }) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    try {
      if (t === 'dark') localStorage.setItem('talk_tema', 'dark');
      else localStorage.removeItem('talk_tema');
    } catch (_) {}
  }, tema);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(DIR_CAPTURAS, arquivo), fullPage: true });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const sim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const url = `http://127.0.0.1:${addr.port}/app/ia-talk/guia.html`;
  const browser = await chromium.launch({ headless: true });

  try {
    await capturar(browser, { url, arquivo: 'g9-guia-1440-claro.png',  largura: 1440, altura: 900, tema: 'light' });
    await capturar(browser, { url, arquivo: 'g9-guia-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark' });
    await capturar(browser, { url, arquivo: 'g9-guia-390-claro.png',   largura: 390,  altura: 844, tema: 'light' });
    await capturar(browser, { url, arquivo: 'g9-guia-390-escuro.png',  largura: 390,  altura: 844, tema: 'dark' });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g9-') && f.endsWith('.png')).sort();
    console.log(`Capturas G9 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
