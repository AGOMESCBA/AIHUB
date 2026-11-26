'use strict';

// G3 (Antigravity) — gera as capturas obrigatórias de:
//   - frontend/painel.html
//   - frontend/mensagens.html
//   - frontend/eventos.html
//   - frontend/auditoria.html
// em apps/IA Talk/tests/telas/capturas/ contra o servidor simulado:
//   - 1440 e 390 px, claro e escuro (4 por tela)
//   - vazio, carregando (lento) e erro (403/500) por tela
//   - detalhes com linha do tempo (mensagens, eventos) e registro somente leitura (auditoria)
// Nenhum número completo, token ou segredo aparece nas capturas.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturar(browser, { url, arquivo, largura, altura, tema = 'light', simular = '', acao = null, esperarMs = 400 }) {
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
  const sim = criarServidorSimulado({ intervaloLogMs: 2000, intervaloQrMs: 30000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  const browser = await chromium.launch({ headless: true });

  try {
    const telas = [
      { nome: 'painel',    url: `${base}/painel.html`,    erro: '403' },
      { nome: 'mensagens', url: `${base}/mensagens.html`, erro: '500' },
      { nome: 'eventos',   url: `${base}/eventos.html`,   erro: '500' },
      { nome: 'auditoria', url: `${base}/auditoria.html`, erro: '403' },
    ];

    for (const t of telas) {
      await capturar(browser, { url: t.url, arquivo: `g3-${t.nome}-1440-claro.png`,  largura: 1440, altura: 900, tema: 'light' });
      await capturar(browser, { url: t.url, arquivo: `g3-${t.nome}-1440-escuro.png`, largura: 1440, altura: 900, tema: 'dark' });
      await capturar(browser, { url: t.url, arquivo: `g3-${t.nome}-390-claro.png`,   largura: 390,  altura: 844, tema: 'light' });
      await capturar(browser, { url: t.url, arquivo: `g3-${t.nome}-390-escuro.png`,  largura: 390,  altura: 844, tema: 'dark' });
      await capturar(browser, { url: t.url, arquivo: `g3-${t.nome}-vazio.png`,       largura: 1440, altura: 900, tema: 'light', simular: 'vazio' });
      await capturar(browser, { url: t.url, arquivo: `g3-${t.nome}-carregando.png`,  largura: 1440, altura: 900, tema: 'light', simular: 'lento' });
      await capturar(browser, { url: t.url, arquivo: `g3-${t.nome}-erro.png`,        largura: 1440, altura: 900, tema: 'light', simular: t.erro });
    }

    // Detalhe de mensagem desconhecida (linha do tempo + ações manuais + confirmação inline aberta)
    await capturar(browser, {
      url: `${base}/mensagens.html?estado=desconhecida`,
      arquivo: 'g3-mensagens-detalhe-timeline-1440.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('.tabulator-row');
        await page.locator('.tabulator-row').first().click();
        await page.waitForSelector('#corpo-detalhe:not([hidden])');
        await page.click('#btn-reenviar');
        await page.waitForSelector('#confirm-acao:not([hidden])');
        await page.waitForTimeout(150);
      },
    });

    // Detalhe de evento falhando (linha do tempo de tentativas + corpo JSON)
    await capturar(browser, {
      url: `${base}/eventos.html?situacao=falhando`,
      arquivo: 'g3-eventos-detalhe-1440.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('.tabulator-row');
        await page.locator('.tabulator-row').first().click();
        await page.waitForSelector('#corpo-detalhe:not([hidden])');
        await page.waitForTimeout(150);
      },
    });

    // Detalhe de registro de auditoria (somente leitura, IP mascarado)
    await capturar(browser, {
      url: `${base}/auditoria.html`,
      arquivo: 'g3-auditoria-detalhe-1440.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => {
        await page.waitForSelector('.tabulator-row');
        await page.locator('.tabulator-row').first().click();
        await page.waitForSelector('#vista-detalhe:not([hidden])');
        await page.waitForTimeout(150);
      },
    });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g3-') && f.endsWith('.png')).sort();
    console.log(`Capturas G3 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
