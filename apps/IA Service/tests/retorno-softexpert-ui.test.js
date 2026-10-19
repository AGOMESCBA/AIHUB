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
        const files = new Set(['radar.css', 'radar.js', 'tab-export.js', 'tab-export.css', 'retorno-softexpert.css', 'retorno-softexpert.js', 'detalhes-tecnicos.js', 'detalhes-tecnicos.css', 'chat-interno.js', 'chat-interno.css']);
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
    await page.getByRole('button', { name: 'Retorno ao SoftExpert', exact: true }).click();
    await page.locator('[name=DESCRICAO]').fill('Texto do posicionamento');
    await page.locator('[data-retorno-files]').setInputFiles({ name: 'log.txt', mimeType: 'text/plain', buffer: Buffer.from('log') });
    await page.getByRole('button', { name: 'Voltar ao chat' }).click();
    await page.getByRole('button', { name: 'Retorno ao SoftExpert', exact: true }).click();
    assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), 'Texto do posicionamento');
    assert.ok((await page.locator('[data-retorno-file-list]').textContent()).includes('log.txt'));
    await preencherHoras(page);
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
    await page.getByRole('button', { name: 'Retorno ao SoftExpert', exact: true }).click();
    assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), '');
    await page.locator('[name=DESCRICAO]').fill('Rascunho B');
    await page.evaluate(() => { window.currentContext = {scopeKey:'sessao-a',chamadoId:'a',numero:'00012345'}; window.editor.contextChanged(); });
    await page.getByRole('button', { name: 'Retorno ao SoftExpert', exact: true }).click();
    assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), '');
    const resize = page.locator('.retorno-resize');
    const oldWidth = await page.locator('.retorno-panel:not(.technical-details-panel)').evaluate((el) => el.clientWidth);
    await resize.focus();
    await page.keyboard.press('ArrowLeft');
    assert.ok(await page.locator('.retorno-panel:not(.technical-details-panel)').evaluate((el) => el.clientWidth) > oldWidth);
    await page.locator('[data-retorno-expand]').click();
    assert.equal(await page.locator('.retorno-panel:not(.technical-details-panel)').evaluate((el) => el.classList.contains('retorno-expanded')), true);
    await page.screenshot({ path: path.join(__dirname, '../../../tmp/retorno-desktop.png') });
  } finally { await page.close(); }
});

async function browserPage(viewport) {
  const url = await setup();
  const page = await browser.newPage({ viewport });
  await page.goto(url);
  return page;
}

async function preencherHoras(page) {
  await page.locator('[name=HORAINI]').selectOption('08:00');
  await page.locator('[name=HORAINT]').selectOption('00:00');
  await page.locator('[name=HORAFIM]').selectOption('08:30');
}

