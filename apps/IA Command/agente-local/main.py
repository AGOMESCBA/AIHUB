import secrets
import uuid as _uuid
import uvicorn
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException, Form, Header
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from config import get_config, set_config
import shutil
from database import init_db, registrar_execucao, listar_execucoes, limpar_historico, get_stats, sincronizar_empresas, listar_empresas, listar_empresas_public, remover_empresa, get_execucao, salvar_conexao_erp, get_conexao_erp, listar_conexoes_erp
from auth import verificar_token_api, verificar_sessao_web, autenticar_admin, alterar_senha, salvar_hash
from modules.erp_executor import executar_sql, testar_conexao
from modules.factory_reset import resetar_fabrica
from crypto_envelope import decrypt_payload, encrypt_payload, encrypt_text, decrypt_text, generate_key_base64, is_encrypted_envelope, normalize_key

BASE_DIR = Path(__file__).parent

# Inicializa o banco antes de tudo
init_db()

app = FastAPI(title="IA Command — Agente Local", version="1.0.0", docs_url=None, redoc_url=None)

cfg = get_config()
_secret = cfg.get("SESSION_SECRET") or secrets.token_hex(32)
app.add_middleware(SessionMiddleware, secret_key=_secret, max_age=28800)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


def _bool_cfg(value):
    return str(value or "").strip().lower() in ("1", "true", "sim", "yes", "on")


def _registrar_anomalia_crypto(*, ip_origem, erro, detalhe="", uuid_tx=None, empresa_id=None, usuario=None):
    try:
        registrar_execucao(
            uuid=uuid_tx or str(_uuid.uuid4()),
            modulo="sistema",
            operacao="crypto_anomalia",
            sql_entrada=detalhe or "Anomalia de criptografia no /execute",
            sql_executado="",
            payload_saida=[],
            duracao_ms=0,
            status="erro",
            erro=erro,
            ip_origem=ip_origem,
            pergunta=None,
            sender=None,
            empresa_id=empresa_id,
            usuario=usuario,
            linhas_retornadas=0,
            limite_solicitado=0,
            tipo_erro="crypto",
        )
    except Exception as exc:
        print(f"[agente-local] falha ao registrar anomalia crypto: {exc}")


# ── Health (público — chamado pela nuvem para testar conexão) ─────────────────
@app.get("/apicommand")
def health():
    return {"status": "ok", "sistema": "IA Command — Agente Local", "versao": "1.0.0"}


