'use strict';

// G10 (Antigravity) — gera as capturas "depois" em apps/IA Talk/tests/telas/capturas/:
//   - Terminal ao vivo em 1440, 1024 e 390 px, claro e escuro (faixa recolhida ~56 px + aberta em 1440)
//   - 1 captura de cada uma das outras 8 telas do IA Talk (1440 px, tema claro)
// Nenhum número completo, token ou segredo aparece nas capturas.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturar(browser, { url, arquivo, largura = 1440, altura = 900, tema = 'light', sidebarRecolhida = null, acao = null, esperarMs = 350 }) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  await page.addInitScript(({ t, rec }) => {
    try {
      if (t === 'dark') localStorage.setItem('talk_tema', 'dark');
      else localStorage.removeItem('talk_tema');
      if (rec === true) localStorage.setItem('talk_term_canais_recolhida', '1');
      else if (rec === false) localStorage.setItem('talk_term_canais_recolhida', '0');
      else localStorage.removeItem('talk_term_canais_recolhida');
      sessionStorage.removeItem('talk_simular');
    } catch (_) {}
  }, { t: tema, rec: sidebarRecolhida });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(esperarMs);
  if (acao) await acao(page);
  await page.screenshot({ path: path.join(DIR_CAPTURAS, arquivo), fullPage: true });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const sim = criarServidorSimulado({ intervaloLogMs: 450, intervaloQrMs: 20000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Terminal ao vivo ("depois"): faixa recolhida ~56 px em 1440, 1024 e 390, claro e escuro
    const termUrl = `${base}/canais.html?id=cn_suporte&aba=terminal`;
    const matrizTerminal = [
      { arquivo: 'g10-depois-terminal-1440-claro.png',  largura: 1440, altura: 900, tema: 'light', rec: true },
      { arquivo: 'g10-depois-terminal-1440-escuro.png', largura: 1440, altura: 900, tema: 'dark',  rec: true },
      { arquivo: 'g10-depois-terminal-1024-claro.png',  largura: 1024, altura: 768, tema: 'light', rec: true },
      { arquivo: 'g10-depois-terminal-1024-escuro.png', largura: 1024, altura: 768, tema: 'dark',  rec: true },
      { arquivo: 'g10-depois-terminal-390-claro.png',   largura: 390,  altura: 844, tema: 'light', rec: true },
      { arquivo: 'g10-depois-terminal-390-escuro.png',  largura: 390,  altura: 844, tema: 'dark',  rec: true },
      { arquivo: 'g10-depois-terminal-aberta-1440-claro.png', largura: 1440, altura: 900, tema: 'light', rec: false },
    ];
    for (const c of matrizTerminal) {
      await capturar(browser, {
        url: termUrl,
        arquivo: c.arquivo,
        largura: c.largura,
        altura: c.altura,
        tema: c.tema,
        sidebarRecolhida: c.rec,
        acao: async (page) => {
          await page.waitForSelector('#painel-terminal:not([hidden])');
          await page.waitForTimeout(1200);
        },
      });
    }

    // 2. Uma captura de cada uma das outras 8 telas do Talk (1440 px, tema claro)
    const outrasTelas = [
      { rota: 'usuarios.html',       arquivo: 'g10-usuarios-1440.png',       espera: '.tabulator-row' },
      { rota: 'aplicacoes.html',     arquivo: 'g10-aplicacoes-1440.png',     espera: '.tabulator-row' },
      { rota: 'empresas.html',       arquivo: 'g10-empresas-1440.png',       espera: '.tabulator-row' },
      { rota: 'configuracoes.html',  arquivo: 'g10-configuracoes-1440.png',  espera: '#cartao-config:not([hidden])' },
      { rota: 'auditoria.html',      arquivo: 'g10-auditoria-1440.png',      espera: '.tabulator-row' },
      { rota: 'painel.html',         arquivo: 'g10-painel-1440.png',         espera: '#conteudo-painel:not([hidden])' },
      { rota: 'mensagens.html',      arquivo: 'g10-mensagens-1440.png',      espera: '.tabulator-row' },
      { rota: 'eventos.html',        arquivo: 'g10-eventos-1440.png',        espera: '.tabulator-row' },
    ];
    for (const t of outrasTelas) {
      await capturar(browser, {
        url: `${base}/${t.rota}`,
        arquivo: t.arquivo,
        acao: async (page) => { await page.waitForSelector(t.espera); },
      });
    }

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g10-') && f.endsWith('.png')).sort();
    console.log(`Capturas G10 presentes (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
