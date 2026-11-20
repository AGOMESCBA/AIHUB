// Etapa 3.8: espaço de trabalho com abas, em navegador real contra o ambiente sintético local.
// Sem segredos no relatório: CPFs, senhas, tokens e segredos de integração não são gravados.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = 'C:/Apps/ELOGESTAO';
const access = JSON.parse(fs.readFileSync(path.join(root, '.local/access.json'), 'utf8'));
const WEB = 'http://localhost:3007';
if (!/^http:\/\/(localhost|127\.0\.0\.1):300[123567]$/.test(WEB) || access.api !== 'http://127.0.0.1:8010')
  throw new Error('Somente ambiente local sintético.');
const out = path.join(root, '.local/logs/ux-browser');
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


const seed=JSON.parse(fs.readFileSync(path.join(root,'.local/lotacao-e2e.json'),'utf8'));
const must=async(p,text)=>{if(!await p.waitText(text,15000))throw new Error('Tela não exibiu: '+text)};
const login=async(p,user)=>{await p.go('/');await p.waitFor('document.querySelector("input[name=username]")');await p.fill('input[name=username]',cpfMasked(user.cpf));await p.fill('input[name=password]',user.password);await p.eval('document.querySelector("form button[type=submit]").click()');if(!await p.waitFor('location.pathname.startsWith("/app/")',20000))throw new Error('Login não concluiu');};
const choose=async(p,option)=>{await p.go('/app/contexto?trocar=1');await must(p,'Selecione o órgão e a secretaria');await p.waitFor(`[...document.querySelectorAll('section[aria-labelledby=context-title] button')].some(b=>b.innerText.includes(${JSON.stringify(ORG_A)}))`);await p.clickWithin('section[aria-labelledby=context-title]',ORG_A);await must(p,option);await p.clickWithin('section[aria-labelledby=context-title]',option);await p.waitFor('location.pathname === "/app/dashboard" || location.pathname === "/app/administracao"');};
(async()=>{
 const b=new Browser();let p;
 try{
  await b.start();p=await b.tab(await b.context());await login(p,seed);await choose(p,A2);await must(p,'Tudo o que você precisa');
  check('Cards das rotinas aparecem na primeira área visível',await p.eval(`(()=>{const e=document.querySelector('button.group.relative');return !!e && e.getBoundingClientRect().top<window.innerHeight-100})()`));
  check('Menu tem ícones e troca de secretaria destacada',await p.eval(`!!document.querySelector('nav[aria-label="Rotinas autorizadas"] button[data-routine] svg') && !!document.querySelector('[data-testid=contexto-novas-abas] a')`));
  await p.shot('inicio');
  await p.fill('input[placeholder="Encontrar uma rotina…"]','Veículos');
  check('Busca no menu reduz as opções autorizadas',await p.waitFor(`[...document.querySelectorAll('nav[aria-label="Rotinas autorizadas"] button[data-routine]')].every(b=>b.innerText.includes('Veículos')) && document.querySelectorAll('nav[aria-label="Rotinas autorizadas"] button[data-routine]').length>0`));
  await p.openRoutine('ope.veiculos');await must(p,'Filtre pelos campos');
  check('Grid tem filtros no próprio cabeçalho',await p.eval(`!!document.querySelector('thead input[name=filtro_identificacao]') && document.querySelectorAll('thead select').length===3`));
  await p.fill(p.inPanel('input[name=filtro_identificacao]'),'INEXISTENTE-UX-654321');await p.clickWithin('[role=tabpanel]:not([hidden]) thead','Aplicar busca');await must(p,'Nenhum registro encontrado');
  check('Resultado vazio mantém os filtros editáveis',await p.eval(`document.querySelector('thead input[name=filtro_identificacao]')?.value==='INEXISTENTE-UX-654321'`));
  await p.fill(p.inPanel('input[name=filtro_identificacao]'),'');await p.clickWithin('[role=tabpanel]:not([hidden])','Limpar filtros');await must(p,'Sem filtros aplicados');
  await p.waitFor('document.querySelectorAll("tbody tr").length>0 && !document.body.innerText.includes("Atualizando registros…")');
  check('Limpar filtros recupera os registros',await p.eval(`!!document.querySelector('[role=tabpanel]:not([hidden]) tbody a')`));
  check('Situação usa badge com texto',await p.eval(`!!document.querySelector('[role=tabpanel]:not([hidden]) tbody span.rounded-full')`));
  await p.shot('grid');check('Grid não provoca rolagem horizontal na página de 390 px',await p.shot('grid',true));
  await p.go('/app/contexto?trocar=1');await must(p,'PASSO 1');await p.fill('input[placeholder="Encontrar órgão pelo nome…"]','nao-existe-ux');await must(p,'Nenhum órgão corresponde');
  check('Seletor de órgão possui busca e estado vazio',true);await p.fill('input[placeholder="Encontrar órgão pelo nome…"]','');await p.clickWithin('section[aria-labelledby=context-title]',ORG_A);await must(p,'PASSO 2');await p.shot('secretarias');check('Seletor de secretaria cabe em 390 px',await p.shot('secretarias',true));
  const admin=await b.tab(await b.context());await login(admin,access.user);await must(admin,'Organize seu órgão');
  check('Administrador da plataforma entra diretamente em Administração',await admin.path()==='/app/administracao');
  await admin.shot('administracao');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
 }catch(e){console.error(e.message);if(p)await p.shot('falha').catch(()=>{});process.exitCode=1;}
 finally{await b.stop().catch(()=>{});}
})();
