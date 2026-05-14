/**
 * Testes de multi-tenancy — Monitor de E-mail
 *
 * Cenários cobertos:
 *  1. Cross-tab sync: trocar empresa em uma aba força reload nas demais
 *  2. Isolamento de status: iniciar serviço na Empresa A não afeta monitor da Empresa B
 *  3. Smoke test: página carrega, socket conecta, controles presentes
 */

const puppeteer = require('puppeteer');

const BASE        = 'http://localhost:3000';
const ADMIN_USER  = 'admin';
const ADMIN_PASS  = 'iahub@2024';
const EMP_A_ID    = 1;   // J2A Consultoria
const EMP_B_ID    = 2;   // C3i Systems
const EMP_A_NOME  = 'J2A Consultoria';
const EMP_B_NOME  = 'C3i Systems';

// ── helpers ───────────────────────────────────────────────────────────────────

async function login(page, user = ADMIN_USER, pass = ADMIN_PASS) {
  // Navega para /login.html (página livre — não redireciona) para ter
  // um contexto estável onde executar o fetch sem interferência do auth.js
  await page.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  const res = await page.evaluate(async (u, p, base) => {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: u, pass: p }),
    });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
  }, user, pass, BASE);

  if (!res.ok) throw new Error(`Login falhou (${res.status}): ${JSON.stringify(res.body)}`);
  return res;
}

