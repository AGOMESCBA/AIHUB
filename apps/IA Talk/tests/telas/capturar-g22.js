'use strict';

// G22 (Antigravity) — gera capturas 1440 e 390 px (claro e escuro) das telas honestas:
//   - setores.html: selos "Ainda não ativo" nos recursos false e "Escalonar para" via GET /atendentes;
//   - portal.html: status, sino e alertas WhatsApp desabilitados com selo "Ainda não ativo";
//   - mensagens.html: período de/ate no servidor e botão "Exportando…" no download do CSV.

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
    // 1. Setores (editor com selos "Ainda não ativo" e Escalonar para) — 1440/390 claro e escuro
    const abrirSuporteSecoes = async (page) => {
      await page.click('[data-editar-setor="set_suporte"]');
      await page.waitForSelector('#vista-setor:not([hidden])');
      await page.locator('#secao-distribuicao').scrollIntoViewIfNeeded();
    };
    await capturar(browser, { url: `${base}/setores.html`, arquivo: 'g22-setor-1440-claro.png', largura: 1440, altura: 900, tema: 'light', esperar: '#lista-setores .g14-card', acao: abrirSuporteSecoes });
    await capturar(browser, { url: `${base}/setores.html`, arquivo: 'g22-setor-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark', esperar: '#lista-setores .g14-card', acao: abrirSuporteSecoes });
    await capturar(browser, { url: `${base}/setores.html`, arquivo: 'g22-setor-390-claro.png', largura: 390, altura: 844, tema: 'light', esperar: '#lista-setores .g14-card', acao: abrirSuporteSecoes });
    await capturar(browser, { url: `${base}/setores.html`, arquivo: 'g22-setor-390-escuro.png', largura: 390, altura: 844, tema: 'dark', esperar: '#lista-setores .g14-card', acao: abrirSuporteSecoes });

    // 2. Portal do atendente com controles desabilitados e selos "Ainda não ativo" — 1440/390 claro e escuro
    const abrirMenuMobile = async (page) => {
      await page.click('#btn-menu-portal');
      await page.waitForSelector('#ptl-extras.aberto');
    };
    await capturar(browser, { url: `${base}/j2a/atendimento`, arquivo: 'g22-portal-1440-claro.png', largura: 1440, altura: 900, tema: 'light', esperar: '#lista-conversas .atd-conv-item', fullPage: false });
    await capturar(browser, { url: `${base}/j2a/atendimento`, arquivo: 'g22-portal-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark', esperar: '#lista-conversas .atd-conv-item', fullPage: false });
    await capturar(browser, { url: `${base}/j2a/atendimento`, arquivo: 'g22-portal-390-claro.png', largura: 390, altura: 844, tema: 'light', esperar: '#lista-conversas .atd-conv-item', acao: abrirMenuMobile, fullPage: false });
    await capturar(browser, { url: `${base}/j2a/atendimento`, arquivo: 'g22-portal-390-escuro.png', largura: 390, altura: 844, tema: 'dark', esperar: '#lista-conversas .atd-conv-item', acao: abrirMenuMobile, fullPage: false });

    // 3. Histórico de mensagens: período no servidor + estado "Exportando…"
    const filtrarPeriodoConv = async (page) => {
      await page.click('#btn-conv-mais-filtros');
      await page.waitForSelector('#filtros-conv-extra:not([hidden])');
      await page.fill('#fc-de', '2026-11-15');
      await page.fill('#fc-ate', '2026-11-23');
      await page.waitForFunction(() => document.getElementById('qtd-aba-conversas')?.textContent?.trim() === '3');
    };
    await capturar(browser, { url: `${base}/mensagens.html`, arquivo: 'g22-mensagens-periodo-1440-claro.png', largura: 1440, altura: 900, tema: 'light', esperar: '#tabela-conversas .tabulator-row', acao: filtrarPeriodoConv, fullPage: false });

    // Captura de "Exportando…" na aba Envios e entregas com filtro de canal
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(`${base}/mensagens.html?aba=envios&canal_id=cn_financeiro`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#tabela .tabulator-row');
      let liberar;
      let avisarChegou;
      const chegou = new Promise((r) => { avisarChegou = r; });
      const segurar = new Promise((r) => { liberar = r; });
      await page.route('**/api/admin/mensagens/exportar*', async (route) => {
        avisarChegou();
        await segurar;
        await route.continue();
      });
      const promDownload = page.waitForEvent('download');
      await page.click('#btn-exportar');
      await chegou;
      await page.screenshot({ path: path.join(DIR_CAPTURAS, 'g22-mensagens-exportando-1440-claro.png'), fullPage: false });
      liberar();
      await promDownload;
      await ctx.close();
    }

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g22-') && f.endsWith('.png')).sort();
    console.log(`Capturas G22 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
