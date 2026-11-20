// Etapa 3.8: espaço de trabalho com abas, em navegador real contra o ambiente sintético local.
// Sem segredos no relatório: CPFs, senhas, tokens e segredos de integração não são gravados.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = 'C:/Apps/ELOGESTAO';
const access = JSON.parse(fs.readFileSync(path.join(root, '.local/access.json'), 'utf8'));
const WEB = process.env.ELO_BROWSER_WEB || 'http://localhost:3003';
if (!/^http:\/\/(localhost|127\.0\.0\.1):300[123]$/.test(WEB) || access.api !== 'http://127.0.0.1:8010')
  throw new Error('Somente ambiente local sintético.');
const out = 'C:/Apps/iahub/tmp/elo-review38-84056ac/browser';
const profile = path.join(os.tmpdir(), 'elo-browser-38-' + Date.now());
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(profile, { recursive: true });
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cpfMasked = cpf => cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
const ORG_A = 'Órgão sintético de desenvolvimento';
const ORG_B = 'Órgão sintético B';
const A1 = 'Unidade sintética';
const A2 = 'Secretaria sintética de saúde';
const B1 = 'Secretaria sintética B1';
const stamp = Date.now();
const results = [];
const measures = {};
let current = '';

function check(name, ok, detail) {
  results.push({ scenario: current, name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  console.log((ok ? 'OK ' : 'FALHA ') + `[${current}] ${name}` + (ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`));
}
function cnpj(base) {
  let s = String(base).padStart(12, '7').slice(-12);
  for (const w of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const n = [...s].reduce((a, d, i) => a + Number(d) * w[i], 0) % 11;
    s += n < 2 ? '0' : String(11 - n);
  }
  return s;
}

class Browser {
  async start() {
    this.process = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore', windowsHide: true });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
    const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    this.ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise(resolve => this.ws.addEventListener('open', resolve, { once: true }));
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.ws.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      } else if (message.method) this.listeners.forEach(listener => listener(message));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error('Tempo esgotado no DevTools: ' + method)); }, 30000);
    });
  }
  async context() { return (await this.send('Target.createBrowserContext')).browserContextId; }
  async tab(browserContextId) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = new Tab(this, sessionId);
    await tab.send('Page.enable');
    await tab.send('Runtime.enable');
    await tab.send('Network.enable');
    await tab.send('Performance.enable');
    // window.confirm só aparece nas confirmações já existentes da 3.7; os diálogos do navegador são aceitos.
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.confirm=()=>true;' });
    this.listeners.add(message => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Page.javascriptDialogOpening') {
        tab.dialogs.push(message.params.type);
        tab.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => null);
      }
      if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/api/elo/'))
        tab.requests.push(message.params.request.method + ' ' + new URL(message.params.request.url).pathname);
      if (message.method === 'Fetch.requestPaused') tab.paused.push(message.params);
    });
    await tab.desktop();
    return tab;
  }
  async stop() {
    try { await this.send('Browser.close'); } catch { /* encerrado */ }
    try { this.ws.close(); } catch { /* encerrado */ }
    this.process.kill();
  }
}

class Tab {
  constructor(browser, sessionId) {
    this.browser = browser; this.sessionId = sessionId; this.dialogs = []; this.requests = []; this.paused = [];
  }
  send(method, params) { return this.browser.send(method, params, this.sessionId); }
  desktop(height = 900) { return this.send('Emulation.setDeviceMetricsOverride', { width: 1366, height, deviceScaleFactor: 1, mobile: false }); }
  async eval(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }
  async go(url) {
    await this.send('Page.navigate', { url: WEB + url });
    await this.waitFor('document.readyState === "complete"');
  }
  async waitFor(expression, timeout = 30000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { if (await this.eval(`Boolean(${expression})`)) return true; } catch { /* navegação em curso */ }
      await sleep(120);
    }
    return false;
  }
  text() { return this.eval('document.body ? document.body.innerText : ""'); }
  path() { return this.eval('location.pathname + location.search'); }
  waitText(fragment, timeout) { return this.waitFor(`document.body && document.body.innerText.includes(${JSON.stringify(fragment)})`, timeout); }
  async fill(selector, value) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.eval(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Campo ausente: ' + ${JSON.stringify(selector)});
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true; })()`);
      } catch (error) { if (attempt >= 20) throw error; await sleep(250); }
    }
  }
  value(selector) { return this.eval(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`); }
  clickWithin(scope, text) {
    return this.eval(`(() => {
      const items = [...document.querySelectorAll(${JSON.stringify(scope)})].flatMap(s => [...s.querySelectorAll('button, a')])
        .filter(el => el.innerText.includes(${JSON.stringify(text)}) && !el.disabled);
      if (!items.length) return false; items[0].click(); return true; })()`);
  }
  async key(key, code, keyCode, modifiers = 0) {
    for (const type of ['rawKeyDown', 'keyUp'])
      await this.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, modifiers });
  }
  tabs() {
    return this.eval(`[...document.querySelectorAll('[role=tab]')].map(b => ({ id: b.id.slice(4),
      text: b.innerText.replace(/\\s+/g, ' ').trim(), selected: b.getAttribute('aria-selected') === 'true' }))`);
  }
  activeTab() { return this.eval(`document.querySelector('[role=tab][aria-selected=true]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`); }
  async activate(fragment) {
    const ok = await this.eval(`(() => { const b = [...document.querySelectorAll('[role=tab]')].find(e => e.innerText.replace(/\\s+/g, ' ').includes(${JSON.stringify(fragment)}));
      if (!b) return false; b.click(); return true; })()`);
    await this.waitFor(`document.querySelector('[role=tab][aria-selected=true]')?.innerText.replace(/\\s+/g, ' ').includes(${JSON.stringify(fragment)})`, 10000);
    await sleep(250);
    return ok;
  }
  async openRoutine(code) {
    const before = (await this.tabs()).length;
    await this.waitFor(`document.querySelector('button[data-routine="${code}"]:not(:disabled)')`);
    await this.eval(`document.querySelector('button[data-routine="${code}"]').click()`);
    const ok = await this.waitFor(`document.querySelectorAll('[role=tab]').length > ${before} || document.querySelector('[role=tab][aria-selected=true]')`, 15000);
    await this.waitFor(`document.querySelector('[role=tabpanel]:not([hidden])')`, 10000);
    await sleep(400);
    return ok;
  }
  inPanel(selector) { return `[role=tabpanel]:not([hidden]) ${selector}`; }
  async closeTab(fragment) {
    return this.eval(`(() => { const b = [...document.querySelectorAll('[role=tab]')].find(e => e.innerText.replace(/\\s+/g, ' ').includes(${JSON.stringify(fragment)}));
      if (!b) return false; b.nextElementSibling.click(); return true; })()`);
  }
  dialogText() { return this.eval(`document.querySelector('[role=alertdialog]')?.innerText ?? null`); }
  dialogClick(text) { return this.clickWithin('[role=alertdialog]', text); }
  async api(pathName, method = 'GET', body, headers = {}) {
    return this.eval(`fetch('/api/elo${pathName}', { method: ${JSON.stringify(method)}, headers: { 'X-Elo-Requested-With': 'elo-backoffice',
      'Content-Type': 'application/json', ...${JSON.stringify(headers)} }, ${body ? `body: JSON.stringify(${JSON.stringify(body)}),` : ''} })
      .then(async r => ({ status: r.status, etag: r.headers.get('etag'), body: await r.json().catch(() => null) }))`);
  }
  async login(user) {
    await this.go('/');
    await this.waitFor('(() => { const el = document.querySelector("input[name=username]"); return el && Object.keys(el).some(k => k.startsWith("__react")); })()');
    await this.fill('input[name=username]', cpfMasked(user.cpf));
    await this.fill('input[name=password]', user.password);
    await this.eval('document.querySelector("form button[type=submit]").click()');
    await this.waitFor('location.pathname.startsWith("/app/")', 30000);
    await this.waitFor('location.pathname === "/app/dashboard" || location.pathname === "/app/contexto"', 30000);
  }
  // Seleção para novas abas pela página existente, navegando dentro do painel (abas preservadas).
  async choose(customer, option) {
    await this.waitFor('document.querySelector("[data-testid=contexto-novas-abas] a")');
    await this.clickWithin('[data-testid=contexto-novas-abas]', 'Trocar');
    await this.waitFor('location.pathname === "/app/contexto"');
    await this.waitFor(`[...document.querySelectorAll('section button')].some(b => b.innerText.includes(${JSON.stringify(customer)}))`);
    await this.clickWithin('section[aria-labelledby=context-title]', customer);
    await this.waitFor(`[...document.querySelectorAll('section button')].some(b => b.innerText.includes(${JSON.stringify(option)}))`);
    await this.clickWithin('section[aria-labelledby=context-title]', option);
    await this.waitFor('location.pathname === "/app/dashboard"');
    return this.waitFor(`document.querySelector('[data-testid=contexto-novas-abas]')?.innerText.includes(${JSON.stringify(option === 'Modo administrativo do órgão' ? 'Modo administrativo' : option)})`, 15000);
  }
  menu() {
    return this.eval(`Object.fromEntries([...document.querySelectorAll('nav[aria-label="Rotinas autorizadas"] section')].map(s =>
      [s.querySelector('h2').textContent.trim(), [...s.querySelectorAll('button[data-routine]')].map(b => b.dataset.routine)]))`);
  }
  async heap() {
    await this.send('HeapProfiler.collectGarbage').catch(() => null);
    const { metrics } = await this.send('Performance.getMetrics');
    return Math.round(metrics.find(m => m.name === 'JSHeapUsedSize').value / 1024);
  }
  counters() { return this.eval('({ ...(window.__eloWorkspaceMetrics ?? { mounts: 0, unmounts: 0 }) })'); }
  async shot(name, mobile = false) {
    if (mobile) await this.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(800);
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(out, `${name}${mobile ? '-celular' : ''}.png`), Buffer.from(data, 'base64'));
    const overflow = await this.eval('document.documentElement.scrollWidth > window.innerWidth + 1');
    if (mobile) await this.desktop();
    return !overflow;
  }
  async hold(pattern) {
    this.paused = [];
    await this.send('Fetch.enable', { patterns: [{ urlPattern: pattern, requestStage: 'Request' }] });
  }
  async waitPaused(timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end && !this.paused.length) await sleep(80);
    return this.paused[0] ?? null;
  }
  // Retém a resposta (a requisição já foi feita com o cookie da sessão de origem).
  async holdResponse(pattern) {
    this.paused = [];
    await this.send('Fetch.enable', { patterns: [{ urlPattern: pattern, requestStage: 'Response' }] });
  }
  async release() {
    for (const p of this.paused.splice(0)) await this.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => null);
    await this.send('Fetch.disable').catch(() => null);
  }
  storage() {
    return this.eval(`JSON.stringify({ session: Object.fromEntries(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)])),
      local: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])) })`);
  }
}

