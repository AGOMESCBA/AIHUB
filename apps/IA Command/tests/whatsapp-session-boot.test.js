const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const qrcode = require('qrcode');

// Executa o boot real com navegador, banco, perfil e relogio isolados.
// Nao importa o pipeline de IA nem abre o perfil WhatsApp da maquina.
const source = fs.readFileSync(path.join(__dirname, '../modules/whatsapp/service.js'), 'utf8');
const begin = source.indexOf('  async _start(config) {');
const end = source.indexOf('\n  // Tenta retomar', begin);
assert.ok(begin >= 0 && end > begin, 'metodo de inicializacao encontrado');

async function fixture({ savedSession = true, encodeQr = qrcode.toDataURL } = {}) {
  const timers = new Map();
  const effects = { destroy: 0, quarantine: 0, cleanup: 0, stop: 0, databaseWrites: 0, logout: 0, removed: 0 };
  let timerId = 0;
  class Client {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.info = { wid: { user: 'numero-simulado' } };
    }
    on(name, handler) { this.handlers[name] = handler; }
    initialize() { return new Promise((resolve, reject) => { this.rejectInit = reject; }); }
    async destroy() {
      effects.destroy++;
      this.rejectInit(new Error('Protocol error (Runtime.callFunctionOn): Target closed'));
    }
    async logout() { effects.logout++; }
  }
  const context = {
    Client,
    LocalAuth: class { constructor(options) { Object.assign(this, options); } },
    AUTH_BASE: 'PERFIL_ISOLADO', PUPPETEER_ARGS: [],
    _sessionLooksAuthenticated: () => savedSession,
    _sessionExists: () => savedSession,
    _quarantineSession: () => { effects.quarantine++; return 'quarentena-simulada'; },
    resolveChromePath: () => null,
    WHATSAPP_POST_CLEANUP_WAIT_MS: 0,
    WHATSAPP_PRESERVE_AUTH_SESSION_ON_TIMEOUT: true,
    WHATSAPP_INIT_TIMEOUT_MS: 180000,
    WHATSAPP_SILENT_SESSION_RETRY_MS: 90000,
    WHATSAPP_QR_AUTH_TIMEOUT_MS: 300000,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval: () => -1, clearInterval() {},
    qrcode: { toDataURL: encodeQr },
    fs: { promises: { async rm() { effects.removed++; } } },
    path,
    require: () => ({ getDB: () => ({ prepare: () => ({ run() { effects.databaseWrites++; } }) }) }),
  };
  const start = vm.runInNewContext('({' + source.slice(begin, end) + '})', context)._start;
  const svc = {
    status: 'stopped', lastQrUrl: null, logs: [], events: [],
    _processedMessageIds: new Set(),
    _senderContext: new Map(),
    _cancelarAutoReconnect() {},
    _resolveConfiguredAuthClientId: () => 'iac_simulado',
    async _killChromeForSession() { effects.cleanup++; },
    _bootLog() {},
    setStatus(status) { this.status = status; },
    log(message) { this.logs.push(message); },
    emit(name, value) { this.events.push({ name, value }); },
    async stop() { effects.stop++; this.client = null; this.lastQrUrl = null; this.setStatus('stopped'); },
  };
  await start.call(svc, { empresaId: 1, channel: { id: 'simulado', nome: 'SIMULACAO' } });
  const client = svc.client;
  async function fireTimeout(ms) {
    const entry = [...timers.entries()].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `timeout de ${ms}ms ativo`);
    timers.delete(entry[0]);
    await entry[1].fn();
  }
  const lifecycleBegin = source.indexOf('  async stop() {');
  const lifecycleEnd = source.indexOf('  async sendMessage(', lifecycleBegin);
  const lifecycle = vm.runInNewContext('(new class {' + source.slice(lifecycleBegin, lifecycleEnd) + '})', context);
  return {
    svc, client, effects, timers, fireTimeout,
    restart: () => start.call(svc, { empresaId: 1, channel: { id: 'simulado', nome: 'SIMULACAO' } }),
    useRealLifecycle() { svc.stop = lifecycle.stop; svc.disconnectSession = lifecycle.disconnectSession; },
  };
}

test('sessao valida conecta automaticamente sem QR nem destruicao do cliente', async () => {
  const { svc, client, effects, timers } = await fixture();
  assert.equal(client.options.authStrategy.clientId, 'iac_simulado');
  assert.equal(client.options.authStrategy.dataPath, 'PERFIL_ISOLADO');
  client.handlers.authenticated();
  client.handlers.ready();
  assert.equal(svc.status, 'connected');
  assert.equal(svc.lastQrUrl, null);
  assert.equal(svc.events.some(event => event.name === 'iac-qr'), false);
  assert.equal(effects.destroy, 0);
  assert.equal(effects.quarantine, 0);
  assert.equal(timers.size, 0);
});

test('QR de sessao salva aparece e mantem cliente ativo e perfil preservado', async () => {
  const { svc, client, effects, timers } = await fixture();
  await client.handlers.qr('qr de teste');
  assert.equal(svc.status, 'starting');
  assert.equal(svc.client, client);
  assert.match(svc.lastQrUrl, /^data:image\/png;base64,/);
  assert.equal(svc.events.at(-1).name, 'iac-qr');
  assert.equal(effects.destroy, 0);
  assert.equal(effects.quarantine, 0);
  assert.equal(effects.cleanup, 1, 'somente limpeza inicial de processos/locks');
  assert.equal([...timers.values()].some(timer => timer.ms === 90000), false);
  assert.equal([...timers.values()].some(timer => timer.ms === 300000), true);
});

