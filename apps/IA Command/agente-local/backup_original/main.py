import secrets
import uvicorn
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException, Form, Header
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from config import get_config, set_config
from database import init_db, registrar_execucao, listar_execucoes, limpar_historico, get_stats
from auth import verificar_token_api, verificar_sessao_web, autenticar_admin, alterar_senha
from modules.erp_executor import executar_sql, testar_conexao
from modules.factory_reset import resetar_fabrica

BASE_DIR = Path(__file__).parent

app = FastAPI(title="IA Command — Agente Local", version="1.0.0", docs_url=None, redoc_url=None)

cfg = get_config()
_secret = cfg.get("SESSION_SECRET") or secrets.token_hex(32)
app.add_middleware(SessionMiddleware, secret_key=_secret, max_age=28800)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


# ── Health (público — chamado pela nuvem para testar conexão) ─────────────────
@app.get("/health")
def health():
    return {"status": "ok", "sistema": "IA Command — Agente Local", "versao": "1.0.0"}


# ── Execute SQL (autenticado por Bearer token) ────────────────────────────────
@app.post("/execute")
async def execute(request: Request, authorization: str = Header(default=None)):
    raw_token = (authorization or "").removeprefix("Bearer ").strip()
    if not verificar_token_api(raw_token):
        raise HTTPException(status_code=401, detail="Token inválido.")

    body      = await request.json()
    sql       = body.get("sql", "").strip()
    limit     = int(body.get("limit", 10000))
    uuid_tx   = body.get("uuid")
    modulo    = body.get("modulo", "")
    operacao  = body.get("operacao", "")
    ip_origem = request.client.host if request.client else "desconhecido"

    if not sql:
        raise HTTPException(status_code=400, detail="Campo 'sql' é obrigatório.")

    resultado = await executar_sql(sql, limit)

    registrar_execucao(
        uuid=uuid_tx,
        modulo=modulo,
        operacao=operacao,
        sql_entrada=sql,
        sql_executado=resultado.get("sql_executado", sql),
        payload_saida=resultado.get("rows", []),
        duracao_ms=resultado.get("duracao_ms", 0),
        status=resultado.get("status", "ok"),
        erro=resultado.get("erro"),
        ip_origem=ip_origem,
    )

    return resultado


# ── Web: Login ────────────────────────────────────────────────────────────────
@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if request.session.get("autenticado"):
        return RedirectResponse("/", status_code=302)
    return templates.TemplateResponse("login.html", {"request": request, "erro": None})


@app.post("/login", response_class=HTMLResponse)
async def login_post(request: Request, senha: str = Form(...)):
    if autenticar_admin(senha):
        request.session["autenticado"] = True
        return RedirectResponse("/", status_code=302)
    return templates.TemplateResponse("login.html", {"request": request, "erro": "Senha incorreta."})


@app.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=302)


# ── Web: Dashboard ────────────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    if not request.session.get("autenticado"):
        return RedirectResponse("/login", status_code=302)
    stats = get_stats()
    c = get_config()
    return templates.TemplateResponse("dashboard.html", {
        "request": request,
        "stats":   stats,
        "versao":  "1.0.0",
        "porta":   c.get("API_PORT", "8765"),
    })


# ── API Web: logs ─────────────────────────────────────────────────────────────
@app.get("/api/logs")
def api_logs(
    request: Request,
    modulo:   str = "",
    status:   str = "",
    data_ini: str = "",
    data_fim: str = "",
    limit:    int = 200,
):
    verificar_sessao_web(request)
    return listar_execucoes(modulo=modulo, status=status, data_ini=data_ini, data_fim=data_fim, limit=limit)


@app.delete("/api/logs")
def api_limpar_logs(request: Request):
    verificar_sessao_web(request)
    limpar_historico()
    return {"ok": True}


# ── API Web: config ERP ───────────────────────────────────────────────────────
@app.get("/api/config")
def api_get_config(request: Request):
    verificar_sessao_web(request)
    c = get_config()
    return {
        "DB_HOST":            c.get("DB_HOST", ""),
        "DB_PORT":            c.get("DB_PORT", "1433"),
        "DB_NAME":            c.get("DB_NAME", ""),
        "DB_USER":            c.get("DB_USER", ""),
        "DB_DRIVER":          c.get("DB_DRIVER", "ODBC Driver 17 for SQL Server"),
        "FILIAL":             c.get("FILIAL", "01"),
        "API_PORT":           c.get("API_PORT", "8765"),
        "TOKEN_CONFIGURADO":  bool(c.get("API_TOKEN")),
    }


@app.post("/api/config")
async def api_set_config(request: Request):
    verificar_sessao_web(request)
    body = await request.json()
    for campo in ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_DRIVER", "FILIAL", "API_PORT"]:
        if campo in body:
            set_config(campo, body[campo])
    if body.get("DB_PASS"):
        set_config("DB_PASS", body["DB_PASS"])
    return {"ok": True}


@app.post("/api/config/testar-erp")
async def api_testar_erp(request: Request):
    verificar_sessao_web(request)
    return await testar_conexao()


# ── API Web: token ────────────────────────────────────────────────────────────
@app.post("/api/token/regerar")
def api_regerar_token(request: Request):
    verificar_sessao_web(request)
    novo = secrets.token_hex(32)
    set_config("API_TOKEN", novo)
    return {"token": novo}


@app.get("/api/token/reveal")
def api_reveal_token(request: Request):
    verificar_sessao_web(request)
    c = get_config()
    return {"token": c.get("API_TOKEN") or None, "configurado": bool(c.get("API_TOKEN"))}


# ── API Web: senha admin ──────────────────────────────────────────────────────
@app.post("/api/senha")
async def api_alterar_senha(request: Request):
    verificar_sessao_web(request)
    body = await request.json()
    alterar_senha(body.get("senha_atual", ""), body.get("nova_senha", ""))
    return {"ok": True}


# ── API Web: factory reset ────────────────────────────────────────────────────
@app.post("/api/factory-reset")
async def api_factory_reset(request: Request):
    verificar_sessao_web(request)
    body = await request.json()
    if body.get("confirmacao") != "RESTAURAR":
        raise HTTPException(status_code=400, detail="Confirmação inválida. Digite RESTAURAR.")
    resetar_fabrica()
    return {"ok": True, "mensagem": "Arquivos restaurados. O serviço será reiniciado em instantes."}


# ── Entrypoint ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    c    = get_config()
    port = int(c.get("API_PORT", 8765))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