const withoutSecrets = (text, extra = []) => {
  const values = [access.user.password, ...Object.values(access.demo_users).map(u => u.password), access.user.cpf,
    ...Object.values(access.demo_users).map(u => u.cpf), ...extra].filter(Boolean);
  return !values.some(v => text.includes(v)) && !/access_token|refresh_token|eyJ[A-Za-z0-9_-]{10,}/.test(text);
};

async function platformScenario(browser) {
  current = 'plataforma';
  const browserContext = await browser.context();
  const page = await browser.tab(browserContext);
  await page.login(access.user);
  await page.waitFor('location.pathname === "/app/dashboard"');
  await page.waitFor('document.querySelector("button[data-routine]")');
  const menu = await page.menu();
  check('Menu da plataforma lista somente rotinas administrativas da plataforma',
    JSON.stringify(menu['Administração']) === JSON.stringify(['adm.orgaos', 'adm.identidades', 'adm.perfis_modelo'])
      && menu['Elo Gestão'].length === 0, menu);
  check('Área Elo Gestão explica que não há operação implícita da plataforma', (await page.text()).includes('Rotinas operacionais aparecem ao selecionar uma secretaria autorizada'));

  await page.go('/app/orgaos/1/administracao/secretarias');
  check('URL direta de órgão sem vínculo é recusada antes de exibir dados',
    await page.waitText('Sem acesso a este órgão, secretaria ou modo.') && (await page.tabs()).length === 0);
  await page.go('/app/administracao/contratos');
  check('Rotina inexistente no registro fechado é tratada como indisponível', await page.waitText('Endereço inválido ou rotina indisponível'));

  const heap0 = await page.heap();
  const count0 = await page.counters();
  page.requests = [];
  await page.go('/app/dashboard');
  await page.openRoutine('adm.orgaos');
  await page.waitFor(page.inPanel('table') ? `document.querySelector('${page.inPanel('table')}')` : 'true');
  await page.fill(page.inPanel('input[name=busca]'), 'sintético B');
  await page.clickWithin('[role=tabpanel]:not([hidden]) form', 'Buscar');
  await page.waitFor(`document.querySelector('${page.inPanel('tbody')}')?.innerText.includes('${ORG_B}')`);
  await page.openRoutine('adm.perfis_modelo');
  await page.waitFor(`document.querySelector('${page.inPanel('table')}')`);
  await page.activate('Órgãos');
  check('Filtro da lista de Órgãos preservado ao alternar entre duas rotinas',
    await page.value(page.inPanel('input[name=busca]')) === 'sintético B'
    && (await page.eval(`document.querySelector('${page.inPanel('tbody')}').innerText`)).includes(ORG_B));
  const openRequests = page.requests.slice();

  // Dois rascunhos independentes da mesma rotina.
  await page.clickWithin('[role=tabpanel]:not([hidden])', 'Cadastrar órgão');
  await page.waitFor(`document.querySelector('${page.inPanel('input[name=name]')}')`);
  await page.fill(page.inPanel('input[name=name]'), `Rascunho A 38 ${stamp}`);
  await page.activate('Órgãos Plataforma');
  await page.clickWithin('[role=tabpanel]:not([hidden])', 'Cadastrar órgão');
  await page.waitFor(`(document.querySelectorAll('[role=tab]').length === 4) && document.querySelector('${page.inPanel('input[name=name]')}')`);
  await page.fill(page.inPanel('input[name=name]'), `Rascunho B 38 ${stamp}`);
  const tabs = await page.tabs();
  check('Cada novo cadastro recebe uma aba de rascunho própria', tabs.filter(t => t.text.includes('Novo órgão')).length === 2, tabs);
  const drafts = tabs.filter(t => t.text.includes('Novo órgão')).map(t => t.id);
  await page.eval(`document.getElementById('aba-${drafts[0]}').click()`);
  await sleep(400);
  check('Rascunho A preservado ao voltar', await page.value(page.inPanel('input[name=name]')) === `Rascunho A 38 ${stamp}`);
  await page.eval(`document.getElementById('aba-${drafts[1]}').click()`);
  await sleep(400);
  check('Rascunho B independente do A', await page.value(page.inPanel('input[name=name]')) === `Rascunho B 38 ${stamp}`);

  // Rolagem por aba.
  await page.desktop(420);
  await page.eval(`document.getElementById('aba-${drafts[0]}').click()`);
  await sleep(300);
  await page.eval(`document.querySelector('${page.inPanel('details')}').open = true`);
  await sleep(200);
  await page.eval('window.scrollTo(0, 360)');
  await sleep(300);
  const scrollA = await page.eval('window.scrollY');
  await page.eval(`document.getElementById('aba-${drafts[1]}').click()`);
  await sleep(400);
  await page.eval('window.scrollTo(0, 0)');
  await sleep(200);
  await page.eval(`document.getElementById('aba-${drafts[0]}').click()`);
  await sleep(600);
  const scrollBack = await page.eval('window.scrollY');
  check('Rolagem da aba preservada ao alternar', scrollA > 100 && Math.abs(scrollBack - scrollA) <= 4, { scrollA, scrollBack });
  check('Campo e seção expandida preservados após alternar',
    await page.value(page.inPanel('input[name=name]')) === `Rascunho A 38 ${stamp}` && await page.eval(`document.querySelector('${page.inPanel('details')}').open`));
  await page.desktop();

  // Reordenação por teclado real (Alt+Shift+seta) e por arraste.
  let order = (await page.tabs()).map(t => t.id);
  await page.eval(`document.getElementById('aba-${drafts[0]}').focus()`);
  await page.key('ArrowLeft', 'ArrowLeft', 37, 1 | 8);
  await sleep(400);
  let next = (await page.tabs()).map(t => t.id);
  check('Alt+Shift+seta move a aba focada uma posição',
    next.indexOf(drafts[0]) === order.indexOf(drafts[0]) - 1, { order, next });
  check('Foco permanece na aba movida', await page.eval(`document.activeElement?.id === 'aba-${drafts[0]}'`));
  check('Movimento anunciado aos leitores de tela', await page.waitFor(`[...document.querySelectorAll('[aria-live=polite]')].some(e => e.innerText.includes('movida para a posição'))`, 3000));
  await page.key('ArrowRight', 'ArrowRight', 39);
  await sleep(150);
  check('Setas movem o foco entre as abas sem ativar', await page.eval(`document.activeElement?.getAttribute('role') === 'tab' && document.activeElement.id !== 'aba-${drafts[0]}'`)
    && (await page.activeTab()).includes('Novo órgão'));
  order = (await page.tabs()).map(t => t.id);
  await page.eval(`(() => {
    const items = [...document.querySelectorAll('[data-tab-id]')];
    const source = items[items.length - 1], target = items[0];
    const dt = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  })()`);
  await sleep(400);
  next = (await page.tabs()).map(t => t.id);
  check('Arrastar a última aba para o início reordena', next[0] === order[order.length - 1] && next.length === order.length, { order, next });
  check('Reordenar não altera o conteúdo dos rascunhos', await (async () => {
    await page.eval(`document.getElementById('aba-${drafts[1]}').click()`); await sleep(300);
    return await page.value(page.inPanel('input[name=name]')) === `Rascunho B 38 ${stamp}`;
  })());

  // Voltar/avançar ativa abas sem trocar o contexto do formulário.
  const before = await page.path();
  await page.eval(`document.getElementById('aba-${drafts[0]}').click()`); await sleep(400);
  await page.eval('history.back()');
  await page.waitFor(`location.pathname + location.search === ${JSON.stringify(before)}`, 5000); await sleep(400);
  check('Voltar ativa a aba anterior preservando o rascunho',
    (await page.eval(`document.querySelector('[role=tab][aria-selected=true]').id`)) === `aba-${drafts[1]}`
    && await page.value(page.inPanel('input[name=name]')) === `Rascunho B 38 ${stamp}`);
  await page.eval('history.forward()'); await sleep(600);
  check('Avançar retorna à aba seguinte', (await page.eval(`document.querySelector('[role=tab][aria-selected=true]').id`)) === `aba-${drafts[0]}`);
  check('Cabeçalho mostra o contexto da aba ativa', (await page.eval(`document.querySelector('[data-testid=contexto-aba-ativa]').innerText`)).includes('Novo órgão em Plataforma'));

  // Fechamento: permanecer, descartar e salvar (inválido e válido).
  await page.closeTab('Novo órgão');
  await page.waitFor('document.querySelector("[role=alertdialog]")', 5000);
  const dialog = await page.dialogText();
  check('Fechar aba alterada oferece permanecer, descartar e salvar',
    /Permanecer/.test(dialog) && /Descartar e fechar/.test(dialog) && /Salvar e fechar/.test(dialog), dialog);
  await page.dialogClick('Permanecer');
  await sleep(400);
  check('Permanecer cancela o fechamento e preserva o formulário',
    (await page.tabs()).length === 4 && (await page.value(page.inPanel('input[name=name]'))).startsWith('Rascunho'));
  const discardName = await page.value(page.inPanel('input[name=name]'));
  const activeDraft = (await page.eval(`document.querySelector('[role=tab][aria-selected=true]').id`)).slice(4);
  const keepDraft = drafts.find(d => d !== activeDraft);
  await page.eval(`document.getElementById('aba-${activeDraft}').nextElementSibling.click()`);
  await page.waitFor('document.querySelector("[role=alertdialog]")', 5000);
  await page.dialogClick('Descartar e fechar');
  await sleep(500);
  const discarded = await page.api(`/customers?page=1&per_page=20&q=${encodeURIComponent(discardName)}`);
  const afterDiscard = await page.tabs();
  check('Descartar fecha a aba sem gravar', afterDiscard.length === 3 && discarded.status === 200 && discarded.body?.total === 0,
    { abas: afterDiscard.map(t => t.text), status: discarded.status, total: discarded.body?.total });

  await page.eval(`document.getElementById('aba-${keepDraft}').click()`); await sleep(400);
  await page.eval(`document.getElementById('aba-${keepDraft}').nextElementSibling.click()`);
  await page.waitFor('document.querySelector("[role=alertdialog]")', 5000);
  await page.dialogClick('Salvar e fechar');
  await page.waitFor(`document.querySelector('[role=alertdialog] [role=alert]')`, 8000);
  check('Salvar com formulário inválido não fecha e informa que nada foi salvo',
    (await page.dialogText()).includes('Não foi possível salvar') && (await page.tabs()).length === 3);
  await page.dialogClick('Permanecer'); await sleep(300);
  const savedName = `Órgão sintético navegador 38 ${stamp}`;
  await page.fill(page.inPanel('input[name=name]'), savedName);
  await page.fill(page.inPanel('input[name=cnpj]'), cnpj(stamp % 1e12));
  await page.fill(page.inPanel('input[name=email]'), 'sintetico38@example.com');
  await page.fill(page.inPanel('input[name=phone]'), '0000000000');
  await page.eval(`document.getElementById('aba-${keepDraft}').nextElementSibling.click()`);
  await page.waitFor('document.querySelector("[role=alertdialog]")', 5000);
  await page.dialogClick('Salvar e fechar');
  await page.waitFor(`document.querySelectorAll('[role=tab]').length === 2`, 15000);
  const created = await page.api(`/customers?page=1&per_page=20&q=${encodeURIComponent(savedName)}`);
  const savedOk = created.body?.total === 1 && (await page.tabs()).length === 2;
  check('Salvar e fechar usa a gravação real e só fecha após sucesso', savedOk, savedOk ? undefined : {
    abas: (await page.tabs()).map(t => t.text), total: created.body?.total, dialogo: await page.dialogText(),
    mensagens: await page.eval(`[...document.querySelectorAll('[role=tabpanel]:not([hidden]) [role=alert], [role=tabpanel]:not([hidden]) [role=status]')].map(e => e.innerText)`) });
  if (!savedOk) throw new Error('Cadastro pelo fechamento não confirmado; cenários dependentes interrompidos.');
  const orgId = created.body.data[0].id;

  // Conflito de edição: outra gravação muda a versão; o formulário não é perdido.
  await page.activate('Órgãos Plataforma');
  await page.fill(page.inPanel('input[name=busca]'), savedName);
  await page.clickWithin('[role=tabpanel]:not([hidden]) form', 'Buscar');
  await page.waitFor(`document.querySelector('${page.inPanel('tbody')}')?.innerText.includes(${JSON.stringify(savedName)})`);
  await page.clickWithin('[role=tabpanel]:not([hidden]) tbody', 'Consultar');
  await page.waitFor(`document.querySelector('[role=tab][aria-selected=true]')?.innerText.includes('Órgão #${orgId}')`);
  await page.waitFor(`document.querySelector('${page.inPanel('input[name=phone]')}:not(:disabled)')`);
  await page.fill(page.inPanel('input[name=phone]'), '1111111111');
  const currentRow = await page.api(`/customers/${orgId}`);
  const fields = ['name', 'email', 'phone', 'status', 'zip_code', 'address', 'number', 'neighborhood', 'city', 'state', 'complement', 'latitude', 'longitude', 'cnpj'];
  const body = Object.fromEntries(fields.map(k => [k, currentRow.body[k] ?? null]));
  const concurrent = await page.api(`/customers/${orgId}`, 'PUT', { ...body, phone: '2222222222' },
    { 'If-Match': currentRow.etag, 'Idempotency-Key': `browser38-conflito-${stamp}` });
  check('Gravação concorrente sintética aceita pela API', concurrent.status === 200, concurrent.status);
  await page.clickWithin('[role=tabpanel]:not([hidden]) form', 'Salvar');
  await page.waitText('O registro mudou');
  check('Conflito informado e formulário preservado', await page.value(page.inPanel('input[name=phone]')) === '1111111111');
  await page.closeTab(`Órgão #${orgId}`);
  await page.waitFor('document.querySelector("[role=alertdialog]")', 5000);
  await page.dialogClick('Salvar e fechar');
  await page.waitFor(`document.querySelector('[role=alertdialog] [role=alert]')`, 8000);
  const after = await page.api(`/customers/${orgId}`);
  check('Salvar e fechar em conflito não fecha e não sobrescreve a outra gravação',
    (await page.tabs()).some(t => t.text.includes(`Órgão #${orgId}`)) && after.body.phone === '2222222222');
  await page.dialogClick('Descartar e fechar'); await sleep(400);

  // Medições: abrir, alternar e fechar um conjunto representativo de abas.
  page.requests = [];
  for (const code of ['adm.identidades']) await page.openRoutine(code);
  for (const id of [orgId]) {
    await page.activate('Órgãos Plataforma');
    await page.clickWithin('[role=tabpanel]:not([hidden]) tbody', 'Consultar');
    await page.waitFor(`document.querySelector('[role=tab][aria-selected=true]')?.innerText.includes('Órgão #${id}')`);
  }
  await page.activate('Órgãos Plataforma');
  for (let i = 0; i < 3; i++) {
    const clicked = await page.clickWithin('[role=tabpanel]:not([hidden])', 'Cadastrar órgão');
    if (!await page.waitFor(`document.querySelectorAll('[role=tab]').length === ${5 + i}`, 15000))
      (measures.diagnostico_rascunho ??= []).push({ tentativa: i, clicou: clicked, abas: (await page.tabs()).map(t => t.text),
        caminho: await page.path(), painel: (await page.eval(`document.querySelector('[role=tabpanel]:not([hidden])')?.innerText.slice(0, 200) ?? null`)),
        avisos: await page.eval(`[...document.querySelectorAll('[role=alert],[role=status]')].map(e => e.innerText).filter(Boolean)`) });
    await page.activate('Órgãos Plataforma');
  }
  const openedTabs = (await page.tabs()).map(t => t.text);
  const opened = openedTabs.length;
  const heapOpen = await page.heap();
  const countOpen = await page.counters();
  const openCalls = page.requests.length;
  page.requests = [];
  const ids = (await page.tabs()).map(t => t.id);
  const mountedIds = await page.eval(`[...document.querySelectorAll('[role=tabpanel]')].map(p => p.id.slice(7))`);
  for (let round = 0; round < 2; round++)
    for (const id of mountedIds) { await page.eval(`document.getElementById('aba-${id}').click()`); await sleep(250); }
  const switchCalls = page.requests.slice();
  const countSwitch = await page.counters();
  const heapSwitch = await page.heap();
  check('Alternar entre abas montadas não remonta rotinas', countSwitch.mounts === countOpen.mounts, { countOpen, countSwitch });
  check('Alternar entre abas montadas não repete consultas de dados (no máximo revalidação)',
    switchCalls.every(r => r.includes('/me/navigation')), switchCalls);
  page.requests = [];
  for (const id of ids) { await page.eval(`document.getElementById('aba-${id}').click()`); await sleep(300); }
  const cycleCalls = page.requests.slice();
  const countCycle = await page.counters();
  await page.activate('Órgãos Plataforma');
  check('Filtro e página guardados na aba sobrevivem à hibernação', await page.value(page.inPanel('input[name=busca]')) === savedName);
  measures.platform = {
    condicoes: 'Chrome headless 1366x900, prévia compilada local 3003, API e banco sintéticos locais',
    inicio: { heap_kb: heap0, montagens: count0.mounts },
    abertas: { abas: opened, titulos: openedTabs, heap_kb: heapOpen, montagens: countOpen.mounts, desmontagens: countOpen.unmounts, requisicoes_abrir: openCalls },
    primeiras_aberturas: openRequests,
    alternancias_montadas: { abas_montadas: mountedIds.length, trocas: mountedIds.length * 2, requisicoes: switchCalls.length, heap_kb: heapSwitch, montagens: countSwitch.mounts },
    ciclo_todas: { abas: ids.length, trocas: ids.length, remontagens: countCycle.mounts - countSwitch.mounts, requisicoes: cycleCalls },
  };

  // Restauração autorizada após recarregar, sem rascunhos.
  await page.activate('Novo órgão');
  await page.fill(page.inPanel('input[name=name]'), 'Rascunho de recarga 38');
  await sleep(300);
  check('Saída ou recarga com alterações é interceptada pelo aviso do navegador',
    await page.eval(`(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`));
  page.dialogs = [];
  await page.send('Page.reload');
  await page.waitFor('document.readyState === "complete"');
  await page.waitText('aba(s) restaurada(s) após revalidação', 20000);
  const restored = await page.tabs();
  const notice = await page.text();
  measures.platform.dialogos_ao_recarregar = page.dialogs;
  check('Restauração revalidada mantém rotinas e registros autorizados', restored.length === opened - 3, { restored: restored.length, opened });
  check('Aviso informa que rascunhos não persistidos foram perdidos', notice.includes('3 rascunho(s) não salvo(s) foram perdidos'));
  await sleep(800);
  check('Endereço do rascunho ativo não recria formulário vazio após recarregar',
    !(await page.path()).includes('/novo') && (await page.tabs()).length === restored.length && !(await page.tabs()).some(t => t.text.includes('Novo órgão')),
    { caminho: await page.path(), abas: (await page.tabs()).map(t => t.text) });
  const storage = await page.storage();
  check('Armazenamento sem credenciais, CPFs, senhas ou formulários', withoutSecrets(storage, ['Rascunho', savedName, '1111111111', 'sintético B']));
  const stored = JSON.parse(JSON.parse(storage).session['elo:espaco-de-trabalho:v1']);
  check('Descritores guardam só IDs, rotina, visão, ordem e aba ativa',
    stored.tabs.every(t => Object.keys(t).sort().join() === 'customerId,entityId,id,mode,officeId,routine,view'));
  const countReload = await page.counters();
  measures.platform.recarregar = { abas: restored.length, montagens_apos_restaurar: countReload.mounts };

  // Restauração recusada: descritor adulterado para um órgão sem vínculo.
  await page.eval(`(() => { const k = 'elo:espaco-de-trabalho:v1'; const s = JSON.parse(sessionStorage.getItem(k));
    s.tabs.push({ id: 'adulterada', mode: 'customer_admin', customerId: 2, officeId: null, routine: 'adm.secretarias', view: 'list', entityId: null });
    s.tabs.push({ id: 'rotina-falsa', mode: 'platform', customerId: null, officeId: null, routine: 'adm.contratos', view: 'list', entityId: null });
    sessionStorage.setItem(k, JSON.stringify(s)); })()`);
  page.requests = [];
  await page.send('Page.reload');
  await page.waitFor('document.readyState === "complete"');
  await page.waitText('não restaurada(s)', 20000);
  const refusedTabs = await page.tabs();
  const refusedText = await page.text();
  check('Restauração recusa contexto sem autorização e rotina fora do registro',
    refusedTabs.length === restored.length && refusedText.includes('1 aba(s) não restaurada(s)'),
    { abas: refusedTabs.map(t => t.text), esperado: restored.length, aviso: refusedText.match(/d+ aba(s)[^.]*./g) });
  check('Nenhum dado do órgão sem vínculo foi consultado na restauração',
    !page.requests.some(r => r.includes('/officers')), page.requests);

  // Fechar todas as abas: memória e desmontagens.
  const beforeClose = await page.counters();
  for (const t of await page.tabs()) { await page.closeTab(t.text.replace(/^Ativa: /, '').split(' ').slice(0, 2).join(' ')); await sleep(250); }
  for (let i = 0; i < 10 && (await page.tabs()).length; i++) { await page.eval(`document.querySelector('[role=tab]')?.nextElementSibling.click()`); await sleep(250); }
  const closedCount = await page.counters();
  const heapClosed = await page.heap();
  check('Fechar todas as abas desmonta os painéis', (await page.tabs()).length === 0
    && (await page.eval(`document.querySelectorAll('[role=tabpanel]').length`)) === 0);
  measures.platform.fechar_todas = { heap_kb: heapClosed, desmontagens: closedCount.unmounts - beforeClose.unmounts, montagens_total: closedCount.mounts };

  // Duas abas do navegador: espaços de trabalho independentes na mesma sessão.
  const second = await browser.tab(browserContext);
  await second.go('/app/contexto');
  await second.waitFor('location.pathname === "/app/dashboard"');
  await second.waitFor('document.querySelector("button[data-routine]")');
  check('Segunda aba do navegador começa sem as abas internas da primeira', (await second.tabs()).length === 0);
  await second.openRoutine('adm.perfis_modelo');
  await sleep(300);
  check('Abrir rotina na segunda aba do navegador não altera a primeira',
    (await second.tabs()).length === 1 && (await page.tabs()).length === 0);
  await second.send('Page.close').catch(() => null);

  // Logout limpa o espaço de trabalho; outra identidade não herda nada.
  await page.clickWithin('[aria-label="Contexto da aba"]', 'Sair');
  await page.waitFor('location.pathname === "/"', 20000);
  const cleared = await page.storage();
  check('Logout remove descritores e contexto do armazenamento', !cleared.includes('elo:espaco-de-trabalho') && !cleared.includes('elo:contexto-da-aba'));
  await page.login(access.demo_users.admin_orgao_a);
  await page.waitFor('location.pathname === "/app/dashboard" || location.pathname === "/app/contexto"');
  check('Troca de identidade começa sem abas da identidade anterior', (await page.tabs()).length === 0 && !(await page.text()).includes(savedName));
  await page.send('Page.close').catch(() => null);
  return orgId;
}

