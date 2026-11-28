'use strict';

// G18 (Antigravity) — testes em Playwright do uso do número e setor padrão no bloco
// Regras do canal (aba Conexão de frontend/canais.html), contra o servidor simulado
// (contratos.md §8.1):
//   - opções de Uso do número ("Só integração", "Atendimento (número só do Talk)", "Compartilhado com o IA Command");
//   - setores ativos carregados por GET /setores?situacao=ativo; campo escondido em "Só integração";
//   - aviso específico quando o uso é "Compartilhado";
//   - salvamento por PUT /canais/:id { uso, setor_padrao_id } e persistência;
//   - erros 400 destacados nos próprios campos (setor_padrao_id e uso);
//   - somente a administração da plataforma altera (campos desabilitados fora desse perfil).

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let sim;
let baseUrl;
let browser;

test.before(async () => {
  sim = criarServidorSimulado({ intervaloLogMs: 60_000, intervaloQrMs: 60_000 });
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
  return { ctx, page, erros };
}

test('G18 canais.html: uso do número, setor padrão ativo, aviso compartilhado, PUT e erros 400 nos campos', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    let chamouSetoresAtivos = false;
    let ultimoPut = null;
    let interceptarErroUso = false;
    await page.route('**/api/admin/setores*', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('situacao') === 'ativo') chamouSetoresAtivos = true;
      await route.continue();
    });
    await page.route('**/api/admin/canais/cn_suporte', async (route) => {
      if (route.request().method() === 'PUT') {
        try { ultimoPut = route.request().postDataJSON(); } catch (_) { ultimoPut = null; }
        if (interceptarErroUso) {
          interceptarErroUso = false;
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              erro: {
                codigo: 'requisicao_invalida',
                mensagem: 'Confira os campos destacados.',
                campos: { uso: 'Use integracao, atendimento, compartilhado.' },
              },
            }),
          });
          return;
        }
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#bloco-regras:not([hidden])');

    // Carregou setores ativos por GET /setores?situacao=ativo
    assert.equal(chamouSetoresAtivos, true, 'deve consultar GET /setores?situacao=ativo');

    // Opções exatas de Uso do número
    const opcoesUso = await page.locator('#r-uso option').evaluateAll((els) =>
      els.map((o) => ({ value: o.value, text: o.textContent.trim() }))
    );
    assert.deepEqual(opcoesUso, [
      { value: 'integracao', text: 'Só integração' },
      { value: 'atendimento', text: 'Atendimento (número só do Talk)' },
      { value: 'compartilhado', text: 'Compartilhado com o IA Command' },
    ]);

    // Estado inicial de cn_suporte no simulado: compartilhado + Suporte + aviso visível
    assert.equal(await page.inputValue('#r-uso'), 'compartilhado');
    assert.equal(await page.isVisible('#campo-r-setor'), true);
    assert.equal(await page.inputValue('#r-setor'), 'set_suporte');
    const nomesSetores = await page.locator('#r-setor option').evaluateAll((els) =>
      els.filter((o) => o.value).map((o) => o.textContent.trim())
    );
    assert.deepEqual(nomesSetores, ['Comercial', 'Financeiro', 'Suporte']);
    assert.equal(await page.isVisible('#r-uso-aviso-compartilhado'), true);
    assert.equal(
      (await page.textContent('#r-uso-aviso-compartilhado')).trim(),
      "Para funcionar, ligue também 'Deixar para o IA Talk atender' no canal do IA Command."
    );

    // Trocar para "Só integração": esconde o setor e o aviso, e salva uso + setor_padrao_id null
    await page.selectOption('#r-uso', 'integracao');
    assert.equal(await page.isVisible('#campo-r-setor'), false, 'setor deve ficar escondido em Só integração');
    assert.equal(await page.isVisible('#r-uso-aviso-compartilhado'), false, 'aviso só aparece em Compartilhado');
    await page.click('#btn-salvar-regras');
    await page.waitForFunction(() => document.querySelector('.tlk-toast--ok')?.textContent?.includes('Regras do canal salvas'));
    assert.equal(ultimoPut?.uso, 'integracao');
    assert.equal(ultimoPut?.setor_padrao_id, null);

    // Recarregar confirma persistência em "Só integração"
    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#bloco-regras:not([hidden])');
    assert.equal(await page.inputValue('#r-uso'), 'integracao');
    assert.equal(await page.isVisible('#campo-r-setor'), false);
    assert.equal(await page.isVisible('#r-uso-aviso-compartilhado'), false);

    // Trocar para "Atendimento (número só do Talk)" sem escolher setor -> 400 mostrado no campo setor_padrao_id
    await page.selectOption('#r-uso', 'atendimento');
    assert.equal(await page.isVisible('#campo-r-setor'), true);
    assert.equal(await page.isVisible('#r-uso-aviso-compartilhado'), false);
    assert.equal(await page.inputValue('#r-setor'), '');
    await page.click('#btn-salvar-regras');
    await page.waitForSelector('#erro-setor_padrao_id');
    assert.match(await page.textContent('#erro-setor_padrao_id'), /setor ativo/i);
    assert.equal(await page.getAttribute('#r-setor', 'aria-invalid'), 'true');
    assert.equal(await page.isVisible('#alerta-regras'), false, 'erro de campo deve aparecer no campo, não só no alerta geral');

    // Simular 400 no campo uso -> mostrado no próprio campo uso
    interceptarErroUso = true;
    await page.selectOption('#r-setor', 'set_financeiro');
    await page.click('#btn-salvar-regras');
    await page.waitForSelector('#erro-uso');
    assert.match(await page.textContent('#erro-uso'), /integracao, atendimento, compartilhado/);
    assert.equal(await page.getAttribute('#r-uso', 'aria-invalid'), 'true');

    // Salvar válido com "Atendimento" + setor Financeiro
    const respAtend = page.waitForResponse((r) => r.url().endsWith('/api/admin/canais/cn_suporte') && r.request().method() === 'PUT');
    await page.click('#btn-salvar-regras');
    assert.equal((await respAtend).status(), 200);
    await page.waitForFunction(() => !document.getElementById('erro-uso'));
    assert.equal(ultimoPut?.uso, 'atendimento');
    assert.equal(ultimoPut?.setor_padrao_id, 'set_financeiro');

    // Recarregar confirma persistência de atendimento + Financeiro
    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#bloco-regras:not([hidden])');
    assert.equal(await page.inputValue('#r-uso'), 'atendimento');
    assert.equal(await page.inputValue('#r-setor'), 'set_financeiro');
    assert.equal(await page.isVisible('#r-uso-aviso-compartilhado'), false);

    // Voltar para Compartilhado + Suporte -> aviso reaparece e salva
    await page.selectOption('#r-uso', 'compartilhado');
    assert.equal(await page.isVisible('#r-uso-aviso-compartilhado'), true);
    await page.selectOption('#r-setor', 'set_suporte');
    const respComp = page.waitForResponse((r) => r.url().endsWith('/api/admin/canais/cn_suporte') && r.request().method() === 'PUT');
    await page.click('#btn-salvar-regras');
    assert.equal((await respComp).status(), 200);
    assert.equal(ultimoPut?.uso, 'compartilhado');
    assert.equal(ultimoPut?.setor_padrao_id, 'set_suporte');

    // Sem rolagem horizontal em 1440 e 390 px
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

