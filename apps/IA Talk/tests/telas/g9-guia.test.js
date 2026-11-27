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

test('G12 guia.html: Regras do canal e seção API para integradores (curl/JS, estados, 120/min, erros e ícones G10)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (err) => erros.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  try {
    await page.goto(`${baseUrl}/guia.html`, { waitUntil: 'networkidle' });

    // 1. Seção Regras do canal (substitui o antigo Modo de teste)
    const txtRegras = await page.textContent('#teste');
    assert.match(txtRegras, /Regras do canal/i);
    assert.match(txtRegras, /envio_modo/);
    assert.match(txtRegras, /recebimento_modo/);
    assert.match(txtRegras, /desligado/i);
    assert.match(txtRegras, /qualquer/i);
    assert.match(txtRegras, /lista de números de teste/i);

    // 2. Seção API para integradores: conteúdo do contrato §2, §6 e README
    const txtApi = await page.textContent('#api');
    assert.match(txtApi, /API para integradores/i);
    assert.match(txtApi, /Authorization:\s*Bearer tk_live_EXEMPLO/);
    assert.match(txtApi, /POST \/app\/ia-talk\/api\/v1\/mensagens/);
    assert.match(txtApi, /GET \/app\/ia-talk\/api\/v1\/mensagens\/\{id\}/);
    assert.match(txtApi, /GET \/app\/ia-talk\/api\/v1\/canais\/\{id\}\/estado/);
    assert.match(txtApi, /envio_modo/);
    assert.match(txtApi, /Idempotency-Key/);
    assert.match(txtApi, /8 a 128 caracteres/);
    assert.match(txtApi, /correlacao_id/);
    assert.match(txtApi, /4096/);
    assert.match(txtApi, /aceita não é entrega/i);
    assert.match(txtApi, /120 pedidos por minuto/i);
    assert.match(txtApi, /X-RateLimit-Limit/);
    assert.match(txtApi, /X-RateLimit-Remaining/);
    assert.match(txtApi, /X-RateLimit-Reset/);
    assert.match(txtApi, /C3b/);
    const txtTabelaErros = await page.textContent('#api table.guia-tabela');
    assert.match(txtTabelaErros, /\/app\/ia-talk\/api\/v1\/canais\/\{id\}\/estado/);
    assert.equal(/\bGET \/api\/v1\/canais\/\{id\}\/estado/.test(txtTabelaErros), false);
    for (const codigo of ['envio_desligado', 'canal_desconectado', 'sem_permissao', 'canal_nao_autorizado', 'recurso_nao_suportado']) {
      assert.match(txtApi, new RegExp(codigo), `tabela de erros deveria citar ${codigo}`);
    }

    // Nunca pode existir token real (só tk_live_EXEMPLO)
    const tokensEncontrados = (await page.content()).match(/tk_live_[A-Za-z0-9_-]+/g) || [];
    assert.ok(tokensEncontrados.length > 0);
    for (const tok of tokensEncontrados) {
      assert.equal(tok, 'tk_live_EXEMPLO', `token inesperado no guia: ${tok}`);
    }

    // 3. Alternância entre cURL e JavaScript + botões Copiar com ícone SVG G10 e title/aria-label
    const boxPost = page.locator('[data-grupo-cod="post-msg"]');
    assert.equal(await boxPost.locator('[data-painel-cod="curl"]').isVisible(), true);
    assert.equal(await boxPost.locator('[data-painel-cod="js"]').isVisible(), false);
    await boxPost.locator('[data-aba-cod="js"]').click();
    assert.equal(await boxPost.locator('[data-painel-cod="js"]').isVisible(), true);
    assert.match(await boxPost.locator('[data-painel-cod="js"]').textContent(), /fetch\(/);

    const botoesCopiar = await page.locator('#api button.btn').evaluateAll((els) => els.map((b) => ({
      temSvg: !!b.querySelector('svg.tlk-ico'),
      title: (b.getAttribute('title') || '').trim(),
      aria: (b.getAttribute('aria-label') || '').trim(),
    })));
    assert.ok(botoesCopiar.length >= 4);
    for (const b of botoesCopiar) {
      assert.equal(b.temSvg, true);
      assert.ok(b.title.length >= 10);
      assert.ok(b.aria.length >= 10);
    }

    // 4. Sem rolagem horizontal em 1440, 1024 e 390 px
    for (const w of [1440, 1024, 390]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal no guia G12 em ${w}px: ${med.sw} > ${med.iw}`);
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