async function adminScenario(browser) {
  current = 'administração do órgão';
  const page = await browser.tab(await browser.context());
  await page.login(access.demo_users.admin_orgao_a);
  if ((await page.path()).startsWith('/app/contexto')) {
    await page.waitText('Modo administrativo do órgão');
    await page.clickWithin('section[aria-labelledby=context-title]', 'Modo administrativo do órgão');
  }
  await page.waitFor('location.pathname === "/app/dashboard"');
  await page.waitFor('document.querySelector("button[data-routine]")');
  const menu = await page.menu();
  check('Menu do modo administrativo do órgão segue as permissões efetivas',
    JSON.stringify(menu['Administração']) === JSON.stringify(['adm.secretarias', 'adm.departamentos', 'adm.vinculos', 'adm.convites', 'adm.sessoes', 'adm.integracoes'])
      && menu['Elo Gestão'].length === 0, menu);

  await page.go('/app/administracao/departamentos');
  await page.waitFor('location.pathname === "/app/orgaos/1/administracao/departamentos"', 15000);
  check('Caminho da 3.7 abre a aba e passa ao endereço canônico', (await page.activeTab())?.includes('Departamentos'));
  await page.waitFor(`document.querySelector('${page.inPanel('tbody a')}')`);
  await page.clickWithin('[role=tabpanel]:not([hidden]) tbody', 'Consultar');
  await page.waitFor(`document.querySelector('[role=tab][aria-selected=true]')?.innerText.includes('Departamento #')`);
  await page.waitFor(`document.querySelector('${page.inPanel('input[name=name]')}:not(:disabled)')`);
  const original = await page.value(page.inPanel('input[name=name]'));
  await page.fill(page.inPanel('input[name=name]'), original.replace(/ · 38.*$/, '') + ` · 38 ${stamp % 1000}`);
  await page.openRoutine('adm.secretarias');
  await page.activate('Departamento #');

  // Gravação em andamento: a requisição fica retida enquanto outra aba é ativada.
  await page.hold('*/api/elo/departments/*');
  await page.clickWithin('[role=tabpanel]:not([hidden]) form', 'Salvar');
  const paused = await page.waitPaused();
  await page.activate('Secretarias');
  const headers = paused?.request.headers ?? {};
  check('Gravação retida mantém o órgão de origem e nenhum outro contexto',
    paused?.request.method === 'PUT' && headers['X-Elo-Customer-Id'] === '1' && !headers['X-Elo-Municipal-Office-Id'], { method: paused?.request.method });
  await page.release();
  await sleep(1200);
  check('Resultado da gravação não aparece na aba ativa de outra rotina', !(await page.eval(`document.querySelector('[role=tabpanel]:not([hidden])').innerText`)).includes('Operação concluída'));
  await page.activate('Departamento #');
  check('Resultado da gravação aparece somente na aba de origem', await page.waitFor(`document.querySelector('[role=tabpanel]:not([hidden])').innerText.includes('Operação concluída')`, 8000));

  // Resposta atrasada: busca retida na lista de secretarias enquanto a aba de departamentos está ativa.
  await page.activate('Secretarias');
  await page.hold('*/api/elo/officers*');
  await page.fill(page.inPanel('input[name=busca]'), 'saúde');
  await page.clickWithin('[role=tabpanel]:not([hidden]) form', 'Buscar');
  await page.waitPaused();
  await page.activate('Departamento #');
  const shownBefore = await page.eval(`document.querySelector('[role=tabpanel]:not([hidden])').innerText`);
  await page.release();
  await sleep(1200);
  const shownAfter = await page.eval(`document.querySelector('[role=tabpanel]:not([hidden])').innerText`);
  check('Resposta atrasada não altera a aba ativa', shownBefore === shownAfter, shownBefore === shownAfter ? undefined : { antes: shownBefore.slice(0, 300), depois: shownAfter.slice(0, 300) });
  await page.activate('Secretarias');
  check('Resposta atrasada aplicada somente à aba de origem',
    await page.waitFor(`document.querySelector('${page.inPanel('tbody')}')?.innerText.includes(${JSON.stringify(A2)})`, 8000)
      && !(await page.eval(`document.querySelector('${page.inPanel('tbody')}').innerText`)).includes(A1));

  // Segredo de exibição única: confirmação própria, nunca persistido.
  await page.openRoutine('adm.integracoes');
  await page.clickWithin('[role=tabpanel]:not([hidden])', 'Criar integração');
  await page.waitFor(`document.querySelector('${page.inPanel('input[name=name]')}')`);
  await page.fill(page.inPanel('input[name=name]'), `Integração sintética 38 ${stamp}`);
  await page.waitFor(`document.querySelector('${page.inPanel('fieldset fieldset input[type=checkbox]')}')`);
  await page.eval(`document.querySelector('${page.inPanel('fieldset input[type=checkbox]')}').click()`);
  await sleep(200);
  await page.eval(`[...document.querySelectorAll('${page.inPanel('label')}')].find(l => /config\./.test(l.innerText) && l.querySelector('input:not(:disabled)'))?.querySelector('input').click()`);
  await page.fill(page.inPanel('input[name=reason]'), 'Ensaio sintético da 3.8');
  await page.clickWithin('[role=tabpanel]:not([hidden]) form', 'Salvar integração');
  const secretShown = await page.waitFor(`document.querySelector('${page.inPanel('textarea[readonly]')}')?.value.length > 20`, 10000);
  const secret = secretShown ? await page.value(page.inPanel('textarea[readonly]')) : '';
  check('Segredo exibido uma vez na aba de origem', secretShown);
  check('Aba indica segredo exibido em texto', (await page.activeTab()).includes('segredo exibido'));
  await page.closeTab('Nova integração');
  await page.waitFor('document.querySelector("[role=alertdialog]")', 5000);
  const secretDialog = await page.dialogText();
  check('Fechar com segredo pede confirmação própria e não oferece salvar',
    secretDialog.includes('segredo de exibição única') && secretDialog.includes('Fechar sem manter o segredo') && !secretDialog.includes('Salvar e fechar'));
  check('Segredo não aparece no armazenamento do navegador', withoutSecrets(await page.storage(), [secret]));
  await page.dialogClick('Fechar sem manter o segredo');
  await sleep(500);
  const revoke = await page.api(`/customers/1/integration-clients?per_page=100`);
  const client = revoke.body?.items?.find(i => i.name === `Integração sintética 38 ${stamp}`);
  check('Integração sintética localizada para revogação ao final do ensaio', !!client);
  if (client) {
    const ended = await page.api(`/customers/1/integration-clients/${client.id}/revoke`, 'POST', { reason: 'Encerramento do ensaio sintético da 3.8' },
      { 'If-Match': `"v${client.version}"`, 'Idempotency-Key': `browser38-revogar-${stamp}` });
    check('Credencial sintética revogada ao final do ensaio', ended.status === 200, ended.status);
  }

  await page.shot('administracao-orgao-abas');
  check('Administração do órgão no celular sem rolagem horizontal da página', await page.shot('administracao-orgao-abas', true));
  for (const code of ['adm.vinculos', 'adm.convites', 'adm.sessoes']) await page.openRoutine(code);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.send('Page.reload');
  await page.waitFor('document.readyState === "complete"');
  await page.waitText('restaurada(s)', 20000);
  await sleep(1000);
  check('Celular com várias abas restauradas e a ativa no fim da barra não alarga a página',
    await page.eval('document.documentElement.scrollWidth <= 391 && window.innerWidth <= 391'),
    await page.eval('({ largura: document.documentElement.scrollWidth, janela: window.innerWidth })'));
  await page.desktop();
  return page;
}

