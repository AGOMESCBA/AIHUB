'use strict';

// G14 (Antigravity) — testes em Playwright para frontend/setores.html (rotina talk-setores, §8.3)
// contra o servidor simulado (backend/simulado/atendimento.js):
//   - Menu talk-sidebar.js com talk-setores (etapa: null, liberado com a C9 real em 27/11);
//   - Setores: criar com código automático (e código somente leitura depois de criado),
//     membros ativos, horário com vários intervalos no mesmo dia, mensagem de fora do
//     horário nascendo desligada, edição com versão e inativação exibindo mensagens de 409;
//   - Respostas rápidas: atalho com "/", gerais ou de um setor, variáveis {nome_contato} e
//     {nome_atendente} com prévia ao vivo, filtro por escopo e inativar/reativar;
//   - Ícones/dicas G10 e layout sem rolagem horizontal em 1440, 1024, 390 e 360 px.

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
  sim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000, intervaloConversaMs: 0 });
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
  page.on('pageerror', (err) => erros.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  return { ctx, page, erros };
}

test('G14 talk-sidebar.js: talk-setores cadastrado apontando para setores.html liberado no menu (etapa null, C9 real)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/js/talk-sidebar.js'), 'utf8');
  assert.match(src, /id:\s*'talk-setores'[^\n]*setores\.html[^\n]*etapa:\s*null/);
});