async function selecionarEmpresa(page, empresaId) {
  // Garante contexto estável antes do fetch (permanece na página atual)
  const res = await page.evaluate(async (id, base) => {
    const r = await fetch(`${base}/api/empresas/selecionar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: id }),
    });
    return { ok: r.ok, status: r.status };
  }, empresaId, BASE);
  if (!res.ok) throw new Error(`Selecionar empresa ${empresaId} falhou (${res.status})`);
}

async function navegarMonitor(page) {
  await page.goto(`${BASE}/monitor-email.html`, { waitUntil: 'networkidle2', timeout: 15000 });
}

async function lerStatusPill(page) {
  return page.$eval('#email-status-pill', el => el.textContent.trim()).catch(() => null);
}

async function lerNomeEmpresaBadge(page) {
  return page.$eval('#_empresa-nome', el => el.textContent.trim()).catch(() => null);
}

async function pararServicoViaApi(page) {
  await page.evaluate(async (base) => {
    await fetch(`${base}/api/email-service/stop`, { method: 'POST' });
  }, BASE);
}

function pass(msg) { console.log(`  ✅ PASS: ${msg}`); }
function fail(msg) { console.error(`  ❌ FAIL: ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  ℹ  ${msg}`); }

// ── Cenário 1: Cross-tab sync ─────────────────────────────────────────────────

async function testCrossTabSync(browser) {
  console.log('\n═══ Cenário 1: Cross-tab sync (localStorage broadcast) ═══');

  // Duas abas no MESMO contexto → compartilham cookies de sessão
  const ctx = await browser.createBrowserContext();
  const tab1 = await ctx.newPage();
  const tab2 = await ctx.newPage();

  try {
    // Login e selecionar Empresa A na aba 1
    await tab1.goto(BASE, { waitUntil: 'domcontentloaded' });
    await login(tab1);
    await selecionarEmpresa(tab1, EMP_A_ID);
    await navegarMonitor(tab1);

    info(`Tab1 carregou monitor — empresa ativa: ${await lerNomeEmpresaBadge(tab1) || '(badge ainda não renderizado)'}`);

    // Aba 2 — mesma sessão, mesmo contexto
    await navegarMonitor(tab2);
    info(`Tab2 carregou monitor`);

    // Monitora se Tab1 vai recarregar
    let tab1Reloaded = false;
    tab1.once('load', () => { tab1Reloaded = true; });

    // Tab2 troca para Empresa B via _trocarEmpresa (simula o dropdown)
    // ATENÇÃO: _trocarEmpresa faz location.reload() na própria aba;
    //           o storage event deve acionar reload na tab1.
    info(`Tab2 está trocando para Empresa B (ID=${EMP_B_ID})…`);

    // Primeiro: só alteramos a sessão (sem reload do Tab2), para observar Tab1
    await selecionarEmpresa(tab2, EMP_B_ID);

    // Disparamos o evento localStorage manualmente (equivale ao código em _trocarEmpresa)
    await tab2.evaluate((eid) => {
      localStorage.setItem('_iahub_empresa_switch', String(eid) + '_' + Date.now());
    }, EMP_B_ID);

    // Aguarda até 3s para Tab1 detectar o storage event e recarregar
    await new Promise(r => setTimeout(r, 3000));

    if (tab1Reloaded) {
      pass('Tab1 recarregou automaticamente ao detectar troca de empresa em Tab2');

      // Após reload, Tab1 deve mostrar Empresa B
      await tab1.waitForSelector('#_empresa-nome', { timeout: 5000 }).catch(() => {});
      const nomeTab1 = await lerNomeEmpresaBadge(tab1);
      if (nomeTab1 && nomeTab1.includes(EMP_B_NOME)) {
        pass(`Tab1 exibe empresa correta após reload: "${nomeTab1}"`);
      } else {
        fail(`Tab1 esperava "${EMP_B_NOME}" mas exibe "${nomeTab1}"`);
      }
    } else {
      fail('Tab1 NÃO recarregou após troca de empresa em Tab2 (storage event não funcionou)');
    }

  } finally {
    await ctx.close();
  }
}

// ── Cenário 2: Isolamento de status entre empresas ────────────────────────────

async function testStatusIsolamento(browser) {
  console.log('\n═══ Cenário 2: Isolamento de status por empresa ═══');

  // Dois contextos SEPARADOS → sessões independentes
  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();

  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const statusEvents = { A: [], B: [] };

  try {
    // Contexto A: login e seleciona Empresa A
    await pageA.goto(BASE, { waitUntil: 'domcontentloaded' });
    await login(pageA);
    await selecionarEmpresa(pageA, EMP_A_ID);
    await navegarMonitor(pageA);

    // Contexto B: login e seleciona Empresa B
    await pageB.goto(BASE, { waitUntil: 'domcontentloaded' });
    await login(pageB);
    await selecionarEmpresa(pageB, EMP_B_ID);
    await navegarMonitor(pageB);

    // Captura eventos de status via socket (exposto na página pelo Puppeteer)
    await pageA.evaluate(() => {
      window._testStatusLog = [];
      if (window.socket) socket.on('email-status', s => window._testStatusLog.push(s));
    });
    await pageB.evaluate(() => {
      window._testStatusLog = [];
      if (window.socket) socket.on('email-status', s => window._testStatusLog.push(s));
    });

    const statusInicialA = await lerStatusPill(pageA);
    const statusInicialB = await lerStatusPill(pageB);
    info(`Status inicial — Empresa A: "${statusInicialA}" | Empresa B: "${statusInicialB}"`);

    // Garante ambos parados antes do teste
    await pararServicoViaApi(pageA);
    await pararServicoViaApi(pageB);
    await new Promise(r => setTimeout(r, 800));

    // Inicia serviço na Empresa A
    info('Iniciando serviço de e-mail da Empresa A…');
    const resStart = await pageA.evaluate(async (base) => {
      const r = await fetch(`${base}/api/email-service/start`, { method: 'POST' });
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
    }, BASE);

    if (!resStart.ok) {
      info(`Aviso: start retornou ${resStart.status} — ${JSON.stringify(resStart.body)}`);
    }

    // Aguarda propagação dos eventos via Socket.IO
    await new Promise(r => setTimeout(r, 2000));

    const pillA = await lerStatusPill(pageA);
    const pillB = await lerStatusPill(pageB);
    const eventsA = await pageA.evaluate(() => window._testStatusLog || []);
    const eventsB = await pageB.evaluate(() => window._testStatusLog || []);

    info(`Status pill após start — A: "${pillA}" | B: "${pillB}"`);
    info(`Socket events — A: [${eventsA}] | B: [${eventsB}]`);

    if (pillA === 'Rodando' || eventsA.includes('running')) {
      pass('Monitor da Empresa A mostra "Rodando" conforme esperado');
    } else {
      info(`Monitor A: "${pillA}" (pode estar parado se e-mail não configurado — aceitável)`);
    }

    if (pillB !== 'Rodando' && !eventsB.includes('running')) {
      pass('Monitor da Empresa B permanece "Parado" — sem vazamento de status');
    } else {
      fail(`Monitor da Empresa B mostrou "Rodando" sem que o serviço fosse iniciado para ela`);
    }

    // Limpeza: para serviço A
    await pararServicoViaApi(pageA);

  } finally {
    await ctxA.close();
    await ctxB.close();
  }
}

// ── Cenário 3: Smoke test da página ──────────────────────────────────────────

async function testSmokePage(browser) {
  console.log('\n═══ Cenário 3: Smoke test — Monitor E-mail ═══');

  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const consoleErrors = [];

  // Erros são monitorados SOMENTE a partir do carregamento do monitor (não do login.html)
  let monitorCarregado = false;
  page.on('console', msg => {
    if (monitorCarregado && msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => { if (monitorCarregado) consoleErrors.push(`[PageError] ${err.message}`); });
  page.on('response', res => {
    // 401 em /api/me no login.html é esperado (usuário ainda não autenticado)
    if (!monitorCarregado) return;
    if ([401, 404, 500].includes(res.status())) consoleErrors.push(`[HTTP ${res.status()}] ${res.url()}`);
  });

  try {
    await login(page);
    await selecionarEmpresa(page, EMP_A_ID);
    monitorCarregado = true;   // ← a partir daqui erros são capturados
    await navegarMonitor(page);

    // Verifica elementos críticos
    const checks = [
      ['#email-status-pill',  'Status pill'],
      ['#email-btn-start',    'Botão Iniciar Serviço'],
      ['#terminal-email',     'Terminal de log'],
      ['#info-email',         'Painel: conta e-mail'],
      ['#info-imap',          'Painel: servidor IMAP'],
      ['#info-intervalo',     'Painel: intervalo'],
      ['#stat-hoje',          'Estatística: e-mails hoje'],
      ['#stat-total',         'Estatística: total'],
    ];

    for (const [sel, label] of checks) {
      const exists = await page.$(sel).then(el => !!el);
      if (exists) pass(`Elemento presente: ${label} (${sel})`);
      else         fail(`Elemento ausente: ${label} (${sel})`);
    }

    // Socket.IO conectado?
    const socketConnected = await page.evaluate(() => {
      return typeof io !== 'undefined' && typeof socket !== 'undefined' && socket.connected;
    });
    if (socketConnected) pass('Socket.IO conectado com sucesso');
    else                  fail('Socket.IO não conectado ou não disponível');

    // Erros de console?
    const relevantErrors = consoleErrors.filter(e =>
      !e.includes('favicon') && !e.includes('net::ERR')
    );
    if (relevantErrors.length === 0) {
      pass('Nenhum erro de JavaScript no console');
    } else {
      fail(`Erros de console detectados:\n    ${relevantErrors.join('\n    ')}`);
    }

    // Verifica se config foi carregada no painel
    const emailInfo = await page.$eval('#info-email', el => el.textContent.trim()).catch(() => '—');
    if (emailInfo !== '—' && emailInfo !== '') {
      pass(`Configuração de e-mail carregada: "${emailInfo}"`);
    } else {
      info('Configuração de e-mail não encontrada para esta empresa (pode não estar cadastrada)');
    }

  } finally {
    await ctx.close();
  }
}

// ── Runner principal ──────────────────────────────────────────────────────────

(async () => {
  console.log('🧪 IAHub — Testes de Multi-tenancy: Monitor de E-mail');
  console.log(`   Servidor: ${BASE}`);
  console.log(`   Empresas: A=${EMP_A_NOME} (ID=${EMP_A_ID}) | B=${EMP_B_NOME} (ID=${EMP_B_ID})\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    await testSmokePage(browser);
    await testCrossTabSync(browser);
    await testStatusIsolamento(browser);
  } catch (err) {
    console.error('\n💥 Erro inesperado no runner de testes:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  const exitCode = process.exitCode || 0;
  console.log(`\n${ exitCode === 0 ? '✅ Todos os testes passaram.' : '❌ Um ou mais testes falharam.' }`);
  process.exit(exitCode);
})();
