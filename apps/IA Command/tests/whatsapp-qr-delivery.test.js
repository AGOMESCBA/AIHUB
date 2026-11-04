const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const express = require('express');
const qrcode = require('qrcode');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const workerSource = fs.readFileSync(path.join(__dirname, '../modules/whatsapp/windows-service/worker.js'), 'utf8');
const routesSource = fs.readFileSync(path.join(__dirname, '../modules/whatsapp/windows-service/service-routes.js'), 'utf8');

async function workerFixture(t) {
  let server;
  let svc;
  let starts = 0;
  let hubPosts = 0;
  class FakeService extends EventEmitter {
    constructor() { super(); svc = this; this.status = 'stopped'; this.qr = null; }
    getStatus() { return this.status; }
    getQr() { return this.qr; }
    getLogBuffer() { return []; }
    async start() { starts++; this.status = 'starting'; }
  }
  const fakeHttp = {
    createServer(handler) {
      server = http.createServer(handler);
      const listen = server.listen.bind(server);
      server.listen = (_port, host, callback) => listen(0, host, callback);
      return server;
    },
    request(_options, callback) {
      // Simula callback nao entregue ao hub. Nunca acessa o servidor real.
      hubPosts++;
      const request = new EventEmitter();
      request.setTimeout = () => {};
      request.write = () => {};
      request.end = () => queueMicrotask(() => callback({ statusCode: 401, resume() {} }));
      return request;
    },
  };
  const channels = {
    buscarCanal: () => ({ id: 'emp_1', nome: 'Teste isolado', auth_client_id: 'iac_simulado' }),
    listarEmpresasDoCanal: () => [{ empresa_id: 1 }],
  };
  const sandbox = {
    process: {
      env: { IAC_APP_DIR: 'PERFIL_ISOLADO', IAC_CHANNEL_ID: 'emp_1', IAC_WORKER_PORT: '9999' },
      chdir() {}, on() {}, stdout: { write() {} }, pid: 4242, uptime: () => 1,
      exit(code) { throw new Error(`worker tentou sair: ${code}`); },
    },
    require(name) {
      const normalized = name.replace(/\\/g, '/');
      if (name === 'http') return fakeHttp;
      if (name === 'path') return path;
      if (name === 'fs') return { existsSync: () => true };
      if (normalized.endsWith('/database/index.js')) return { inicializarDB() {} };
      if (normalized.endsWith('/whatsapp/service.js')) return FakeService;
      if (normalized.endsWith('/whatsapp/channel-store.js')) return channels;
      if (normalized.endsWith('/whatsapp/log-contact.js')) return {};
      throw new Error(`require nao isolado: ${name}`);
    },
    Buffer, URL, setTimeout, clearTimeout, console,
  };
  vm.runInNewContext(workerSource, sandbox, { filename: 'worker-isolado.js' });
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  return {
    svc, port, starts: () => starts, hubPosts: () => hubPosts,
    async getQr() {
      const res = await fetch(`http://127.0.0.1:${port}/command`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'get-qr' }),
      });
      assert.equal(res.status, 200);
      return res.json();
    },
  };
}

test('worker retorna a imagem pelo HTTP mesmo sem entrega do callback ao hub', async t => {
  const f = await workerFixture(t);
  f.svc.qr = await qrcode.toDataURL('qr isolado');
  f.svc.emit('iac-qr', f.svc.qr);
  const result = await f.getQr();
  assert.equal(result.qr, f.svc.qr);
  assert.equal(result.hasQr, true);
  assert.equal(result.status, 'starting');
  assert.ok(f.hubPosts() > 0);
  assert.equal(f.starts(), 1);
});

test('consulta QR nao inicia servico parado e nao retorna imagem antiga conectado', async t => {
  const f = await workerFixture(t);
  f.svc.qr = 'imagem-antiga';
  for (const state of ['connected', 'stopped']) {
    f.svc.status = state;
    const result = await f.getQr();
    assert.equal(result.hasQr, false);
    assert.equal(result.qr, null);
    assert.equal(result.status, state);
  }
  assert.equal(f.starts(), 1, 'somente boot inicial');
});