# ── Execute SQL (autenticado por Bearer token) ────────────────────────────────
@app.post("/execute")
async def execute(request: Request, authorization: str = Header(default=None)):
    raw_token = (authorization or "").removeprefix("Bearer ").strip()
    if not verificar_token_api(raw_token):
        raise HTTPException(status_code=401, detail="Token inválido.")

    ip_origem  = request.client.host if request.client else "desconhecido"
    cfg        = get_config()
    crypto_key = cfg.get("CRYPTO_KEY", "")
    crypto_required = _bool_cfg(cfg.get("CRYPTO_REQUIRED", "false"))

    body_raw = await request.json()
    request_encrypted = is_encrypted_envelope(body_raw)

    if request_encrypted:
        if not crypto_key:
            _registrar_anomalia_crypto(ip_origem=ip_origem, erro="CRYPTO_KEY ausente para payload criptografado.", detalhe="Requisicao /execute criptografada recebida sem chave configurada.")
            raise HTTPException(status_code=400, detail="Chave de criptografia nao configurada no agente.")
        try:
            body = decrypt_payload(body_raw, crypto_key)
        except Exception as exc:
            _registrar_anomalia_crypto(ip_origem=ip_origem, erro=f"Falha ao descriptografar payload: {exc}", detalhe="Envelope AES-256-GCM invalido ou chave incorreta.")
            raise HTTPException(status_code=400, detail="Payload criptografado invalido.")
    else:
        if crypto_required:
            _registrar_anomalia_crypto(ip_origem=ip_origem, erro="Payload em claro rejeitado: CRYPTO_REQUIRED=true.", detalhe="Requisicao /execute em claro bloqueada pelo agente.")
            raise HTTPException(status_code=426, detail="Criptografia obrigatoria para /execute.")
        body = body_raw

    sql        = body.get("sql", "").strip()
    limit      = int(body.get("limit", 10000))
    uuid_tx    = body.get("uuid") or str(_uuid.uuid4())
    modulo     = body.get("modulo", "")
    operacao   = body.get("operacao", "")
    pergunta   = body.get("pergunta", "") or ""
    sender     = body.get("sender", "")   or ""
    usuario    = body.get("usuario", "")  or ""
    empresa_id = str(body.get("empresa_id") or "")

    if not sql:
        raise HTTPException(status_code=400, detail="Campo 'sql' é obrigatório.")

    resultado = await executar_sql(sql, limit, empresa_id)

    rows_list = resultado.get("rows", [])
    linhas_retornadas = len(rows_list) if isinstance(rows_list, list) else 0

    erro_msg  = resultado.get("erro") or ""
    tipo_erro = None
    if resultado.get("status") == "erro":
        em = erro_msg.lower()
        if "timeout" in em:
            tipo_erro = "timeout"
        elif any(k in em for k in ("syntax", "invalid column", "invalid object", "incorrect syntax")):
            tipo_erro = "sql_syntax"
        elif any(k in em for k in ("connect", "connection", "login failed", "network")):
            tipo_erro = "conexao"
        else:
            tipo_erro = "erp"

    registrar_execucao(
        uuid=uuid_tx,
        modulo=modulo,
        operacao=operacao,
        sql_entrada=sql,
        sql_executado=resultado.get("sql_executado", sql),
        payload_saida=rows_list,
        duracao_ms=resultado.get("duracao_ms", 0),
        status=resultado.get("status", "ok"),
        erro=erro_msg or None,
        ip_origem=ip_origem,
        pergunta=pergunta or None,
        sender=sender or None,
        empresa_id=empresa_id or None,
        usuario=usuario or None,
        linhas_retornadas=linhas_retornadas,
        limite_solicitado=limit,
        tipo_erro=tipo_erro,
        origem_conexao=resultado.get("origem_conexao") or None,
    )

    if request_encrypted:
        try:
            return encrypt_payload(resultado, crypto_key, kid=str(empresa_id or "default"))
        except Exception as exc:
            _registrar_anomalia_crypto(
                ip_origem=ip_origem,
                erro=f"Falha ao criptografar resposta: {exc}",
                detalhe=sql,
                uuid_tx=uuid_tx,
                empresa_id=empresa_id or None,
                usuario=usuario or None,
            )
            raise HTTPException(status_code=500, detail="Falha ao criptografar resposta do agente.")

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
    request:    Request,
    modulo:     str = "",
    status:     str = "",
    data_ini:   str = "",
    data_fim:   str = "",
    empresa_id: str = "",
    limit:      int = 200,
):
    verificar_sessao_web(request)
    return listar_execucoes(modulo=modulo, status=status, data_ini=data_ini, data_fim=data_fim, empresa_id=empresa_id, limit=limit)


@app.get("/api/logs/{log_id}")
def api_log_detalhe(request: Request, log_id: int):
    verificar_sessao_web(request)
    rec = get_execucao(log_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")
    return rec


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
        "CRYPTO_KEY_CONFIGURADA": bool(c.get("CRYPTO_KEY")),
        "CRYPTO_REQUIRED":    _bool_cfg(c.get("CRYPTO_REQUIRED", "false")),
    }


@app.get("/api/config/reveal-db-pass")
def api_reveal_db_pass(request: Request):
    verificar_sessao_web(request)
    c = get_config()
    return {"senha": c.get("DB_PASS") or None}


@app.post("/api/config")
async def api_set_config(request: Request):
    verificar_sessao_web(request)
    body = await request.json()
    for campo in ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_DRIVER", "FILIAL", "API_PORT", "CRYPTO_REQUIRED"]:
        if campo in body:
            set_config(campo, body[campo])
    if body.get("DB_PASS"):
        set_config("DB_PASS", body["DB_PASS"])
    if body.get("CRYPTO_KEY"):
        try:
            normalize_key(body["CRYPTO_KEY"])
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        set_config("CRYPTO_KEY", body["CRYPTO_KEY"])
    return {"ok": True}