async function multiScenario(browser, admin) {
  current = 'dois órgãos';
  const page = await browser.tab(await browser.context());
  await page.login(access.demo_users.multi_orgao);
  await page.choose(ORG_A, A1);
  await page.waitFor('document.querySelector("button[data-routine]")');
  const menu = await page.menu();
  check('Menu da secretaria lista somente consultas operacionais autorizadas',
    JSON.stringify(menu['Elo Gestão']) === JSON.stringify(['ope.secretarias', 'ope.departamentos']) && menu['Administração'].length === 0, menu);
  await page.openRoutine('ope.secretarias');
  await page.waitFor(`document.querySelector('${page.inPanel('tbody')}')`);
  check('Consulta operacional não oferece cadastro', !(await page.text()).includes('Cadastrar secretaria'));
  await page.choose(ORG_B, B1);
  check('Mudar a seleção não converte a aba aberta', (await page.tabs())[0].text.includes(ORG_A));
  await page.openRoutine('ope.secretarias');
  await page.waitFor(`document.querySelector('${page.inPanel('tbody')}')`);
  const tabs = await page.tabs();
  check('Mesma rotina aberta em dois órgãos, com contexto textual em cada aba',
    tabs.length === 2 && tabs[0].text.includes(ORG_A) && tabs[1].text.includes(ORG_B), tabs);
  check('Cada aba consulta somente o próprio órgão',
    (await page.eval(`document.querySelector('${page.inPanel('tbody')}').innerText`)).includes(B1)
      && !(await page.eval(`document.querySelector('${page.inPanel('tbody')}').innerText`)).includes(A1));

  // Revogação limitada ao órgão A com a aba A inativa; a aba B continua válida.
  await page.activate(ORG_A);
  await page.hold('*/api/elo/officers*');
  await page.fill(page.inPanel('input[name=busca]'), 'Unidade');
  await page.clickWithin('[role=tabpanel]:not([hidden]) form', 'Buscar');
  await page.waitPaused();
  await page.activate(ORG_B);
  const session = await page.eval('fetch("/api/auth/session").then(r => r.json())');
  const revoked = await admin.api(`/customers/1/sessions/${session.sessionId}/revoke-customer-access`, 'POST',
    { reason: 'Ensaio sintético da 3.8: revogação limitada ao órgão' }, { 'Idempotency-Key': `browser38-orgao-${stamp}` });
  check('Administrador do órgão A encerra o acesso da sessão somente em A', revoked.status === 200, revoked.status);
  await page.release();
  await page.waitFor(`[...document.querySelectorAll('[role=tab]')].some(t => t.innerText.includes('acesso encerrado'))`, 10000);
  const after = await page.tabs();
  check('Resposta negada da aba inativa bloqueia somente a aba de A', after.find(t => t.text.includes(ORG_A))?.text.includes('acesso encerrado')
    && !after.find(t => t.text.includes(ORG_B))?.text.includes('acesso encerrado'), after);
  check('Aba ativa de B continua exibindo seus dados', (await page.eval(`document.querySelector('${page.inPanel('tbody')}')?.innerText ?? ''`)).includes(B1)
    && (await page.eval(`document.querySelector('[data-testid=contexto-aba-ativa]').innerText`)).includes(ORG_B));
  await page.activate(ORG_A);
  check('Aba de A mostra mensagem compreensível e nenhum dado protegido',
    (await page.text()).includes('Acesso encerrado nesta aba') && !(await page.eval(`document.querySelector('[role=tabpanel]:not([hidden]) table') !== null`)));
  check('Painel de A desmontado: sem tabela de A oculta no documento', !(await page.eval(`[...document.querySelectorAll('[role=tabpanel] tbody')].some(t => t.innerText.includes(${JSON.stringify(A1)}))`)));
  await page.closeTab(ORG_A);
  await sleep(300);
  check('Aba bloqueada fecha sem diálogo de alterações', (await page.tabs()).length === 1 && !(await page.dialogText()));
  await page.go('/app/orgaos/1/secretarias/1/secretarias');
  check('Reabrir A por URL direta após a revogação é recusado',
    await page.waitText('O acesso desta sessão ao órgão foi encerrado.', 10000) && (await page.tabs()).length === 1);
  await page.send('Page.close').catch(() => null);
}