test('G14 setores.html: criar setor (código fixo depois, membros, 2 intervalos/dia, fora do horário desligado) e 409 ao inativar', async () => {
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    await page.goto(`${baseUrl}/setores.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lista-setores .g14-card');

    const txtInicial = await page.textContent('#lista-setores');
    assert.match(txtInicial, /Suporte/);
    assert.match(txtInicial, /Financeiro/);
    assert.match(txtInicial, /Comercial/);

    // 1. Tenta inativar Suporte (tem conversas abertas) -> exibe a mensagem do 409
    await page.click('[data-pedir-inativar-setor="set_suporte"]');
    await page.click('[data-confirmar-inativar-setor="set_suporte"]');
    await page.waitForSelector('#alerta-lista-setores:not([hidden])');
    assert.match(await page.textContent('#alerta-lista-setores'), /conversas abertas/i);

    // 2. Abre Novo setor e confere que mensagem de fora do horário nasce desligada
    await page.click('#btn-novo-setor');
    await page.waitForSelector('#vista-setor:not([hidden])');
    assert.equal(await page.isChecked('#s-fh-ligado'), false, 'mensagem de fora do horário deve nascer desligada');
    assert.equal(await page.locator('#s-codigo').evaluate((el) => el.readOnly), false, 'código editável na criação');

    // Preenche nome (código vazio -> nasce fiscal-e-tributos), descrição, membros e 2 intervalos na segunda
    await page.fill('#s-nome', 'Fiscal e Tributos');
    await page.fill('#s-descricao', 'Notas fiscais e impostos.');
    assert.match(await page.textContent('#dica-codigo'), /fiscal-e-tributos/);

    // Marca os dois primeiros usuários ativos como membros
    const checksMembros = page.locator('#lista-membros input[type="checkbox"]');
    assert.ok((await checksMembros.count()) >= 2);
    await checksMembros.nth(0).check();
    await checksMembros.nth(1).check();

    // Liga horário e adiciona 2 intervalos na segunda-feira (dia 1): 08:00-12:00 e 13:00-18:00
    await page.check('#s-hor-ligado');
    await page.click('[data-add-intervalo="1"]');
    await page.click('[data-add-intervalo="1"]');
    assert.equal(await page.locator('[data-dia-row="1"] .g14-intervalo').count(), 2);

    // Verifica responsividade no editor de setor em 1440, 1024, 390 e 360 px
    for (const w of [1440, 1024, 390, 360]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal no editor de setor em ${w}px: ${med.sw} > ${med.iw}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.click('#btn-salvar-setor');
    await page.waitForSelector('#vista-principal:not([hidden])');
    await page.waitForFunction(() => document.getElementById('lista-setores')?.textContent?.includes('Fiscal e Tributos'));
    const cardNovo = page.locator('#lista-setores .g14-card', { hasText: 'Fiscal e Tributos' });
    const txtNovo = await cardNovo.textContent();
    assert.match(txtNovo, /fiscal-e-tributos/);
    assert.match(txtNovo, /2 intervalo\(s\)/);
    assert.match(txtNovo, /Aviso fora do horário desligado/i);

    // 3. Abre para edição e confirma que o código ficou somente leitura
    const idNovo = await cardNovo.getAttribute('data-setor-id');
    await page.click(`[data-editar-setor="${idNovo}"]`);
    await page.waitForSelector('#vista-setor:not([hidden])');
    assert.equal(await page.locator('#s-codigo').evaluate((el) => el.readOnly), true, 'código deve ser somente leitura após criado');
    assert.equal(await page.inputValue('#s-codigo'), 'fiscal-e-tributos');

    // Liga fora do horário com texto e salva atualização
    await page.check('#s-fh-ligado');
    await page.fill('#s-fh-texto', 'O setor Fiscal atende das 8h às 18h. Sua mensagem foi registrada.');
    await page.click('#btn-salvar-setor');
    await page.waitForSelector('#vista-principal:not([hidden])');
    await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll('#lista-setores .g14-card')];
      const alvo = cards.find((c) => c.textContent.includes('Fiscal e Tributos'));
      return alvo?.textContent?.includes('Aviso fora do horário ligado');
    });

    // 4. Inativa o setor sem conversas abertas -> sucesso; depois reativa
    await page.click(`[data-pedir-inativar-setor="${idNovo}"]`);
    await page.click(`[data-confirmar-inativar-setor="${idNovo}"]`);
    await page.waitForSelector(`[data-reativar-setor="${idNovo}"]`);
    await page.click(`[data-reativar-setor="${idNovo}"]`);
    await page.waitForSelector(`[data-pedir-inativar-setor="${idNovo}"]`);

    // 5. Simula 409 de setor padrão de canal ao inativar -> exibe mensagem exata do 409
    await page.route(`**/api/admin/setores/${idNovo}`, async (route) => {
      if (route.request().method() === 'PUT') {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            erro: {
              codigo: 'conflito',
              mensagem: 'Este setor recebe as conversas novas de um canal. Troque o setor padrão do canal antes de inativar.',
            },
          }),
        });
      }
      return route.continue();
    });
    await page.click(`[data-pedir-inativar-setor="${idNovo}"]`);
    await page.click(`[data-confirmar-inativar-setor="${idNovo}"]`);
    await page.waitForSelector('#alerta-lista-setores:not([hidden])');
    assert.match(await page.textContent('#alerta-lista-setores'), /setor padrão do canal/i);

    // Ignora apenas os erros HTTP 409 intencionalmente provocados no teste
    assert.equal(erros.filter((e) => !/409|status of/.test(e)).length, 0, `erros inesperados: ${erros.join('; ')}`);
  } finally {
    await ctx.close();
  }
});

test('G14 setores.html: respostas rápidas com "/", gerais ou de um setor, variáveis, ícones G10 e responsividade', async () => {
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    await page.goto(`${baseUrl}/setores.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lista-setores .g14-card');

    // Troca para a aba Respostas rápidas
    await page.click('#tab-respostas');
    await page.waitForSelector('#lista-respostas .g14-card');
    const txtRespostas = await page.textContent('#lista-respostas');
    assert.match(txtRespostas, /\/saudacao/);
    assert.match(txtRespostas, /\/boleto/);

    // Filtra somente gerais
    await page.selectOption('#fr-escopo', '__geral__');
    const txtGerais = await page.textContent('#lista-respostas');
    assert.match(txtGerais, /\/saudacao/);
    assert.equal(txtGerais.includes('/boleto'), false, '/boleto é do setor Financeiro, não deve aparecer no filtro Gerais');
    await page.selectOption('#fr-escopo', '');

    // Cria resposta rápida geral com variáveis {nome_contato} e {nome_atendente}
    await page.click('#btn-nova-resposta');
    await page.waitForSelector('#vista-resposta:not([hidden])');
    await page.fill('#r-atalho', '/horario-geral');
    await page.fill('#r-titulo', 'Horário de expediente');
    await page.fill('#r-texto', 'Olá, ');
    await page.click('[data-inserir-var="{nome_contato}"]');
    await page.locator('#r-texto').pressSequentially('! Aqui é ');
    await page.click('[data-inserir-var="{nome_atendente}"]');
    await page.locator('#r-texto').pressSequentially('. Atendemos das 8h às 18h.');

    // Confirma prévia ao vivo
    await page.waitForSelector('#box-previa-rr:not([hidden])');
    const previa = await page.textContent('#previa-rr-corpo');
    assert.match(previa, /Mariana Oliveira/);
    assert.match(previa, /Carla Souza/);

    await page.click('#btn-salvar-resposta');
    await page.waitForSelector('#vista-principal:not([hidden])');
    await page.waitForFunction(() => document.getElementById('lista-respostas')?.textContent?.includes('/horario-geral'));

    // Cria resposta rápida vinculada ao setor Financeiro
    await page.click('#btn-nova-resposta');
    await page.waitForSelector('#vista-resposta:not([hidden])');
    await page.fill('#r-atalho', '/pix-fin');
    await page.fill('#r-titulo', 'Dados para PIX');
    await page.selectOption('#r-setor', 'set_financeiro');
    await page.fill('#r-texto', 'Segue a chave PIX do Financeiro para baixa imediata.');
    await page.click('#btn-salvar-resposta');
    await page.waitForSelector('#vista-principal:not([hidden])');
    await page.waitForFunction(() => document.getElementById('lista-respostas')?.textContent?.includes('/pix-fin'));

    const cardPix = page.locator('#lista-respostas .g14-card', { hasText: '/pix-fin' });
    assert.match(await cardPix.textContent(), /Setor:\s*Financeiro/);

    // Inativa e reativa a resposta rápida /pix-fin
    const idPix = await cardPix.getAttribute('data-resposta-id');
    await page.click(`[data-alternar-resposta="${idPix}"][data-nova-situacao="inativa"]`);
    await page.waitForSelector(`[data-alternar-resposta="${idPix}"][data-nova-situacao="ativa"]`);
    await page.click(`[data-alternar-resposta="${idPix}"][data-nova-situacao="ativa"]`);
    await page.waitForSelector(`[data-alternar-resposta="${idPix}"][data-nova-situacao="inativa"]`);

    // Confere ícones G10 (SVG + title + aria-label) nos botões visíveis
    const botoes = await page.locator('#vista-principal button.btn:visible').evaluateAll((els) => els.map((b) => ({
      temSvg: !!b.querySelector('svg.tlk-ico'),
      title: (b.getAttribute('title') || '').trim(),
      aria: (b.getAttribute('aria-label') || '').trim(),
    })));
    assert.ok(botoes.length >= 4);
    for (const b of botoes) {
      assert.equal(b.temSvg, true);
      assert.ok(b.title.length >= 8);
      assert.ok(b.aria.length >= 8);
    }

    // Sem rolagem horizontal em 1440, 1024, 390 e 360 px
    for (const w of [1440, 1024, 390, 360]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal na lista em ${w}px: ${med.sw} > ${med.iw}`);
    }

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});
