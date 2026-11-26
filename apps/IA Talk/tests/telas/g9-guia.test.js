'use strict';

// G9 (Antigravity) — teste em Playwright para frontend/guia.html e conferência do menu talk-auditoria.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let sim;
let baseUrl;
let browser;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  await sim?.fechar();
});

test('G9 guia.html: seção Canais descreve Terminal em 3 colunas, passo a passo do QR e renovação automática, sem rolagem horizontal', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (err) => erros.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  try {
    await page.goto(`${baseUrl}/guia.html`, { waitUntil: 'networkidle' });
    const txtCanais = await page.textContent('#canais');
    assert.match(txtCanais, /Terminal ao vivo/i);
    assert.match(txtCanais, /três colunas/i);
    assert.match(txtCanais, /WhatsApp → Aparelhos conectados → Conectar aparelho/);
    assert.match(txtCanais, /se renova sozinho/i);
    assert.match(txtCanais, /Novo QR/);
    assert.match(txtCanais, /Remover sessão/);
    assert.match(txtCanais, /Copiar/);

    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal no guia em ${w}px: ${med.sw} > ${med.iw}`);
    }

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G9 talk-sidebar.js: talk-auditoria, painel e mensagens liberados (C3); eventos ainda G3 até a C4', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/js/talk-sidebar.js'), 'utf8');
  assert.match(src, /id:\s*'talk-auditoria'[^\n]*etapa:\s*null/);
  assert.match(src, /id:\s*'talk-painel'[^\n]*etapa:\s*null/);
  assert.match(src, /id:\s*'talk-mensagens'[^\n]*etapa:\s*null/);
  assert.match(src, /id:\s*'talk-eventos'[^\n]*etapa:\s*'G3'/);
});
