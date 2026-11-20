// Etapa 3.8: espaço de trabalho com abas, em navegador real contra o ambiente sintético local.
// Sem segredos no relatório: CPFs, senhas, tokens e segredos de integração não são gravados.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = 'C:/Apps/ELOGESTAO';
const access = JSON.parse(fs.readFileSync(path.join(root, '.local/access.json'), 'utf8'));
const WEB = 'http://localhost:3008';
// API da prévia: a padrão (8010) ou a das prévias de avaliação (8012), ambas locais e sintéticas.
const API = 'http://127.0.0.1:8013';
if (!/^http:\/\/(localhost|127\.0\.0\.1):300[1-8]$/.test(WEB) || access.api !== 'http://127.0.0.1:8010'
    || !/^http:\/\/127\.0\.0\.1:801[023]$/.test(API))
  throw new Error('Somente ambiente local sintético.');
const out = path.join(root, '.local/logs/contracts-browser');
const profile = path.join(os.tmpdir(), 'elo-browser-38-' + Date.now());
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(profile, { recursive: true });
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cpfMasked = cpf => cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
const ORG_A = 'Órgão de demonstração';
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
          // Campos de filtro ficam no painel recolhido: abre o painel como o usuário faria.
          const panel = el.closest('[id^=filtros-]');
          if (panel && panel.hidden) document.querySelector('[aria-controls="' + panel.id + '"]')?.click();
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
      text: b.innerText.replace(/\\s*,\\s/g, ' ').replace(/\\s+/g, ' ').trim(), selected: b.getAttribute('aria-selected') === 'true' }))`);
  }
  activeTab() { return this.eval(`document.querySelector('[role=tab][aria-selected=true]')?.innerText.replace(/\\s*,\\s/g, ' ').replace(/\\s+/g, ' ').trim() ?? null`); }
  async activate(fragment) {
    const ok = await this.eval(`(() => { const b = [...document.querySelectorAll('[role=tab]')].find(e => e.innerText.replace(/\\s*,\\s/g, ' ').replace(/\\s+/g, ' ').includes(${JSON.stringify(fragment)}));
      if (!b) return false; b.click(); return true; })()`);
    await this.waitFor(`document.querySelector('[role=tab][aria-selected=true]')?.innerText.replace(/\\s*,\\s/g, ' ').replace(/\\s+/g, ' ').includes(${JSON.stringify(fragment)})`, 10000);
    await sleep(250);
    return ok;
  }
  async openRoutine(code) {
    const before = (await this.tabs()).length;
    // O menu mostra a área exibida: rotina da outra área é aberta depois de trocar de área pelo menu.
    if (!(await this.eval(`!!document.querySelector('button[data-routine="${code}"]')`))) {
      const area = code.startsWith('adm.') ? 'Administração' : 'Operação';
      await this.eval(`document.querySelector('nav[aria-label="Rotinas autorizadas"] a[title="${area}"]')?.click()`);
    }
    await this.waitFor(`document.querySelector('button[data-routine="${code}"]:not(:disabled)')`);
    await this.eval(`document.querySelector('button[data-routine="${code}"]').click()`);
    const ok = await this.waitFor(`document.querySelectorAll('[role=tab]').length > ${before} || document.querySelector('[role=tab][aria-selected=true]')`, 15000);
    await this.waitFor(`document.querySelector('[role=tabpanel]:not([hidden])')`, 10000);
    await sleep(400);
    return ok;
  }
  inPanel(selector) { return `[role=tabpanel]:not([hidden]) ${selector}`; }
  async closeTab(fragment) {
    return this.eval(`(() => { const b = [...document.querySelectorAll('[role=tab]')].find(e => e.innerText.replace(/\\s*,\\s/g, ' ').replace(/\\s+/g, ' ').includes(${JSON.stringify(fragment)}));
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
    // Escolha explícita depois do login (seção 46): a identidade da plataforma entra na administração da
    // plataforma; as demais escolhem órgão e ambiente com choose() ou pela tela de seleção do cenário.
    if (user.cpf === access.user.cpf && (await this.path()).startsWith('/app/contexto')) await this.enterPlatform();
  }
  async enterPlatform() {
    await this.waitFor(`[...document.querySelectorAll('section[aria-labelledby=context-title] button')].some(b => b.innerText.includes('Administração da plataforma'))`, 20000);
    await this.clickWithin('section[aria-labelledby=context-title]', 'Administração da plataforma');
    return this.waitFor('location.pathname === "/app/administracao"', 20000);
  }
  // Seleção para novas abas pela página existente, navegando dentro do painel (abas preservadas).
  async choose(customer, option) {
    // Logo após o login já se está na tela de seleção; depois, o botão abre a troca rápida e o roteiro
    // usa a tela completa pelo link do rodapé.
    if (!(await this.path()).startsWith('/app/contexto')) {
      await this.waitFor('document.querySelector("[data-testid=contexto-novas-abas] button[aria-haspopup]")');
      await this.clickWithin('[data-testid=contexto-novas-abas]', 'Trocar');
      await this.waitFor('[...document.querySelectorAll("[data-testid=contexto-novas-abas] a")].some(a => a.innerText.includes("tela completa"))');
      await this.clickWithin('[data-testid=contexto-novas-abas]', 'tela completa');
      await this.waitFor('location.pathname === "/app/contexto"');
    }
    await this.waitFor(`[...document.querySelectorAll('section button')].some(b => b.innerText.includes(${JSON.stringify(customer)}))`);
    await this.clickWithin('section[aria-labelledby=context-title]', customer);
    await this.waitFor(`[...document.querySelectorAll('section button')].some(b => b.innerText.includes(${JSON.stringify(option)}))`);
    await this.clickWithin('section[aria-labelledby=context-title]', option);
    await this.waitFor('location.pathname === "/app/dashboard" || location.pathname === "/app/administracao"');
    return this.waitFor(`document.querySelector('[data-testid=contexto-novas-abas]')?.innerText.includes(${JSON.stringify(option === 'Modo administrativo do órgão' ? 'Modo administrativo' : option)})`, 15000);
  }
  // Rotinas por área (data-area); os grupos de processo só organizam a apresentação.
  // O menu mostra as rotinas da área exibida; o roteiro alterna as duas áreas pelos links do próprio menu
  // e termina na área Elo Gestão (/app/dashboard).
  async menu() {
    const result = {};
    for (const [label, title, target] of [['Administração', 'Administração', '/app/administracao'], ['Elo Gestão', 'Operação', '/app/dashboard']]) {
      await this.eval(`document.querySelector('nav[aria-label="Rotinas autorizadas"] a[title="${title}"]')?.click()`);
      await this.waitFor(`location.pathname === '${target}'`, 15000);
      await this.waitFor(`!document.body.innerText.includes('Organizando suas rotinas') && !document.body.innerText.includes('Carregando rotinas')`, 15000);
      await sleep(400);
      result[label] = await this.eval(`[...document.querySelectorAll('nav[aria-label="Rotinas autorizadas"] button[data-routine]')].map(b => b.dataset.routine)`);
    }
    return result;
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


{
const demo=JSON.parse(fs.readFileSync(path.join(root,'.local/testes-municipios.json'),'utf8'));
const older=JSON.parse(fs.readFileSync(path.join(root,'.local/lotacao-e2e.json'),'utf8'));
const S='[role="tabpanel"]:not([hidden])';
const stamp=Date.now().toString().slice(-9), number='DEMO-4BC-'+stamp;
const city=demo.customers.find(c=>c.name==='Cuiabá'), office=city.offices.find(o=>o.name==='Saúde');
const headers={'X-Elo-Customer-Id':String(city.id),'X-Elo-Municipal-Office-Id':String(office.id)};
const must=async(p,text)=>{if(!await p.waitText(text,15000))throw new Error('Não exibiu: '+text)};
const good=(r,status)=>{if(r.status!==status)throw new Error('HTTP '+r.status+' '+JSON.stringify(r.body));return r.body;};
async function until(fn){const end=Date.now()+15000;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(120);}throw new Error('Condição não atingida');}
async function login(p,c){await p.go('/');await p.waitFor('(()=>{const e=document.querySelector("input[name=username]");return e&&Object.keys(e).some(k=>k.startsWith("__react"))})()');await p.fill('input[name=username]',cpfMasked(c.cpf));await p.fill('input[name=password]',c.password);await p.eval('document.querySelector("form button[type=submit]").click()');await must(p,'Onde vamos trabalhar?');}
async function choose(p){await p.waitFor(`document.querySelector('ul[aria-label="Órgãos autorizados"] button')`);await p.clickWithin('ul[aria-label="Órgãos autorizados"]','Cuiabá');await must(p,'Escolha sua secretaria');await p.waitFor(`document.querySelector('ul[aria-label="Contextos autorizados"] button')`);await p.clickWithin('ul[aria-label="Contextos autorizados"]','Saúde');await must(p,'Seu trabalho, organizado.');}
async function pick(p,title,text,id){await p.fill(S+` input[name="${title}"]`,text);await p.waitFor(`document.querySelector(${JSON.stringify(S+` [role="listbox"][aria-label="${title}"] [data-value="${id}"]`)})`);await p.eval(`document.querySelector(${JSON.stringify(S+` [role="listbox"][aria-label="${title}"] [data-value="${id}"]`)}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))`);}
async function select(p,title,value){await p.eval(`(()=>{const label=[...document.querySelectorAll(${JSON.stringify(S+' label')})].find(l=>l.querySelector('span')?.textContent===${JSON.stringify(title)});const el=label?.querySelector('select');if(!el)throw new Error('Select não encontrado: '+${JSON.stringify(title)});el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function action(p,command,reason){await select(p,'Ação',command);await p.fill(S+' input[name=reason]',reason);await p.clickWithin(S,'Confirmar ação');}
function validCnpj(seed){let d=String(seed).padStart(8,'0')+'0001';for(const w of [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]]){const n=[...d].reduce((a,c,i)=>a+Number(c)*w[i],0)%11;d+=n<2?'0':String(11-n);}return d;}
(async()=>{const b=new Browser();let p,q,cid;
try{
 await b.start();p=await b.tab(await b.context());await login(p,demo);await choose(p);await p.openRoutine('ope.contratos');await must(p,'Cadastrar contrato');
 check('Menu e GRID de contratos disponíveis na secretaria',await p.eval(`!!document.querySelector(${JSON.stringify(S+' table')})`));
 const types=good(await p.api('/supplier_types?per_page=1','GET',null,headers),200).items;
 const units=good(await p.api('/measurement_units?per_page=1','GET',null,headers),200).items;
 const supplier=good(await p.api('/suppliers','POST',{company_name:'Fornecedor demonstração contratos '+stamp,trading_name:'DEMO 4BC '+stamp,cnpj:validCnpj(98000000+Number(stamp.slice(-6))),type_id:types[0].id,email:'contratos.teste@example.com',phone:'0000000000',zip:'00000000',state:'MT',city:'Cuiabá',district:'Teste',address:'Rua de teste',number:'0',complement:null},{...headers,'Idempotency-Key':'supplier-'+stamp}),201);
 const product=good(await p.api('/products','POST',{code:'DEMO4BC-'+stamp,name:'Item contratual de demonstração '+stamp,unit_id:units[0].id},{...headers,'Idempotency-Key':'product-'+stamp}),201);
 await p.clickWithin(S,'Cadastrar contrato');await must(p,'Novo contrato');await p.fill(S+' input[name=number]',number);await p.fill(S+' input[name=description]','Contrato exclusivamente sintético para avaliação 4B/4C');await pick(p,'Fornecedor',supplier.company_name,supplier.id);await pick(p,'Produto 1',product.code,product.id);await p.fill(S+' input[name="quantity-0"]','100');await p.fill(S+' input[name="price-0"]','10,00');const end=new Date();end.setDate(end.getDate()+30);await p.fill(S+' input[name=ends_on]',end.toISOString().slice(0,10));await p.clickWithin(S,'Salvar contrato');await must(p,'Abrir contrato '+number);
 let current=good(await p.api('/contracts?q='+number,'GET',null,headers),200).items.find(c=>c.number===number);cid=current.id;
 check('CRUD cria contrato e calcula total no servidor',current.limit_cents===100000&&current.status==='pending');
 const url=`/app/orgaos/${city.id}/secretarias/${office.id}/contratos/${cid}`;
 await p.go(`/app/orgaos/${city.id}/administracao/alcadas`);await must(p,'Alçadas contratuais');await pick(p,'Contrato',number,cid);await p.waitFor(`document.querySelector(${JSON.stringify(S+' input[name="limit-0-0"]')})`);
 const opts=good(await p.api(`/customers/${city.id}/contract-approval-options?contract_id=${cid}`,'GET',null,{'X-Elo-Customer-Id':String(city.id)}),200);
 const approver=opts.approvers.find(a=>a.name.includes('transferência'));if(!approver)throw new Error('Aprovador de demonstração ausente');
 await select(p,'Aprovador 1',approver.id);await p.fill(S+' input[name="limit-0-0"]','2.000,00');await p.clickWithin(S,'Adicionar nível');await p.waitFor(`document.querySelector(${JSON.stringify(S+' input[name="limit-1-0"]')})`);
 await p.eval(`(()=>{const h=[...document.querySelectorAll(${JSON.stringify(S+' h3')})].find(e=>e.textContent==='Nível 2');const e=h.parentElement.parentElement.querySelectorAll('select')[1];e.value=${JSON.stringify(String(approver.id))};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await p.fill(S+' input[name="limit-1-0"]','2.000,00');await p.clickWithin(S,'Salvar alçadas');
 let policy=await until(async()=>{const r=await p.api(`/customers/${city.id}/contract-approval-policies?contract_id=${cid}`,'GET',null,{'X-Elo-Customer-Id':String(city.id)});return r.body?.items?.[0]?.levels?.length===2?r.body.items[0]:null;});
 check('Cadastro visual configura dois níveis de alçada',policy.levels.every(l=>l.approvers[0].user_id===approver.id&&l.approvers[0].limit_cents===200000));await p.shot('alcadas');
 await p.go(url);await must(p,'Contrato '+number);await action(p,'submit','Submissão de demonstração');await until(async()=>{const r=await p.api('/contracts/'+cid,'GET',null,headers);return r.body.status==='awaiting_approval';});
 q=await b.tab(await b.context());await login(q,older);await choose(q);await q.go(url);await must(q,'Contrato '+number);await action(q,'approve','Primeiro nível conferido');await until(async()=>{const r=await q.api('/contracts/'+cid,'GET',null,headers);return r.body.approval_rounds?.at(-1)?.current_level===2;});await sleep(250);await action(q,'approve','Segundo nível conferido');current=await until(async()=>{const r=await q.api('/contracts/'+cid,'GET',null,headers);return r.body.status==='approved'?r.body:null;});check('Duas aprovações pela tela liberam o contrato',current.approval_rounds.at(-1).votes.length===2);
 await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/empenhos/novo`);await must(p,'Registrar empenho autorizado');await pick(p,'Contrato vigente',number,cid);await p.fill(S+' input[name=number]','EMP-'+stamp);await p.fill(S+' input[name=amount]','800,00');await p.fill(S+' input[name=reference]','Autorização contábil sintética');await p.fill(S+' input[name=responsible]','Responsável de testes');await p.clickWithin(S,'Registrar');await must(p,'Consultar contrato e saldo');current=good(await p.api('/contracts/'+cid,'GET',null,headers),200);check('Empenho pela tela reserva somente o limite contratual',current.balance.committed_cents===80000&&current.balance.available_to_commit_cents===20000);
 const emp=current.commitments.at(-1).id,item=current.items[0].id;
 await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/medicoes/novo`);await must(p,'Registrar medição');await pick(p,'Contrato vigente',number,cid);await until(async()=>await p.eval(`document.querySelectorAll(${JSON.stringify(S+' select option')}).length>2`));await select(p,'Empenho',emp);await select(p,'Item contratado',item);await p.fill(S+' input[name=quantity]','30');await p.fill(S+' input[name=reference]','Ateste de execução sintético');await p.fill(S+' input[name=responsible]','Fiscal de testes');await p.clickWithin(S,'Registrar');await must(p,'Consultar contrato e saldo');current=good(await p.api('/contracts/'+cid,'GET',null,headers),200);check('Medição pela tela realiza sem nova alçada nem desconto duplicado',current.balance.realized_cents===30000&&current.balance.committed_cents===80000&&current.balance.available_to_commit_cents===20000);
 await p.go(url);await must(p,'Disponível para empenhar');await p.shot('monitor');check('Monitor responsivo sem rolagem horizontal de página',await p.shot('monitor',true));
 const other=demo.customers.find(c=>c.name==='Sinop');const r=await p.api('/contracts/'+cid,'GET',null,{'X-Elo-Customer-Id':String(other.id),'X-Elo-Municipal-Office-Id':String(other.offices[0].id)});check('Contrato de Cuiabá invisível em Sinop',r.status===404);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({results,contract_id:cid,number,supplier_id:supplier.id,product_id:product.id},null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
}catch(e){console.error(e.message);if(p)await p.shot('falha').catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({results,contract_id:cid,error:e.message},null,2));process.exitCode=1;}finally{await b.stop().catch(()=>{});}})();
}
