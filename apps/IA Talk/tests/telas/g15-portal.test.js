'use strict';

// G15 (Antigravity) — testes em Playwright para o Portal do atendente (frontend/portal.html)
// e fluxo de entrada com ?destino=atendimento (frontend/entrar.html) contra o servidor simulado:
//   - /app/ia-talk/j2a/atendimento?simular=atendente abre como Carla Souza, sem "Abrir a administração";
//   - sem ?simular=atendente (administrador), "Abrir a administração" aparece apontando para shell.html;
//   - troca de status (Disponível -> Ausente) atualiza seletor e chama PUT /atendentes/eu;
//   - POST /simulado/alerta faz alerta chegar no sino ao vivo, sobe contador e muda título da aba;
//   - Aceitar e Recusar na oferta do rodízio (cv_ex02 nasce oferecida à Carla);
//   - ?simular=401 redireciona para /app/ia-talk/j2a?destino=atendimento;
//   - sem rotina talk-atendimento mostra estado "Sem acesso ao atendimento" + botão Sair;
//   - entrar.html com ?destino=atendimento e código 123456 leva a /app/ia-talk/j2a/atendimento;
//   - zero rolagem horizontal em 1440 e 390 px.

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarServidorSimulado } = require('../../backend/simulado/servidor-simulado');

let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
});

async function criarAmbiente() {
  const sim = criarServidorSimulado({ intervaloLogMs: 5000, intervaloQrMs: 30000, intervaloConversaMs: 0 });
  const addr = await sim.iniciar(0, '127.0.0.1');
  return { sim, baseUrl: `http://127.0.0.1:${addr.port}/app/ia-talk` };
}

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

