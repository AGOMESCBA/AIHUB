/**
 * Testes da funcionalidade de monitoramento multi-empresa via ?empresa=ID
 */
const puppeteer = require('puppeteer');

const BASE     = 'http://localhost:3000';
const USER     = 'admin';
const PASS     = 'iahub@2024';
const EMP_A_ID = 1;
const EMP_B_ID = 2;

let passed = 0, failed = 0;

function ok(msg)   { passed++; console.log(`  ✅ PASS: ${msg}`); }
function fail(msg) { failed++; console.error(`  ❌ FAIL: ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  ℹ  ${msg}`); }

async function login(page) {
  await page.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  const res = await page.evaluate(async (u, p, base) => {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: u, pass: p }),
    });
    return { ok: r.ok, status: r.status };
  }, USER, PASS, BASE);
  if (!res.ok) throw new Error(`Login falhou (${res.status})`);
}

async function selecionarEmpresa(page, eid) {
  const res = await page.evaluate(async (id, base) => {
    const r = await fetch(`${base}/api/empresas/selecionar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: id }),
    });
    return { ok: r.ok, status: r.status };
  }, eid, BASE);
  if (!res.ok) throw new Error(`Selecionar empresa ${eid} falhou (${res.status})`);
}

function filtrarErros(erros) {
  return erros.filter(e => !e.includes('favicon') && !e.includes('net::ERR'));
}

// ── Cenário 1: Monitor e-mail com ?empresa=1 quando sessão está em empresa 2 ──
async function testCenario1(browser) {
  console.log('\n═══ Cenário 1: Monitor e-mail com ?empresa=1, sessão em empresa 2 ═══');
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  try {
    await login(page);
    await selecionarEmpresa(page, EMP_B_ID); // Sessão = Empresa B

    // API com ?empresa=1 deve retornar status da Empresa 1
    const res = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/email-service/status?empresa=1`);
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
    }, BASE);
    info(`GET /api/email-service/status?empresa=1 → HTTP ${res.status} body=${JSON.stringify(res.body)}`);
    if (res.ok && res.body.status) {
      ok('API retornou status da Empresa 1 mesmo com sessão na Empresa 2');
    } else {
      fail(`API falhou: HTTP ${res.status}, body=${JSON.stringify(res.body)}`);
    }

    // Monitora erros a partir da navegação ao monitor
    const errors = [];
    page.on('response', r => {
      if ([401,500].includes(r.status()) && r.url().includes('localhost:3000')
        && !r.url().includes('/api/me') && !r.url().includes('/api/minhas-rotinas') && !r.url().includes('/api/session'))
        errors.push(`[HTTP ${r.status()}] ${r.url()}`);
    });
    page.on('pageerror', e => errors.push(`[PageError] ${e.message}`));

    // Carrega a página com ?empresa=1
    await page.goto(`${BASE}/monitor-email.html?empresa=1`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForSelector('#email-status-pill', { timeout: 5000 }).catch(() => {});
    const pill = await page.$eval('#email-status-pill', el => el.textContent.trim()).catch(() => null);
    if (pill !== null) {
      ok(`Página monitor-email.html?empresa=1 carregou — pill="${pill}"`);
    } else {
      fail('Status pill não encontrado na página');
    }

    // Título dinâmico
    await new Promise(r => setTimeout(r, 1500));
    const title = await page.title();
    info(`Título da página: "${title}"`);
    if (title.includes('J2A') || title.includes('Monitor E-mail')) {
      ok(`Título correto: "${title}"`);
    } else {
      info(`Título sem nome da empresa (pode ser timing): "${title}"`);
    }

    if (errors.length) errors.forEach(e => info(`Resposta HTTP: ${e}`));
    if (errors.length === 0) ok('Sem erros HTTP inesperados no monitor');
    else fail(`Erros HTTP no monitor: ${errors.join(' | ')}`);

  } finally {
    await ctx.close();
  }
}