async function officesScenario(browser) {
  current = 'duas secretarias';
  const page = await browser.tab(await browser.context());
  await page.login(access.demo_users.consulta_duas_secretarias);
  await page.choose(ORG_A, A1);
  await page.openRoutine('ope.departamentos');
  await page.openRoutine('ope.secretarias');
  await page.fill(page.inPanel('input[name=busca]'), 'Unidade');
  await page.clickWithin('[role=tabpanel]:not([hidden]) form', 'Buscar');
  await page.choose(ORG_A, A2);
  await page.openRoutine('ope.secretarias');
  const tabs = await page.tabs();
  check('Mesma rotina em duas secretarias do mesmo órgão',
    tabs.filter(t => t.text.includes('Secretarias (consulta)')).length === 2 && tabs.some(t => t.text.includes(A1)) && tabs.some(t => t.text.includes(A2)), tabs);
  check('Filtro da nova aba começa vazio', await page.value(page.inPanel('input[name=busca]')) === '');
  await page.activate(`Secretarias (consulta) ${ORG_A} · ${A1}`);
  check('Filtro da aba da primeira secretaria preservado', await page.value(page.inPanel('input[name=busca]')) === 'Unidade');
  await page.go('/app/orgaos/2/secretarias/3/secretarias');
  check('URL direta para órgão sem vínculo é recusada', await page.waitText('Sem acesso a este órgão, secretaria ou modo.', 10000));
  await page.go('/app/orgaos/1/administracao/secretarias');
  check('URL direta para administração sem perfil administrativo é recusada', await page.waitText('Sem acesso a este órgão, secretaria ou modo.', 10000));
  await page.go('/app/orgaos/1/secretarias/1/vinculos');
  check('Rotina fora do modo da secretaria é indisponível', await page.waitText('Endereço inválido ou rotina indisponível', 10000));
  check('Recusas não criaram abas', (await page.tabs()).length === tabs.length);
  await page.activate(`Departamentos (consulta)`);
  check('Aviso de endereço recusado é dispensado ao ativar uma aba', !(await page.text()).includes('Endereço inválido ou rotina indisponível'));

  // Acessibilidade e celular: lista de abas com alternativa ao arraste.
  await page.eval(`[...document.querySelectorAll('button')].find(b => b.innerText.startsWith('Abas ('))?.click()`);
  await page.waitFor('document.getElementById("organizar-abas")');
  const panel = await page.eval(`document.getElementById('organizar-abas').innerText`);
  check('Lista de abas oferece ativar, mover e fechar sem gesto', ['Ativar', 'Mover para antes', 'Mover para depois', 'Fechar'].every(t => panel.includes(t)));
  const order = (await page.tabs()).map(t => t.id);
  await page.eval(`[...document.querySelectorAll('#organizar-abas button')].filter(b => b.innerText === 'Mover para depois')[0].click()`);
  await sleep(300);
  const moved = (await page.tabs()).map(t => t.id);
  check('Mover pela lista reordena as abas', moved[1] === order[0] && moved[0] === order[1], { order, moved });
  check('Semântica de abas: tablist, tab, tabpanel e aria-controls coerentes', await page.eval(`(() => {
    const list = document.querySelector('[role=tablist]'); const tabs = [...list.querySelectorAll('[role=tab]')];
    return tabs.length > 0 && tabs.filter(t => t.tabIndex === 0).length === 1 && tabs.every(t => !document.getElementById(t.getAttribute('aria-controls'))
      || document.getElementById(t.getAttribute('aria-controls')).getAttribute('aria-labelledby') === t.id); })()`));
  await page.shot('operacao-duas-secretarias');
  const mobileOk = await page.shot('operacao-duas-secretarias', true);
  check('Operação com abas no celular sem rolagem horizontal da página', mobileOk);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  await page.eval(`void (document.getElementById('organizar-abas') || [...document.querySelectorAll('button')].find(b => b.innerText.startsWith('Abas ('))?.click())`);
  await page.waitFor('document.getElementById("organizar-abas")');
  await page.eval(`[...document.querySelectorAll('#organizar-abas li')].pop().querySelector('button').click()`);
  await sleep(700);
  check('No celular, a aba ativada pela lista fica visível na barra', await page.eval(`(() => {
    const list = document.querySelector('[role=tablist]').getBoundingClientRect();
    const tab = document.querySelector('[role=tab][aria-selected=true]').getBoundingClientRect();
    return tab.left >= list.left - 1 && tab.right <= list.right + 1; })()`));
  check('No celular, a barra de abas rola internamente e o menu fica recolhível',
    await page.eval(`getComputedStyle(document.querySelector('[role=tablist]')).overflowX === 'auto'
      && document.getElementById('menu-rotinas').classList.contains('hidden')`));
  await page.desktop();
  await page.send('Page.close').catch(() => null);
}