test('mobile 390 e 320 px: tela inteira, ações acessíveis e rascunho preservado', async () => {
  for (const width of [390, 320]) {
    const page = await browserPage({ width, height: 844 });
    try {
      await page.evaluate(() => { window.ready = false; });
      await page.getByRole('button', { name: 'Retorno ao SoftExpert', exact: true }).click();
      await page.locator('[name=DESCRICAO]').fill('Retorno no celular');
      const bounds = await page.locator('.retorno-panel:not(.technical-details-panel)').boundingBox();
      assert.equal(Math.round(bounds.width), width);
      assert.equal(Math.round(bounds.x), 0);
      const footer = await page.locator('.retorno-form > footer').boundingBox();
      assert.ok(footer.y + footer.height <= 845);
      await preencherHoras(page);
      await page.getByRole('button', { name: 'Registrar retorno', exact: true }).click();
      assert.equal(await page.locator('[data-retorno-confirm-send]').isDisabled(), true);
      assert.equal(await page.evaluate(() => window.posts), 0);
      await page.locator('[data-retorno-confirm-cancel]').click();
      await page.locator('[data-retorno-close]').click();
      await page.getByRole('button', { name: 'Retorno ao SoftExpert', exact: true }).click();
      assert.equal(await page.locator('[name=DESCRICAO]').inputValue(), 'Retorno no celular');
      assert.equal(await page.locator('.retorno-panel:not(.technical-details-panel)').evaluate((el) => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: path.join(__dirname, `../../../tmp/retorno-mobile-${width}.png`) });
      await page.evaluate(() => window.editor.clear());
      await page.getByRole('button', { name: 'Retorno ao SoftExpert', exact: true }).click();
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
    await page.addInitScript(() => {
      localStorage.setItem('svc_token_externo', 'sessao-simulada');
      // Acesso HTTP por IP não disponibiliza randomUUID.
      Object.defineProperty(crypto, 'randomUUID', { value: undefined });
    });
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
      await page.locator('#message-input').evaluate((el) => { el.style.height = '120px'; });
      for (const selector of ['.attach-button', '#send-btn']) {
        const bounds = await page.locator(selector).boundingBox();
        assert.equal(bounds.width, 40, `${selector}: largura fixa`);
        assert.equal(bounds.height, 40, `${selector}: altura fixa mesmo com mensagem alta`);
      }
      // Campo de mensagem cresce enquanto digita (como no WhatsApp), para no
      // limite e passa a rolar; vazio volta ao tamanho inicial.
      const campo = page.locator('#message-input');
      const altura = () => campo.evaluate(el => el.getBoundingClientRect().height);
      await campo.evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input')); });
      const vazio = await altura();
      await campo.fill('linha 1');
      const umaLinha = await altura();
      await campo.fill('linha 1\nlinha 2\nlinha 3\nlinha 4');
      const quatro = await altura();
      assert.ok(quatro > umaLinha + 40, `cresce com as linhas: ${umaLinha} -> ${quatro}`);
      await campo.fill(Array.from({ length: 40 }, (_, i) => `linha ${i}`).join('\n'));
      assert.equal(Math.round(await altura()), 200, 'para no limite');
      assert.equal(await campo.evaluate(el => getComputedStyle(el).overflowY), 'auto', 'acima do limite rola por dentro');
      await campo.fill('');
      assert.ok(Math.abs((await altura()) - vazio) <= 1, 'vazio volta ao tamanho inicial');
      // Registrar retorno no SoftExpert fica no menu ⋯ do cabeçalho, junto de
      // Copiar e Salvar como imagem, cada um com ícone do mesmo tamanho.
      assert.equal(await page.locator('#composer #retorno-btn').count(), 0, 'rodapé só com Anexar');
      assert.equal(await page.locator('.case-actions > #retorno-btn').count(), 0, 'fora da barra do cabeçalho');
      assert.equal(await page.locator('.ia-export-options #retorno-btn').count(), 1, 'dentro do menu ⋯');
      assert.equal(await page.locator('#retorno-btn').getAttribute('title'), 'Registrar retorno no SoftExpert');
      await page.locator('.ia-export-trigger').click();
      const itens = await page.locator('.ia-export-options .ia-export-item').allInnerTexts();
      assert.deepEqual(itens.map(t => t.trim()), ['Registrar retorno no SoftExpert', 'Copiar conteúdo', 'Salvar conteúdo como imagem']);
      const icones = await page.locator('.ia-export-options .ia-export-icon').evaluateAll(els => els.map(e => {
        const r = e.getBoundingClientRect(); const s = e.querySelector('svg').getBoundingClientRect();
        return [r.width, r.height, s.width, s.height];
      }));
      assert.equal(icones.length, 3);
      for (const i of icones) assert.deepEqual(i, icones[0], 'ícones no mesmo tamanho do SoftExpert');
      await page.screenshot({ path: path.join(__dirname, `../../../tmp/retorno-j2a-menu-${width}.png`) });
      await page.locator('#retorno-btn').click();
      assert.ok(await page.locator('.ia-export-options').isHidden(), 'menu fecha ao abrir o retorno');
      await page.locator('[name=DESCRICAO]').fill('Descrição preparada pelo analista');
      await page.screenshot({ path: path.join(__dirname, `../../../tmp/retorno-j2a-${width}.png`) });
      if (width > 1100) {
        const chat = await page.locator('#case-view').boundingBox();
        const panel = await page.locator('.retorno-panel:not(.technical-details-panel)').boundingBox();
        assert.ok(chat.x + chat.width <= panel.x + 2, 'painel não deve cobrir o chat');
        // Alinhado à grade do J2A: mesmo topo e base do chat e respiro de 12px entre os dois.
        assert.ok(Math.abs(panel.y - chat.y) <= 1, `topo desalinhado: chat ${chat.y} x painel ${panel.y}`);
        assert.ok(Math.abs((panel.y + panel.height) - (chat.y + chat.height)) <= 1, 'base desalinhada');
        assert.ok(Math.abs(panel.x - (chat.x + chat.width) - 12) <= 1, `respiro entre chat e painel: ${panel.x - (chat.x + chat.width)}`);
        assert.ok(Math.abs(panel.width - chat.width) <= 2, `deve abrir meio a meio: chat ${chat.width} x painel ${panel.width}`);
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
      if (width < 1100) assert.equal(Math.round((await page.locator('.retorno-panel:not(.technical-details-panel)').boundingBox()).width), width);
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
    await page.getByRole('button', { name: 'Retorno ao SoftExpert', exact: true }).click();
    await page.locator('[name=DESCRICAO]').fill('Conteúdo a retomar');
    await preencherHoras(page);
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

test('horas, agendamento, Memo e anexo único no desktop e no mobile', async () => {
  for (const width of [1440, 320]) {
    const page = await browserPage({ width, height: 900 });
    try {
      await page.getByRole('button', { name: 'Retorno ao SoftExpert', exact: true }).click();
      await page.locator('[name=DESCRICAO]').fill('Descrição longa\n' + 'Memo com acentuação. '.repeat(600));
      assert.equal(await page.locator('[name=HORAINI] option').count(), 49);
      assert.equal(await page.locator('[name=HORAINI] option').last().getAttribute('value'), '23:30');
      assert.equal(await page.locator('[name=HORAFIM]').getAttribute('required'), '');
      await page.getByRole('button', { name: 'Registrar retorno', exact: true }).click();
      assert.equal(await page.locator('dialog').isVisible(), false);
      await page.locator('[name=HORAINI]').selectOption('08:30');
      await page.locator('[name=HORAINT]').selectOption('00:30');
      await page.locator('[name=HORAFIM]').selectOption('08:00');
      assert.equal(await page.locator('[name=HORAFIM]').evaluate(e => e.checkValidity()), false);
      await page.locator('[name=HORAFIM]').selectOption('10:30');
      assert.equal(await page.locator('[name=HORATOTALNUM]').inputValue(), '1,50');
      assert.equal(await page.locator('[name=HORATOTALNUM]').evaluate(e => e.readOnly), true);
      await page.locator('[name=HORAINT]').selectOption('03:00');
      assert.equal(await page.locator('[name=HORAINT]').evaluate(e => e.checkValidity()), false);
      await page.locator('[name=HORAINT]').selectOption('00:30');
      await page.locator('[name=DTAGEND]').fill('2026-10-18');
      await page.locator('[name=HRAGEND]').fill('19:00');
      assert.equal(await page.locator('[data-retorno-files]').evaluate(e => e.multiple), false);
      await page.locator('[data-retorno-files]').setInputFiles({ name: 'primeiro.txt', mimeType: 'text/plain', buffer: Buffer.from('1') });
      await page.locator('[data-retorno-files]').setInputFiles({ name: 'segundo.txt', mimeType: 'text/plain', buffer: Buffer.from('2') });
      assert.equal(await page.locator('[data-retorno-file-list] li').count(), 1);
      assert.equal((await page.locator('[data-retorno-file-list]').textContent()).includes('primeiro.txt'), false);
      assert.equal((await page.locator('[data-retorno-file-list]').textContent()).includes('segundo.txt'), true);
      await page.getByRole('button', { name: 'Voltar ao chat' }).click();
      await page.getByRole('button', { name: 'Retorno ao SoftExpert', exact: true }).click();
      assert.equal(await page.locator('[name=HORATOTALNUM]').inputValue(), '1,50');
      await page.getByRole('button', { name: 'Registrar retorno', exact: true }).click();
      assert.equal(await page.locator('dialog').isVisible(), true);
      assert.match(await page.locator('[data-retorno-confirm-context]').textContent(), /1 anexo/);
      await page.locator('[data-retorno-confirm-cancel]').click();
      await page.locator('[name=HORAINI]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(__dirname, `../../../tmp/retorno-horas-${width}.png`) });
    } finally { await page.close(); }
  }
});

test('falha de rede exige consulta; resultado confirmado não causa outro POST', async () => {
  const page = await browserPage({ width: 1440, height: 900 });
  try {
    await page.evaluate(() => { window.failNetwork = true; window.serverStatus = {status:'registrado',posicionamento:'registrado'}; });
    await page.getByRole('button', { name: 'Retorno ao SoftExpert', exact: true }).click();
    await page.locator('[name=DESCRICAO]').fill('Conteúdo enviado');
    await preencherHoras(page);
    await page.getByRole('button', { name: 'Registrar retorno', exact: true }).click();
    await page.locator('[data-retorno-confirm-send]').click();
    await page.waitForFunction(() => window.posts === 1 && !document.querySelector('dialog').open);
    assert.equal(await page.getByRole('button', { name: 'Retomar tentativa', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Consultar tentativa', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-retorno-new]').hidden);
    assert.equal(await page.evaluate(() => window.posts), 1);
  } finally { await page.close(); }
});
