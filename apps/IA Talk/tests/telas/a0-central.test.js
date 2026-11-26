'use strict';

// A0 (Antigravity) — testes funcionais e responsivos em Playwright para o
// protótipo da Central de Atendimento (apps/IA Talk/prototipos/central/):
//   - index.html (comparação)
//   - alternativa-a.html (4 áreas)
//   - alternativa-b.html (3 áreas + gaveta)
// Rodar com: node --test --test-concurrency=2 "apps/IA Talk/tests/telas/a0-central.test.js"

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let sim;
let baseUrl;
let browser;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${addr.port}/app/ia-talk/prototipos/central`;
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  await sim?.fechar();
});

async function novaPagina(largura = 1440, altura = 900) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (err) => erros.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  return { ctx, page, erros };
}

async function semRolagemHorizontal(page, contexto) {
  const medidas = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
  assert.ok(
    medidas.scrollW <= medidas.innerW + 1,
    `Rolagem horizontal detectada (${contexto}): scrollWidth=${medidas.scrollW} > innerWidth=${medidas.innerW}`,
  );
}

test('A0 index.html: compara alternativas A e B sem erros e sem rolagem horizontal em 1440, 1024, 390 e 360 px', async () => {
  const { ctx, page, erros } = await novaPagina(1440, 900);
  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    const txt = await page.textContent('main');
    assert.match(txt, /Alternativa A — Quatro áreas/);
    assert.match(txt, /Alternativa B — Três áreas \+ gaveta/);
    assert.equal(await page.locator('a[href$="alternativa-a.html"]').count() >= 1, true);
    assert.equal(await page.locator('a[href$="alternativa-b.html"]').count() >= 1, true);

    for (const w of [1440, 1024, 390, 360]) {
      await page.setViewportSize({ width: w, height: 844 });
      await semRolagemHorizontal(page, `index ${w}px`);
    }
    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('A0 alternativa-a.html: 4 áreas, notas internas, respostas /, transferir/encerrar 1 clique, IA sem cobrir conversa e estados', async () => {
  const { ctx, page, erros } = await novaPagina(1440, 900);
  try {
    await page.goto(`${baseUrl}/alternativa-a.html`, { waitUntil: 'networkidle' });
    await semRolagemHorizontal(page, 'alt-a 1440px');

    // Números sempre mascarados
    const txtTodo = await page.textContent('#workspace');
    assert.match(txtTodo, /\+55 65 9••••-\d{4}/);
    assert.equal(/\b55659\d{8}\b/.test(txtTodo), false, 'nenhum telefone completo permitido');

    // Notas internas visualmente distintas
    assert.ok(await page.locator('.cnt-msg--nota').count() >= 1);
    assert.match(await page.locator('.cnt-msg--nota').first().textContent(), /Nota interna/);
    await page.click('#btn-modo-nota');
    assert.equal(await page.locator('#compositor.modo-nota').count(), 1);
    await page.fill('#campo-msg', 'Verificado índice do relatório no ERP.');
    await page.click('#btn-enviar');
    assert.match(await page.locator('.cnt-msg--nota').last().textContent(), /Verificado índice/);

    // Respostas rápidas com /
    await page.click('#btn-modo-cliente');
    await page.fill('#campo-msg', '/bol');
    await page.waitForSelector('#slash-menu:not([hidden])');
    assert.match(await page.textContent('#slash-menu'), /\/boleto/);
    await page.keyboard.press('Enter');
    assert.match(await page.inputValue('#campo-msg'), /2ª via/i);

    // Assistente de IA no painel lateral sem cobrir a conversa
    await page.click('#aba-ia');
    await page.click('#btn-ia-resumo');
    await page.waitForSelector('#ia-saida:not([hidden])');
    assert.match(await page.textContent('#ia-saida-texto'), /relatório de faturamento/i);

    const chatBox = await page.locator('#lista-mensagens').boundingBox();
    const latBox = await page.locator('#painel-lateral').boundingBox();
    assert.ok(chatBox && latBox, 'áreas da conversa e do painel lateral precisam existir');
    assert.ok(chatBox.x + chatBox.width <= latBox.x + 2, 'painel de IA não pode cobrir a conversa');

    await page.click('#btn-ia-sugestao');
    await page.click('#btn-ia-inserir');
    assert.match(await page.inputValue('#campo-msg'), /Mariana/i);

    await page.click('#btn-ia-melhorar');
    assert.match(await page.textContent('#ia-saida-tit'), /Texto melhorado/i);

    // Transferir em 1 clique
    await page.click('#btn-transferir');
    await page.waitForSelector('#popover-transferir:not([hidden])');
    await page.click('[data-transf-setor="financeiro"]');
    assert.match(await page.textContent('#chat-sub'), /Financeiro/);

    // Encerrar em 1 clique
    await page.click('#btn-encerrar');
    assert.match(await page.textContent('.tlk-toasts'), /Conversa encerrada/);

    // Estados obrigatórios: canal desconectado (bloqueia cliente, libera nota interna), vazio, carregando, sem permissão
    await page.selectOption('#sel-cenario', 'desconectado');
    await page.waitForSelector('#banner-desconectado:not([hidden])');
    await page.click('#btn-modo-cliente');
    assert.equal(await page.isDisabled('#campo-msg'), true);
    await page.click('#btn-modo-nota');
    assert.equal(await page.isDisabled('#campo-msg'), false, 'nota interna deve continuar liberada mesmo com canal offline');

    await page.selectOption('#sel-cenario', 'vazio');
    await page.waitForSelector('#estado-lista-vazio:not([hidden])');

    await page.selectOption('#sel-cenario', 'carregando');
    await page.waitForSelector('#estado-global:not([hidden])');
    assert.match(await page.textContent('#estado-global'), /Carregando central/i);

    await page.selectOption('#sel-cenario', 'sem_permissao');
    assert.match(await page.textContent('#estado-global'), /Sem permissão/i);

    // 1024px sem rolagem horizontal
    await page.selectOption('#sel-cenario', 'normal');
    await page.setViewportSize({ width: 1024, height: 768 });
    await semRolagemHorizontal(page, 'alt-a 1024px');

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('A0 alternativa-b.html e celular (390/360 px): gaveta retrátil sem cobrir conversa e telas em sequência no mobile', async () => {
  const { ctx, page, erros } = await novaPagina(1440, 900);
  try {
    await page.goto(`${baseUrl}/alternativa-b.html`, { waitUntil: 'networkidle' });
    await semRolagemHorizontal(page, 'alt-b 1440px fechada');

    // Começa com gaveta recolhida; 1 clique abre sem cobrir conversa
    const larguraAntes = (await page.locator('#lista-mensagens').boundingBox()).width;
    await page.click('#btn-gaveta');
    await page.waitForTimeout(260);
    await semRolagemHorizontal(page, 'alt-b 1440px aberta');
    const chatBox = await page.locator('#lista-mensagens').boundingBox();
    const latBox = await page.locator('#painel-lateral').boundingBox();
    assert.ok(chatBox.width < larguraAntes, 'gaveta deve redimensionar o grid em vez de cobrir');
    assert.ok(chatBox.x + chatBox.width <= latBox.x + 2, 'gaveta não pode sobrepor a conversa');

    // Filtro de setor no topo da lista
    await page.selectOption('#sel-setor-b', 'financeiro');
    assert.match(await page.textContent('#lista-conversas'), /Lucas Ferreira/);

    // 1024px
    await page.setViewportSize({ width: 1024, height: 768 });
    await semRolagemHorizontal(page, 'alt-b 1024px');

    // Celular 390 e 360 px na Alternativa A: sequência setores -> lista -> chat + folha deslizante
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/alternativa-a.html`, { waitUntil: 'networkidle' });
    await semRolagemHorizontal(page, 'alt-a 390px lista');
    await page.click('#btn-mobile-setores');
    assert.equal(await page.getAttribute('#workspace', 'data-passo'), 'setores');
    await semRolagemHorizontal(page, 'alt-a 390px setores');
    await page.locator('#lista-setores button').first().click();
    assert.equal(await page.getAttribute('#workspace', 'data-passo'), 'lista');
    await page.locator('#lista-conversas button').first().click();
    assert.equal(await page.getAttribute('#workspace', 'data-passo'), 'chat');
    await semRolagemHorizontal(page, 'alt-a 390px chat');

    // Folha deslizante Contato/IA no celular + fechamento por Esc
    await page.click('#btn-abrir-sheet');
    await page.waitForSelector('#painel-lateral.sheet-aberta');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#painel-lateral.sheet-aberta').count(), 0);

    await page.setViewportSize({ width: 360, height: 800 });
    await semRolagemHorizontal(page, 'alt-a 360px chat');

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('A0 hibrido.html (Escolhida): 4 áreas >=1280, gaveta <1280 sem cobrir conversa, mobile <=760, sem Plantivo e foco visível no teclado', async () => {
  const { ctx, page, erros } = await novaPagina(1440, 900);
  try {
    // Confere destaque "Escolhida" na página de comparação
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    const txtIndex = await page.textContent('main');
    assert.match(txtIndex, /Escolhida/);
    assert.ok(await page.locator('a[href$="hibrido.html"]').count() >= 1);

    // >= 1280 px: quatro áreas fixas visíveis (1440 e 1280 px)
    await page.goto(`${baseUrl}/hibrido.html`, { waitUntil: 'networkidle' });
    const txtTodo = await page.textContent('#workspace');
    assert.equal(/Plantivo/i.test(txtTodo), false, 'nome de empresa real não pode aparecer em dados.js');
    assert.match(txtTodo, /Alvorada Sementes/);

    for (const w of [1440, 1280]) {
      await page.setViewportSize({ width: w, height: 860 });
      await semRolagemHorizontal(page, `hibrido ${w}px`);
      assert.equal(await page.isVisible('#btn-gaveta'), false, `em ${w}px o painel lateral já é fixo`);
      const chatBox = await page.locator('#lista-mensagens').boundingBox();
      const latBox = await page.locator('#painel-lateral').boundingBox();
      assert.ok(latBox && latBox.width >= 240, `em ${w}px painel Contato/IA deve estar aberto`);
      assert.ok(chatBox.x + chatBox.width <= latBox.x + 2, `em ${w}px painel não pode cobrir conversa`);
    }

    // Foco visível na navegação por teclado (Tab)
    await page.keyboard.press('Tab');
    const foco = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const st = getComputedStyle(el);
      return { tag: el.tagName, outlineStyle: st.outlineStyle, outlineWidth: parseFloat(st.outlineWidth) || 0 };
    });
    assert.ok(foco && foco.tag !== 'BODY', 'Tab deve mover foco para elemento interativo');
    assert.notEqual(foco.outlineStyle, 'none', 'foco por teclado deve ser visível');
    assert.ok(foco.outlineWidth >= 1, 'largura do contorno de foco deve ser visível');

    // Abaixo de 1280 px (1024 px): gaveta retrátil abrindo e fechando sem cobrir a conversa
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(260);
    await semRolagemHorizontal(page, 'hibrido 1024px fechada');
    assert.equal(await page.isVisible('#btn-gaveta'), true, 'em 1024px botão da gaveta deve aparecer');
    const larguraFechada = (await page.locator('#lista-mensagens').boundingBox()).width;

    await page.click('#btn-gaveta');
    await page.waitForTimeout(260);
    await semRolagemHorizontal(page, 'hibrido 1024px gaveta aberta');
    const chatAberta = await page.locator('#lista-mensagens').boundingBox();
    const latAberta = await page.locator('#painel-lateral').boundingBox();
    assert.ok(chatAberta.width < larguraFechada, 'abrir gaveta deve redimensionar a conversa');
    assert.ok(chatAberta.x + chatAberta.width <= latAberta.x + 2, 'gaveta em 1024px não pode cobrir conversa');

    await page.click('#btn-fechar-lateral');
    await page.waitForTimeout(260);
    const larguraRefechada = (await page.locator('#lista-mensagens').boundingBox()).width;
    assert.ok(larguraRefechada > chatAberta.width, 'fechar gaveta deve devolver largura à conversa');

    // Até 760 px (390 e 360 px): telas em sequência + folha deslizante sem rolagem horizontal
    for (const w of [390, 360]) {
      await page.setViewportSize({ width: w, height: 844 });
      await semRolagemHorizontal(page, `hibrido ${w}px lista`);
      await page.click('#btn-mobile-setores');
      assert.equal(await page.getAttribute('#workspace', 'data-passo'), 'setores');
      await semRolagemHorizontal(page, `hibrido ${w}px setores`);
      await page.locator('#lista-setores button').first().click();
      await page.locator('#lista-conversas button').first().click();
      assert.equal(await page.getAttribute('#workspace', 'data-passo'), 'chat');
      await semRolagemHorizontal(page, `hibrido ${w}px chat`);
      await page.click('#btn-abrir-sheet');
      await page.waitForSelector('#painel-lateral.sheet-aberta');
      await page.click('#btn-fechar-lateral');
      assert.equal(await page.locator('#painel-lateral.sheet-aberta').count(), 0);
      await page.click('#btn-mobile-lista');
    }

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});
