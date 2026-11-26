'use strict';

// G11 (Antigravity) — gera as capturas em apps/IA Talk/tests/telas/capturas/:
//   - Canais › aba Conexão com bloco "Enviar mensagem de teste" (envio ok até Lida) em 1440 e 390 px, claro e escuro
//   - Canais › aba Conexão com envio em falha (motivo + link Ver na tela Mensagens) e envio desligado
//   - Mensagens com selo "Teste" e "Envio de teste" em 1440 e 390 px, claro e escuro
// Nenhum número completo, token ou segredo aparece nas capturas.

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
  await page.screenshot({ path: path.join(DIR_CAPTURAS, arquivo), fullPage: true });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const sim = criarServidorSimulado({ intervaloLogMs: 2500, intervaloQrMs: 25000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Canais › Conexão: envio ok até Lida em 1440 e 390 px, claro e escuro
    const matrizConexao = [
      { arquivo: 'g11-canais-envio-ok-1440-claro.png',  largura: 1440, altura: 900, tema: 'light' },
      { arquivo: 'g11-canais-envio-ok-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark' },
      { arquivo: 'g11-canais-envio-ok-390-claro.png',   largura: 390,  altura: 844, tema: 'light' },
      { arquivo: 'g11-canais-envio-ok-390-escuro.png',  largura: 390,  altura: 844, tema: 'dark' },
    ];
    for (const c of matrizConexao) {
      await capturar(browser, {
        url: `${base}/canais.html?id=cn_suporte`,
        arquivo: c.arquivo,
        largura: c.largura,
        altura: c.altura,
        tema: c.tema,
        acao: async (page) => {
          await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));
          await page.selectOption('#t-para', '0');
          await page.fill('#t-texto', 'Teste de envio G11 — conferindo entrega em tempo real.');
          await page.click('#btn-enviar-teste');
          await page.waitForFunction(() => document.getElementById('envio-teste-pill')?.textContent?.trim() === 'Lida', { timeout: 12000 });
          await page.locator('#bloco-envio-teste').scrollIntoViewIfNeeded();
        },
      });
    }

    // 2. Canais › Conexão: envio com falha (motivo + link Ver na tela Mensagens)
    await capturar(browser, {
      url: `${base}/canais.html?id=cn_suporte`,
      arquivo: 'g11-canais-envio-falha-1440-claro.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));
        await page.selectOption('#t-para', '1');
        await page.fill('#t-texto', 'Simular falha de entrega no teste.');
        await page.click('#btn-enviar-teste');
        await page.waitForFunction(() => document.getElementById('envio-teste-falha-texto')?.textContent?.includes('Número não encontrado'), { timeout: 10000 });
        await page.locator('#bloco-envio-teste').scrollIntoViewIfNeeded();
      },
    });

    // 3. Canais › Conexão: envio desligado (cn_financeiro)
    await capturar(browser, {
      url: `${base}/canais.html?id=cn_financeiro`,
      arquivo: 'g11-canais-envio-desligado-1440-claro.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('#vista-detalhe:not([hidden])');
        await page.waitForSelector('#envio-teste-motivo:not([hidden])');
        await page.locator('#bloco-envio-teste').scrollIntoViewIfNeeded();
      },
    });

    // 4. Tela Mensagens com selo "Teste" e "Envio de teste" em 1440 e 390 px, claro e escuro
    const matrizMensagens = [
      { arquivo: 'g11-mensagens-teste-1440-claro.png',  largura: 1440, altura: 900, tema: 'light' },
      { arquivo: 'g11-mensagens-teste-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark' },
      { arquivo: 'g11-mensagens-teste-390-claro.png',   largura: 390,  altura: 844, tema: 'light' },
      { arquivo: 'g11-mensagens-teste-390-escuro.png',  largura: 390,  altura: 844, tema: 'dark' },
    ];
    for (const m of matrizMensagens) {
      await capturar(browser, {
        url: `${base}/mensagens.html`,
        arquivo: m.arquivo,
        largura: m.largura,
        altura: m.altura,
        tema: m.tema,
        acao: async (page) => {
          await page.waitForSelector('.tabulator-row');
          await page.waitForTimeout(250);
        },
      });
    }

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g11-') && f.endsWith('.png')).sort();
    console.log(`Capturas G11 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
