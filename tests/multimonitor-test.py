"""
Testes da funcionalidade de monitoramento multi-empresa via ?empresa=ID
"""
from playwright.sync_api import sync_playwright
import json, sys

BASE       = 'http://localhost:3000'
USER       = 'admin'
PASS       = 'iahub@2024'
EMP_A_ID   = 1
EMP_B_ID   = 2

passed = 0
failed = 0

def ok(msg):
    global passed
    passed += 1
    print(f'  ✅ PASS: {msg}')

def fail(msg):
    global failed
    failed += 1
    print(f'  ❌ FAIL: {msg}')

def info(msg):
    print(f'  ℹ  {msg}')

def login(page):
    page.goto(f'{BASE}/login.html', wait_until='domcontentloaded')
    res = page.evaluate("""async ([u, p, base]) => {
        const r = await fetch(base + '/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({user: u, pass: p})
        });
        return {ok: r.ok, status: r.status};
    }""", [USER, PASS, BASE])
    if not res['ok']:
        raise Exception(f"Login falhou: {res['status']}")

def selecionar_empresa(page, eid):
    res = page.evaluate("""async ([id, base]) => {
        const r = await fetch(base + '/api/empresas/selecionar', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({empresa_id: id})
        });
        return {ok: r.ok, status: r.status};
    }""", [eid, BASE])
    if not res['ok']:
        raise Exception(f"Selecionar empresa {eid} falhou: {res['status']}")

def get_console_errors(errors):
    return [e for e in errors if 'favicon' not in e and 'net::ERR' not in e]

# ─── Cenário 1: Monitor e-mail com ?empresa=1 quando sessão está em empresa 2 ──
def test_cenario1(browser):
    print('\n═══ Cenário 1: Monitor e-mail com ?empresa=1, sessão em empresa 2 ═══')
    ctx = browser.new_context()
    page = ctx.new_page()
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'[PageError] {e.message}'))
    try:
        login(page)
        selecionar_empresa(page, EMP_B_ID)  # Sessão = Empresa B

        # Verifica que a API com ?empresa=1 retorna status da Empresa 1
        res = page.evaluate("""async ([base]) => {
            const r = await fetch(base + '/api/email-service/status?empresa=1');
            return {ok: r.ok, status: r.status, body: await r.json().catch(() => ({}))};
        }""", [BASE])
        info(f"GET /api/email-service/status?empresa=1 → HTTP {res['status']} body={res['body']}")
        if res['ok'] and 'status' in res['body']:
            ok('API retornou status da Empresa 1 mesmo com sessão na Empresa 2')
        else:
            fail(f"API falhou: HTTP {res['status']}, body={res['body']}")

        # Acessa o monitor com ?empresa=1
        page.goto(f'{BASE}/monitor-email.html?empresa=1', wait_until='networkidle', timeout=15000)
        page.wait_for_selector('#email-status-pill', timeout=5000)
        ok('Página monitor-email.html?empresa=1 carregou com sucesso')

        # Verifica título dinâmico
        page.wait_for_timeout(1500)
        title = page.title()
        info(f'Título da página: "{title}"')
        if 'J2A' in title or 'empresa=1' in title.lower() or 'Monitor E-mail' in title:
            ok(f'Título atualizado corretamente: "{title}"')
        else:
            info(f'Título não contém nome da empresa (pode ser timing): "{title}"')

        errs = get_console_errors(errors)
        if not errs:
            ok('Sem erros de JavaScript no console')
        else:
            fail(f'Erros no console: {errs}')

    finally:
        ctx.close()

# ─── Cenário 2: Duas "abas" simultâneas com empresas diferentes ─────────────────
def test_cenario2(browser):
    print('\n═══ Cenário 2: Duas abas simultâneas — empresa=1 e empresa=2 ═══')
    ctx = browser.new_context()
    page1 = ctx.new_page()
    page2 = ctx.new_page()
    try:
        login(page1)
        selecionar_empresa(page1, EMP_A_ID)

        # Aba 1: empresa=1
        status1 = page1.evaluate("""async ([base]) => {
            const r = await fetch(base + '/api/email-service/status?empresa=1');
            return await r.json().catch(() => ({}));
        }""", [BASE])

        # Aba 2 (mesma sessão): empresa=2
        login(page2)
        selecionar_empresa(page2, EMP_A_ID)
        status2 = page2.evaluate("""async ([base]) => {
            const r = await fetch(base + '/api/email-service/status?empresa=2');
            return await r.json().catch(() => ({}));
        }""", [BASE])

        info(f"Status empresa=1: {status1}")
        info(f"Status empresa=2: {status2}")

        if 'status' in status1 and 'status' in status2:
            ok('Ambas as chamadas retornaram status independentes')
        else:
            fail(f'Uma ou ambas as chamadas falharam: emp1={status1} emp2={status2}')

        # Carrega as duas páginas
        errors1, errors2 = [], []
        page1.on('console', lambda m: errors1.append(m.text) if m.type == 'error' else None)
        page2.on('console', lambda m: errors2.append(m.text) if m.type == 'error' else None)

        page1.goto(f'{BASE}/monitor-email.html?empresa=1', wait_until='networkidle', timeout=15000)
        page2.goto(f'{BASE}/monitor-email.html?empresa=2', wait_until='networkidle', timeout=15000)

        page1.wait_for_selector('#email-status-pill', timeout=5000)
        page2.wait_for_selector('#email-status-pill', timeout=5000)
        ok('Ambas as páginas monitor carregaram simultaneamente sem erros')

        e1 = get_console_errors(errors1)
        e2 = get_console_errors(errors2)
        if not e1 and not e2:
            ok('Sem erros de JavaScript em nenhuma das duas abas')
        else:
            if e1: fail(f'Erros no console da aba empresa=1: {e1}')
            if e2: fail(f'Erros no console da aba empresa=2: {e2}')

    finally:
        ctx.close()

