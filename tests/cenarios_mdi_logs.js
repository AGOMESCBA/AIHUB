/**
 * Testes Playwright — IAHub
 * Cenário 1: Logout limpa abas MDI
 * Cenário 2: Vazamento de logs entre empresas
 * Cenário 3: Monitores atualiza via BroadcastChannel
 */

const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const CREDS = { user: 'admin', pass: 'iahub@2024' };
const SCREENSHOT_DIR = __dirname + '/screenshots';

const fs = require('fs');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let passCount = 0;
let failCount = 0;

function report(label, pass, detail = '') {
  const tag = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`${tag} — ${label}${detail ? '\n       ' + detail : ''}`);
  if (pass) passCount++; else failCount++;
}

async function doLogin(page) {
  const resp = await page.request.post(`${BASE}/api/login`, {
    data: CREDS,
    headers: { 'Content-Type': 'application/json' }
  });
  return resp;
}

async function selecionarEmpresa(page, empresaId) {
  const resp = await page.request.post(`${BASE}/api/empresas/selecionar`, {
    data: { empresa_id: empresaId },
    headers: { 'Content-Type': 'application/json' }
  });
  return resp;
}

// ─────────────────────────────────────────────
// CENÁRIO 1 — Logout limpa abas MDI
// ─────────────────────────────────────────────
async function cenario1(browser) {
  console.log('\n══════════════════════════════════════');
  console.log('CENÁRIO 1 — Logout limpa abas MDI');
  console.log('══════════════════════════════════════');

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Login
    const loginResp = await doLogin(page);
    report('C1-1: POST /api/login retorna sucesso', loginResp.ok(), `status=${loginResp.status()}`);

    // 2. Selecionar empresa 1
    const selResp = await selecionarEmpresa(page, 1);
    report('C1-2: POST /api/empresas/selecionar empresa 1', selResp.ok(), `status=${selResp.status()}`);

    // 3. Abrir shell.html
    await page.goto(`${BASE}/shell.html`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/c1_01_shell_inicial.png`, fullPage: true });

    // 4. Injetar estado fake no sessionStorage
    await page.evaluate(() => {
      sessionStorage.setItem('iahub_mdi_state', JSON.stringify({
        tabs: [{ k: '/dashboard.html', url: '/dashboard.html', label: 'Dashboard', icon: '⊞', empresaId: 1, empresaNome: 'J2A' }],
        active: '/dashboard.html'
      }));
    });

    // 5. Recarregar página
    await page.reload({ waitUntil: 'networkidle' });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/c1_02_shell_apos_reload.png`, fullPage: true });

    // 6. Verificar que .mdi-tab existe
    const tabsAntes = await page.locator('.mdi-tab').count();
    report('C1-3: Aba MDI restaurada após reload', tabsAntes > 0, `count=${tabsAntes}`);

    // 7. Clicar em .btn-logout
    const btnLogout = page.locator('.btn-logout').first();
    const logoutVisible = await btnLogout.isVisible().catch(() => false);
    if (!logoutVisible) {
      console.log('       [INFO] .btn-logout não visível, tentando seletor alternativo...');
      // Tenta encontrar qualquer botão de logout
      const altBtn = page.locator('button:has-text("Sair"), a:has-text("Sair"), [data-action="logout"]').first();
      const altVisible = await altBtn.isVisible().catch(() => false);
      if (altVisible) {
        await altBtn.click();
      } else {
        // Chama API de logout diretamente
        await page.evaluate(() => {
          fetch('/api/logout', { method: 'POST' })
            .then(() => { window.location.href = '/login.html'; });
        });
      }
    } else {
      await btnLogout.click();
    }

    // 8. Aguardar URL = /login.html
    try {
      await page.waitForURL('**/login.html', { timeout: 8000 });
      report('C1-4: Redirecionado para /login.html após logout', true, `url=${page.url()}`);
    } catch (e) {
      report('C1-4: Redirecionado para /login.html após logout', false, `url atual=${page.url()}`);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/c1_03_apos_logout.png`, fullPage: true });

    // 9. Verificar sessionStorage limpo — precisa estar na página de login agora
    // sessionStorage é por origem, portanto ainda acessível na mesma origem /login.html
    const mdiState = await page.evaluate(() => sessionStorage.getItem('iahub_mdi_state')).catch(() => 'ERRO_EVALUATE');
    report('C1-5: sessionStorage iahub_mdi_state === null após logout', mdiState === null, `valor=${mdiState}`);

    // 10. Novo login e ir para shell.html
    await doLogin(page);
    await selecionarEmpresa(page, 1);
    await page.goto(`${BASE}/shell.html`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/c1_04_shell_novo_login.png`, fullPage: true });

    // 11. Verificar 0 abas MDI
    const tabsDepois = await page.locator('.mdi-tab').count();
    report('C1-6: 0 abas MDI após novo login (sem estado persistido)', tabsDepois === 0, `count=${tabsDepois}`);

  } finally {
    await context.close();
  }
}