// Revisão independente da 3.8 (R38-01 e R38-02) -----------------------------------------------------

async function adminMode(page) {
  if ((await page.path()).startsWith('/app/contexto')) {
    await page.waitText('Modo administrativo do órgão');
    await page.clickWithin('section[aria-labelledby=context-title]', 'Modo administrativo do órgão');
  }
  await page.waitFor('location.pathname === "/app/dashboard"');
  await page.waitFor('document.querySelector("button[data-routine]:not(:disabled)")');
}

const identityText = page => page.eval(`document.querySelector('[aria-label="Contexto da aba"]')?.innerText ?? ''`);

// R38-01: resposta de abertura retida enquanto outra identidade assume a sessão do navegador.
async function staleIdentityScenario(browser) {
  current = 'R38-01 identidade trocada com abertura retida';
  const page = await browser.tab(await browser.context());
  await page.login(access.demo_users.admin_orgao_a);
  await adminMode(page);
  const before = await identityText(page);
  await page.holdResponse('*/api/elo/me/navigation*');
  await page.eval(`document.querySelector('button[data-routine="adm.secretarias"]').click()`);
  const paused = await page.waitPaused();
  check('Resposta da abertura retida no navegador (identidade anterior)', paused?.responseStatusCode === 200,
    paused?.responseStatusCode);
  // Mesmo cookie do navegador: outra identidade entra pelo endpoint de credenciais, sem sair antes.
  const next = access.demo_users.consulta_duas_secretarias;
  const signed = await page.eval(`(async () => {
    const { csrfToken } = await (await fetch('/api/auth/csrf')).json();
    const body = new URLSearchParams({ username: ${JSON.stringify(cpfMasked(next.cpf))}, password: ${JSON.stringify(next.password)},
      csrfToken, json: 'true' });
    const response = await fetch('/api/auth/callback/credentials', { method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const session = await (await fetch('/api/auth/session')).json();
    return { status: response.status, changed: !!session?.user && JSON.stringify(session).length > 2 };
  })()`);
  check('Outra identidade entrou na mesma sessão do navegador', signed?.status === 200 && signed.changed, signed);
  await page.eval(`document.dispatchEvent(new Event('visibilitychange'))`);
  const switched = await page.waitFor(`(document.querySelector('[aria-label="Contexto da aba"]')?.innerText ?? '')
    !== ${JSON.stringify(before)} && !!document.querySelector('[aria-label="Contexto da aba"]')`, 20000);
  check('Outra identidade assumiu a página antes da resposta', switched);
  await page.release();
  await sleep(2500);
  const tabs = await page.tabs();
  const stored = await page.eval(`sessionStorage.getItem('elo:espaco-de-trabalho:v1')`);
  const descriptors = stored ? JSON.parse(stored).tabs : [];
  check('Resposta da identidade anterior não cria aba', tabs.length === 0, tabs.map(t => t.text));
  check('Resposta da identidade anterior não muda o endereço', !(await page.path()).includes('/administracao/secretarias'),
    await page.path());
  check('Resposta da identidade anterior não grava descritor', descriptors.length === 0, descriptors);
  const text = await page.text();
  check('Indicador de abertura encerrado e nenhum aviso da identidade anterior',
    !text.includes('Validando o acesso à rotina') && !text.includes('Sem autorização para esta rotina'));
  await page.send('Page.close').catch(() => null);
}