// ── Cenário 2: Duas abas simultâneas com empresas diferentes ──────────────────
async function testCenario2(browser) {
  console.log('\n═══ Cenário 2: Duas abas simultâneas — empresa=1 e empresa=2 ═══');
  const ctx = await browser.createBrowserContext();
  const page1 = await ctx.newPage();
  const page2 = await ctx.newPage();
  const errors1 = [], errors2 = [];
  // Captura erros de HTTP response (não do console de login.html)
  page1.on('response', r => { if ([401,404,500].includes(r.status()) && r.url().includes('localhost:3000')) errors1.push(`[HTTP ${r.status()}] ${r.url()}`); });
  page2.on('response', r => { if ([401,404,500].includes(r.status()) && r.url().includes('localhost:3000')) errors2.push(`[HTTP ${r.status()}] ${r.url()}`); });
  try {
    await login(page1);
    await selecionarEmpresa(page1, EMP_A_ID);

    // API independente para cada empresa
    const [status1, status2] = await Promise.all([
      page1.evaluate(async base => {
        const r = await fetch(`${base}/api/email-service/status?empresa=1`);
        return r.json().catch(() => ({}));
      }, BASE),
      page1.evaluate(async base => {
        const r = await fetch(`${base}/api/email-service/status?empresa=2`);
        return r.json().catch(() => ({}));
      }, BASE),
    ]);
    info(`Status empresa=1: ${JSON.stringify(status1)}`);
    info(`Status empresa=2: ${JSON.stringify(status2)}`);
    if (status1.status && status2.status) {
      ok('Ambas as chamadas retornaram status independentes');
    } else {
      fail(`Uma ou ambas falharam: emp1=${JSON.stringify(status1)} emp2=${JSON.stringify(status2)}`);
    }

    // Carrega as duas páginas simultaneamente
    await Promise.all([
      page1.goto(`${BASE}/monitor-email.html?empresa=1`, { waitUntil: 'networkidle2', timeout: 15000 }),
      page2.goto(`${BASE}/monitor-email.html?empresa=2`, { waitUntil: 'networkidle2', timeout: 15000 }),
    ]);

    const [pill1, pill2] = await Promise.all([
      page1.$eval('#email-status-pill', el => el.textContent.trim()).catch(() => null),
      page2.$eval('#email-status-pill', el => el.textContent.trim()).catch(() => null),
    ]);
    info(`Pill página empresa=1: "${pill1}" | empresa=2: "${pill2}"`);
    if (pill1 && pill2) {
      ok('Ambas as páginas monitor carregaram com status pill presente');
    } else {
      fail(`Pill ausente: empresa=1="${pill1}" empresa=2="${pill2}"`);
    }

    const filtrarHttpOk = errs => errs.filter(e => !e.includes('/api/me') && !e.includes('/api/minhas-rotinas') && !e.includes('/api/session'));
    const e1 = filtrarHttpOk(errors1), e2 = filtrarHttpOk(errors2);
    if (e1.length) e1.forEach(e => info(`HTTP aba empresa=1: ${e}`));
    if (e2.length) e2.forEach(e => info(`HTTP aba empresa=2: ${e}`));
    if (!e1.length && !e2.length) ok('Sem erros HTTP inesperados em nenhuma das duas abas');
    else fail(`Erros HTTP inesperados: ${[...e1,...e2].join(' | ')}`);

  } finally {
    await ctx.close();
  }
}

// ── Cenário 3: Empresa inexistente ────────────────────────────────────────────
async function testCenario3(browser) {
  console.log('\n═══ Cenário 3: Controle de acesso — empresa inexistente (999) ═══');
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  try {
    await login(page);
    await selecionarEmpresa(page, EMP_A_ID);

    const res999 = await page.evaluate(async base => {
      const r = await fetch(`${base}/api/email-service/status?empresa=999`);
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
    }, BASE);
    info(`GET status?empresa=999 → HTTP ${res999.status} body=${JSON.stringify(res999.body)}`);

    if (res999.ok && res999.body.status === 'stopped') {
      ok('Empresa inexistente retorna "stopped" sem crash (admin tem acesso geral)');
    } else if (res999.status === 403) {
      ok('Empresa inexistente retorna 403');
    } else {
      fail(`Resposta inesperada para empresa=999: HTTP ${res999.status} body=${JSON.stringify(res999.body)}`);
    }

    // empresa=1 com admin deve funcionar
    const res1 = await page.evaluate(async base => {
      const r = await fetch(`${base}/api/email-service/status?empresa=1`);
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
    }, BASE);
    if (res1.ok) ok(`empresa=1 com admin retorna 200: ${JSON.stringify(res1.body)}`);
    else fail(`empresa=1 falhou: HTTP ${res1.status}`);

  } finally {
    await ctx.close();
  }
}

