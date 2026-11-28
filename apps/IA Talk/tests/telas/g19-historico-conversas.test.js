'use strict';

// Testes em Playwright da nova tela Histórico de mensagens (frontend/mensagens.html):
//   - Aba padrão Conversas (auditoria): cada linha é uma conversa com contato, atendente, setor e datas;
//   - Clique em uma conversa abre todo o histórico no painel lateral (entrada, saída, notas, eventos, filtros e cópia);
//   - Painel de agrupamento funcional em ambas as abas (.aberta) agrupando a grade Tabulator;
//   - Reordenação de colunas (movableColumns) persistida em localStorage + botão Restaurar colunas;
//   - Aba Envios e entregas com painel lateral, texto completo e botão Ampliar grade (Esc volta);
//   - Zero rolagem horizontal em 1440 e 390 px e nenhum número completo exposto.

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let sim;
let baseUrl;
let browser;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 60_000, intervaloQrMs: 60_000, intervaloConversaMs: 0 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  await sim?.fechar();
});

async function novaPagina(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  return { ctx, page, erros };
}

test('Histórico de mensagens: grade de conversas, leitor lateral completo, agrupamento e colunas móveis persistidas', async () => {
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    await page.goto(`${baseUrl}/mensagens.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#tabela-conversas .tabulator-row');

    // Aba padrão é Conversas (auditoria), cada linha é uma conversa com nome do contato, setor e atendente
    assert.equal(await page.getAttribute('#aba-conversas', 'aria-selected'), 'true');
    const txtGrid = await page.textContent('#tabela-conversas');
    assert.match(txtGrid, /Mariana Oliveira/);
    assert.match(txtGrid, /Ricardo Alves/);
    assert.match(txtGrid, /Suporte/);
    assert.match(txtGrid, /Carla Souza/);
    assert.match(txtGrid, /••••/);
    assert.equal(txtGrid.includes('5565999990010'), false, 'número completo nunca pode aparecer');

    // Clicar em uma conversa (Ricardo Alves, cv_ex04: tem entrada, saída, nota interna e eventos) abre o histórico na lateral
    const linhaRicardo = page.locator('#tabela-conversas .tabulator-row', { hasText: 'Ricardo Alves' }).first();
    await linhaRicardo.click();
    await page.waitForSelector('#painel-detalhe-conversa:not([hidden])');
    await page.waitForSelector('#conv-fio:not([hidden])');

    assert.equal(await page.textContent('#conv-det-nome'), 'Ricardo Alves');
    const txtFio = await page.textContent('#conv-fio');
    assert.match(txtFio, /A nota fiscal 1234 foi rejeitada pela Sefaz/);
    assert.match(txtFio, /Verificar com o fiscal se houve reenvio no dia 24/);
    assert.match(txtFio, /Bruno Lima assumiu a conversa/);
    assert.ok(await page.locator('#conv-fio .tlk-chat-balao--entrada').count() >= 1);
    assert.ok(await page.locator('#conv-fio .tlk-chat-balao--saida').count() >= 1);
    assert.ok(await page.locator('#conv-fio .tlk-chat-balao--nota').count() >= 1);
    assert.ok(await page.locator('#conv-fio .tlk-chat-dia').count() >= 1);

    // Filtro por categoria e busca dentro da conversa
    await page.click('[data-cat-filtro="nota"]');
    assert.equal(await page.locator('#conv-fio .tlk-chat-balao--entrada').count(), 0);
    assert.equal(await page.locator('#conv-fio .tlk-chat-balao--nota').count(), 1);
    await page.click('[data-cat-filtro=""]');
    await page.fill('#f-chat-busca', 'Sefaz');
    assert.equal(await page.locator('#conv-fio .tlk-chat-balao').count(), 1);
    await page.fill('#f-chat-busca', '');

    // Copiar transcrição e fechar painel lateral
    await page.click('#btn-copiar-conversa');
    await page.click('#btn-fechar-conversa');
    assert.equal(await page.isHidden('#painel-detalhe-conversa'), true);

    // Painel de agrupamento da aba Conversas abre de verdade e agrupa a tabela por Setor
    await page.click('#btn-conv-agrupar');
    await page.waitForSelector('#grupo-area-conv.aberta');
    assert.equal(await page.isVisible('#grupo-area-conv'), true);
    await page.locator('#gp-chips-conv .ggp-chip-avail', { hasText: 'Setor' }).click();
    assert.match(await page.textContent('#grupo-status-conv'), /1 campo\(s\) agrupado\(s\)/);
    assert.ok(await page.locator('#tabela-conversas .tabulator-group').count() >= 2);
    // Remove o agrupamento
    await page.locator('#dz-conv .ggp-chip-rm').click();
    assert.match(await page.textContent('#grupo-status-conv'), /Sem agrupamento ativo/);

    // Persistência da ordem das colunas + botão Restaurar colunas
    await page.evaluate(() => {
      localStorage.setItem('talk_hist_conv_colunas_v1', JSON.stringify(['setor_nome', 'protocolo', 'contato_busca']));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#tabela-conversas .tabulator-col[tabulator-field]');
    const camposAposReload = await page.locator('#tabela-conversas .tabulator-col[tabulator-field]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('tabulator-field'))
    );
    assert.equal(camposAposReload[0], 'setor_nome');
    assert.equal(camposAposReload[1], 'protocolo');

    await page.click('#btn-conv-agrupar');
    await page.click('#btn-conv-reset-colunas');
    const camposRestaurados = await page.locator('#tabela-conversas .tabulator-col[tabulator-field]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('tabulator-field'))
    );
    assert.equal(camposRestaurados[0], 'protocolo');

    // Aba Envios e entregas: agrupamento corrigido (.aberta) + painel lateral + Ampliar grade
    await page.click('#aba-envios');
    await page.waitForSelector('#tabela .tabulator-row');
    await page.click('#btn-agrupar');
    await page.waitForSelector('#grupo-area.aberta');
    assert.equal(await page.isVisible('#grupo-area'), true);
    await page.locator('#gp-chips .ggp-chip-avail', { hasText: 'Canal' }).click();
    assert.match(await page.textContent('#grupo-status'), /1 campo\(s\) agrupado\(s\)/);
    assert.ok(await page.locator('#tabela .tabulator-group').count() >= 1);
    await page.locator('#dz .ggp-chip-rm').click();

    await page.locator('#tabela .tabulator-row').first().click();
    await page.waitForSelector('#corpo-detalhe:not([hidden])');
    assert.equal(await page.isVisible('#vista-detalhe'), true);
    assert.equal(await page.isVisible('#tabela'), true, 'em 1440 px a grade permanece visível ao lado do painel lateral');

    // Ampliar grade + Esc volta
    await page.click('#btn-ampliar');
    assert.equal(await page.evaluate(() => document.body.classList.contains('grade-ampliada')), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.body.classList.contains('grade-ampliada')), false);

    // Sem rolagem horizontal em 1440 e 390 px (com e sem detalhe aberto)
    await page.click('#aba-conversas');
    await page.locator('#tabela-conversas .tabulator-row').first().click();
    await page.waitForSelector('#conv-fio:not([hidden])');
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal em ${w}px: ${med.sw} > ${med.iw}`);
    }

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});
