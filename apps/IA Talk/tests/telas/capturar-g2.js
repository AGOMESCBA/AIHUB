'use strict';

// G2 (Antigravity) — gera as capturas obrigatórias de frontend/canais.html em
// apps/IA Talk/tests/telas/capturas/ contra o servidor simulado:
//   - 1440 e 390 px, claro e escuro (4 imagens)
//   - vazio, lento (carregando) e erro (403)
//   - detalhes das 4 abas (Conexão/QR, Terminal ao vivo, Empresas, Capacidades) e Novo canal
// Nenhum número completo, token ou segredo aparece nas capturas.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturar(browser, { url, arquivo, largura, altura, tema = 'light', simular = '', acao = null, esperarMs = 350 }) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  await page.addInitScript(({ t, s }) => {
    try {
      if (t === 'dark') localStorage.setItem('talk_tema', 'dark');
      else localStorage.removeItem('talk_tema');
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
  const sim = criarServidorSimulado({ intervaloLogMs: 500, intervaloQrMs: 20000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  const browser = await chromium.launch({ headless: true });

  try {
    const url = `${base}/canais.html`;
    await capturar(browser, { url, arquivo: 'g2-canais-1440-claro.png', largura: 1440, altura: 900, tema: 'light' });
    await capturar(browser, { url, arquivo: 'g2-canais-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark' });
    await capturar(browser, { url, arquivo: 'g2-canais-390-claro.png', largura: 390, altura: 844, tema: 'light' });
    await capturar(browser, { url, arquivo: 'g2-canais-390-escuro.png', largura: 390, altura: 844, tema: 'dark' });
    await capturar(browser, { url, arquivo: 'g2-canais-vazio.png', largura: 1440, altura: 900, tema: 'light', simular: 'vazio' });
    await capturar(browser, { url, arquivo: 'g2-canais-carregando.png', largura: 1440, altura: 900, tema: 'light', simular: 'lento' });
    await capturar(browser, { url, arquivo: 'g2-canais-erro.png', largura: 1440, altura: 900, tema: 'light', simular: '403' });

    // Novo canal (WhatsApp Web ativo + Meta indisponível)
    await capturar(browser, {
      url, arquivo: 'g2-canais-novo-1440.png', largura: 1440, altura: 900, tema: 'light',
      acao: async (page) => { await page.click('#btn-novo'); await page.waitForSelector('#vista-novo:not([hidden])'); },
    });

    // Aba 1: Conexão + QR grande com contagem (canal cn_teste)
    await capturar(browser, {
      url: `${url}?id=cn_teste`, arquivo: 'g2-canais-detalhe-qr-1440.png', largura: 1440, altura: 900, tema: 'light',
      acao: async (page) => { await page.waitForSelector('#box-qr:not([hidden])'); await page.waitForTimeout(200); },
    });

    // Aba 2: Terminal ao vivo (canal cn_suporte com linhas coloridas)
    await capturar(browser, {
      url: `${url}?id=cn_suporte`, arquivo: 'g2-canais-detalhe-terminal-1440.png', largura: 1440, altura: 900, tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('#vista-detalhe:not([hidden])');
        await page.click('#aba-terminal');
        await page.waitForTimeout(1600);
      },
    });

    // Aba 3: Empresas que usam o número (com marca Canal padrão)
    await capturar(browser, {
      url: `${url}?id=cn_suporte`, arquivo: 'g2-canais-detalhe-empresas-1440.png', largura: 1440, altura: 900, tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('#vista-detalhe:not([hidden])');
        await page.click('#aba-empresas');
        await page.waitForTimeout(150);
      },
    });

    // Aba 4: Capacidades (somente leitura)
    await capturar(browser, {
      url: `${url}?id=cn_suporte`, arquivo: 'g2-canais-detalhe-capacidades-1440.png', largura: 1440, altura: 900, tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('#vista-detalhe:not([hidden])');
        await page.click('#aba-capacidades');
        await page.waitForTimeout(150);
      },
    });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g2-') && f.endsWith('.png')).sort();
    console.log(`Capturas G2 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
