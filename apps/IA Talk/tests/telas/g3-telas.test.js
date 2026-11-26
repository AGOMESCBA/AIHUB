'use strict';

// G3 (Antigravity) — testes funcionais em Playwright para:
//   - frontend/painel.html
//   - frontend/mensagens.html
//   - frontend/eventos.html
//   - frontend/auditoria.html
// Executados contra o servidor simulado em memória.

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let sim;
let baseUrl;
let browser;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 1000, intervaloQrMs: 20000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  await sim?.fechar();
});

async function novaPagina() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (err) => erros.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  return { ctx, page, erros };
}

test('G3 painel.html: exibe KPIs, pendências com link, canais mascarados e tempo real via Socket.IO', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    await page.goto(`${baseUrl}/painel.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#conteudo-painel:not([hidden])');
    await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));

    assert.match(await page.textContent('#kpi-canais'), /1\s*\/\s*3/);
    assert.match(await page.textContent('#kpi-tempo'), /1,8 s/);

    const txtPend = await page.textContent('#lista-pendencias');
    assert.match(txtPend, /resultado desconhecido/i);
    assert.match(txtPend, /Financeiro/);
    assert.match(txtPend, /Webhook do IA Command/);
    assert.equal(await page.locator('#lista-pendencias button[data-link-idx]').count(), 3);

    const txtCanais = await page.textContent('#lista-canais');
    assert.match(txtCanais, /Suporte J2A/);
    assert.match(txtCanais, /••••/);
    assert.equal(txtCanais.includes('5565999900001'), false, 'número completo nunca pode aparecer');

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G3 mensagens.html: filtro por URL, linha do tempo, ações manuais só em desconhecida/falhou com confirmação inline e exportar CSV', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    // Filtro vindo de link do painel (?estado=desconhecida)
    await page.goto(`${baseUrl}/mensagens.html?estado=desconhecida`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tabulator-row');
    assert.equal(await page.inputValue('#f-estado'), 'desconhecida');

    const txtLista = await page.textContent('#tabela');
    assert.match(txtLista, /Resultado desconhecido/);
    assert.match(txtLista, /••••/);
    assert.equal(/\b55659999\d{5}\b/.test(txtLista), false, 'número completo nunca pode aparecer');

    // Exportar CSV usa os filtros atuais (estado=desconhecida)
    const promResp = page.waitForResponse((r) => r.url().includes('/api/admin/mensagens/exportar'));
    await page.click('#btn-exportar');
    const respExport = await promResp;
    assert.equal(respExport.status(), 200);
    assert.match(respExport.url(), /estado=desconhecida/);
    const csv = await respExport.text();
    assert.match(csv, /id;direcao;canal;aplicacao;contato;tipo;estado;correlacao;criada_em/);
    assert.match(csv, /desconhecida/);

    // Abre a primeira mensagem desconhecida: linha do tempo + ações manuais visíveis
    await page.locator('.tabulator-row').first().click();
    await page.waitForSelector('#corpo-detalhe:not([hidden])');
    assert.ok(await page.locator('#lista-timeline .tlk-timeline-item').count() >= 2);
    assert.equal(await page.isVisible('#acoes-manuais'), true);

    // Reenviar exige confirmação inline (explicando risco de duplicidade) e após confirmar oculta ações
    await page.click('#btn-reenviar');
    await page.waitForSelector('#confirm-acao:not([hidden])');
    assert.match(await page.textContent('#confirm-texto'), /duplicidade/i);
    const qtdTimelineAntes = await page.locator('#lista-timeline .tlk-timeline-item').count();
    await page.click('#btn-confirm-executar');
    await page.waitForFunction(() => document.getElementById('detalhe-pill')?.textContent?.includes('Aceita'));
    assert.equal(await page.locator('#lista-timeline .tlk-timeline-item').count(), qtdTimelineAntes + 1);
    assert.equal(await page.isHidden('#acoes-manuais'), true, 'após virar aceita, ações manuais devem sumir');

    // Volta e testa "Dar como falha" na próxima mensagem desconhecida
    await page.click('#btn-voltar');
    await page.waitForSelector('#vista-lista:not([hidden])');
    await page.click('#btn-atualizar');
    await page.waitForSelector('.tabulator-row');
    await page.locator('.tabulator-row').first().click();
    await page.waitForSelector('#corpo-detalhe:not([hidden])');
    await page.click('#btn-dar-falha');
    await page.waitForSelector('#confirm-acao:not([hidden])');
    await page.click('#btn-confirm-executar');
    await page.waitForFunction(() => document.getElementById('detalhe-pill')?.textContent?.includes('Falhou'));
    // Estado 'falhou' mantém ações manuais disponíveis
    assert.equal(await page.isVisible('#acoes-manuais'), true);

    // Mensagem com estado 'lida' NÃO pode exibir ações manuais
    await page.goto(`${baseUrl}/mensagens.html?id=msg_ex001`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#corpo-detalhe:not([hidden])');
    assert.match(await page.textContent('#detalhe-pill'), /Lida/);
    assert.equal(await page.isHidden('#acoes-manuais'), true, 'estado lida não pode mostrar Reenviar/Dar como falha');

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G3 eventos.html: filtro por URL, linha do tempo de tentativas, corpo JSON e Reentregar inline', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    await page.goto(`${baseUrl}/eventos.html?situacao=falhando`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tabulator-row');
    assert.equal(await page.inputValue('#f-situacao'), 'falhando');
    assert.match(await page.textContent('#tabela'), /Falhando/);

    await page.locator('.tabulator-row').first().click();
    await page.waitForSelector('#corpo-detalhe:not([hidden])');
    assert.ok(await page.locator('#lista-tentativas .tlk-timeline-item').count() >= 1);
    assert.match(await page.textContent('#detalhe-corpo'), /"mensagem_id"/);

    await page.click('#btn-reentregar');
    await page.waitForSelector('#confirm-reentregar:not([hidden])');
    await page.click('#btn-confirm-executar');
    await page.waitForFunction(() => document.getElementById('detalhe-pill')?.textContent?.includes('Pendente'));

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G3 auditoria.html: carrega registros com IP mascarado, filtra por ação e abre detalhe somente leitura', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    await page.goto(`${baseUrl}/auditoria.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tabulator-row');
    const txtLista = await page.textContent('#tabela');
    assert.match(txtLista, /189\.40\.•••\.•••/);

    // Filtro por ação
    await page.selectOption('#f-acao', 'canal.');
    await page.waitForFunction(() => {
      const txt = document.getElementById('tabela')?.textContent || '';
      return txt.includes('canal.reconectar') && !txt.includes('email_envio.testado');
    });

    // Detalhe em página (somente leitura)
    await page.locator('.tabulator-row').first().click();
    await page.waitForSelector('#vista-detalhe:not([hidden])');
    assert.match(await page.textContent('#vista-detalhe'), /Somente leitura/);
    assert.match(await page.textContent('#meta-auditoria'), /189\.40\.•••\.•••/);

    await page.click('#btn-voltar');
    await page.waitForSelector('#vista-lista:not([hidden])');

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});
