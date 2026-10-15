const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
let browser;
let server;
const assets = path.join(__dirname, '../frontend/j2a/assets');
const harness = `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/radar.css"><link rel="stylesheet" href="/retorno-softexpert.css"></head><body><main id="radar-layout" class="radar-layout" style="height:100vh"><aside class="queue-panel">Fila</aside><article><h1>Chat</h1><textarea aria-label="Mensagem do chat"></textarea><button id="retorno" type="button">Retorno</button></article><aside class="summary-panel">Resumo</aside></main><script src="/retorno-softexpert.js"></script><script>
window.currentContext = {scopeKey:'sessao-a',chamadoId:'a',numero:'00012345'};
window.posts = 0; window.ready = true; window.keys = []; window.replies = [];
window.editor = IaRetornoSoftExpert.mount({ button: document.getElementById('retorno'), getContext:()=>window.currentContext,
request: async (_context, options) => {
  if(options.method === 'POST') { window.posts++; window.keys.push(JSON.parse(options.body.get('dados')).idempotencyKey); if(window.failNetwork) throw new Error('Falha de rede simulada'); return window.replies.shift() || {status:'registrado'}; }
  if(options.consultaChave) return window.serverStatus || {status:'parcial',posicionamento:'registrado'};
  return {disponivel:window.ready,motivo:'Configuração pendente.'};
}});
</script></body></html>`;
async function setup() {
  if (!browser) {
    server = await new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        const files = new Set(['radar.css', 'radar.js', 'tab-export.js', 'retorno-softexpert.css', 'retorno-softexpert.js']);
        const name = req.url.replace(/^\/iaservice\/j2a\/assets\//, '').replace(/^\//, '');
        if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(harness); }
        if (req.url === '/j2a') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(path.join(assets, '../index.html'))); }
        if (req.url === '/radar-externo') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(path.join(assets, '../../radar.html'))); }
        if (!files.has(name)) { res.writeHead(404); return res.end(); }
        res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'application/javascript');
        res.end(fs.readFileSync(path.join(assets, name)));
      });
      srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
    browser = await chromium.launch({ headless: true });
  }
  return `http://127.0.0.1:${server.address().port}/`;
}
after(async () => { if (browser) await browser.close(); if (server) await new Promise((r) => server.close(r)); });

test('rascunhos, anexos e confirmação explícita no desktop', async () => {
  const page = await browserPage({ width: 1440, height: 900 });
  try {
    await page.getByRole('button', { name: 'Retorno', exact: true }).click();
    await page.locator('[name=DESCRICAO]').fill('Texto do posicionamento');
    await page.locator('[data-retorno-files]').setInputFiles({ name: 'log.txt', mimeType: 'text/plain', buffer: Buffer.from('log') });
    await page.getByRole('button', { name: 'Voltar ao chat' }).click();
    await page.getByRole('button', { name: 'Retorno', exact: true }).click();
    assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), 'Texto do posicionamento');
    assert.ok((await page.locator('[data-retorno-file-list]').textContent()).includes('log.txt'));
    await page.getByRole('button', { name: 'Registrar retorno', exact: true }).click();
    assert.equal(await page.locator('dialog').isVisible(), true);
    assert.ok((await page.locator('[data-retorno-confirm-context]').textContent()).includes('00012345 · 1 anexo'));
    assert.equal(await page.evaluate(() => window.posts), 0);
    await page.locator('[data-retorno-confirm-cancel]').click();
    assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), 'Texto do posicionamento');
    await page.getByRole('button', { name: 'Registrar retorno', exact: true }).click();
    await page.locator('[data-retorno-confirm-send]').click();
    await page.waitForFunction(() => window.posts === 1);
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), '');
    await page.locator('[data-retorno-close]').click();
    await page.evaluate(() => { window.currentContext = {scopeKey:'sessao-a',chamadoId:'b',numero:'0002'}; window.editor.contextChanged(); });
    await page.getByRole('button', { name: 'Retorno', exact: true }).click();
    assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), '');
    await page.locator('[name=DESCRICAO]').fill('Rascunho B');
    await page.evaluate(() => { window.currentContext = {scopeKey:'sessao-a',chamadoId:'a',numero:'00012345'}; window.editor.contextChanged(); });
    await page.getByRole('button', { name: 'Retorno', exact: true }).click();
    assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), '');
    const resize = page.locator('.retorno-resize');
    const oldWidth = await page.locator('.retorno-panel').evaluate((el) => el.clientWidth);
    await resize.focus();
    await page.keyboard.press('ArrowLeft');
    assert.ok(await page.locator('.retorno-panel').evaluate((el) => el.clientWidth) > oldWidth);
    await page.locator('[data-retorno-expand]').click();
    assert.equal(await page.locator('.retorno-panel').evaluate((el) => el.classList.contains('retorno-expanded')), true);
    await page.screenshot({ path: path.join(__dirname, '../../../tmp/retorno-desktop.png') });
  } finally { await page.close(); }
});