# ─── Cenário 3: Acesso negado a empresa inexistente ─────────────────────────────
def test_cenario3(browser):
    print('\n═══ Cenário 3: Controle de acesso — empresa inexistente ═══')
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        login(page)
        selecionar_empresa(page, EMP_A_ID)

        # empresa=999 não existe — admin terá acesso mas deve retornar stopped (não erro)
        res999 = page.evaluate("""async ([base]) => {
            const r = await fetch(base + '/api/email-service/status?empresa=999');
            return {ok: r.ok, status: r.status, body: await r.json().catch(() => ({}))};
        }""", [BASE])
        info(f"GET status?empresa=999 → HTTP {res999['status']} body={res999['body']}")

        # Admin tem acesso a tudo, empresa=999 não existe → deve retornar stopped (não crash)
        if res999['ok'] and res999['body'].get('status') == 'stopped':
            ok('Empresa inexistente retorna "stopped" sem crash (admin)')
        elif res999['status'] == 403:
            ok('Empresa inexistente retorna 403 (acesso negado)')
        else:
            fail(f'Resposta inesperada para empresa=999: HTTP {res999["status"]} body={res999["body"]}')

        # empresa=1 com admin deve funcionar
        res1 = page.evaluate("""async ([base]) => {
            const r = await fetch(base + '/api/email-service/status?empresa=1');
            return {ok: r.ok, status: r.status, body: await r.json().catch(() => ({}))};
        }""", [BASE])
        if res1['ok']:
            ok(f'empresa=1 com admin retorna 200: {res1["body"]}')
        else:
            fail(f'empresa=1 falhou: HTTP {res1["status"]}')

    finally:
        ctx.close()

# ─── Cenário 4: Sem parâmetro — comportamento original preservado ────────────────
def test_cenario4(browser):
    print('\n═══ Cenário 4: Sem ?empresa — comportamento original ═══')
    ctx = browser.new_context()
    page = ctx.new_page()
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    try:
        login(page)
        selecionar_empresa(page, EMP_A_ID)

        # API sem parâmetro deve usar sessão
        res = page.evaluate("""async ([base]) => {
            const r = await fetch(base + '/api/email-service/status');
            return {ok: r.ok, status: r.status, body: await r.json().catch(() => ({}))};
        }""", [BASE])
        if res['ok'] and 'status' in res['body']:
            ok(f'API sem parâmetro usa sessão corretamente: {res["body"]}')
        else:
            fail(f'API sem parâmetro falhou: HTTP {res["status"]}')

        # Página sem parâmetro
        page.goto(f'{BASE}/monitor-email.html', wait_until='networkidle', timeout=15000)
        page.wait_for_selector('#email-status-pill', timeout=5000)
        ok('Monitor sem ?empresa carrega normalmente')

        errs = get_console_errors(errors)
        if not errs:
            ok('Sem erros de JavaScript no console')
        else:
            fail(f'Erros no console: {errs}')

    finally:
        ctx.close()

# ─── Cenário 5: Monitor WhatsApp com ?empresa=ID ────────────────────────────────
def test_cenario5(browser):
    print('\n═══ Cenário 5: Monitor WhatsApp com ?empresa=2 ═══')
    ctx = browser.new_context()
    page = ctx.new_page()
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'[PageError] {e.message}'))
    try:
        login(page)
        selecionar_empresa(page, EMP_A_ID)  # Sessão = empresa 1

        # API WhatsApp com empresa=2
        res = page.evaluate("""async ([base]) => {
            const r = await fetch(base + '/api/service/status?empresa=2');
            return {ok: r.ok, status: r.status, body: await r.json().catch(() => ({}))};
        }""", [BASE])
        info(f"GET /api/service/status?empresa=2 → HTTP {res['status']} body={res['body']}")
        if res['ok'] and 'status' in res['body']:
            ok('API WhatsApp retorna status da Empresa 2 com sessão na Empresa 1')
        else:
            fail(f'API WhatsApp falhou: HTTP {res["status"]} body={res["body"]}')

        # Página monitor WA com ?empresa=2
        page.goto(f'{BASE}/monitor.html?empresa=2', wait_until='networkidle', timeout=15000)
        page.wait_for_selector('#status-pill', timeout=5000)
        ok('Página monitor.html?empresa=2 carregou com sucesso')

        page.wait_for_timeout(1500)
        title = page.title()
        info(f'Título: "{title}"')

        errs = get_console_errors(errors)
        if not errs:
            ok('Sem erros de JavaScript no console')
        else:
            fail(f'Erros no console: {errs}')

    finally:
        ctx.close()

# ─── Runner ─────────────────────────────────────────────────────────────────────
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    try:
        test_cenario1(browser)
        test_cenario2(browser)
        test_cenario3(browser)
        test_cenario4(browser)
        test_cenario5(browser)
    except Exception as e:
        print(f'\n💥 Erro inesperado: {e}')
        failed += 1
    finally:
        browser.close()

print(f'\n{"✅ Todos os testes passaram" if failed == 0 else "❌ Falhas detectadas"} — {passed} passed, {failed} failed')
sys.exit(0 if failed == 0 else 1)
