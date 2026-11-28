'use strict';

// G13 (Antigravity) — gera capturas da Central de Atendimento real (frontend/atendimento.html)
// em apps/IA Talk/tests/telas/capturas/ (1440, 1024 e 390 px, claro e escuro + visão Carla + envio bloqueado).

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
  await page.waitForSelector('#chat-ativo:not([hidden])');
  await page.waitForTimeout(300);
  if (acao) await acao(page);
  await page.screenshot({ path: path.join(DIR_CAPTURAS, arquivo), fullPage: false });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const sim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000, intervaloConversaMs: 0 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  const browser = await chromium.launch({ headless: true });

  try {
    // 1. 1440 claro e escuro (cards numéricos no topo + lista + conversa ampla + contato)
    await capturar(browser, { url: `${base}/atendimento.html?conversa=cv_ex04`, arquivo: 'g13-atendimento-1440-claro.png', largura: 1440, altura: 900, tema: 'light' });
    await capturar(browser, { url: `${base}/atendimento.html?conversa=cv_ex04`, arquivo: 'g13-atendimento-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark' });

    // 1b. 1440 modo foco: cards retráteis recolhidos + contato recolhido pela setinha mágica (claro e escuro)
    await capturar(browser, {
      url: `${base}/atendimento.html?conversa=cv_ex04`,
      arquivo: 'g13-atendimento-1440-recolhido-claro.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.click('#btn-toggle-resumo');
        await page.click('#btn-seta-lateral');
        await page.waitForTimeout(260);
      },
    });
    await capturar(browser, {
      url: `${base}/atendimento.html?conversa=cv_ex04`,
      arquivo: 'g13-atendimento-1440-recolhido-escuro.png',
      largura: 1440,
      altura: 900,
      tema: 'dark',
      acao: async (page) => {
        await page.click('#btn-toggle-resumo');
        await page.click('#btn-seta-lateral');
        await page.click('#btn-seta-lista');
        await page.waitForTimeout(260);
      },
    });

    // 2. 1024 px (gaveta fechada e gaveta aberta sem cobrir a conversa)
    await capturar(browser, { url: `${base}/atendimento.html?conversa=cv_ex01`, arquivo: 'g13-atendimento-1024-claro.png', largura: 1024, altura: 768, tema: 'light' });
    await capturar(browser, {
      url: `${base}/atendimento.html?conversa=cv_ex01`,
      arquivo: 'g13-atendimento-1024-gaveta.png',
      largura: 1024,
      altura: 768,
      tema: 'light',
      acao: async (page) => { await page.click('#btn-gaveta'); await page.waitForTimeout(250); },
    });

    // 3. 390 px mobile (claro e escuro)
    await capturar(browser, { url: `${base}/atendimento.html?conversa=cv_ex01`, arquivo: 'g13-atendimento-390-claro.png', largura: 390, altura: 844, tema: 'light' });
    await capturar(browser, { url: `${base}/atendimento.html?conversa=cv_ex01`, arquivo: 'g13-atendimento-390-escuro.png', largura: 390, altura: 844, tema: 'dark' });

    // 4. Visão da atendente Carla (?simular=atendente) com menu "/" aberto
    await capturar(browser, {
      url: `${base}/atendimento.html?simular=atendente&conversa=cv_ex02`,
      arquivo: 'g13-atendimento-carla-1440.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.fill('#campo-msg', '/');
        await page.waitForSelector('#slash-menu:not([hidden])');
      },
    });

    // 5. Envio bloqueado (envio.pode_responder = false com motivo explicado)
    await capturar(browser, {
      url: `${base}/atendimento.html?conversa=cv_ex03`,
      arquivo: 'g13-atendimento-bloqueado-1440.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => { await page.waitForSelector('#banner-envio:not([hidden])'); },
    });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g13-') && f.endsWith('.png')).sort();
    console.log(`Capturas G13 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
