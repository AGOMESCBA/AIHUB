'use strict';

// G15 (Antigravity) — gera capturas do Portal do atendente (frontend/portal.html)
// em apps/IA Talk/tests/telas/capturas/: 1440 e 390 px (claro e escuro) + estado "Sem acesso".

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

const DIR_CAPTURAS = path.join(__dirname, 'capturas');

async function capturar(browser, { url, arquivo, largura = 1440, altura = 900, tema = 'light', antes = null, esperar = '#chat-ativo:not([hidden])', acao = null }) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    try {
      if (t === 'dark') localStorage.setItem('talk_tema', 'dark');
      else localStorage.removeItem('talk_tema');
      sessionStorage.removeItem('talk_simular');
    } catch (_) {}
  }, tema);

  if (antes) await antes(page);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector(esperar);
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
    // 1. 1440 claro — Carla com oferta do rodízio (cv_ex02) em destaque
    await capturar(browser, {
      url: `${base}/j2a/atendimento?simular=atendente&conversa=cv_ex02`,
      arquivo: 'g15-portal-1440-claro.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      acao: async (page) => { await page.waitForSelector('#banner-oferta:not([hidden])'); },
    });

    // 2. 1440 escuro — Administrador com "Abrir a administração" e alerta no sino
    await capturar(browser, {
      url: `${base}/j2a/atendimento?conversa=cv_ex04`,
      arquivo: 'g15-portal-1440-escuro.png',
      largura: 1440,
      altura: 900,
      tema: 'dark',
      acao: async (page) => {
        await page.evaluate(async () => {
          await fetch('/app/ia-talk/api/admin/simulado/alerta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversa_id: 'cv_ex03', tipo: 'nova_na_fila' }),
          });
        });
        await page.waitForSelector('#ptl-sino-badge:not([hidden])');
        await page.click('#btn-sino');
        await page.waitForSelector('#popover-alertas:not([hidden])');
      },
    });

    // 3. 390 px celular — claro e escuro (com oferta em destaque)
    await capturar(browser, {
      url: `${base}/j2a/atendimento?simular=atendente&conversa=cv_ex02`,
      arquivo: 'g15-portal-390-claro.png',
      largura: 390,
      altura: 844,
      tema: 'light',
      acao: async (page) => { await page.waitForSelector('#banner-oferta:not([hidden])'); },
    });
    await capturar(browser, {
      url: `${base}/j2a/atendimento?simular=atendente&conversa=cv_ex01`,
      arquivo: 'g15-portal-390-escuro.png',
      largura: 390,
      altura: 844,
      tema: 'dark',
    });

    // 4. Estado "Sem acesso ao atendimento" (1440 claro)
    await capturar(browser, {
      url: `${base}/j2a/atendimento`,
      arquivo: 'g15-portal-sem-acesso-1440.png',
      largura: 1440,
      altura: 900,
      tema: 'light',
      esperar: '#estado-global:not([hidden])',
      antes: async (page) => {
        await page.route('**/api/admin/sessao*', async (route) => {
          const resp = await route.fetch();
          const dados = await resp.json();
          dados.rotinas = ['talk-painel'];
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dados) });
        });
      },
    });

    const geradas = fs.readdirSync(DIR_CAPTURAS).filter((f) => f.startsWith('g15-') && f.endsWith('.png')).sort();
    console.log(`Capturas G15 geradas (${geradas.length}):`, geradas.join(', '));
  } finally {
    await browser.close();
    await sim.fechar();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
