'use strict';

// G1 (Antigravity) — gera as capturas obrigatórias do guia §7 em
// apps/IA Talk/tests/telas/capturas/ contra o servidor simulado:
//   - 1440 e 390 px, claro e escuro (4 imagens por tela)
//   - vazio, lento (carregando) e erro (403/500)
//   - tela modelo empresas.html para comparação lado a lado
// Nenhum número completo, token ou segredo aparece nas capturas.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturarPagina(browser, { url, arquivo, largura, altura, tema = 'light', simular = '', acao = null, esperarMs = 300 }) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  await page.addInitScript(({ t, s }) => {
    try {
      if (t === 'dark') localStorage.setItem('talk_tema', 'dark');
      else localStorage.removeItem('talk_tema');
      localStorage.removeItem('talk_login_telefone');
      if (s) sessionStorage.setItem('talk_simular', s);
      else sessionStorage.removeItem('talk_simular');
    } catch (_) {}
  }, { t: tema, s: simular });

  if (simular === 'lento') {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(350);
  } else {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(esperarMs);
  }

  if (acao) await acao(page);
  await page.screenshot({ path: path.join(DIR_CAPTURAS, arquivo), fullPage: true });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const sim = criarServidorSimulado({ intervaloLogMs: 60000, intervaloQrMs: 60000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  const browser = await chromium.launch({ headless: true });

  try {
    // Tela modelo oficial do IA Talk (empresas.html) para comparação lado a lado
    await capturarPagina(browser, { url: `${base}/empresas.html`, arquivo: 'modelo-empresas-1440-claro.png', largura: 1440, altura: 900, tema: 'light' });
    await capturarPagina(browser, { url: `${base}/empresas.html`, arquivo: 'modelo-empresas-390-claro.png', largura: 390, altura: 844, tema: 'light' });

    const telas = [
      { nome: 'entrar', url: `${base}/j2a`, urlVazio: `${base}/link-inexistente`, erroSimular: '500' },
      { nome: 'usuarios', url: `${base}/usuarios.html`, urlVazio: `${base}/usuarios.html`, erroSimular: '403' },
      { nome: 'aplicacoes', url: `${base}/aplicacoes.html`, urlVazio: `${base}/aplicacoes.html`, erroSimular: '403' },
      { nome: 'configuracoes', url: `${base}/configuracoes.html`, urlVazio: `${base}/configuracoes.html`, erroSimular: '500' },
    ];

    for (const t of telas) {
      await capturarPagina(browser, { url: t.url, arquivo: `g1-${t.nome}-1440-claro.png`, largura: 1440, altura: 900, tema: 'light' });
      await capturarPagina(browser, { url: t.url, arquivo: `g1-${t.nome}-1440-escuro.png`, largura: 1440, altura: 900, tema: 'dark' });
      await capturarPagina(browser, { url: t.url, arquivo: `g1-${t.nome}-390-claro.png`, largura: 390, altura: 844, tema: 'light' });
      await capturarPagina(browser, { url: t.url, arquivo: `g1-${t.nome}-390-escuro.png`, largura: 390, altura: 844, tema: 'dark' });
      await capturarPagina(browser, { url: t.urlVazio, arquivo: `g1-${t.nome}-vazio.png`, largura: 1440, altura: 900, tema: 'light', simular: t.nome === 'entrar' ? '' : 'vazio' });
      await capturarPagina(browser, { url: t.url, arquivo: `g1-${t.nome}-carregando.png`, largura: 1440, altura: 900, tema: 'light', simular: 'lento' });
      await capturarPagina(browser, { url: t.url, arquivo: `g1-${t.nome}-erro.png`, largura: 1440, altura: 900, tema: 'light', simular: t.erroSimular });
    }

    // Capturas extras de detalhe/abas (sempre sem dados sensíveis completos)
    await capturarPagina(browser, {
      url: `${base}/usuarios.html`, arquivo: 'g1-usuarios-detalhe-1440.png', largura: 1440, altura: 900, tema: 'light',
      acao: async (page) => { await page.click('.tabulator-row'); await page.waitForSelector('#vista-detalhe:not([hidden])'); },
    });
    await capturarPagina(browser, {
      url: `${base}/aplicacoes.html`, arquivo: 'g1-aplicacoes-detalhe-tokens-1440.png', largura: 1440, altura: 900, tema: 'light',
      acao: async (page) => { await page.click('.tabulator-row'); await page.waitForSelector('#vista-detalhe:not([hidden])'); await page.click('#aba-tokens'); await page.waitForTimeout(150); },
    });
    await capturarPagina(browser, {
      url: `${base}/configuracoes.html`, arquivo: 'g1-configuracoes-email-teste-1440.png', largura: 1440, altura: 900, tema: 'light',
      acao: async (page) => { await page.click('#aba-email'); await page.click('#btn-testar-email'); await page.waitForSelector('#lista-etapas-teste .tlk-etapa-item--ok'); },
    });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.endsWith('.png')).sort();
    console.log(`Capturas geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