async function browserPage(viewport) {
  const url = await setup();
  const page = await browser.newPage({ viewport });
  await page.goto(url);
  return page;
}

test('mobile 390 e 320 px: tela inteira, ações acessíveis e rascunho preservado', async () => {
  for (const width of [390, 320]) {
    const page = await browserPage({ width, height: 844 });
    try {
      await page.evaluate(() => { window.ready = false; });
      await page.getByRole('button', { name: 'Retorno', exact: true }).click();
      await page.locator('[name=DESCRICAO]').fill('Retorno no celular');
      const bounds = await page.locator('.retorno-panel').boundingBox();
      assert.equal(Math.round(bounds.width), width);
      assert.equal(Math.round(bounds.x), 0);
      const footer = await page.locator('.retorno-form > footer').boundingBox();
      assert.ok(footer.y + footer.height <= 845);
      await page.getByRole('button', { name: 'Registrar retorno', exact: true }).click();
      assert.equal(await page.locator('[data-retorno-confirm-send]').isDisabled(), true);
      assert.equal(await page.evaluate(() => window.posts), 0);
      await page.locator('[data-retorno-confirm-cancel]').click();
      await page.locator('[data-retorno-close]').click();
      await page.getByRole('button', { name: 'Retorno', exact: true }).click();
      assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), 'Retorno no celular');
      assert.equal(await page.locator('.retorno-panel').evaluate((el) => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: path.join(__dirname, `../../../tmp/retorno-mobile-${width}.png`) });
      await page.evaluate(() => window.editor.clear());
      await page.getByRole('button', { name: 'Retorno', exact: true }).click();
      assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), '');
    } finally { await page.close(); }
  }
});

test('J2A real integra o painel e mantém o chat utilizável no desktop e no mobile', async () => {
  const url = await setup();
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.addInitScript(() => localStorage.setItem('svc_token_externo', 'sessao-simulada'));
    await page.route('**/api/ia-service-externo/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      let body = {};
      if (pathname.endsWith('/whoami')) body = { empresaNome: 'Empresa de teste', consultorNome: 'Analista de teste', outrasEmpresas: [] };
      else if (pathname.endsWith('/radar/fila')) body = { chamados: [{ id: 'ch-a', numero: '00012345', titulo: 'Chamado de teste', tecnicoResponsavelNome: 'Analista de teste', statusEncerramento: 'Andamento' }] };
      else if (pathname.endsWith('/risco-sla')) body = { chamados: [], consultores: [] };
      else if (pathname.endsWith('/minhas-preferencias')) body = { preAnaliseAutomatica: false };
      else if (pathname.endsWith('/config')) body = { autoRefreshSegundos: 900 };
      else if (pathname.endsWith('/abrir-atendimento')) body = { atendimentoId: 'at-a', preAnaliseDisparada: false };
      else if (pathname.endsWith('/anexos-softexpert')) body = { anexos: [] };
      else if (/\/(mensagens|anexos|investigacoes|trilha)$/.test(pathname)) body = [];
      else if (pathname.endsWith('/retorno')) body = { disponivel: false, motivo: 'Registro aguardando configuração validada.' };
      await route.fulfill({ json: body });
    });
    try {
      await page.goto(new URL('j2a', url).href);
      await page.locator('#queue-list [data-ticket-id]').first().click();
      await page.locator('#retorno-btn').click();
      await page.locator('[name=DESCRICAO]').fill('Descrição preparada pelo analista');
      await page.screenshot({ path: path.join(__dirname, `../../../tmp/retorno-j2a-${width}.png`) });
      if (width > 1100) {
        const chat = await page.locator('#case-view').boundingBox();
        const panel = await page.locator('.retorno-panel').boundingBox();
        assert.ok(chat.x + chat.width <= panel.x + 2, 'painel não deve cobrir o chat');
        const closeButton = await page.locator('[data-retorno-close]').boundingBox();
        const actions = await page.locator('.retorno-form > footer').boundingBox();
        assert.ok(closeButton.x + closeButton.width <= width, `fechar fora da tela: ${JSON.stringify(closeButton)}`);
        assert.ok(actions.y + actions.height <= 900, `ações fora da tela: ${JSON.stringify(actions)}`);
      }
      await page.locator('[data-retorno-close]').click();
      await page.locator('#message-input').fill('Chat continua acessível');
      assert.equal(await page.locator('#message-input').inputValue(), 'Chat continua acessível');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});