test('G15 + G22 portal (padrão recursos false): exibe selos Ainda não ativo, desabilita controles, não chama /atendentes/eu nem /alertas e zero overflow 1440/390', async () => {
  const { sim, baseUrl } = await criarAmbiente();
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    let chamadasAtendenteEu = 0;
    let chamadasAlertas = 0;
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('/api/admin/atendentes/eu')) chamadasAtendenteEu += 1;
      if (/\/api\/admin\/alertas(\?|$|\/)/.test(u)) chamadasAlertas += 1;
    });

    // 1. Atendente Carla (?simular=atendente) com recursos padrão (status_atendente, alertas_tela e alertas_whatsapp = false)
    await page.goto(`${baseUrl}/j2a/atendimento?simular=atendente`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lista-conversas .atd-conv-item');
    await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));

    assert.match(await page.textContent('#ptl-usuario-nome'), /Carla Souza/);
    assert.match(await page.textContent('#ptl-empresa-nome'), /J2A Consultoria/);
    assert.equal(await page.isVisible('#link-admin'), false, 'Atendente não deve ver "Abrir a administração"');
    assert.equal(await page.title(), 'Atendimento · J2A Consultoria');

    // G22: selos "Ainda não ativo" visíveis, dica correta e controles desabilitados em 1440 px
    for (const chave of ['status_atendente', 'alertas_tela', 'alertas_whatsapp']) {
      const selo = page.locator(`[data-selo-recurso="${chave}"]`);
      assert.equal(await selo.isVisible(), true, `selo de ${chave} deve aparecer quando false`);
      assert.equal((await selo.textContent()).trim(), 'Ainda não ativo');
      assert.equal(await selo.getAttribute('title'), 'Já pode configurar; passa a valer numa próxima atualização.');
    }
    assert.equal(await page.isDisabled('#ptl-status-select'), true);
    assert.equal(await page.isDisabled('#btn-sino'), true);
    assert.equal(await page.isDisabled('#chk-alertas-whatsapp'), true);

    // Mesmo clicando em Atualizar, não chama /atendentes/eu nem /alertas e não mostra erro
    await page.click('#btn-atualizar');
    await page.waitForTimeout(200);
    assert.equal(chamadasAtendenteEu, 0, 'não pode chamar /atendentes/eu quando status_atendente=false');
    assert.equal(chamadasAlertas, 0, 'não pode chamar /alertas quando alertas_tela=false');
    assert.equal(await page.locator('.tlk-toast--erro').count(), 0);

    // Sem rolagem horizontal em 1440 e 390 px (lista, chat e menu mobile)
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 844 });
      const med = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(med.sw <= med.iw + 1, `rolagem horizontal no portal em ${w}px: ${med.sw} > ${med.iw}`);
    }
    await page.click('#btn-menu-portal');
    assert.equal(await page.isVisible('#ptl-extras'), true);
    assert.equal(await page.locator('[data-selo-recurso="alertas_whatsapp"]').isVisible(), true);
    const medMenu = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(medMenu.sw <= medMenu.iw + 1, `rolagem horizontal com menu mobile aberto: ${medMenu.sw} > ${medMenu.iw}`);

    // 2. Administrador (sem ?simular=atendente): vê "Abrir a administração"
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/j2a/atendimento`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lista-conversas .atd-conv-item');
    assert.match(await page.textContent('#ptl-usuario-nome'), /Ana Ribeiro/);
    assert.equal(await page.isVisible('#link-admin'), true, 'Administrador deve ver "Abrir a administração"');
    assert.equal(await page.getAttribute('#link-admin', 'href'), '/app/ia-talk/shell.html');
    assert.equal(chamadasAtendenteEu, 0);
    assert.equal(chamadasAlertas, 0);

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
    await sim.fechar();
  }
});

test('G15 + G22 portal (recursos ativos via page.route): troca de status chama PUT /atendentes/eu e alertas via POST /simulado/alerta atualizam sino e título', async () => {
  const { sim, baseUrl } = await criarAmbiente();
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    await page.route('**/api/admin/atendimento/recursos*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          menu: true,
          midia: true,
          status_atendente: true,
          rodizio: true,
          alertas_tela: true,
          alertas_whatsapp: true,
          escalonamento: true,
          pesquisa: true,
          inatividade: true,
          sla: true,
        }),
      });
    });

    let putStatusPayload = null;
    await page.route('**/api/admin/atendentes/eu*', async (route) => {
      if (route.request().method() === 'PUT') {
        putStatusPayload = route.request().postDataJSON();
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/j2a/atendimento`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lista-conversas .atd-conv-item');
    await page.waitForFunction(() => document.getElementById('rt-texto')?.textContent?.includes('Tempo real ativo'));

    // Com tudo true, nenhum selo "Ainda não ativo" aparece e os controles ficam habilitados
    assert.equal(await page.locator('[data-selo-recurso]:visible').count(), 0);
    assert.equal(await page.isDisabled('#ptl-status-select'), false);
    assert.equal(await page.isDisabled('#btn-sino'), false);
    assert.equal(await page.isDisabled('#chk-alertas-whatsapp'), false);

    // Status inicial da Ana é 'disponivel' -> troca para 'ausente'
    assert.equal(await page.inputValue('#ptl-status-select'), 'disponivel');
    await page.selectOption('#ptl-status-select', 'ausente');
    await page.waitForFunction(() => document.getElementById('ptl-status-dot')?.classList.contains('ptl-status-dot--ausente'));
    assert.deepEqual(putStatusPayload, { status: 'ausente' });
    assert.equal(await page.inputValue('#ptl-status-select'), 'ausente');

    // Toggle alertas_whatsapp também chama PUT /atendentes/eu
    await page.check('#chk-alertas-whatsapp');
    await page.waitForFunction(() => document.getElementById('chk-alertas-whatsapp')?.checked === true);
    assert.deepEqual(putStatusPayload, { alertas_whatsapp: true });

    // Dispara alerta ao vivo via POST /api/admin/simulado/alerta
    const statusAlerta = await page.evaluate(async () => {
      const r = await fetch('/app/ia-talk/api/admin/simulado/alerta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversa_id: 'cv_ex03', tipo: 'nova_na_fila' }),
      });
      return r.status;
    });
    assert.equal(statusAlerta, 201);

    // Contador no sino sobe para 1 e título da aba vira "(1) Atendimento · J2A Consultoria"
    await page.waitForSelector('#ptl-sino-badge:not([hidden])');
    assert.equal((await page.textContent('#ptl-sino-badge')).trim(), '1');
    assert.equal(await page.title(), '(1) Atendimento · J2A Consultoria');

    // Abre sino, confere alerta e clica nele -> abre cv_ex03 e zera o contador/título
    await page.click('#btn-sino');
    await page.waitForSelector('#popover-alertas:not([hidden])');
    assert.match(await page.textContent('#lista-alertas'), /2026-000103/);
    await page.locator('#lista-alertas [data-alerta-id]').first().click();

    await page.waitForFunction(() => document.getElementById('chat-nome')?.textContent?.includes('Fernanda Costa'));
    assert.equal(await page.isHidden('#ptl-sino-badge'), true);
    assert.equal(await page.title(), 'Atendimento · J2A Consultoria');

    // Novo alerta + "Marcar todos como lidos"
    await page.evaluate(async () => {
      await fetch('/app/ia-talk/api/admin/simulado/alerta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversa_id: 'cv_ex05', tipo: 'espera_longa' }),
      });
    });
    await page.waitForSelector('#ptl-sino-badge:not([hidden])');
    await page.click('#btn-sino');
    await page.click('#btn-marcar-todos-lidos');
    await page.waitForFunction(() => document.getElementById('ptl-sino-badge')?.hidden === true);
    assert.equal(await page.title(), 'Atendimento · J2A Consultoria');

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
    await sim.fechar();
  }
});

