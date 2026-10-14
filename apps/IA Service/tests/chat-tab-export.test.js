// Integração real de navegação, clipboard e PNG, com API simulada e sem dados de produção.
// Executar: node --test "apps/IA Service/tests/chat-tab-export.test.js"
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const vm = require('node:vm');

test('todas as abas exportam conteúdo completo sem alterar a tela', async () => {
  const root = path.resolve(__dirname, '../frontend/j2a');
  const ticket = { id: 'ticket1', numero: '123456', titulo: 'Chamado de teste', descricao: 'Descrição completa', clienteNome: 'Cliente de teste', slaPrazo: 'Em atraso' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let data = {};
      if (url.pathname.endsWith('/whoami')) data = { empresaNome: 'Teste', consultorNome: 'Consultor' };
      if (url.pathname.endsWith('/fila')) data = { chamados: [ticket] };
      if (url.pathname.endsWith('/risco-sla')) data = { consultores: [], chamados: [ticket] };
      if (url.pathname.endsWith('/abrir-atendimento')) data = { atendimentoId: 'a1' };
      if (url.pathname.endsWith('/mensagens')) data = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, papel: 'assistant', texto: `Mensagem completa ${i}\n${'Texto longo de teste. '.repeat(15)}`, criadoEm: '2026-10-14T12:00:00Z' }));
      if (url.pathname.endsWith('/anexos')) data = [];
      if (url.pathname.endsWith('/trilha')) data = { trilha: ['e1', 'e2'].map(execucaoId => ({ execucaoId, status: 'concluido', statusLabel: 'Concluído', criadoEm: '2026-10-14T12:00:00Z', eventos: [{ tipo: 'chamada_provider', titulo: `Etapa ${execucaoId}`, resumo: `Resumo ${execucaoId}`, status: 'concluido', detalhes: { providerFinal: `PROVIDER-${execucaoId}`, tentativas: [{ provider: 'Teste', status: 'ok', erro: `Detalhe completo ${execucaoId}` }] } }] })) };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
      return;
    }
    const relative = url.pathname.replace(/^\/iaservice\/j2a\/?/, '') || 'index.html';
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(filename));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('svc_token_externo', 'test-token');
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copied = text; } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/iaservice/j2a/`);
    await page.locator('[data-ticket-id="ticket1"]').first().waitFor();
    assert.equal(await page.locator('#nav-radar-btn').count(), 0);
    assert.equal(await page.locator('.topbar-nav > [data-panel-tab="details"]').textContent(), 'Detalhes');
    assert.equal(await page.locator('.more-menu [data-panel-tab="details"]').count(), 0);
    assert.equal(await page.locator('.topbar-nav > [data-panel-tab="conversation"]').textContent(), 'Chamados');
    await page.locator('[data-ticket-id="ticket1"]').first().click();
    await page.locator('.message-text').nth(29).waitFor();
    const copy = async () => {
      await page.locator('.ia-export-trigger').click();
      await page.locator('[data-export="copy"]').click();
      await page.waitForFunction(() => !document.querySelector('.ia-export-trigger').disabled);
      return page.evaluate(() => window.copied);
    };
    const image = async () => {
      await page.locator('.ia-export-trigger').click();
      const downloading = page.waitForEvent('download');
      await page.locator('[data-export="image"]').click();
      const download = await downloading;
      assert.equal(await download.failure(), null);
      const file = fs.readFileSync(await download.path());
      assert.equal(file.subarray(1, 4).toString(), 'PNG');
      assert.ok(file.readUInt32BE(16) > 300);
      assert.ok(file.readUInt32BE(20) > 100);
      const varied = await page.evaluate(async base64 => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 200;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 200, 200);
        const pixels = ctx.getImageData(0, 0, 200, 200).data;
        const colors = new Set();
        for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        return colors.size;
      }, file.toString('base64'));
      assert.ok(varied > 20, 'PNG contém a captura renderizada, não uma imagem vazia');
      await page.waitForFunction(() => !document.querySelector('.ia-export-trigger').disabled, null, { timeout: 60000 });
      return file;
    };
    const beforeScroll = await page.locator('#messages').evaluate(el => el.scrollTop);
    const messages = await copy();
    assert.ok(messages.includes('Mensagem completa 0'));
    assert.ok(messages.includes('Mensagem completa 29'));
    assert.ok(!messages.includes('Digite sua mensagem'));
    assert.equal(await page.locator('#messages').evaluate(el => el.scrollTop), beforeScroll);
    // As seis abas usam o mesmo menu; validar clipboard e PNG em cada uma.
    for (const tab of ['details', 'evidence', 'trail', 'knowledge', 'risk']) {
      const button = page.locator(`.topbar-nav [data-panel-tab="${tab}"]`);
      if (await button.evaluate(el => Boolean(el.closest('details')))) await page.locator('.more-menu > summary').click();
      await button.click();
      await page.locator(`#panel-${tab}.active`).waitFor();
      const panelRect = await page.locator(`#panel-${tab}`).boundingBox();
      const workspaceRect = await page.locator('#workspace').boundingBox();
      assert.ok(panelRect.height > 100 && panelRect.y + panelRect.height <= workspaceRect.y + workspaceRect.height + 1, 'aba cabe no painel e mantém área de rolagem');
      const text = await copy();
      assert.ok(text.length > 20);
      if (tab === 'trail') {
        assert.ok(text.includes('PROVIDER-e1'));
        assert.ok(text.includes('PROVIDER-e2'));
        assert.ok(text.includes('Detalhe completo e1'));
        assert.equal(await page.locator('.trail-execution-body[hidden]').count(), 1);
        assert.equal(await page.locator('.trail-step-details[hidden]').count(), 2);
      }
      if (tab === 'risk') assert.ok(text.includes('123456'), 'preserva número do chamado na tabela');
      await image();
    }
    await page.locator('.topbar-nav [data-panel-tab="conversation"]').click();
    const downloads = [];
    const track = download => downloads.push(download);
    page.on('download', track);
    await image();
    assert.ok(downloads.length > 1, 'mensagens longas geram imagens em partes sem truncar');
    page.off('download', track);
    assert.equal(await page.locator('.ia-export-snapshot').count(), 0);
    if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: 'tmp/chat-export-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('[data-mobile-target="conversation"]').textContent(), 'Chamados');
    const rect = await page.locator('.ia-export-trigger').boundingBox();
    assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= 390, 'menu acessível no celular');
    if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: 'tmp/chat-export-mobile.png' });
    const navEnd = await page.locator('.more-menu > summary').boundingBox();
    const accountStart = await page.locator('.topbar-actions').boundingBox();
    assert.ok(navEnd.x + navEnd.width <= accountStart.x, 'navegação não se sobrepõe à conta no celular');
    assert.deepEqual(errors, []);
    // Validar também o adaptador da versão anterior e sua tabela virtualizada.
    const legacyHtml = fs.readFileSync(path.resolve(root, '../radar.html'), 'utf8');
    const inlineScripts = [...legacyHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(Boolean);
    inlineScripts.forEach((source, i) => new vm.Script(source, { filename: `radar-inline-${i}.js` }));
    const adapter = inlineScripts.at(-1);
    await page.setContent(`<section id="chat-col"><div id="chat-view-tabs"><button class="view-tab active">Risco SLA</button></div><div id="chat-header-titulo">Teste</div><div class="view-panel active" id="painel-risco"><div class="risco-grid-wrap">Só uma linha visível</div></div></section>`);
    await page.evaluate(() => {
      window.riscoTable = {
        getColumnDefinitions: () => [{ title: 'Chamado', field: 'numero' }, { title: 'Consultor', field: 'consultor' }],
        getData: range => {
          if (range !== 'active') throw new Error('Exportação deve respeitar filtros');
          return Array.from({ length: 150 }, (_, i) => ({ numero: `Risco completo ${i}`, consultor: 'Teste' }));
        },
      };
    });
    await page.evaluate(adapter);
    const legacyCopy = await copy();
    assert.ok(legacyCopy.includes('Risco completo 0'));
    assert.ok(legacyCopy.includes('Risco completo 149'), 'inclui registros além da janela virtualizada');
    assert.equal(await page.locator('.risco-grid-wrap').textContent(), 'Só uma linha visível');
    await image();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
