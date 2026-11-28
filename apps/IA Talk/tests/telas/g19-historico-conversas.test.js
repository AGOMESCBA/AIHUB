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

test('G22 Histórico de mensagens: período enviado ao servidor encontra conversas fora dos 100 primeiros e Exportar CSV envia filtro de canal mostrando Exportando…', async () => {
  // Instância isolada do simulado para semear >100 conversas recentes sem afetar outros testes
  const simIsolado = criarServidorSimulado({ intervaloLogMs: 60_000, intervaloQrMs: 60_000, intervaloConversaMs: 0 });
  const addr = await simIsolado.iniciar(0, '127.0.0.1');
  const urlIsolada = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });

  try {
    // Semeia 102 conversas novas (atualizada_em = hoje, 2026-11-28), empurrando as da semente
    // (ex.: cv_ex08 em 2026-11-20 e cv_ex09 em 2026-11-15) para além das 100 primeiras posições.
    await Promise.all(Array.from({ length: 102 }, (_, i) => {
      const n = String(i + 1).padStart(4, '0');
      return fetch(`${urlIsolada}/api/v1/conversas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer tk_teste_g22',
        },
        body: JSON.stringify({
          canal: 'cn_suporte',
          contato: { telefone: `556598888${n}`, nome: `Cliente Recente ${n}` },
          referencia: { sistema: 'softexpert', id: `G22-${n}`, titulo: `Chamado recente ${n}` },
          setor: 'suporte',
        }),
      });
    }));

    const queriesConversas = [];
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (u.pathname.endsWith('/api/admin/conversas')) {
        queriesConversas.push(Object.fromEntries(u.searchParams.entries()));
      }
    });

    await page.goto(`${urlIsolada}/mensagens.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#tabela-conversas .tabulator-row');

    // Sem filtro de período: total = 111 (9 da semente + 102 recentes), página mostra 100 e "Carregar mais" visível;
    // Marcos Teixeira (2026-11-20, pos. 110) e 2026-000109 (2026-11-15, pos. 111) estão fora dos 100 primeiros.
    assert.equal((await page.textContent('#qtd-aba-conversas')).trim(), '111');
    assert.equal(await page.isVisible('#mais-conv'), true);
    const txtSemPeriodo = await page.textContent('#tabela-conversas');
    assert.equal(txtSemPeriodo.includes('2026-000109'), false, 'conversa antiga está fora dos 100 primeiros');

    // Abre "Mais filtros" e informa o período 2026-11-15 a 2026-11-20 -> servidor filtra na base inteira
    await page.click('#btn-conv-mais-filtros');
    await page.waitForSelector('#filtros-conv-extra:not([hidden])');
    queriesConversas.length = 0;

    await page.fill('#fc-de', '2026-11-15');
    await page.fill('#fc-ate', '2026-11-20');
    await page.waitForFunction(() => document.getElementById('qtd-aba-conversas')?.textContent?.trim() === '2');

    const ultimaQuery = queriesConversas[queriesConversas.length - 1];
    assert.equal(ultimaQuery.de, '2026-11-15');
    assert.equal(ultimaQuery.ate, '2026-11-20');
    assert.equal((await page.textContent('#contador')).trim(), '(2)');
    assert.equal(await page.isHidden('#mais-conv'), true, 'apenas 2 registros no período: sem próxima página');

    const txtFiltrado = await page.textContent('#tabela-conversas');
    assert.match(txtFiltrado, /Marcos Teixeira/);
    assert.match(txtFiltrado, /2026-000108/);
    assert.match(txtFiltrado, /2026-000109/);

    // Com período amplo (2026-11-20 a 2026-11-28 -> 110 conversas), total e paginação vêm do servidor
    await page.fill('#fc-de', '2026-11-20');
    await page.fill('#fc-ate', '2026-11-28');
    await page.waitForFunction(() => document.getElementById('qtd-aba-conversas')?.textContent?.trim() === '110');
    assert.equal(await page.isVisible('#mais-conv'), true, 'com 110 no período, paginação do servidor habilita Carregar mais');

    // Aba Envios e entregas: filtra por canal Financeiro (cn_financeiro) e exporta CSV
    await page.click('#aba-envios');
    await page.waitForSelector('#tabela .tabulator-row');
    await page.selectOption('#f-canal', 'cn_financeiro');
    await page.waitForFunction(() => {
      const n = Number(document.getElementById('qtd-aba-envios')?.textContent?.trim());
      return Number.isFinite(n) && n > 0 && n < 64;
    });

    let urlExportada = '';
    let textoDuranteDownload = '';
    let desabilitadoDuranteDownload = false;
    let liberarResposta;
    const aguardarClique = new Promise((r) => { liberarResposta = r; });

    await page.route('**/api/admin/mensagens/exportar*', async (route) => {
      urlExportada = route.request().url();
      liberarResposta();
      await new Promise((r) => setTimeout(r, 220));
      await route.continue();
    });

    const promessaDownload = page.waitForEvent('download');
    await page.click('#btn-exportar');
    await aguardarClique;

    textoDuranteDownload = (await page.textContent('#btn-exportar')).trim();
    desabilitadoDuranteDownload = await page.isDisabled('#btn-exportar');
    assert.equal(textoDuranteDownload, 'Exportando…');
    assert.equal(desabilitadoDuranteDownload, true);

    const download = await promessaDownload;
    await page.waitForFunction(() => !document.getElementById('btn-exportar')?.disabled);
    assert.equal((await page.textContent('#btn-exportar')).trim(), 'Exportar CSV');

    const paramsExport = new URL(urlExportada).searchParams;
    assert.equal(paramsExport.get('canal_id'), 'cn_financeiro');

    const caminhoCsv = await download.path();
    const csvConteudo = require('fs').readFileSync(caminhoCsv, 'utf8').replace(/^\uFEFF/, '').trim();
    const linhasCsv = csvConteudo.split(/\r?\n/);
    assert.equal(linhasCsv[0], 'id;direcao;canal;aplicacao;contato;tipo;estado;correlacao;criada_em');
    assert.ok(linhasCsv.length >= 2, 'deve exportar as mensagens do canal Financeiro');
    for (const linha of linhasCsv.slice(1)) {
      const cols = linha.split(';');
      assert.equal(cols[2], 'Financeiro', `linha fora do canal filtrado: ${linha}`);
    }

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
    await simIsolado.fechar();
  }
});