test('sessao pode autenticar apos QR e limpar QR e todos os timers ao conectar', async () => {
  const { svc, client, effects, timers } = await fixture();
  await client.handlers.qr('qr de teste');
  client.handlers.authenticated();
  client.handlers.ready();
  assert.equal(svc.status, 'connected');
  assert.equal(svc.lastQrUrl, null);
  assert.equal(effects.destroy, 0);
  assert.equal(effects.quarantine, 0);
  assert.equal(timers.size, 0);
});

test('renovacao do QR nao encerra cliente nem reinicia prazo de autenticacao', async () => {
  const { svc, client, effects, timers } = await fixture();
  await client.handlers.qr('qr inicial');
  const authTimer = [...timers.entries()].find(([, timer]) => timer.ms === 300000)[0];
  const firstQr = svc.lastQrUrl;
  await client.handlers.qr('qr renovado');
  assert.notEqual(svc.lastQrUrl, firstQr);
  assert.ok(timers.has(authTimer));
  assert.equal([...timers.values()].filter(timer => timer.ms === 300000).length, 1);
  assert.equal(svc.logs.filter(message => message.includes('Mantendo o cliente ativo')).length, 1);
  assert.equal(effects.destroy, 0);
});

test('timeout inicial apos QR aguarda o prazo de leitura sem limpar sessao', async () => {
  const { svc, client, effects, fireTimeout } = await fixture();
  await client.handlers.qr('qr de teste');
  await fireTimeout(180000);
  assert.equal(svc.status, 'starting');
  assert.equal(effects.quarantine, 0);
  assert.equal(effects.stop, 0);
  await fireTimeout(300000);
  assert.equal(svc.status, 'stopped');
  assert.equal(effects.stop, 1);
  assert.equal(effects.quarantine, 0);
});

test('sessao salva silenciosa mantem protecao contra limpeza automatica', async () => {
  const { svc, effects, fireTimeout } = await fixture();
  await fireTimeout(90000);
  assert.equal(svc.status, 'starting');
  await fireTimeout(180000);
  assert.equal(svc.status, 'stopped');
  assert.equal(effects.destroy, 1);
  assert.equal(effects.quarantine, 0);
});

test('primeira conexao sem sessao salva continua gerando QR', async () => {
  const { svc, client, effects } = await fixture({ savedSession: false });
  await client.handlers.qr('primeiro qr');
  assert.match(svc.lastQrUrl, /^data:image\/png;base64,/);
  assert.equal(svc.status, 'starting');
  assert.equal(effects.destroy, 0);
  assert.equal(effects.quarantine, 0);
});

test('QR cuja imagem termina apos ready nao reaparece no canal conectado', async () => {
  let finishQr;
  const { svc, client } = await fixture({ encodeQr: () => new Promise(resolve => { finishQr = resolve; }) });
  const pendingQr = client.handlers.qr('qr de teste');
  client.handlers.authenticated();
  client.handlers.ready();
  finishQr('imagem-atrasada');
  await pendingQr;
  assert.equal(svc.status, 'connected');
  assert.equal(svc.lastQrUrl, null);
  assert.equal(svc.events.some(event => event.name === 'iac-qr'), false);
});

test('parada cancela timers de boot e permite nova tentativa com prazo independente', async () => {
  const f = await fixture();
  f.useRealLifecycle();
  await f.client.handlers.qr('qr antigo');
  const oldTimeout = [...f.timers.values()].find(timer => timer.ms === 300000).fn;
  const stopping = f.svc.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal([...f.timers.values()].some(timer => timer.ms === 300000), false);
  await f.fireTimeout(1000);
  await stopping;
  await f.restart();
  const newClient = f.svc.client;
  await newClient.handlers.qr('qr novo');
  await oldTimeout();
  assert.equal(f.svc.client, newClient);
  assert.equal(f.svc.status, 'starting');
  assert.equal(f.effects.destroy, 1, 'somente cliente antigo encerrado pela parada');
  assert.equal(f.effects.logout, 0);
  assert.equal(f.effects.removed, 0);
});

test('reconexao cancela timer antigo antes de iniciar outro cliente', async () => {
  const f = await fixture();
  f.useRealLifecycle();
  await f.client.handlers.qr('qr antigo');
  const disconnecting = f.svc.disconnectSession();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal([...f.timers.values()].some(timer => timer.ms === 300000), false);
  await f.fireTimeout(1000);
  await disconnecting;
  await f.restart();
  const newClient = f.svc.client;
  await newClient.handlers.qr('qr novo');
  // Eventos atrasados de um navegador encerrado nao podem alterar a nova sessao.
  f.client.handlers.ready();
  f.client.handlers.disconnected('NAVIGATION');
  assert.equal(f.svc.client, newClient);
  assert.equal(f.svc.status, 'starting');
  assert.equal([...f.timers.values()].filter(timer => timer.ms === 300000).length, 1);
});

test('rejeicao atrasada de initialize nao derruba o cliente de uma nova tentativa', async () => {
  const f = await fixture();
  await f.client.handlers.qr('qr antigo');
  f.svc.setStatus('stopped');
  await f.restart();
  const newClient = f.svc.client;
  await newClient.handlers.qr('qr novo');
  f.client.rejectInit(new Error('Target closed do cliente antigo'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.svc.client, newClient);
  assert.equal(f.svc.status, 'starting');
  assert.equal([...f.timers.values()].filter(timer => timer.ms === 300000).length, 1);
});