@app.post("/api/config/testar-erp")
async def api_testar_erp(request: Request, empresa_id: str = ""):
    verificar_sessao_web(request)
    return await testar_conexao(empresa_id)


# ── API Web: config ERP por empresa ───────────────────────────────────────────
@app.get("/api/empresas/{empresa_id}/conexao-erp")
def api_get_conexao_erp(request: Request, empresa_id: str):
    verificar_sessao_web(request)
    row = get_conexao_erp(empresa_id)
    if not row:
        return {
            "empresa_id": empresa_id, "db_host": "", "db_port": "1433", "db_name": "",
            "db_user": "", "db_driver": "ODBC Driver 17 for SQL Server", "filial": "01",
            "senha_configurada": False, "origem": "padrao_env",
        }
    return {
        "empresa_id": empresa_id,
        "db_host":    row.get("db_host") or "",
        "db_port":    row.get("db_port") or "1433",
        "db_name":    row.get("db_name") or "",
        "db_user":    row.get("db_user") or "",
        "db_driver":  row.get("db_driver") or "ODBC Driver 17 for SQL Server",
        "filial":     row.get("filial") or "01",
        "senha_configurada": bool(row.get("db_pass_enc")),
        "origem": "conexao_propria",
    }


@app.get("/api/empresas/{empresa_id}/conexao-erp/reveal-senha")
def api_reveal_senha_conexao_erp(request: Request, empresa_id: str):
    verificar_sessao_web(request)
    row = get_conexao_erp(empresa_id)
    if not row or not row.get("db_pass_enc"):
        return {"senha": None}
    c = get_config()
    crypto_key = c.get("CRYPTO_KEY", "")
    if not crypto_key:
        raise HTTPException(status_code=400, detail="CRYPTO_KEY não configurada — não é possível decifrar a senha salva.")
    try:
        senha = decrypt_text(row["db_pass_enc"], crypto_key)
    except Exception:
        raise HTTPException(status_code=500, detail="Falha ao decifrar a senha salva.")
    return {"senha": senha}


@app.post("/api/empresas/{empresa_id}/conexao-erp")
async def api_set_conexao_erp(request: Request, empresa_id: str):
    verificar_sessao_web(request)
    body = await request.json()

    db_pass_enc = None
    senha = body.get("db_pass")
    if senha:
        c = get_config()
        crypto_key = c.get("CRYPTO_KEY", "")
        if not crypto_key:
            raise HTTPException(status_code=400, detail="Configure a CRYPTO_KEY (aba Conexão API) antes de salvar a senha da conexão ERP por empresa.")
        db_pass_enc = encrypt_text(senha, crypto_key)

    salvar_conexao_erp(
        empresa_id=empresa_id,
        db_host=body.get("db_host", ""),
        db_port=body.get("db_port", "1433"),
        db_name=body.get("db_name", ""),
        db_user=body.get("db_user", ""),
        db_pass_enc=db_pass_enc,
        db_driver=body.get("db_driver") or "ODBC Driver 17 for SQL Server",
        filial=body.get("filial", "01"),
    )
    return {"ok": True}


@app.post("/api/empresas/{empresa_id}/conexao-erp/usar-padrao-env")
def api_usar_padrao_env_conexao_erp(request: Request, empresa_id: str):
    """Copia a conexão global do .env para a empresa informada, sem expor a senha no navegador."""
    verificar_sessao_web(request)
    c = get_config()

    db_pass_enc = None
    senha_env = c.get("DB_PASS", "")
    if senha_env:
        crypto_key = c.get("CRYPTO_KEY", "")
        if not crypto_key:
            raise HTTPException(status_code=400, detail="Configure a CRYPTO_KEY (aba Conexão API) antes de copiar a senha do .env para uma empresa.")
        db_pass_enc = encrypt_text(senha_env, crypto_key)

    salvar_conexao_erp(
        empresa_id=empresa_id,
        db_host=c.get("DB_HOST", ""),
        db_port=c.get("DB_PORT", "1433"),
        db_name=c.get("DB_NAME", ""),
        db_user=c.get("DB_USER", ""),
        db_pass_enc=db_pass_enc,
        db_driver=c.get("DB_DRIVER") or "ODBC Driver 17 for SQL Server",
        filial=c.get("FILIAL", "01"),
    )
    return {"ok": True}


