'use strict';

// Capturas da nova experiência do Histórico de mensagens (frontend/mensagens.html):
//   - Aba Conversas (auditoria) com painel lateral aberto em 1440 e 390 px, claro e escuro
//   - Painel de agrupamento aberto e agrupado por Setor (1440 claro)
//   - Aba Envios e entregas com painel lateral aberto (1440 claro)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturar(browser, { url, arquivo, largura = 1440, altura = 900, tema = 'light', acao = null }) {
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
  await page.waitForTimeout(300);
  if (acao) await acao(page);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(DIR_CAPTURAS, arquivo), fullPage: false });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const sim = criarServidorSimulado({ intervaloLogMs: 60_000, intervaloQrMs: 60_000, intervaloConversaMs: 0 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  const browser = await chromium.launch({ headless: true });

  try {
    const abrirRicardo = async (page) => {
      await page.waitForSelector('#tabela-conversas .tabulator-row');
      await page.locator('#tabela-conversas .tabulator-row', { hasText: 'Ricardo Alves' }).first().click();
      await page.waitForSelector('#conv-fio:not([hidden])');
    };

    // 1. Matriz 1440 e 390 px, claro e escuro
    await capturar(browser, { url: `${base}/mensagens.html`, arquivo: 'hist-conversas-1440-claro.png', largura: 1440, altura: 900, tema: 'light', acao: abrirRicardo });
    await capturar(browser, { url: `${base}/mensagens.html`, arquivo: 'hist-conversas-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark', acao: abrirRicardo });
    await capturar(browser, {
      url: `${base}/mensagens.html`, arquivo: 'hist-conversas-390-claro.png', largura: 390, altura: 844, tema: 'light',
      acao: async (page) => { await page.waitForSelector('#tabela-conversas .tabulator-row'); },
    });
    await capturar(browser, { url: `${base}/mensagens.html`, arquivo: 'hist-conversas-390-escuro.png', largura: 390, altura: 844, tema: 'dark', acao: abrirRicardo });

    // 2. Painel de agrupamento aberto e agrupado por Setor
    await capturar(browser, {
      url: `${base}/mensagens.html`, arquivo: 'hist-conversas-agrupado-1440-claro.png', largura: 1440, altura: 900, tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('#tabela-conversas .tabulator-row');
        await page.click('#btn-conv-agrupar');
        await page.waitForSelector('#grupo-area-conv.aberta');
        await page.locator('#gp-chips-conv .ggp-chip-avail', { hasText: 'Setor' }).click();
        await page.waitForSelector('#tabela-conversas .tabulator-group');
      },
    });

    // 3. Aba Envios e entregas com painel lateral aberto
    await capturar(browser, {
      url: `${base}/mensagens.html?aba=envios`, arquivo: 'hist-envios-lateral-1440-claro.png', largura: 1440, altura: 900, tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('#tabela .tabulator-row');
        await page.locator('#tabela .tabulator-row').first().click();
        await page.waitForSelector('#corpo-detalhe:not([hidden])');
      },
    });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('hist-') && f.endsWith('.png')).sort();
    console.log(`Capturas Histórico geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
