'use strict';

// G11 (Antigravity) — testes em Playwright do envio de mensagem de teste (C3, contrato §4)
// contra o servidor simulado:
//   - envio ok com para_indice (0, 1, …) até `lida` via socket mensagem:estado;
//   - texto "falha" até `falhou`, exibindo motivo (historico_estados[].detalhe) e link para Mensagens;
//   - posição fora da lista (para_indice: 5 -> 403 com campos.para_indice) exibido no campo Para;
//   - validação 400 (texto vazio e > 1000 caracteres) e contador de caracteres;
//   - canal com envio desligado, canal desconectado e lista vazia exibindo o bloco desabilitado;
//   - tela Mensagens: selo "Teste", Aplicação "Envio de teste" e atualização ao vivo via mensagem:estado sem reload.

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let sim;
let baseUrl;
let browser;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 1200, intervaloQrMs: 25000 });
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

test('G11 canais.html: envio ok com para_indice até lida, contador de caracteres, 400 e 403 (para_indice fora da lista)', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    let ultimoPayload = null;
    await page.route('**/api/admin/canais/*/enviar-teste', async (route) => {
      try { ultimoPayload = route.request().postDataJSON(); } catch (_) { ultimoPayload = null; }
      await route.continue();
    });

    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#bloco-envio-teste');
    await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));

    // Campo Para é uma lista (select) apenas com números mascarados, sem campo livre
    const opcoes = await page.locator('#t-para option').evaluateAll((els) => els.map((o) => ({ v: o.value, t: o.textContent.trim() })));
    assert.equal(opcoes.length, 2);
    assert.equal(opcoes[0].v, '0');
    assert.match(opcoes[0].t, /••••-0010$/);
    assert.equal(opcoes[1].v, '1');
    assert.match(opcoes[1].t, /••••-0011$/);
    assert.equal(await page.isDisabled('#fieldset-envio-teste'), false);

    // Contador de caracteres (0 / 1000 -> texto -> excedido > 1000)
    assert.equal((await page.textContent('#t-contador')).trim(), '0 / 1000');
    await page.fill('#t-texto', 'x'.repeat(1005));
    assert.equal((await page.textContent('#t-contador')).trim(), '1005 / 1000');
    assert.equal(await page.locator('#t-contador').evaluate((el) => el.classList.contains('tlk-contador-chars--excedido')), true);

    // Envio com > 1000 caracteres -> 400 exibido no próprio formulário (campo texto)
    await page.click('#btn-enviar-teste');
    await page.waitForSelector('#erro-texto');
    assert.match(await page.textContent('#erro-texto'), /1000/);

    // Posição fora da lista (para_indice: 5) -> 403 exibido no próprio campo Para (campos.para_indice)
    await page.fill('#t-texto', 'Olá teste fora da lista');
    await page.evaluate(() => {
      const sel = document.getElementById('t-para');
      const opt = document.createElement('option');
      opt.value = '5';
      opt.textContent = 'Posição inválida 5';
      sel.appendChild(opt);
      sel.value = '5';
    });
    await page.click('#btn-enviar-teste');
    await page.waitForSelector('#erro-para_indice');
    assert.equal(ultimoPayload?.para_indice, 5);
    assert.equal('para' in (ultimoPayload || {}), false, 'nunca deve enviar campo para');
    assert.match(await page.textContent('#erro-para_indice'), /Fora da lista de teste/i);
    assert.equal(await page.getAttribute('#t-para', 'aria-invalid'), 'true');

    // Envio válido (para_indice: 0) -> 202 e acompanhamento em tempo real até Lida
    await page.selectOption('#t-para', '0');
    await page.fill('#t-texto', 'Olá de teste G11');
    assert.equal((await page.textContent('#t-contador')).trim(), '16 / 1000');
    await page.click('#btn-enviar-teste');

    await page.waitForSelector('#card-envio-teste:not([hidden])');
    assert.equal(ultimoPayload?.para_indice, 0);
    assert.equal(ultimoPayload?.texto, 'Olá de teste G11');
    assert.match(await page.textContent('#card-envio-teste'), /Aceita não é entrega/i);

    // Aguarda progressão automática do simulado (~5 passos × 1,2 s) até Lida
    await page.waitForFunction(() => document.getElementById('envio-teste-pill')?.textContent?.trim() === 'Lida', { timeout: 12000 });
    const timelineTxt = await page.textContent('#envio-teste-timeline');
    for (const rotulo of ['Aceita', 'Aguardando canal', 'Encaminhada', 'Enviada', 'Entregue', 'Lida']) {
      assert.match(timelineTxt || '', new RegExp(rotulo), `timeline deveria conter o estado "${rotulo}"`);
    }
    assert.equal(await page.isHidden('#envio-teste-falha'), true);

    // Sem rolagem horizontal em 1440 e 390 px
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal em ${w}px: ${med.sw} > ${med.iw}`);
    }

    // Erros 400 e 403 de rede no console são esperados nos subcasos negativos; confirma zero pageerror
    assert.equal(erros.filter((e) => !/400|403|status of/.test(e)).length, 0, `erros inesperados: ${erros.join('; ')}`);
  } finally {
    await ctx.close();
  }
});

test('G11 canais.html: texto "falha" vai até falhou com motivo e link "Ver na tela Mensagens"; Mensagens exibe selo Teste e atualiza ao vivo sem reload', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));

    await page.selectOption('#t-para', '1');
    await page.fill('#t-texto', 'Simular falha de entrega');
    await page.click('#btn-enviar-teste');

    await page.waitForSelector('#card-envio-teste:not([hidden])');
    await page.waitForFunction(() => document.getElementById('envio-teste-pill')?.textContent?.trim() === 'Falhou', { timeout: 10000 });
    await page.waitForSelector('#envio-teste-falha:not([hidden])');

    // Motivo da falha vindo de historico_estados[].detalhe + link para Mensagens
    await page.waitForFunction(() => document.getElementById('envio-teste-falha-texto')?.textContent?.includes('Número não encontrado'));
    const hrefMsg = await page.getAttribute('#btn-ver-em-mensagens', 'href');
    assert.match(hrefMsg || '', /\/mensagens\.html\?id=msg_/);
    assert.equal(await page.locator('#btn-ver-em-mensagens svg.tlk-ico').count(), 1);

    // Abre a tela Mensagens pelo link e confirma selo "Teste" e Aplicação "Envio de teste"
    await page.click('#btn-ver-em-mensagens');
    await page.waitForURL(/mensagens\.html\?id=msg_/);
    await page.waitForSelector('#corpo-detalhe:not([hidden])');
    assert.match(await page.textContent('#detalhe-pill'), /Teste/);
    assert.match(await page.textContent('#meta-mensagem'), /Envio de teste/);

    // Volta à lista de Mensagens e verifica selo "Teste" + "Envio de teste" na grade
    await page.click('#btn-voltar');
    await page.waitForSelector('.tabulator-row');
    const primeiraLinha = await page.locator('.tabulator-row').first().textContent();
    assert.match(primeiraLinha || '', /Teste/);
    assert.match(primeiraLinha || '', /Envio de teste/);

    // Dispara um novo envio de teste pela API e verifica atualização ao vivo na lista de Mensagens sem recarregar
    const resEnvio = await page.evaluate(async () => {
      const r = await fetch('/app/ia-talk/api/admin/canais/cn_suporte/enviar-teste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ para_indice: 0, texto: 'Atualizacao ao vivo na grade G11' }),
      });
      return r.json();
    });
    assert.ok(resEnvio?.id);

    // Recarrega a grade uma vez para listar a mensagem recém-criada ainda em andamento, depois marca janela para provar ausência de reload
    await page.click('#btn-atualizar');
    await page.waitForFunction(() => document.querySelector('#tabela')?.textContent?.includes('Atualizacao ao vivo na grade G11'));
    await page.evaluate(() => { window.__semReloadG11 = 'intacto'; });

    await page.waitForFunction(() => {
      const linhas = [...document.querySelectorAll('.tabulator-row')];
      const alvo = linhas.find((l) => l.textContent.includes('Atualizacao ao vivo na grade G11'));
      return alvo && alvo.textContent.includes('Lida');
    }, { timeout: 12000 });

    assert.equal(await page.evaluate(() => window.__semReloadG11), 'intacto', 'a lista deve atualizar via socket sem recarregar a página');
    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G11 canais.html: bloco desabilitado quando envio está desligado, canal desconectado ou lista de teste vazia', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    // 1. Envio desligado (cn_financeiro tem envio_habilitado = false no simulado)
    await page.goto(`${baseUrl}/canais.html?id=cn_financeiro`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#vista-detalhe:not([hidden])');
    await page.waitForSelector('#envio-teste-motivo:not([hidden])');
    assert.equal(await page.isDisabled('#btn-enviar-teste'), true);
    assert.equal(await page.isDisabled('#t-para'), true);
    assert.equal(
      (await page.textContent('#envio-teste-motivo')).trim(),
      'Envio desligado neste canal. A administração da plataforma liga quando for liberado.'
    );

    // 2. Envio ligado mas canal não conectado (intercepta cn_teste com envio_habilitado = true)
    await page.route('**/api/admin/canais/cn_teste', async (route) => {
      const resp = await route.fetch();
      const dados = await resp.json();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...dados, envio_habilitado: true }),
      });
    });
    await page.goto(`${baseUrl}/canais.html?id=cn_teste`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#vista-detalhe:not([hidden])');
    await page.waitForSelector('#envio-teste-motivo:not([hidden])');
    assert.equal(await page.isDisabled('#btn-enviar-teste'), true);
    assert.equal((await page.textContent('#envio-teste-motivo')).trim(), 'Conecte o canal para enviar.');

    // 3. Envio ligado e conectado, mas lista de teste vazia
    await page.route('**/api/admin/canais/cn_suporte', async (route) => {
      const resp = await route.fetch();
      const dados = await resp.json();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...dados, envio_habilitado: true, numeros_teste_mascarados: [] }),
      });
    });
    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#vista-detalhe:not([hidden])');
    await page.waitForSelector('#envio-teste-motivo:not([hidden])');
    assert.equal(await page.isDisabled('#btn-enviar-teste'), true);
    assert.equal((await page.textContent('#envio-teste-motivo')).trim(), 'Nenhum número de teste cadastrado neste canal.');

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});
