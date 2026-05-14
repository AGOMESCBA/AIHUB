"""
IAHub - Testes Playwright para os 3 cenários solicitados
Servidor: http://localhost:3000
"""
import json
import time
from playwright.sync_api import sync_playwright, Page, expect

BASE = "http://localhost:3000"
USER = "admin"
PASS = "iahub@2024"
SCREENSHOTS = "c:/Apps/iahub/tests/screenshots"

import os
os.makedirs(SCREENSHOTS, exist_ok=True)

results = []

def log(label, status, detail=""):
    mark = "✅ PASS" if status else "❌ FAIL"
    msg = f"{mark} | {label}"
    if detail:
        msg += f" — {detail}"
    print(msg)
    results.append({"label": label, "pass": status, "detail": detail})

def do_login(page: Page):
    """Faz login via API e retorna para uso na sessão de cookies."""
    resp = page.request.post(f"{BASE}/api/login", data=json.dumps({"user": USER, "pass": PASS}),
                             headers={"Content-Type": "application/json"})
    return resp.status == 200

def selecionar_empresa(page: Page, empresa_id=1):
    resp = page.request.post(f"{BASE}/api/empresas/selecionar",
                             data=json.dumps({"empresa_id": empresa_id}),
                             headers={"Content-Type": "application/json"})
    return resp.status == 200


# ─────────────────────────────────────────────────────────────
# CENÁRIO 1 — Logout limpa abas do MDI
# ─────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("CENÁRIO 1 — Logout limpa abas do MDI")
print("="*60)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()

    # Passo 1-2: Login + seleção de empresa via API
    ok_login = do_login(page)
    log("1. POST /api/login", ok_login, f"HTTP {200 if ok_login else 'falhou'}")

    ok_emp = selecionar_empresa(page, 1)
    log("2. POST /api/empresas/selecionar (empresa 1)", ok_emp)

    # Passo 3-4: Abrir shell.html
    page.goto(f"{BASE}/shell.html")
    page.wait_for_load_state("networkidle")
    page.screenshot(path=f"{SCREENSHOTS}/c1_01_shell_inicial.png", full_page=True)
    log("3-4. Abrir shell.html (networkidle)", True)

    # Passo 5: Screenshot estado inicial — já tirado acima

    # Passo 6: Verificar sessionStorage
    mdi_before = page.evaluate("sessionStorage.getItem('iahub_mdi_state')")
    log("6. sessionStorage inicial lido", True, f"valor={'<vazio>' if not mdi_before else mdi_before[:60]}")

    # Passo 7: Injetar aba manualmente
    page.evaluate("""() => {
        sessionStorage.setItem('iahub_mdi_state', JSON.stringify({
            tabs: [{k:'/dashboard.html', url:'/dashboard.html', label:'Dashboard', icon:'⊞', empresaId:1, empresaNome:'J2A'}],
            active: '/dashboard.html'
        }));
    }""")
    log("7. Aba Dashboard injetada no sessionStorage", True)

    # Passo 8: Recarregar
    page.reload()
    page.wait_for_load_state("networkidle")
    page.screenshot(path=f"{SCREENSHOTS}/c1_02_shell_apos_reload.png", full_page=True)

    # Passo 9: Verificar se aba aparece no DOM
    tab_count = page.evaluate("document.querySelectorAll('.mdi-tab').length")
    log("9. Aba Dashboard aparece no DOM após reload", tab_count > 0, f"{tab_count} .mdi-tab encontrada(s)")

    # Passo 10: Clicar em "Sair"
    btn_logout = page.locator(".btn-logout")
    has_btn = btn_logout.count() > 0
    log("10. Botão .btn-logout encontrado", has_btn)

    if has_btn:
        page.screenshot(path=f"{SCREENSHOTS}/c1_03_antes_logout.png", full_page=True)
        btn_logout.first.click()
        # Aguardar redirecionamento para login.html
        page.wait_for_url("**/login.html", timeout=5000)
        log("11. Redirecionado para login.html após logout", "/login.html" in page.url, page.url)
    else:
        log("11. Redirecionamento após logout", False, "botão não encontrado — pulando")

    page.screenshot(path=f"{SCREENSHOTS}/c1_04_login_apos_logout.png", full_page=True)

    # Passo 12: Verificar sessionStorage na página login.html
    # Importante: origin é o mesmo, sessionStorage é limpo no logout
    mdi_after_logout = page.evaluate("sessionStorage.getItem('iahub_mdi_state')")
    log("12. sessionStorage limpo após logout", mdi_after_logout is None, f"valor={mdi_after_logout!r}")

    # Passo 13: Login novamente
    ok_login2 = do_login(page)
    ok_emp2 = selecionar_empresa(page, 1)
    log("13a. Re-login", ok_login2)
    log("13b. Re-seleção empresa 1", ok_emp2)

    page.goto(f"{BASE}/shell.html")
    page.wait_for_load_state("networkidle")
    page.screenshot(path=f"{SCREENSHOTS}/c1_05_shell_apos_novo_login.png", full_page=True)

    # Passo 14: Verificar que nenhuma aba aparece
    tab_count_after = page.evaluate("document.querySelectorAll('.mdi-tab').length")
    log("14. Nenhuma aba no DOM após novo login (sem estado MDI)", tab_count_after == 0,
        f"{tab_count_after} .mdi-tab encontrada(s)")

    browser.close()


