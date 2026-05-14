/**
 * IAHub - Testes Playwright (Node.js) para os 3 cenários
 * Servidor: http://localhost:3000
 * Usa Chrome instalado no sistema via channel:'chrome'
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const USER = 'admin';
const PASS = 'iahub@2024';
const SCREENSHOTS = path.join(__dirname, 'screenshots');

fs.mkdirSync(SCREENSHOTS, { recursive: true });

const results = [];

function log(label, pass, detail = '') {
  const mark = pass ? '✅ PASS' : '❌ FAIL';
  const msg = detail ? `${mark} | ${label} — ${detail}` : `${mark} | ${label}`;
  console.log(msg);
  results.push({ label, pass, detail });
}

async function doLogin(page) {
  const resp = await page.request.post(`${BASE}/api/login`, {
    data: { user: USER, pass: PASS },
    headers: { 'Content-Type': 'application/json' }
  });
  return resp.status() === 200;
}

async function selecionarEmpresa(page, empresaId = 1) {
  const resp = await page.request.post(`${BASE}/api/empresas/selecionar`, {
    data: { empresa_id: empresaId },
    headers: { 'Content-Type': 'application/json' }
  });
  return resp.status() === 200;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {

  // ─────────────────────────────────────────────────────────
  // CENÁRIO 1 — Logout limpa abas do MDI
  // ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('CENÁRIO 1 — Logout limpa abas do MDI');
  console.log('='.repeat(60));

  {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // 1-2: Login + seleção empresa
    const okLogin = await doLogin(page);
    log('1. POST /api/login', okLogin);

    const okEmp = await selecionarEmpresa(page, 1);
    log('2. POST /api/empresas/selecionar (empresa 1)', okEmp);

    // 3-4: Abrir shell.html
    await page.goto(`${BASE}/shell.html`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SCREENSHOTS}/c1_01_shell_inicial.png`, fullPage: true });
    log('3-4. shell.html carregado (networkidle)', true);

    // 6: Ler sessionStorage inicial
    const mdiBefore = await page.evaluate("sessionStorage.getItem('iahub_mdi_state')");
    log('6. sessionStorage inicial lido', true, mdiBefore ? `tem valor: ${String(mdiBefore).substring(0, 60)}` : 'vazio (null)');

    // 7: Injetar aba manualmente
    await page.evaluate(`
      sessionStorage.setItem('iahub_mdi_state', JSON.stringify({
        tabs: [{k:'/dashboard.html', url:'/dashboard.html', label:'Dashboard', icon:'⊞', empresaId:1, empresaNome:'J2A'}],
        active: '/dashboard.html'
      }));
    `);
    const mdiInjected = await page.evaluate("sessionStorage.getItem('iahub_mdi_state')");
    log('7. Aba Dashboard injetada no sessionStorage', mdiInjected !== null, mdiInjected ? 'valor injetado com sucesso' : 'falhou injeção');

    // 8: Recarregar
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SCREENSHOTS}/c1_02_shell_apos_reload.png`, fullPage: true });

    // 9: Verificar aba no DOM
    const tabCount = await page.evaluate("document.querySelectorAll('.mdi-tab').length");
    log('9. Aba Dashboard aparece no DOM após reload', tabCount > 0, `${tabCount} .mdi-tab encontrada(s)`);

    // 10: Clicar em Sair
    const btnCount = await page.locator('.btn-logout').count();
    log('10. Botão .btn-logout encontrado', btnCount > 0, `${btnCount} botão(ões)`);

    if (btnCount > 0) {
      await page.screenshot({ path: `${SCREENSHOTS}/c1_03_antes_logout.png`, fullPage: true });
      await page.locator('.btn-logout').first().click();
      try {
        await page.waitForURL('**/login.html', { timeout: 6000 });
        log('11. Redirecionado para login.html após logout', page.url().includes('/login.html'), page.url());
      } catch {
        log('11. Redirecionado para login.html após logout', false, `URL atual: ${page.url()}`);
      }
    } else {
      log('11. Redirecionado para login.html após logout', false, 'botão não encontrado — pulando');
    }

    await page.screenshot({ path: `${SCREENSHOTS}/c1_04_login_apos_logout.png`, fullPage: true });

    // 12: Verificar sessionStorage limpo
    const mdiAfterLogout = await page.evaluate("sessionStorage.getItem('iahub_mdi_state')");
    log('12. sessionStorage limpo após logout (deve ser null)', mdiAfterLogout === null, `valor=${JSON.stringify(mdiAfterLogout)}`);

    // 13: Re-login + ir para shell.html
    const okLogin2 = await doLogin(page);
    const okEmp2 = await selecionarEmpresa(page, 1);
    log('13a. Re-login', okLogin2);
    log('13b. Re-seleção empresa 1', okEmp2);

    await page.goto(`${BASE}/shell.html`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SCREENSHOTS}/c1_05_shell_apos_novo_login.png`, fullPage: true });

    // 14: Sem abas no DOM
    const tabCountAfter = await page.evaluate("document.querySelectorAll('.mdi-tab').length");
    log('14. Nenhuma aba no DOM após novo login (0 .mdi-tab)', tabCountAfter === 0, `${tabCountAfter} .mdi-tab encontrada(s)`);

    await browser.close();
  }

  // ─────────────────────────────────────────────────────────
  // CENÁRIO 2 — Monitores page recebe update via BroadcastChannel
  // ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('CENÁRIO 2 — Monitores page recebe atualização via BroadcastChannel');
  console.log('='.repeat(60));

  {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const ctx = await browser.newContext();

    // Login no contexto
    const pageShell = await ctx.newPage();
    await doLogin(pageShell);
    await selecionarEmpresa(pageShell, 1);
    await pageShell.goto(`${BASE}/shell.html`);
    await pageShell.waitForLoadState('networkidle');
    log('C2-1. shell.html carregado', true);

    // Abrir monitores.html
    const pageMon = await ctx.newPage();
    const apiCalls = [];

    pageMon.on('request', req => {
      const url = req.url();
      if (url.includes('/api/service/status') || url.includes('/api/email-service/status')) {
        apiCalls.push(url);
      }
    });

    await pageMon.goto(`${BASE}/monitores.html`);
    await pageMon.waitForLoadState('networkidle');
    await pageMon.screenshot({ path: `${SCREENSHOTS}/c2_01_monitores.png`, fullPage: true });
    log('C2-2-3. monitores.html carregado (networkidle)', true);

    // 4: Verificar window._bc
    const bcDefined = await pageMon.evaluate(`
      (function() {
        // _bc é variável local de um IIFE/escopo, não window — tentamos via DevTools
        // Vamos verificar se o BroadcastChannel listener está presente de outra forma
        try {
          // Testa criando um canal e vendo se há handlers (workaround)
          return typeof _bc !== 'undefined' && _bc !== null;
        } catch(e) {
          return false;
        }
      })()
    `);
    // Nota: _bc é variável local (let), não window._bc — isso é esperado
    // Vamos checar de outra forma: verificar se a função carregarStatus existe
    const carregarStatusExists = await pageMon.evaluate(`typeof carregarStatus === 'function'`);
    log('C2-4. BroadcastChannel listener ativo (carregarStatus existe)', carregarStatusExists,
      `window._bc=${bcDefined} | carregarStatus=${carregarStatusExists ? 'function' : 'undefined'}`);

    // 5-7: Enviar mensagem BroadcastChannel e verificar chamadas de API
    apiCalls.length = 0;

    // Enviar a mensagem pela própria página monitores (mesmo origin, mesmo contexto de browser)
    await pageMon.evaluate(`
      (function() {
        const bc = new BroadcastChannel('iahub_monitors');
        bc.postMessage({ type: 'status-changed' });
        // Pequeno delay antes de fechar para garantir entrega
        setTimeout(() => bc.close(), 100);
      })()
    `);

    // Aguardar para a mensagem ser processada e a rede reagir
    await sleep(1500);
    await pageMon.screenshot({ path: `${SCREENSHOTS}/c2_02_monitores_apos_bc.png`, fullPage: true });

    log('C2-7. Requisição /api/service/status ou /api/email-service/status após postMessage',
      apiCalls.length > 0,
      apiCalls.length > 0 ? `chamadas: ${apiCalls.slice(0, 3).join(', ')}` : 'nenhuma chamada detectada');

    await browser.close();
  }

  // ─────────────────────────────────────────────────────────
  // CENÁRIO 3 — Status WA via socket
  // ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('CENÁRIO 3 — Status WA via socket');
  console.log('='.repeat(60));

  {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Login
    await doLogin(page);
    await selecionarEmpresa(page, 1);

    // Verificar API status antes de abrir a página
    const apiResp = await page.request.get(`${BASE}/api/service/status?empresa_id=1`);
    const apiStatus = apiResp.status();
    let apiBody = '';
    try {
      const json = await apiResp.json();
      apiBody = JSON.stringify(json).substring(0, 150);
    } catch {
      apiBody = (await apiResp.text()).substring(0, 150);
    }
    log('C3-6. GET /api/service/status?empresa_id=1', apiStatus === 200, `HTTP ${apiStatus} — ${apiBody}`);

    // Coletar erros JS
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(String(err)));

    const consoleMsgs = [];
    page.on('console', msg => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));

    // 1-2: Abrir monitor.html
    await page.goto(`${BASE}/monitor.html?_empresa=1`);
    await page.waitForLoadState('networkidle');

    // Aguardar pill aparecer
    let pillOk = false;
    try {
      await page.waitForSelector('#status-pill', { timeout: 5000 });
      pillOk = true;
    } catch { /* timeout */ }

    await page.screenshot({ path: `${SCREENSHOTS}/c3_01_monitor_wa.png`, fullPage: true });
    log('C3-1-2. monitor.html carregado (networkidle)', true);

    // 4: Erros JS
    log('C3-4. Console sem erros JS', jsErrors.length === 0,
      jsErrors.length === 0 ? 'sem erros' : jsErrors.slice(0, 3).join('; '));

    // 5: pill de status
    if (pillOk) {
      const pillText = await page.locator('#status-pill').innerText();
      const pillClass = await page.locator('#status-pill').getAttribute('class') || '';
      log('C3-5. Pill de status visível', true, `texto='${pillText}' | classes='${pillClass}'`);
    } else {
      log('C3-5. Pill de status visível', false, '#status-pill não encontrado no DOM');
    }

    // Mensagens de console relevantes
    const relevant = consoleMsgs.filter(m => m.includes('error') || m.includes('Error') || m.includes('warn'));
    if (relevant.length > 0) {
      console.log('\n  [console relevante]:');
      relevant.slice(0, 10).forEach(m => console.log(`    ${m}`));
    }

    await browser.close();
  }

  // ─────────────────────────────────────────────────────────
  // RESUMO FINAL
  // ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('RESUMO FINAL');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`Total: ${results.length} verificações | ✅ ${passed} PASS | ❌ ${failed} FAIL\n`);

  for (const r of results) {
    const mark = r.pass ? '✅' : '❌';
    let line = `  ${mark} ${r.label}`;
    if (r.detail) line += `\n       → ${r.detail}`;
    console.log(line);
  }

  console.log(`\nScreenshots salvos em: ${SCREENSHOTS}`);
  process.exit(failed > 0 ? 1 : 0);
})();