@app.post("/api/empresas/{origem_id}/conexao-erp/copiar-para/{destino_id}")
def api_copiar_conexao_erp(request: Request, origem_id: str, destino_id: str):
    verificar_sessao_web(request)
    if origem_id == destino_id:
        raise HTTPException(status_code=400, detail="Empresa de origem e destino são a mesma.")

    origem = get_conexao_erp(origem_id)
    if not origem:
        raise HTTPException(status_code=404, detail="A empresa de origem ainda não tem conexão ERP própria cadastrada.")

    salvar_conexao_erp(
        empresa_id=destino_id,
        db_host=origem.get("db_host", ""),
        db_port=origem.get("db_port", "1433"),
        db_name=origem.get("db_name", ""),
        db_user=origem.get("db_user", ""),
        db_pass_enc=origem.get("db_pass_enc"),
        db_driver=origem.get("db_driver") or "ODBC Driver 17 for SQL Server",
        filial=origem.get("filial", "01"),
    )
    return {"ok": True}


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


@app.post("/api/crypto-key/regerar")
def api_regerar_crypto_key(request: Request):
    verificar_sessao_web(request)
    nova = generate_key_base64()
    set_config("CRYPTO_KEY", nova)
    return {"crypto_key": nova}


@app.get("/api/crypto-key/reveal")
def api_reveal_crypto_key(request: Request):
    verificar_sessao_web(request)
    c = get_config()
    return {
        "crypto_key": c.get("CRYPTO_KEY") or None,
        "configurado": bool(c.get("CRYPTO_KEY")),
        "required": _bool_cfg(c.get("CRYPTO_REQUIRED", "false")),
    }


# ── API Web: senha admin ──────────────────────────────────────────────────────
@app.post("/api/senha")
async def api_alterar_senha(request: Request):
    verificar_sessao_web(request)
    body = await request.json()
    alterar_senha(body.get("senha_atual", ""), body.get("nova_senha", ""))
    return {"ok": True}


# ── API: reset de senha via Bearer Token (sem sessão web) ────────────────────
@app.post("/api/senha/reset")
async def api_reset_senha(request: Request, authorization: str = Header(default=None)):
    raw_token = (authorization or "").removeprefix("Bearer ").strip()
    if not verificar_token_api(raw_token):
        raise HTTPException(status_code=401, detail="Token inválido.")
    body = await request.json()
    nova_senha = body.get("nova_senha", "")
    if len(nova_senha) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter no mínimo 6 caracteres.")
    salvar_hash(nova_senha)
    return {"ok": True}


# ── API: empresas (autenticadas por Bearer token — chamadas pela nuvem) ───────
@app.post("/api/empresas/sync")
async def api_empresas_sync(request: Request, authorization: str = Header(default=None)):
    raw_token = (authorization or "").removeprefix("Bearer ").strip()
    if not verificar_token_api(raw_token):
        raise HTTPException(status_code=401, detail="Token inválido.")
    body = await request.json()
    empresas = body.get("empresas", [])
    if not isinstance(empresas, list):
        raise HTTPException(status_code=400, detail="Campo 'empresas' deve ser uma lista.")
    import time as _time
    t0 = _time.monotonic()
    sincronizar_empresas(empresas)

    c = get_config()
    crypto_key = c.get("CRYPTO_KEY", "")
    for emp in empresas:
        conexao = emp.get("conexao_erp")
        if not isinstance(conexao, dict):
            continue
        eid = str(emp.get("empresa_id", "")).strip()
        if not eid:
            continue
        db_pass_enc = None
        if conexao.get("db_pass"):
            if not crypto_key:
                continue  # sem CRYPTO_KEY local não é seguro persistir a senha em claro
            db_pass_enc = encrypt_text(conexao["db_pass"], crypto_key)
        salvar_conexao_erp(
            empresa_id=eid,
            db_host=conexao.get("db_host", ""),
            db_port=conexao.get("db_port", "1433"),
            db_name=conexao.get("db_name", ""),
            db_user=conexao.get("db_user", ""),
            db_pass_enc=db_pass_enc,
            db_driver=conexao.get("db_driver") or "ODBC Driver 17 for SQL Server",
            filial=conexao.get("filial", "01"),
        )

    duracao = int((_time.monotonic() - t0) * 1000)
    nomes   = ", ".join(e.get("nome", e.get("empresa_id", "?")) for e in empresas)
    registrar_execucao(
        uuid=str(_uuid.uuid4()),
        modulo="sistema",
        operacao="sync_empresas",
        sql_entrada=f"Sync de {len(empresas)} empresa(s): {nomes}",
        sql_executado="",
        payload_saida=[{"empresa_id": e.get("empresa_id"), "nome": e.get("nome")} for e in empresas],
        duracao_ms=duracao,
        status="ok",
        erro=None,
        ip_origem=request.client.host if request.client else "desconhecido",
        linhas_retornadas=len(empresas),
    )
    return {"ok": True, "sincronizadas": len(empresas)}