test('G15 oferta do rodízio: Aceitar (cv_ex02) e Recusar (cv_ex02) funcionam para Carla', async () => {
  // Parte A: Aceitar oferta (cv_ex02 nasce oferecida à Carla)
  {
    const { sim, baseUrl } = await criarAmbiente();
    const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
    try {
      await page.goto(`${baseUrl}/j2a/atendimento?simular=atendente&conversa=cv_ex02`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#banner-oferta:not([hidden])');
      const txtOferta = await page.textContent('#banner-oferta');
      assert.match(txtOferta, /2026-000102/);
      assert.match(txtOferta, /Suporte/);
      assert.match(await page.textContent('#oferta-contagem'), /^\d{2}:\d{2}$/);
      assert.equal(await page.isVisible('#btn-oferta-aceitar'), true);
      assert.equal(await page.isVisible('#btn-oferta-recusar'), true);

      await page.click('#btn-oferta-aceitar');
      await page.waitForFunction(() => document.getElementById('chat-sub')?.textContent?.includes('Com Carla Souza'));
      assert.equal(await page.isHidden('#banner-oferta'), true);
      assert.deepEqual(erros, []);
    } finally {
      await ctx.close();
      await sim.fechar();
    }
  }

  // Parte B: Recusar oferta (passa para Bruno Lima e remove os botões de aceite da Carla)
  {
    const { sim, baseUrl } = await criarAmbiente();
    const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
    try {
      await page.goto(`${baseUrl}/j2a/atendimento?simular=atendente&conversa=cv_ex02`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#btn-oferta-recusar');

      await page.click('#btn-oferta-recusar');
      await page.waitForFunction(() => document.getElementById('banner-oferta')?.textContent?.includes('Oferecida a Bruno Lima'));
      assert.equal(await page.locator('#btn-oferta-aceitar').count(), 0, 'Oferta de outra pessoa não mostra botão Aceitar');
      assert.equal(await page.locator('#btn-oferta-recusar').count(), 0, 'Oferta de outra pessoa não mostra botão Recusar');

      // Tentar assumir oferta de outro atendente exibe a mensagem do 409
      await page.click('#btn-assumir');
      await page.waitForSelector('#alerta-conversa:not([hidden])');
      assert.match(await page.textContent('#alerta-conversa-texto'), /Bruno Lima/i);

      assert.equal(erros.filter((e) => !/409|status of/.test(e)).length, 0, `erros inesperados: ${erros.join('; ')}`);
    } finally {
      await ctx.close();
      await sim.fechar();
    }
  }
});

test('G15 acesso: ?simular=401 redireciona para /app/ia-talk/j2a?destino=atendimento; sem rotina talk-atendimento mostra Sem acesso', async () => {
  const { sim, baseUrl } = await criarAmbiente();
  const { ctx, page } = await novaPagina({ width: 1440, height: 900 });
  try {
    // 1. 401 redireciona para o login da empresa com ?destino=atendimento
    await page.goto(`${baseUrl}/j2a/atendimento?simular=401`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL((url) => url.pathname === '/app/ia-talk/j2a' && url.searchParams.get('destino') === 'atendimento', { timeout: 10000 });
    assert.equal(new URL(page.url()).pathname, '/app/ia-talk/j2a');
    assert.equal(new URL(page.url()).searchParams.get('destino'), 'atendimento');

    // 2. Sem a rotina talk-atendimento no GET /sessao -> estado "Sem acesso ao atendimento" + botão Sair
    await page.route('**/api/admin/sessao*', async (route) => {
      const resp = await route.fetch();
      const dados = await resp.json();
      dados.rotinas = ['talk-painel'];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dados) });
    });

    await page.goto(`${baseUrl}/j2a/atendimento`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#estado-global:not([hidden])');
    const txtEstado = await page.textContent('#estado-global');
    assert.match(txtEstado, /Sem acesso ao atendimento/);
    assert.match(txtEstado, /Peça ao administrador da empresa para liberar o atendimento para você\./);
    assert.equal(await page.isVisible('#portal-header'), false);
    assert.equal(await page.locator('#estado-global button', { hasText: 'Sair' }).isVisible(), true);
  } finally {
    await ctx.close();
    await sim.fechar();
  }
});

test('G15 entrar.html?destino=atendimento: código 123456 leva para /app/ia-talk/j2a/atendimento e bloqueia destinos inválidos', async () => {
  const { sim, baseUrl } = await criarAmbiente();
  const { ctx, page, erros } = await novaPagina({ width: 1440, height: 900 });
  try {
    let payloadConfirmar = null;
    await page.route('**/api/publico/login/confirmar*', async (route) => {
      payloadConfirmar = route.request().postDataJSON();
      await route.continue();
    });

    // 1. ?destino=atendimento -> envia destino: 'atendimento' e redireciona para o portal
    await page.goto(`${baseUrl}/j2a?destino=atendimento`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#form-telefone:not([hidden])');
    await page.fill('#c-telefone', '65999990001');
    await page.click('#btn-enviar');
    await page.waitForSelector('#form-codigo:not([hidden])');

    for (let i = 0; i < 6; i++) {
      await page.fill(`#cod-${i}`, String(i + 1));
    }
    await page.click('#btn-confirmar');
    await page.waitForURL((url) => url.pathname === '/app/ia-talk/j2a/atendimento', { timeout: 10000 });
    assert.equal(payloadConfirmar?.destino, 'atendimento');
    assert.equal(new URL(page.url()).pathname, '/app/ia-talk/j2a/atendimento');

    // 2. ?destino=https://externo.exemplo -> NUNCA repassa outro valor ou URL
    payloadConfirmar = null;
    await page.goto(`${baseUrl}/j2a?destino=https://externo.exemplo`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#form-telefone:not([hidden])');
    await page.fill('#c-telefone', '65999990001');
    await page.click('#btn-enviar');
    await page.waitForSelector('#form-codigo:not([hidden])');
    for (let i = 0; i < 6; i++) {
      await page.fill(`#cod-${i}`, String(i + 1));
    }
    await page.click('#btn-confirmar');
    await page.waitForURL((url) => url.pathname === '/app/ia-talk/shell.html', { timeout: 10000 });
    assert.equal(payloadConfirmar?.destino, undefined);

    assert.deepEqual(erros, []);
  } finally {
    await ctx.close();
    await sim.fechar();
  }
});
