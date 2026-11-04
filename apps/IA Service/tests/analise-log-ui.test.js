'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { localizarErros } = require('../backend/services/analise-log-service');

test('aba real J2A: avulso sem chamado, seleção automática, troca de chamado e telas móveis', { timeout: 60000 }, async () => {
  const root = path.resolve(__dirname, '../frontend/j2a');
  const tickets = ['A', 'B'].map(id => ({ id, numero: id === 'A' ? '123' : '456', titulo: `Chamado ${id}`, clienteNome: 'Teste', descricao: 'Descrição de teste' }));
  let resolverAnalise;
  const postsChat = [];
  const requestsLogs = [];
  const relatorio = localizarErros(Buffer.from('THREAD ERROR\nVariable does not exist CTEST on U_TESTE(TESTE.PRW) line 42\n'), 'error.log');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/radar-externo') {
      res.setHeader('Content-Type', 'text/html');
      res.end(fs.readFileSync(path.resolve(root, '../radar.html'))); return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname.includes('/radar/logs')) requestsLogs.push(url.pathname + url.search);
      else if (req.method === 'POST' && /\/(?:abrir-atendimento|iniciar-analise|mensagens|investigar)$/.test(url.pathname)) postsChat.push(url.pathname);
      if (url.pathname.endsWith('/radar/logs/analisar')) {
        resolverAnalise = () => res.end(JSON.stringify({ ...relatorio, origem: { tipo: 'chat', numero: '123', chamadoId: 'A' } }));
        return;
      }
      let data = {};
      if (url.pathname.endsWith('/whoami')) data = { empresaNome: 'Teste', consultorNome: 'Analista' };
      if (url.pathname.endsWith('/fila')) data = { chamados: tickets };
      if (url.pathname.endsWith('/risco-sla')) data = { consultores: [], chamados: tickets };
      if (url.pathname.endsWith('/abrir-atendimento')) data = { atendimentoId: url.pathname.includes('/A/') ? 'at-A' : 'at-B' };
      if (url.pathname.endsWith('/mensagens') || url.pathname.endsWith('/anexos')) data = [];
      if (url.pathname.endsWith('/radar/logs')) {
        const id = url.searchParams.get('chamadoId');
        data = { chamadoId: id, numero: id === 'A' ? '123' : '456', arquivos: [{ id: `anexo-${id}`, nome: `error-${id}.log`, tipo: 'chat', origem: 'Chat IA Service', disponivel: true }], avisos: [] };
      }
      if (url.pathname.endsWith('/radar/logs/avulso')) {
        data = structuredClone({ ...relatorio, origem: { tipo: 'avulso' } });
        if (url.searchParams.get('grupoId')) {
          data.grupos[0].analise = { explicacao: 'Falha de variável.', causaProvavel: 'Verificar o fonte.', solucoes: 'Encaminhar ao desenvolvedor.', validacao: 'Repetir em homologação.', informacoesFaltantes: 'Fonte da rotina.' };
          data.ia = { gruposAnalisados: 1 };
        }
      }
      res.end(JSON.stringify(data)); return;
    }
    const relative = url.pathname.replace(/^\/iaservice\/(?:j2a\/)?assets\//, 'assets/').replace(/^\/iaservice\/j2a\/?/, '') || 'index.html';
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(filename));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const abrirLogs = async () => {
      if (!await page.locator('[data-panel-tab="logs"]').isVisible()) await page.locator('.more-menu > summary').click();
      await page.locator('[data-panel-tab="logs"]').click();
    };
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.addInitScript(() => localStorage.setItem('svc_token_externo', 'token-teste'));
    await page.goto(`http://127.0.0.1:${server.address().port}/iaservice/j2a/`);
    await page.locator('[data-ticket-id="A"]').first().waitFor();
    await abrirLogs();
    assert.equal(await page.locator('#panel-logs').isVisible(), true);
    assert.match(await page.locator('#logs-contexto').textContent(), /Nenhum chamado/);
    await page.locator('#logs-modo-avulso').click();
    await page.locator('#logs-arquivo').setInputFiles({ name: 'avulso.log.txt', mimeType: 'text/plain', buffer: Buffer.from('THREAD ERROR\nFalha de teste') });
    await page.locator('#logs-analisar').click();
    await page.locator('#logs-resultado h3').first().waitFor();
    assert.match(await page.locator('#logs-resultado').textContent(), /Análise avulsa/);
    await page.getByRole('button', { name: 'Analisar este erro', exact: true }).click();
    await page.getByText('Falha de variável.', { exact: true }).waitFor();
    assert.ok(requestsLogs.some(p => /avulso\?grupoId=erro-1/.test(p)));
    assert.equal(postsChat.length, 0, 'avulso não inicia chamado nem envia mensagem');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#logs-baixar').click();
    const download = await downloadPromise;
    assert.match(fs.readFileSync(await download.path(), 'utf8'), /Evidência.*trecho limitado/);

    await page.locator('[data-ticket-id="A"]').first().click();
    await abrirLogs();
    await page.locator('#logs-modo-chamado').click();
    await page.locator('.logs-item').filter({ hasText: 'error-A.log' }).waitFor();
    assert.ok(requestsLogs.some(p => /chamadoId=A/.test(p)));
    await page.locator('input[name="logs-selecao"]').check();
    await page.locator('#logs-analisar').click();
    await page.waitForFunction(() => document.querySelector('#logs-analisar').disabled);
    const inicioEspera = Date.now();
    while (!resolverAnalise) {
      if (Date.now() - inicioEspera > 3000) throw new Error('Requisição simulada de análise não iniciou.');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await page.locator('[data-ticket-id="B"]').first().click();
    if (resolverAnalise) resolverAnalise();
    await abrirLogs();
    await page.locator('.logs-item').filter({ hasText: 'error-B.log' }).waitFor();
    assert.equal(await page.locator('#logs-resultado').textContent(), '', 'resultado do chamado anterior não aparece no novo chamado');
    assert.match(await page.locator('#logs-contexto').textContent(), /#456/);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await abrirLogs();
      assert.equal(await page.locator('#panel-logs').isVisible(), true);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `sem rolagem horizontal em ${width}px`);
      await page.locator('#logs-modo-avulso').click();
      await page.screenshot({ path: path.resolve(__dirname, `../../../tmp/analise-logs-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}/radar-externo`);
    await page.locator('#tab-logs').click();
    assert.equal(await page.locator('#painel-logs').isVisible(), true);
    await page.locator('#logs-modo-avulso').click();
    await page.locator('#logs-arquivo').setInputFiles({ name: 'avulso.log', mimeType: 'text/plain', buffer: Buffer.from('THREAD ERROR\nFalha de teste') });
    await page.locator('#logs-analisar').click();
    await page.locator('#logs-resultado h3').first().waitFor();
    assert.match(await page.locator('#logs-resultado').textContent(), /Análise avulsa/);
    await page.screenshot({ path: path.resolve(__dirname, '../../../tmp/analise-logs-radar-desktop.png') });
    assert.deepEqual(errors, []);
  } finally {
    resolverAnalise?.();
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