// R38-02: revisão de autorização nova não destrói a edição; conflito e perda real de acesso preservados.
async function revisionScenario(browser) {
  current = 'R38-02 revisão nova preserva edição';
  const page = await browser.tab(await browser.context());
  await page.login(access.demo_users.admin_orgao_a);
  await adminMode(page);
  await page.go('/app/administracao/departamentos');
  await page.waitFor('location.pathname === "/app/orgaos/1/administracao/departamentos"', 15000);
  await page.waitFor(`document.querySelector('${page.inPanel('tbody a')}')`);
  await page.clickWithin('[role=tabpanel]:not([hidden]) tbody', 'Consultar');
  await page.waitFor(`document.querySelector('[role=tab][aria-selected=true]')?.innerText.includes('Departamento #')`);
  const field = page.inPanel('input[name=name]');
  await page.waitFor(`document.querySelector('${field}:not(:disabled)')`);
  const recordId = (await page.path()).split('/').pop();
  const original = await page.value(field);
  const typed = `R38-02 edição ${stamp % 100000}`;
  await page.fill(field, typed);
  check('Edição não salva marcada na aba', (await page.activeTab()).includes('alterada, não salva'));
  await page.openRoutine('adm.secretarias');

  // Revisão nova sem perda de acesso: a plataforma altera o órgão (auth_version do órgão).
  const platform = await browser.tab(await browser.context());
  await platform.login(access.user);
  const customer = await platform.api('/customers/1');
  const bumped = await platform.api('/customers/1', 'PUT', customer.body, { 'If-Match': customer.etag });
  check('Plataforma altera o órgão, gerando nova revisão de autorização', bumped.status === 200, bumped.status);

  // Revalidação real: a aba volta a ser exibida depois de 60 s.
  await sleep(61000);
  page.requests.length = 0;
  await page.activate('Departamento #');
  const revalidated = await (async () => {
    for (let i = 0; i < 60; i++) {
      if (page.requests.includes('GET /api/elo/me/navigation') && page.requests.includes(`GET /api/elo/departments/${recordId}`))
        return true;
      await sleep(150);
    }
    return false;
  })();
  await sleep(800);
  check('Revalidação consultou a navegação e o registro sob a nova revisão', revalidated, page.requests);
  check('Edição não salva preservada após a nova revisão', (await page.value(field)) === typed, await page.value(field));
  check('Aba continua indicada como alterada', (await page.activeTab()).includes('alterada, não salva'));

  // ETag e conflito: outra sessão altera o registro; a gravação com o ETag do formulário recebe 412.
  const other = await browser.tab(await browser.context());
  await other.login(access.demo_users.admin_orgao_a);
  const headers = { 'X-Elo-Customer-Id': '1' };
  const record = await other.api(`/departments/${recordId}`, 'GET', null, headers);
  const changed = await other.api(`/departments/${recordId}`, 'PUT', { ...record.body, name: `${original} ·R38` },
    { ...headers, 'If-Match': record.etag, 'Idempotency-Key': `r38-02-alterar-${stamp}` });
  check('Outra sessão altera o registro em edição', changed.status === 200, changed.status);
  await page.clickWithin('[role=tabpanel]:not([hidden]) form', 'Salvar');
  check('Gravação com o ETag do formulário recebe conflito e preserva o texto',
    await page.waitText('O registro mudou', 10000) && (await page.value(field)) === typed);

  // Regressão — perda real de acesso: sessão encerrada no órgão. A aba é bloqueada sem manter dados.
  const sessions = await page.api('/me/sessions');
  const sid = sessions.body?.items?.find(s => s.current)?.id;
  const revoked = await other.api(`/customers/1/sessions/${sid}/revoke-customer-access`, 'POST',
    { reason: 'Ensaio sintético R38-02' }, { 'Idempotency-Key': `r38-02-revogar-${stamp}` });
  check('Acesso da sessão ao órgão encerrado por outra sessão', revoked.status === 200, revoked.status);
  await page.clickWithin('[role=tabpanel]:not([hidden]) form', 'Salvar');
  check('Perda real de acesso bloqueia a aba', await page.waitText('Acesso encerrado nesta aba', 10000));
  await sleep(500);
  check('Nenhum dado nem texto digitado permanece após a perda de acesso',
    !(await page.eval(`document.body.innerHTML.includes(${JSON.stringify(typed)})`))
      && !(await page.eval(`!!document.querySelector('[role=tabpanel] input[name=name]')`)));

  // Restauração do nome sintético.
  const latest = await other.api(`/departments/${recordId}`, 'GET', null, headers);
  const restored = await other.api(`/departments/${recordId}`, 'PUT', { ...latest.body, name: original },
    { ...headers, 'If-Match': latest.etag, 'Idempotency-Key': `r38-02-restaurar-${stamp}` });
  check('Nome sintético do departamento restaurado ao final', restored.status === 200, restored.status);
  for (const tab of [other, platform, page]) await tab.send('Page.close').catch(() => null);
}

