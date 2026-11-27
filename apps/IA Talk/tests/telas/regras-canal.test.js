'use strict';

// Regras do canal (C3) na aba Conexão, contra o servidor simulado (sessão da plataforma):
// envio e recebimento separados, confirmação ao liberar, lista de teste por posição.

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let sim; let baseUrl; let browser;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 60_000, intervaloQrMs: 60_000 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${addr.port}/app/ia-talk`;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await sim?.fechar(); });

test('Regras do canal: liberar pede confirmação, lista por posição, nada de número completo', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  try {
    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#bloco-regras:not([hidden])');
    assert.equal(await page.inputValue('#r-envio'), 'teste');
    assert.equal(await page.inputValue('#r-recebimento'), 'teste');
    assert.equal(await page.isEnabled('#btn-salvar-regras'), true, 'sessão simulada é da plataforma');
    assert.match(await page.textContent('#regras-badge'), /só para teste/);

    // A aba Conexão passa da altura da janela: a página precisa rolar (iahub.css trava o body).
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 3000);
    await page.waitForFunction(() => Math.max(document.body.scrollTop, document.documentElement.scrollTop) > 0);
    const caixa = await page.locator('#btn-salvar-regras').boundingBox();
    assert.ok(caixa && caixa.y >= 0 && caixa.y + caixa.height <= 900, 'Salvar regras alcançável pela rolagem');

    // Liberar envio para qualquer número: confirmação antes de gravar.
    await page.selectOption('#r-envio', 'qualquer');
    assert.match(await page.textContent('#r-envio-dica'), /qualquer número/);
    await page.click('#btn-salvar-regras');
    await page.waitForSelector('#regras-confirmar:not([hidden])');
    assert.match(await page.textContent('#regras-confirmar-texto'), /qualquer número/);
    await page.click('#btn-regras-cancelar');
    assert.equal(await page.isHidden('#regras-confirmar'), true);
    await page.click('#btn-salvar-regras');
    await page.click('#btn-regras-confirmar');
    await page.waitForFunction(() => document.getElementById('regras-badge')?.textContent?.includes('Envio liberado'));

    // Lista de teste: remove o 1º pela posição e inclui um novo digitado.
    await page.click('#r-lista [data-r-alternar="0"]');
    await page.fill('#r-novo-numero', '5565999990077');
    await page.click('#btn-r-incluir');
    assert.match(await page.textContent('#r-lista'), /0077 novo/);
    await page.click('#btn-salvar-regras'); // nada a liberar: salva direto
    await page.waitForFunction(() => !document.querySelector('#r-lista .tlk-regras-item--novo'));
    const lista = await page.textContent('#r-lista');
    assert.match(lista, /-0011/);
    assert.match(lista, /-0077/);
    assert.doesNotMatch(lista, /-0010/, 'removido pela posição');
    assert.equal((await page.content()).includes('5565999990077'), false, 'número completo some da tela depois de salvo');

    // Número inválido não entra.
    await page.fill('#r-novo-numero', '123');
    await page.click('#btn-r-incluir');
    assert.match(await page.textContent('#alerta-regras'), /DDI e DDD/);
    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});
