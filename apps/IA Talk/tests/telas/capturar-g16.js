'use strict';

// G16 (Antigravity) — gera capturas 1440 e 390 px (claro e escuro) do editor de setor
// com as 5 seções Onda 1 (frontend/setores.html) e do menu de setores nas regras do canal
// (frontend/canais.html) em apps/IA Talk/tests/telas/capturas/.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturar(browser, { url, arquivo, largura = 1440, altura = 900, tema = 'light', esperar, acao = null, fullPage = true }) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    try {
      if (t === 'dark') localStorage.setItem('talk_tema', 'dark');
      else localStorage.removeItem('talk_tema');
      sessionStorage.removeItem('talk_simular');
    } catch (_) {}
  }, tema);

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector(esperar);
  if (acao) await acao(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(DIR_CAPTURAS, arquivo), fullPage });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const sim = criarServidorSimulado({ intervaloLogMs: 60_000, intervaloQrMs: 60_000, intervaloConversaMs: 0 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Editor do setor Suporte (já nasce com Rodízio e Alertas ligados) — 1440 e 390, claro e escuro
    const abrirSuporte = async (page) => {
      await page.click('[data-editar-setor="set_suporte"]');
      await page.waitForSelector('#vista-setor:not([hidden])');
    };
    await capturar(browser, { url: `${base}/setores.html`, arquivo: 'g16-setor-1440-claro.png', largura: 1440, altura: 900, tema: 'light', esperar: '#lista-setores .g14-card', acao: abrirSuporte });
    await capturar(browser, { url: `${base}/setores.html`, arquivo: 'g16-setor-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark', esperar: '#lista-setores .g14-card', acao: abrirSuporte });
    await capturar(browser, { url: `${base}/setores.html`, arquivo: 'g16-setor-390-claro.png', largura: 390, altura: 844, tema: 'light', esperar: '#lista-setores .g14-card', acao: abrirSuporte });
    await capturar(browser, { url: `${base}/setores.html`, arquivo: 'g16-setor-390-escuro.png', largura: 390, altura: 844, tema: 'dark', esperar: '#lista-setores .g14-card', acao: abrirSuporte });

    // 2. Menu de setores nas regras do canal (cn_suporte) — 1440 e 390, claro e escuro
    const focarMenuCanal = async (page) => {
      await page.check('#r-menu-ligado');
    };
    await capturar(browser, { url: `${base}/canais.html?id=cn_suporte`, arquivo: 'g16-canal-menu-1440-claro.png', largura: 1440, altura: 900, tema: 'light', esperar: '#bloco-menu-canal:not([hidden])', acao: focarMenuCanal });
    await capturar(browser, { url: `${base}/canais.html?id=cn_suporte`, arquivo: 'g16-canal-menu-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark', esperar: '#bloco-menu-canal:not([hidden])', acao: focarMenuCanal });
    await capturar(browser, { url: `${base}/canais.html?id=cn_suporte`, arquivo: 'g16-canal-menu-390-claro.png', largura: 390, altura: 844, tema: 'light', esperar: '#bloco-menu-canal:not([hidden])', acao: focarMenuCanal });
    await capturar(browser, { url: `${base}/canais.html?id=cn_suporte`, arquivo: 'g16-canal-menu-390-escuro.png', largura: 390, altura: 844, tema: 'dark', esperar: '#bloco-menu-canal:not([hidden])', acao: focarMenuCanal });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g16-') && f.endsWith('.png')).sort();
    console.log(`Capturas G16 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