// ─────────────────────────────────────────────
// CENÁRIO 2 — Vazamento de logs entre empresas
// ─────────────────────────────────────────────
async function cenario2(browser) {
  console.log('\n══════════════════════════════════════');
  console.log('CENÁRIO 2 — Vazamento de logs entre empresas');
  console.log('══════════════════════════════════════');

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Login + selecionar empresa 1
    await doLogin(page);
    await selecionarEmpresa(page, 1);

    // Verificar status serviço WA empresa 1
    const statusResp = await page.request.get(`${BASE}/api/service/status?empresa_id=1`);
    let statusData = {};
    try { statusData = await statusResp.json(); } catch(e) {}
    console.log(`  [INFO] Status serviço WA empresa 1: ${JSON.stringify(statusData)}`);

    const servicoEmpresa1Rodando = statusData.status === 'connected' || statusData.status === 'running' || statusData.connected === true;

    if (!servicoEmpresa1Rodando) {
      console.log('  [INFO] Serviço WA empresa 1 parado — tentando iniciar para forçar logs...');
      const startResp = await page.request.post(`${BASE}/api/service/start`, {
        data: { empresa_id: 1 },
        headers: { 'Content-Type': 'application/json' }
      });
      console.log(`  [INFO] Resultado start empresa 1: status=${startResp.status()}`);
      // Aguardar 3s para logs aparecerem
      await page.waitForTimeout(3000);
    }

    // 2. Abrir monitor WA da empresa 2 (sessão logada como empresa 1)
    await page.goto(`${BASE}/monitor.html?_empresa=2`, { waitUntil: 'networkidle' });
    // 3. Extra 2s para socket conectar
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/c2_01_monitor_empresa2.png`, fullPage: true });

    // 4. Ler conteúdo do #terminal
    const terminalText = await page.locator('#terminal').innerText().catch(() => '');
    const terminalHtml = await page.locator('#terminal').innerHTML().catch(() => '');
    console.log(`  [INFO] Texto #terminal (primeiros 300 chars): "${terminalText.slice(0, 300)}"`);

    // 5. Verificar status pill
    const statusPillText = await page.locator('#status-pill').innerText().catch(async () => {
      // Tenta seletores alternativos
      return await page.locator('.status-pill, [id*="status"], .pill').first().innerText().catch(() => '(não encontrado)');
    });
    console.log(`  [INFO] Texto #status-pill: "${statusPillText}"`);

    const terminalVazio = terminalText.trim() === '' || terminalHtml.trim() === '' || terminalHtml === '<span></span>';

    // 5. Verificar ausência de logs da empresa 1
    const temLogEmpresa1 = terminalText.toLowerCase().includes('empresa #1')
      || terminalText.toLowerCase().includes('j2a')
      || terminalText.toLowerCase().includes('empresa_1')
      || terminalText.includes('empresa 1');

    if (terminalVazio) {
      report('C2-1: Terminal empresa 2 vazio (sem vazamento)', true, 'terminal não tem conteúdo');
    } else if (temLogEmpresa1) {
      report('C2-1: Terminal empresa 2 sem logs da empresa 1', false, `VAZAMENTO DETECTADO! Texto: "${terminalText.slice(0, 200)}"`);
    } else {
      report('C2-1: Terminal empresa 2 sem logs da empresa 1', true, `Terminal tem conteúdo mas sem dados da empresa 1: "${terminalText.slice(0, 100)}"`);
    }

    // 6. Verificar status pill
    const pillParado = statusPillText.toLowerCase().includes('parado')
      || statusPillText.toLowerCase().includes('stopped')
      || statusPillText.toLowerCase().includes('desconectado');
    const pillConectado = statusPillText.toLowerCase().includes('conectado')
      || statusPillText.toLowerCase().includes('connected')
      || statusPillText.toLowerCase().includes('iniciando');

    if (pillParado) {
      report('C2-2: Status pill mostra "Parado" para empresa 2', true, `pill="${statusPillText}"`);
    } else if (pillConectado) {
      // Pode ser bug ou empresa 2 realmente tem serviço rodando
      report('C2-2: Status pill mostra "Parado" para empresa 2', false, `pill="${statusPillText}" (empresa 2 aparece como conectada/iniciando)`);
    } else {
      report('C2-2: Status pill mostra "Parado" para empresa 2', false, `pill="${statusPillText}" (estado desconhecido)`);
    }

    // Se serviço foi iniciado, recarregar e reverificar
    if (!servicoEmpresa1Rodando) {
      console.log('\n  [INFO] Reverificando após start do serviço 1...');
      await page.goto(`${BASE}/monitor.html?_empresa=2`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/c2_02_monitor_empresa2_apos_start.png`, fullPage: true });

      const terminalText2 = await page.locator('#terminal').innerText().catch(() => '');
      const temLogEmpresa1v2 = terminalText2.toLowerCase().includes('empresa #1')
        || terminalText2.toLowerCase().includes('j2a')
        || terminalText2.includes('empresa 1');

      const terminal2Vazio = terminalText2.trim() === '';

      if (terminal2Vazio) {
        report('C2-3: Terminal empresa 2 vazio após start serviço 1', true, 'terminal limpo');
      } else if (temLogEmpresa1v2) {
        report('C2-3: Terminal empresa 2 sem logs da empresa 1 (após start)', false, `VAZAMENTO! "${terminalText2.slice(0, 200)}"`);
      } else {
        report('C2-3: Terminal empresa 2 sem logs da empresa 1 (após start)', true, `"${terminalText2.slice(0, 100)}"`);
      }
    }

  } finally {
    await context.close();
  }
}

// ─────────────────────────────────────────────
// CENÁRIO 3 — Monitores atualiza via BroadcastChannel
// ─────────────────────────────────────────────
async function cenario3(browser) {
  console.log('\n══════════════════════════════════════');
  console.log('CENÁRIO 3 — Monitores atualiza via BroadcastChannel');
  console.log('══════════════════════════════════════');

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Login
    await doLogin(page);
    await selecionarEmpresa(page, 1);

    // 1. Coletar requests de rede ANTES do postMessage para referência
    const statusRequests = [];
    page.on('request', req => {
      if (req.url().includes('/api/service/status')) {
        statusRequests.push({ url: req.url(), time: Date.now(), trigger: 'before-bc' });
      }
    });

    // 2. Abrir monitores.html
    await page.goto(`${BASE}/monitores.html`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/c3_01_monitores_inicial.png`, fullPage: true });

    // Limpa requests coletados até agora (eram do load inicial)
    const initialRequestCount = statusRequests.length;
    console.log(`  [INFO] Requests /api/service/status durante load inicial: ${initialRequestCount}`);

    // Reconfigurar listener apenas para após o BC
    const postBcRequests = [];
    page.on('request', req => {
      if (req.url().includes('/api/service/status')) {
        postBcRequests.push(req.url());
      }
    });

    // 4. Enviar BroadcastChannel
    await page.evaluate(() => {
      const bc = new BroadcastChannel('iahub_monitors');
      bc.postMessage({ type: 'status-changed' });
    });

    // 5. Aguardar 1 segundo para requests acontecerem
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/c3_02_monitores_apos_bc.png`, fullPage: true });

    console.log(`  [INFO] Requests /api/service/status após BroadcastChannel: ${postBcRequests.length}`);
    if (postBcRequests.length > 0) {
      console.log(`  [INFO] URLs: ${postBcRequests.slice(0, 3).join(', ')}`);
    }

    report(
      'C3-1: Requests /api/service/status disparados após BroadcastChannel',
      postBcRequests.length > 0,
      `${postBcRequests.length} request(s) detectados`
    );

    // Verifica se a página de monitores está estruturalmente correta
    const monitorCards = await page.locator('.monitor-card, .card, [class*="monitor"], [class*="empresa"]').count();
    console.log(`  [INFO] Cards/elementos de empresa visíveis: ${monitorCards}`);

    const pageTitle = await page.title().catch(() => '');
    console.log(`  [INFO] Título da página: "${pageTitle}"`);

  } finally {
    await context.close();
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
(async () => {
  console.log('🚀 Iniciando testes IAHub — Playwright headless');
  console.log(`   Base URL: ${BASE}`);
  console.log(`   Screenshots em: ${SCREENSHOT_DIR}`);

  // Usa Chrome instalado no sistema já que o download do Playwright browser falhou
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath
  });

  try {
    // Verificar se servidor está acessível
    const context0 = await browser.newContext();
    const p0 = await context0.newPage();
    try {
      const r = await p0.request.get(`${BASE}/api/login`);
      console.log(`\n[INFO] Servidor respondeu: HTTP ${r.status()}`);
    } catch(e) {
      console.log(`\n[ERRO] Servidor não acessível em ${BASE}: ${e.message}`);
      process.exit(1);
    } finally {
      await context0.close();
    }

    await cenario1(browser);
    await cenario2(browser);
    await cenario3(browser);

  } finally {
    await browser.close();
  }

  console.log('\n══════════════════════════════════════');
  console.log(`RESULTADO FINAL: ${passCount} PASS / ${failCount} FAIL`);
  console.log('══════════════════════════════════════\n');

  process.exit(failCount > 0 ? 1 : 0);
})();