test('G18 canais.html: fora da administração da plataforma, uso e setor ficam somente leitura', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    await page.route('**/api/admin/sessao', async (route) => {
      const resp = await route.fetch();
      const dados = await resp.json();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...dados,
          usuario: { ...dados.usuario, administrador_plataforma: false },
        }),
      });
    });

    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#bloco-regras:not([hidden])');
    await page.waitForSelector('#regras-somente-leitura:not([hidden])');

    assert.match(await page.textContent('#regras-somente-leitura'), /Só a administração da plataforma altera estas regras/);
    assert.equal(await page.isDisabled('#r-uso'), true);
    assert.equal(await page.isDisabled('#r-setor'), true);
    assert.equal(await page.isDisabled('#btn-salvar-regras'), true);
    assert.equal(await page.inputValue('#r-uso'), 'compartilhado');
    assert.equal(await page.inputValue('#r-setor'), 'set_suporte');
    assert.equal(await page.isVisible('#r-uso-aviso-compartilhado'), true);
    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});

test('G18 canais.html: quando o atendimento pertence a outra empresa que não a logada, não mistura setores da empresa da sessão', async () => {
  const { ctx, page, erros } = await novaPagina();
  try {
    await page.route('**/api/admin/canais/cn_suporte', async (route) => {
      const resp = await route.fetch();
      const dados = await resp.json();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...dados,
          uso: 'compartilhado',
          atendimento: {
            empresa: { id: 'emp_plantivo', nome: 'Plantivo Agro (exemplo)' },
            setor_padrao: { id: 'set_plantivo_1', nome: 'Atendimento Plantivo' },
          },
        }),
      });
    });

    await page.goto(`${baseUrl}/canais.html?id=cn_suporte`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#bloco-regras:not([hidden])');

    const opcoesSetor = await page.locator('#r-setor option').evaluateAll((els) =>
      els.filter((o) => o.value).map((o) => ({ value: o.value, text: o.textContent.trim() }))
    );
    assert.deepEqual(opcoesSetor, [{ value: 'set_plantivo_1', text: 'Atendimento Plantivo' }]);
    assert.equal(await page.inputValue('#r-setor'), 'set_plantivo_1');
    assert.match(await page.textContent('#r-setor-dica'), /Plantivo Agro/);
    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
  }
});
