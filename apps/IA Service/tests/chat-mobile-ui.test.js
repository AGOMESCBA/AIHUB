// node --test "apps/IA Service/tests/chat-mobile-ui.test.js"
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const playwright = require('playwright');
const root = path.resolve(__dirname, '../frontend/j2a');
let browser;
before(async () => { browser = await playwright[process.env.QA_BROWSER || 'chromium'].launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function abrir(viewport, { readonly = false, visualViewportMock = false } = {}) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width <= 900, hasTouch: viewport.width <= 900 });
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      requests.push({ path: url.pathname, method: route.request().method() });
      let data = {};
      const ticket = { id: 'ticket1', numero: '123456', titulo: 'Chamado mobile', descricao: 'Descrição extensa. '.repeat(50), clienteNome: 'Teste' };
      if (url.pathname.endsWith('/whoami')) data = { empresaNome: 'Teste', consultorNome: 'Consultor' };
      if (url.pathname.endsWith('/fila')) data = { chamados: [ticket] };
      if (url.pathname.endsWith('/risco-sla')) data = { consultores: [], chamados: [ticket] };
      if (url.pathname.endsWith('/abrir-atendimento')) data = { atendimentoId: 'a1', chamado: ticket, somenteLeitura: readonly };
      if (url.pathname.endsWith('/mensagens')) data = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, papel: 'assistant', texto: `Mensagem ${i}\n${'Resposta de teste. '.repeat(35)}`, criadoEm: '2026-10-30T12:00:00Z' }));
      if (url.pathname.endsWith('/anexos')) data = [];
      if (url.pathname.endsWith('/anexos') && route.request().method() === 'POST') data = { id: 'anexo1' };
      if (url.pathname.endsWith('/trilha')) data = { trilha: [] };
      if (url.pathname.endsWith('/retorno')) data = { disponivel: true };
      if (url.pathname.endsWith('/contatos')) data = { destinatariosTransmissao: 1, contatos: [{ consultorId: 'colega', nome: 'Colega com nome muito longo para uma tela pequena', conversaId: 'c1' }] };
      if (url.pathname.includes('/conversas/') && url.pathname.endsWith('/mensagens')) data = { mensagens: [{ id: 'interna', conversaId: 'c1', minha: true, texto: 'Mensagem da equipe', criadoEm: '2026-10-30T12:00:00Z' }], contato: { nome: 'Colega' } };
      return route.fulfill({ json: data });
    }
    if (url.pathname.includes('/socket.io/')) return route.fulfill({ contentType: 'text/javascript', body: 'window.io=()=>({connected:true,on(){},emit(){},disconnect(){}});' });
    const rel = url.pathname.replace(/^\/iaservice\/(?:j2a\/)?assets\//, 'assets/');
    const filename = path.resolve(root, rel === '/iaservice/j2a/' ? 'index.html' : rel);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(filename) });
  });
  await page.addInitScript(({ visualViewportMock }) => {
    localStorage.setItem('svc_token_externo', 'teste-mobile');
    if (visualViewportMock) {
      const viewport = new EventTarget();
      Object.assign(viewport, { height: 844, offsetTop: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { value: viewport });
    }
  }, { visualViewportMock });
  await page.goto('http://mobile.test/iaservice/j2a/');
  await page.locator('[data-ticket-id="ticket1"]').first().click();
  await page.locator('.message-text').nth(29).waitFor();
  return { page, context, errors, requests };
}