# ─────────────────────────────────────────────────────────────
# CENÁRIO 2 — Monitores page recebe update via BroadcastChannel
# ─────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("CENÁRIO 2 — Monitores page recebe atualização via BroadcastChannel")
print("="*60)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page_shell = ctx.new_page()

    # Login
    do_login(page_shell)
    selecionar_empresa(page_shell, 1)

    # Passo 1: shell.html
    page_shell.goto(f"{BASE}/shell.html")
    page_shell.wait_for_load_state("networkidle")
    log("C2-1. shell.html carregado", True)

    # Passo 2-3: monitores.html (nova aba/página)
    page_mon = ctx.new_page()
    # monitores.html é protegida por auth — o contexto já tem a sessão
    api_calls = []

    def on_request(req):
        if "/api/service/status" in req.url or "/api/email-service/status" in req.url:
            api_calls.append(req.url)

    page_mon.on("request", on_request)

    page_mon.goto(f"{BASE}/monitores.html")
    page_mon.wait_for_load_state("networkidle")
    page_mon.screenshot(path=f"{SCREENSHOTS}/c2_01_monitores.png", full_page=True)
    log("C2-2-3. monitores.html carregado (networkidle)", True)

    # Passo 4: Verificar _bc definido
    bc_defined = page_mon.evaluate("typeof window._bc !== 'undefined' && window._bc !== null")
    log("C2-4. window._bc está definido (BroadcastChannel ativo)", bc_defined,
        f"_bc={'definido' if bc_defined else 'undefined/null'}")

    # Passo 5: Enviar mensagem BroadcastChannel (na mesma página para garantir mesmo origin/contexto)
    api_calls.clear()
    page_mon.evaluate("""() => {
        const bc = new BroadcastChannel('iahub_monitors');
        bc.postMessage({ type: 'status-changed' });
        bc.close();
    }""")

    # Passo 6: Aguardar 500ms + um pouco mais para a rede
    page_mon.wait_for_timeout(1500)

    # Passo 7: Verificar requisições de rede após postMessage
    log("C2-7. Requisição /api/service/status ou /api/email-service/status após postMessage",
        len(api_calls) > 0,
        f"chamadas={api_calls[:3] if api_calls else 'nenhuma'}")

    page_mon.screenshot(path=f"{SCREENSHOTS}/c2_02_monitores_apos_bc.png", full_page=True)
    browser.close()


# ─────────────────────────────────────────────────────────────
# CENÁRIO 3 — Status WA via socket
# ─────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("CENÁRIO 3 — Status WA via socket")
print("="*60)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()

    # Login
    do_login(page)
    selecionar_empresa(page, 1)

    # Coletar erros JS
    js_errors = []
    page.on("pageerror", lambda err: js_errors.append(str(err)))

    # Coletar console
    console_msgs = []
    page.on("console", lambda msg: console_msgs.append(f"[{msg.type}] {msg.text}"))

    # Verificar status HTTP da API
    api_resp = page.request.get(f"{BASE}/api/service/status?empresa_id=1")
    api_status = api_resp.status
    try:
        api_body = api_resp.json()
    except Exception:
        api_body = api_resp.text()

    log("C3-6. GET /api/service/status?empresa_id=1 HTTP status",
        api_status == 200, f"HTTP {api_status} — body={str(api_body)[:120]}")

    # Passo 1-2: Abrir monitor.html
    page.goto(f"{BASE}/monitor.html?_empresa=1")
    page.wait_for_load_state("networkidle")

    # Aguardar pill de status aparecer (pode demorar por socket.io)
    try:
        page.wait_for_selector("#status-pill", timeout=5000)
        pill_ok = True
    except Exception:
        pill_ok = False

    page.screenshot(path=f"{SCREENSHOTS}/c3_01_monitor_wa.png", full_page=True)
    log("C3-1-2. monitor.html carregado (networkidle)", True)

    # Passo 4: Erros JS
    has_js_errors = len(js_errors) > 0
    log("C3-4. Console sem erros JS", not has_js_errors,
        "SEM erros" if not has_js_errors else "; ".join(js_errors[:3]))

    # Passo 5: pill de status
    if pill_ok:
        pill_text = page.locator("#status-pill").inner_text()
        pill_class = page.locator("#status-pill").get_attribute("class") or ""
        log("C3-5. Pill de status visível", True, f"texto='{pill_text}' classes='{pill_class}'")
    else:
        log("C3-5. Pill de status visível", False, "#status-pill não encontrado no DOM")

    # Print console relevante
    relevant = [m for m in console_msgs if "error" in m.lower() or "warn" in m.lower()]
    if relevant:
        print(f"\n  [console relevante]")
        for m in relevant[:10]:
            print(f"    {m}")

    browser.close()


# ─────────────────────────────────────────────────────────────
# RESUMO FINAL
# ─────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("RESUMO FINAL")
print("="*60)
passed = sum(1 for r in results if r["pass"])
failed = sum(1 for r in results if not r["pass"])
print(f"Total: {len(results)} verificações | ✅ {passed} PASS | ❌ {failed} FAIL\n")

for r in results:
    mark = "✅" if r["pass"] else "❌"
    line = f"  {mark} {r['label']}"
    if r["detail"]:
        line += f"\n       → {r['detail']}"
    print(line)

print(f"\nScreenshots salvos em: {SCREENSHOTS}")