test('painel exibe e renova QR por HTTP, preserva imagem no polling e limpa por canal/estado', async t => {
  const f = await workerFixture(t);
  const firstQr = await qrcode.toDataURL('qr primeiro');
  const renewedQr = await qrcode.toDataURL('qr renovado');
  f.svc.qr = firstQr;
  const app = express();
  app.use(express.json());
  const channels = {
    listarTodosCanais: () => [
      { id: 'emp_1', nome: 'Canal teste', is_windows_service: 1, worker_port: f.port },
      { id: 'emp_2', nome: 'Outro canal', is_windows_service: 0 },
    ],
    listarEmpresasDoCanal: () => [{ empresa_id: 1, nome: 'Empresa teste' }],
    buscarCanal: id => channels.listarTodosCanais().find(channel => channel.id === id),
  };
  const noop = (_req, _res, next) => next();
  const routesModule = { exports: {} };
  vm.runInNewContext(routesSource, {
    module: routesModule, Buffer, setTimeout, process: { env: {} },
    require(name) {
      if (name === 'http') return http;
      if (name === './nssm-manager') return {
        statusServico: () => 'SERVICE_RUNNING', slugDoCanal: id => id, nomeServico: slug => slug,
      };
      if (name === '../channel-store') return channels;
      if (name === '../../permissions') return { requireRotina: () => noop };
      throw new Error(`require nao isolado: ${name}`);
    },
  });
  routesModule.exports(app, { requireAuth: noop, requireIaCommand: noop, io: {} });
  const html = fs.readFileSync(path.join(__dirname, '../frontend/whatsapp-services.html'), 'utf8')
    .replace(/<script\b[^>]*\bsrc=[^>]*>[\s\S]*?<\/script>/gi, '');
  app.get('/css/iahub.css', (_req, res) => res.sendFile(path.join(root, 'packages/ui/frontend/css/iahub.css')));
  app.get('/painel', (_req, res) => res.type('html').send(html));
  const web = app.listen(0, '127.0.0.1');
  await new Promise(resolve => web.once('listening', resolve));
  t.after(() => new Promise(resolve => web.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__socketHandlers = {};
    window.io = () => ({ on(name, handler) { window.__socketHandlers[name] = handler; }, emit() {} });
  });
  await page.goto(`http://127.0.0.1:${web.address().port}/painel`);
  assert.equal((await page.request.get(`http://127.0.0.1:${web.address().port}/css/iahub.css`)).status(), 200);
  await page.waitForFunction(() => canais.length === 2);
  await page.evaluate(() => selecionarCanal('emp_1'));
  await page.waitForFunction(qr => document.getElementById('qr-img').getAttribute('src') === qr && document.getElementById('qr-img').naturalWidth > 0, firstQr);
  assert.equal(await page.locator('#qr-img').isVisible(), true);
  await page.evaluate(() => carregarCanais());
  assert.equal(await page.locator('#qr-img').getAttribute('src'), firstQr);
  await page.evaluate(() => window.__socketHandlers['iac-status']({ channelId: 'emp_1', status: 'starting' }));
  assert.equal(await page.locator('#qr-img').isVisible(), true);
  f.svc.qr = renewedQr;
  await page.evaluate(() => _agendarFallbackQr('emp_1', 0));
  await page.waitForFunction(qr => document.getElementById('qr-img').getAttribute('src') === qr, renewedQr);
  await page.screenshot({ path: path.join(root, 'tmp/whatsapp-qr-http-painel.png'), fullPage: true });
  await page.evaluate(() => selecionarCanal('emp_2'));
  assert.equal(await page.locator('#qr-img').isVisible(), false);
  assert.equal(await page.locator('#qr-img').getAttribute('src'), null);
  await page.evaluate(() => selecionarCanal('emp_1'));
  await page.waitForFunction(qr => document.getElementById('qr-img').getAttribute('src') === qr, renewedQr);
  f.svc.status = 'connected';
  await page.evaluate(() => _agendarFallbackQr('emp_1', 0));
  await page.waitForFunction(() => canais.find(channel => channel.id === 'emp_1').estado === 'connected');
  assert.equal(await page.locator('#qr-img').isVisible(), false);
  // QR atrasado, recebido depois de ready, nao deve reaparecer.
  await page.evaluate(qr => window.__socketHandlers['iac-qr']({ channelId: 'emp_1', url: qr }), firstQr);
  assert.equal(await page.locator('#qr-img').isVisible(), false);
  // Uma resposta HTTP atrasada tambem nao pode ressuscitar QR apos ready.
  let releaseResponse;
  await page.route('**/services/get-qr', async route => {
    await new Promise(resolve => { releaseResponse = resolve; });
    await route.fulfill({ json: { ok: true, hasQr: true, qr: firstQr, status: 'starting' } });
  });
  await page.evaluate(() => {
    canais.find(channel => channel.id === 'emp_1').estado = 'starting';
    _agendarFallbackQr('emp_1', 0);
  });
  const responseDeadline = Date.now() + 3000;
  while (!releaseResponse && Date.now() < responseDeadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(releaseResponse, 'consulta HTTP pendente encontrada');
  await page.evaluate(() => window.__socketHandlers['iac-status']({ channelId: 'emp_1', status: 'connected' }));
  const responseDone = page.waitForResponse(response => response.url().endsWith('/services/get-qr'));
  releaseResponse();
  await responseDone;
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#qr-img').isVisible(), false);
  assert.deepEqual(errors, []);
});