async function visivelNaTela(page, selector, height) {
  const r = await page.locator(selector).boundingBox();
  const width = page.viewportSize().width;
  assert.ok(r && r.height > 0 && r.x >= -1 && r.x + r.width <= width + 1 && r.y >= -1 && r.y + r.height <= height + 1,
    `${selector} deve caber na tela ${width}×${height}: ${JSON.stringify(r)}`);
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
  test(`histórico longo, digitação e navegação (${viewport.width}×${viewport.height})`, async () => {
    const { page, context, errors } = await abrir(viewport);
    try {
      await visivelNaTela(page, '#message-input', viewport.height);
      await visivelNaTela(page, '#send-btn', viewport.height);
      if (viewport.width <= 600) {
        const nav = await page.locator('.topbar-nav').boundingBox();
        const actions = await page.locator('.topbar-actions').boundingBox();
        assert.ok(nav.x + nav.width <= actions.x, 'navegação e ações do topo não devem se sobrepor');
        await visivelNaTela(page, '.topbar-actions', viewport.height);
      }
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: path.resolve(__dirname, `../../../tmp/chat-mobile-corrigido-${viewport.width}.png`) });
      const metrics = await page.locator('#messages').evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight }));
      assert.ok(metrics.height > 20 && metrics.scroll > metrics.height, 'histórico deve rolar dentro da conversa');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1), 'página não deve crescer com o histórico');
      await page.locator('#message-input').fill('Linha de rascunho\n'.repeat(30));
      await visivelNaTela(page, '#message-input', viewport.height);
      await visivelNaTela(page, '#send-btn', viewport.height);
      if (viewport.width <= 900) {
        await page.getByRole('button', { name: 'Fila', exact: true }).click();
        await visivelNaTela(page, '.queue-list', viewport.height);
        await page.getByRole('button', { name: 'Mais', exact: true }).last().click();
        await visivelNaTela(page, '#panel-details', viewport.height);
        await page.locator('[data-mobile-target="conversation"]').click();
        assert.match(await page.locator('#message-input').inputValue(), /rascunho/);
        await page.setViewportSize({ width: viewport.width, height: 480 });
        await page.waitForFunction(() => Math.abs(parseFloat(document.documentElement.style.getPropertyValue('--chat-vh')) - visualViewport.height) < 1);
        await visivelNaTela(page, '#send-btn', 480);
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('teclado que reduz apenas visualViewport, deslocamento e zoom por gesto', async () => {
  const { page, context } = await abrir({ width: 390, height: 844 }, { visualViewportMock: true });
  try {
    await page.locator('#message-input').fill('Rascunho com teclado');
    await page.evaluate(() => { visualViewport.height = 480; visualViewport.dispatchEvent(new Event('resize')); });
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--chat-vh') === '480px');
    await visivelNaTela(page, '#message-input', 480);
    await page.getByRole('button', { name: 'Mensagens da equipe' }).click();
    await page.locator('[data-ci-contato="colega"]').click();
    await page.locator('#ci-texto').fill('Rascunho da equipe');
    await visivelNaTela(page, '#ci-texto', 480);
    await visivelNaTela(page, '.ci-enviar', 480);
    assert.equal(await page.locator('#ci-texto').evaluate(el => getComputedStyle(el).fontSize), '16px');
    for (const selector of ['[data-ci="fechar"]', '.ci-menu-conversa summary', '.ci-enviar']) {
      const r = await page.locator(selector).boundingBox();
      assert.ok(r.width >= 44 && r.height >= 44, 'controle deve ter área de toque de 44 px');
    }
    await page.evaluate(() => { visualViewport.offsetTop = 35; visualViewport.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--chat-top') === '35px');
    assert.equal(Math.round((await page.locator('.ci-painel').boundingBox()).y), 35);
    await page.evaluate(() => { visualViewport.scale = 2; visualViewport.height = 240; visualViewport.dispatchEvent(new Event('resize')); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--chat-vh')), '480px', 'zoom não deve redimensionar o layout');
    assert.equal(await page.locator('#ci-texto').inputValue(), 'Rascunho da equipe');
    await page.evaluate(() => { visualViewport.scale = 1; visualViewport.height = 844; visualViewport.offsetTop = 0; visualViewport.dispatchEvent(new Event('resize')); });
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--chat-vh') === '844px');
    await visivelNaTela(page, '#ci-texto', 844);
  } finally { await context.close(); }
});

test('chamado somente leitura mantém histórico rolável e envio bloqueado', async () => {
  const { page, context } = await abrir({ width: 390, height: 844 }, { readonly: true });
  try {
    await page.locator('#case-readonly-banner').waitFor();
    assert.equal(await page.locator('#message-input').isDisabled(), true);
    await visivelNaTela(page, '#case-readonly-banner', 844);
    await visivelNaTela(page, '#messages', 844);
  } finally { await context.close(); }
});

test('anexo com nome extenso e envio da mensagem no mobile', async () => {
  const { page, context, requests, errors } = await abrir({ width: 320, height: 568 });
  try {
    await page.locator('#file-input').setInputFiles({ name: `${'arquivo'.repeat(25)}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Anexo sintético') });
    await page.locator('#message-input').fill('Analise este anexo');
    await visivelNaTela(page, '#send-btn', 568);
    await page.locator('#send-btn').click();
    await page.waitForFunction(() => !document.querySelector('#pending-files').classList.contains('active'));
    assert.ok(requests.some(r => r.method === 'POST' && r.path.endsWith('/anexos')), 'anexo enviado à API simulada');
    assert.ok(requests.some(r => r.method === 'POST' && r.path.endsWith('/investigar')), 'mensagem enviada à API simulada');
    assert.equal(await page.locator('#message-input').inputValue(), '');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('avaliação e retorno permanecem na área visual com teclado aberto', async () => {
  const { page, context } = await abrir({ width: 390, height: 844 }, { visualViewportMock: true });
  try {
    await page.locator('[data-avaliacao-abrir]').last().click();
    await page.locator('#avaliacao-observacoes').fill('Observação com teclado');
    await page.evaluate(() => { visualViewport.height = 480; visualViewport.dispatchEvent(new Event('resize')); });
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--chat-vh') === '480px');
    await visivelNaTela(page, '.avaliacao-modal', 480);
    await visivelNaTela(page, '.avaliacao-modal-close-btn', 480);
    assert.equal(await page.locator('#avaliacao-observacoes').evaluate(el => getComputedStyle(el).fontSize), '16px');
    await page.locator('.avaliacao-modal-close-btn').click();
    await page.locator('.ia-export-trigger').click();
    await page.locator('#retorno-btn').click();
    await page.locator('.retorno-panel:not([hidden]) textarea[name="DESCRICAO"]').fill('Rascunho de retorno');
    await visivelNaTela(page, '.retorno-panel:not([hidden])', 480);
    await visivelNaTela(page, '.retorno-panel:not([hidden]) .retorno-form > footer', 480);
    await page.getByRole('button', { name: 'Voltar ao chat', exact: true }).click();
    await page.locator('.ia-export-trigger').click();
    await page.locator('#retorno-btn').click();
    assert.equal(await page.locator('.retorno-panel:not([hidden]) textarea[name="DESCRICAO"]').inputValue(), 'Rascunho de retorno');
    await page.locator('[name="HORAINI"]').selectOption('08:00');
    await page.locator('[name="HORAINT"]').selectOption('00:00');
    await page.locator('[name="HORAFIM"]').selectOption('08:30');
    await page.getByRole('button', { name: 'Registrar retorno', exact: true }).click();
    await visivelNaTela(page, '.retorno-confirm[open]', 480);
    await visivelNaTela(page, '[data-retorno-confirm-send]', 480);
    await page.locator('[data-retorno-confirm-cancel]').click();
  } finally { await context.close(); }
});

test('edição, seleção e transmissão da equipe em tela baixa', async () => {
  const { page, context } = await abrir({ width: 320, height: 390 });
  try {
    await page.getByRole('button', { name: 'Mensagens da equipe' }).click();
    await page.locator('[data-ci-contato="colega"]').click();
    await page.locator('#ci-texto').fill('Meu rascunho');
    await page.locator('[data-msg="interna"] summary').click();
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.locator('#ci-editar-texto').fill('Edição em tela baixa');
    await visivelNaTela(page, '#ci-editar-texto', 390);
    await visivelNaTela(page, '.ci-enviar', 390);
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(await page.locator('#ci-texto').inputValue(), 'Meu rascunho');
    await page.locator('.ci-menu-conversa summary').click();
    await page.getByRole('button', { name: 'Selecionar mensagens', exact: true }).click();
    await visivelNaTela(page, '.ci-enviar', 390);
    await page.getByRole('button', { name: 'Cancelar seleção', exact: true }).click();
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await page.locator('[data-ci="todos"]').click();
    await page.locator('#ci-texto-todos').fill('Comunicado de teste');
    await page.locator('#ci-form-todos button').scrollIntoViewIfNeeded();
    await visivelNaTela(page, '#ci-form-todos button', 390);
  } finally { await context.close(); }
});