test('Radar original integra retorno no desktop e no mobile sem perder o rascunho', async () => {
  const url = await setup();
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.addInitScript(() => localStorage.setItem('svc_token_externo', 'sessao-simulada'));
    await page.route('**/api/ia-service-externo/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      let body = {};
      if (pathname.endsWith('/whoami')) body = { empresaId: 99001, empresaNome: 'Teste', consultorNome: 'Analista', outrasEmpresas: [] };
      else if (pathname.endsWith('/radar/fila')) body = { chamados: [{ id: 'ch-a', numero: '00012345', titulo: 'Chamado de teste', statusEncerramento: 'Andamento' }] };
      else if (pathname.endsWith('/iniciar-analise')) body = { atendimentoId: 'at-a', preAnaliseDisparada: false };
      else if (pathname.endsWith('/anexos-softexpert')) body = { anexos: [] };
      else if (/\/(mensagens|anexos|investigacoes|trilha)$/.test(pathname)) body = [];
      else if (pathname.endsWith('/retorno')) body = { disponivel: false, motivo: 'Contrato pendente.' };
      await route.fulfill({ json: body });
    });
    try {
      await page.goto(new URL('radar-externo', url).href);
      await page.locator('.fila-item').first().click();
      await page.locator('#retorno-btn').click();
      await page.locator('[name=DESCRICAO]').fill('Retorno pelo Radar original');
      if (width < 1100) assert.equal(Math.round((await page.locator('.retorno-panel').boundingBox()).width), width);
      await page.locator('[data-retorno-close]').click();
      await page.locator('#retorno-btn').click();
      assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), 'Retorno pelo Radar original');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});

test('sucesso parcial preserva conteúdo e chave na retomada confirmada', async () => {
  const page = await browserPage({ width: 390, height: 844 });
  try {
    await page.evaluate(() => { window.replies = [{status:'parcial',posicionamento:'registrado',mensagem:'Um anexo falhou.'},{status:'registrado',posicionamento:'registrado'}]; });
    await page.getByRole('button', { name: 'Retorno', exact: true }).click();
    await page.locator('[name=DESCRICAO]').fill('Conteúdo a retomar');
    await page.getByRole('button', { name: 'Registrar retorno', exact: true }).click();
    await page.locator('[data-retorno-confirm-send]').click();
    await page.waitForFunction(() => window.posts === 1 && !document.querySelector('dialog').open);
    assert.equal(await page.locator('[name=DESCRICAO]').isDisabled(), true);
    assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), 'Conteúdo a retomar');
    await page.getByRole('button', { name: 'Retomar tentativa', exact: true }).click();
    await page.locator('[data-retorno-confirm-send]').click();
    await page.waitForFunction(() => window.posts === 2 && !document.querySelector('dialog').open);
    assert.equal(await page.evaluate(() => window.keys[0] === window.keys[1]), true);
    assert.equal(await page.locator('[data-retorno-new]').isVisible(), true);
  } finally { await page.close(); }
});

test('falha de rede exige consulta; resultado confirmado não causa outro POST', async () => {
  const page = await browserPage({ width: 1440, height: 900 });
  try {
    await page.evaluate(() => { window.failNetwork = true; window.serverStatus = {status:'registrado',posicionamento:'registrado'}; });
    await page.getByRole('button', { name: 'Retorno', exact: true }).click();
    await page.locator('[name=DESCRICAO]').fill('Conteúdo enviado');
    await page.getByRole('button', { name: 'Registrar retorno', exact: true }).click();
    await page.locator('[data-retorno-confirm-send]').click();
    await page.waitForFunction(() => window.posts === 1 && !document.querySelector('dialog').open);
    assert.equal(await page.getByRole('button', { name: 'Retomar tentativa', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Consultar tentativa', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-retorno-new]').hidden);
    assert.equal(await page.evaluate(() => window.posts), 1);
  } finally { await page.close(); }
});