(async () => {
  const browser = new Browser();
  await browser.start();
  const started = Date.now();
  let admin;
  try {
    // ELO_BROWSER_ONLY=r38 executa somente os cenários da revisão independente (R38-01 e R38-02).
    const only = process.env.ELO_BROWSER_ONLY;
    const scenarios = [['plataforma', () => platformScenario(browser)], ['administração do órgão', async () => { admin = await adminScenario(browser); }],
      ['dois órgãos', () => multiScenario(browser, admin)], ['duas secretarias', () => officesScenario(browser)],
      ['r38-01', () => staleIdentityScenario(browser)], ['r38-02', () => revisionScenario(browser)]];
    for (const [name, run] of scenarios.filter(([name]) => !only || name.startsWith(only))) {
      try { await run(); } catch (error) { current = name; check('Roteiro concluído sem erro inesperado', false, error.message.slice(0, 300)); }
    }
  } finally {
    await browser.stop();
    const report = { web: WEB, executado_em: new Date().toISOString(), duracao_s: Math.round((Date.now() - started) / 1000),
      aprovadas: results.filter(r => r.ok).length, total: results.length, results, medicoes: measures };
    const text = JSON.stringify(report, null, 2);
    if (!withoutSecrets(text)) throw new Error('Relatório conteria dado sensível; não gravado.');
    fs.writeFileSync(path.join(out, process.env.ELO_BROWSER_ONLY ? `results-${process.env.ELO_BROWSER_ONLY}.json` : 'results.json'), text);
    console.log(`\n${report.aprovadas}/${report.total} verificações aprovadas.`);

    process.exitCode = report.aprovadas === report.total ? 0 : 1;
  }
})();