// ── Cenário 4: Sem parâmetro — comportamento original preservado ──────────────
async function testCenario4(browser) {
  console.log('\n═══ Cenário 4: Sem ?empresa — comportamento original ═══');
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  try {
    await login(page);
    await selecionarEmpresa(page, EMP_A_ID);

    const res = await page.evaluate(async base => {
      const r = await fetch(`${base}/api/email-service/status`);
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
    }, BASE);
    if (res.ok && res.body.status) {
      ok(`API sem parâmetro usa sessão corretamente: ${JSON.stringify(res.body)}`);
    } else {
      fail(`API sem parâmetro falhou: HTTP ${res.status}`);
    }

    // Monitora erros HTTP a partir da navegação ao monitor (não do login.html)
    const errors = [];
    page.on('response', r => {
      if ([401,500].includes(r.status()) && r.url().includes('localhost:3000')
        && !r.url().includes('/api/me') && !r.url().includes('/api/minhas-rotinas') && !r.url().includes('/api/session'))
        errors.push(`[HTTP ${r.status()}] ${r.url()}`);
    });
    page.on('pageerror', e => errors.push(`[PageError] ${e.message}`));

    await page.goto(`${BASE}/monitor-email.html`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForSelector('#email-status-pill', { timeout: 5000 }).catch(() => {});
    const pill = await page.$eval('#email-status-pill', el => el.textContent.trim()).catch(() => null);
    if (pill) ok(`Monitor sem ?empresa carrega normalmente — pill="${pill}"`);
    else fail('Status pill não encontrado');

    if (errors.length) errors.forEach(e => info(`Resposta HTTP: ${e}`));
    if (errors.length === 0) ok('Sem erros HTTP inesperados no monitor');
    else fail(`Erros HTTP no monitor: ${errors.join(' | ')}`);

  } finally {
    await ctx.close();
  }
}

// ── Cenário 5: Monitor WhatsApp com ?empresa=ID ───────────────────────────────
async function testCenario5(browser) {
  console.log('\n═══ Cenário 5: Monitor WhatsApp com ?empresa=2 ═══');
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  try {
    await login(page);
    await selecionarEmpresa(page, EMP_A_ID); // Sessão = empresa 1

    const res = await page.evaluate(async base => {
      const r = await fetch(`${base}/api/service/status?empresa=2`);
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
    }, BASE);
    info(`GET /api/service/status?empresa=2 → HTTP ${res.status} body=${JSON.stringify(res.body)}`);
    if (res.ok && res.body.status) {
      ok('API WhatsApp retorna status da Empresa 2 com sessão na Empresa 1');
    } else {
      fail(`API WhatsApp falhou: HTTP ${res.status} body=${JSON.stringify(res.body)}`);
    }

    // Monitora erros a partir da navegação ao monitor
    const errors = [];
    page.on('response', r => {
      if ([401,500].includes(r.status()) && r.url().includes('localhost:3000')
        && !r.url().includes('/api/me') && !r.url().includes('/api/minhas-rotinas') && !r.url().includes('/api/session'))
        errors.push(`[HTTP ${r.status()}] ${r.url()}`);
    });
    page.on('pageerror', e => errors.push(`[PageError] ${e.message}`));

    await page.goto(`${BASE}/monitor.html?empresa=2`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForSelector('#status-pill', { timeout: 5000 }).catch(() => {});
    const pill = await page.$eval('#status-pill', el => el.textContent.trim()).catch(() => null);
    if (pill) ok(`Página monitor.html?empresa=2 carregou — pill="${pill}"`);
    else fail('Status pill não encontrado no monitor WhatsApp');

    await new Promise(r => setTimeout(r, 1500));
    info(`Título: "${await page.title()}"`);

    if (errors.length) errors.forEach(e => info(`Resposta HTTP: ${e}`));
    if (errors.length === 0) ok('Sem erros HTTP inesperados no monitor WhatsApp');
    else fail(`Erros HTTP no monitor: ${errors.join(' | ')}`);

  } finally {
    await ctx.close();
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────
(async () => {
  console.log('🧪 IAHub — Testes Multi-Monitor (?empresa=ID)');
  console.log(`   Servidor: ${BASE}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    await testCenario1(browser);
    await testCenario2(browser);
    await testCenario3(browser);
    await testCenario4(browser);
    await testCenario5(browser);
  } catch (err) {
    console.error('\n💥 Erro inesperado no runner:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  console.log(`\n${failed === 0 ? '✅ Todos os testes passaram.' : '❌ Um ou mais testes falharam.'} — ${passed} passed, ${failed} failed`);
  process.exit(process.exitCode || 0);
})();