@app.get("/api/empresas")
def api_listar_empresas(request: Request):
    verificar_sessao_web(request)
    return listar_empresas()


@app.get("/api/empresas/list")
def api_listar_empresas_api(authorization: str = Header(default=None)):
    raw_token = (authorization or "").removeprefix("Bearer ").strip()
    if not verificar_token_api(raw_token):
        raise HTTPException(status_code=401, detail="Token inválido.")
    return listar_empresas()


@app.get("/api/empresas/public")
def api_empresas_public():
    """Endpoint público para a página de login — sem autenticação."""
    return listar_empresas_public()


# ── API Web: remover empresa ──────────────────────────────────────────────────
@app.delete("/api/empresas/{empresa_id}")
def api_remover_empresa(request: Request, empresa_id: str):
    verificar_sessao_web(request)
    remover_empresa(empresa_id)
    return {"ok": True}


# ── API Web: editor de código ─────────────────────────────────────────────────
EDITOR_WHITELIST = [
    {"arquivo": "main.py",                 "descricao": "Servidor principal FastAPI"},
    {"arquivo": "database.py",             "descricao": "Banco SQLite — execuções e empresas"},
    {"arquivo": "config.py",               "descricao": "Configurações do agente"},
    {"arquivo": "auth.py",                 "descricao": "Autenticação (sessão e token)"},
    {"arquivo": "modules/erp_executor.py",  "descricao": "Executor SQL no ERP"},
    {"arquivo": "modules/factory_reset.py", "descricao": "Factory reset — restaura arquivos originais"},
]

@app.get("/api/codigo/arquivos")
def api_codigo_arquivos(request: Request):
    verificar_sessao_web(request)
    result = []
    for item in EDITOR_WHITELIST:
        p = BASE_DIR / item["arquivo"]
        result.append({
            "arquivo":   item["arquivo"],
            "descricao": item["descricao"],
            "existe":    p.exists(),
            "tamanho":   p.stat().st_size if p.exists() else 0,
        })
    return result

@app.get("/api/codigo/conteudo")
def api_codigo_conteudo(request: Request, arquivo: str = ""):
    verificar_sessao_web(request)
    nomes = [i["arquivo"] for i in EDITOR_WHITELIST]
    if arquivo not in nomes:
        raise HTTPException(status_code=403, detail="Arquivo não permitido.")
    p = BASE_DIR / arquivo
    if not p.exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    return {"conteudo": p.read_text(encoding="utf-8")}

@app.post("/api/codigo/salvar")
async def api_codigo_salvar(request: Request):
    verificar_sessao_web(request)
    body    = await request.json()
    arquivo = body.get("arquivo", "")
    conteudo = body.get("conteudo", "")
    nomes = [i["arquivo"] for i in EDITOR_WHITELIST]
    if arquivo not in nomes:
        raise HTTPException(status_code=403, detail="Arquivo não permitido.")
    p = BASE_DIR / arquivo
    if p.exists():
        shutil.copy2(p, BASE_DIR / f"{arquivo}.bak")
    p.write_text(conteudo, encoding="utf-8")
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
