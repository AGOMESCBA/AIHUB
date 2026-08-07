import base64
import json
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH    = Path(__file__).parent / "audit.db"
STATIC_DIR = Path(__file__).parent / "static"


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with _conn() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS execucoes (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid           TEXT,
                modulo         TEXT,
                operacao       TEXT,
                ip_origem      TEXT,
                pergunta       TEXT,
                sender         TEXT,
                sql_entrada    TEXT,
                sql_executado  TEXT,
                payload_saida  TEXT,
                duracao_ms     INTEGER,
                status         TEXT NOT NULL DEFAULT 'ok',
                erro           TEXT,
                chegada_em     TEXT NOT NULL,
                finalizado_em  TEXT NOT NULL
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS idx_exec_modulo  ON execucoes (modulo,  chegada_em)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_exec_status  ON execucoes (status,  chegada_em)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_exec_uuid    ON execucoes (uuid)")
        # Migrações: adiciona colunas em bases existentes sem recriar a tabela
        for col, typ in [
            ("pergunta",          "TEXT"),
            ("sender",            "TEXT"),
            ("empresa_id",        "TEXT"),
            ("usuario",           "TEXT"),
            ("connection_key",     "TEXT"),
            ("connection_nome",    "TEXT"),
            ("linhas_retornadas", "INTEGER"),
            ("limite_solicitado", "INTEGER"),
            ("tipo_erro",         "TEXT"),
            ("origem_conexao",    "TEXT"),
        ]:
            try:
                db.execute(f"ALTER TABLE execucoes ADD COLUMN {col} {typ}")
            except Exception:
                pass

        db.execute("""
            CREATE TABLE IF NOT EXISTS empresas (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                empresa_id      TEXT NOT NULL UNIQUE,
                nome            TEXT NOT NULL,
                cnpj            TEXT,
                ativo           INTEGER DEFAULT 1,
                sincronizado_em TEXT NOT NULL,
                logo_url        TEXT,
                bg_url          TEXT,
                slogan          TEXT
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS idx_empresas_eid ON empresas (empresa_id)")
        for col, typ in [("logo_url", "TEXT"), ("bg_url", "TEXT"), ("slogan", "TEXT")]:
            try:
                db.execute(f"ALTER TABLE empresas ADD COLUMN {col} {typ}")
            except Exception:
                pass

        db.execute("""
            CREATE TABLE IF NOT EXISTS conexoes_erp (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                empresa_id      TEXT NOT NULL UNIQUE,
                db_host         TEXT,
                db_port         TEXT,
                db_name         TEXT,
                db_user         TEXT,
                db_pass_enc     TEXT,
                db_driver       TEXT,
                filial          TEXT,
                atualizado_em   TEXT NOT NULL
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS idx_conexoes_erp_eid ON conexoes_erp (empresa_id)")
        db.execute("""
            CREATE TABLE IF NOT EXISTS conexoes_dados (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                empresa_id      TEXT NOT NULL,
                connection_key  TEXT NOT NULL,
                nome            TEXT,
                sistema_origem  TEXT,
                db_host         TEXT,
                db_port         TEXT,
                db_name         TEXT,
                db_user         TEXT,
                db_pass_enc     TEXT,
                db_driver       TEXT,
                filial          TEXT,
                padrao          INTEGER DEFAULT 0,
                ativo           INTEGER DEFAULT 1,
                atualizado_em   TEXT NOT NULL,
                UNIQUE(empresa_id, connection_key)
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS idx_conexoes_dados_eid ON conexoes_dados (empresa_id, ativo)")
        db.execute("""
            INSERT OR IGNORE INTO conexoes_dados
              (empresa_id, connection_key, nome, sistema_origem, db_host, db_port, db_name, db_user,
               db_pass_enc, db_driver, filial, padrao, ativo, atualizado_em)
            SELECT empresa_id, 'default', 'Conexao padrao', 'protheus', db_host, db_port, db_name, db_user,
                   db_pass_enc, db_driver, filial, 1, 1, atualizado_em
              FROM conexoes_erp
        """)


def registrar_execucao(
    *, uuid, modulo, operacao, sql_entrada, sql_executado,
    payload_saida, duracao_ms, status, erro, ip_origem,
    pergunta=None, sender=None, empresa_id=None, usuario=None,
    connection_key=None, connection_nome=None,
    linhas_retornadas=None, limite_solicitado=None, tipo_erro=None,
    origem_conexao=None,
):
    agora = datetime.utcnow().isoformat()
    # Grava apenas amostra (primeiras 10 linhas) + total — evita JSON gigante no SQLite
    amostra = None
    if payload_saida is not None:
        try:
            rows = payload_saida if isinstance(payload_saida, list) else []
            amostra = json.dumps(rows[:10], ensure_ascii=False, default=str)
        except Exception:
            amostra = str(payload_saida)[:4000]

    with _conn() as db:
        db.execute(
            """INSERT INTO execucoes
               (uuid, modulo, operacao, ip_origem, pergunta, sender, empresa_id, usuario, connection_key, connection_nome,
                sql_entrada, sql_executado, payload_saida, duracao_ms,
                status, erro, linhas_retornadas, limite_solicitado, tipo_erro, origem_conexao,
                chegada_em, finalizado_em)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (uuid, modulo, operacao, ip_origem, pergunta, sender, empresa_id, usuario, connection_key, connection_nome,
             sql_entrada, sql_executado, amostra, duracao_ms,
             status, erro, linhas_retornadas, limite_solicitado, tipo_erro, origem_conexao,
             agora, agora),
        )


_COLS_LISTA = (
    "id, uuid, modulo, operacao, ip_origem, pergunta, sender, sql_entrada, sql_executado, "
    "duracao_ms, status, erro, chegada_em, finalizado_em, empresa_id, usuario, "
    "connection_key, connection_nome, linhas_retornadas, limite_solicitado, tipo_erro, origem_conexao"
)

def listar_execucoes(*, modulo="", status="", data_ini="", data_fim="", empresa_id="", limit=200):
    where, params = ["1=1"], []
    if modulo:     where.append("modulo = ?");        params.append(modulo)
    if status:     where.append("status = ?");        params.append(status)
    if empresa_id: where.append("empresa_id = ?");    params.append(empresa_id)
    if data_ini:   where.append("chegada_em >= ?");   params.append(data_ini)
    if data_fim:   where.append("chegada_em <= ?");   params.append(data_fim + "T23:59:59")
    params.append(min(limit, 1000))

    with _conn() as db:
        rows = db.execute(
            f"SELECT {_COLS_LISTA} FROM execucoes WHERE {' AND '.join(where)} ORDER BY chegada_em DESC LIMIT ?",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


def get_execucao(id_: int):
    with _conn() as db:
        row = db.execute("SELECT * FROM execucoes WHERE id = ?", (id_,)).fetchone()
    return dict(row) if row else None


def limpar_historico():
    with _conn() as db:
        db.execute("DELETE FROM execucoes")


# ── Empresas ─────────────────────────────────────────────────────────────────

_IMG_EXTS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


def _salvar_imagem(eid: str, nome_arquivo: str, data_b64: str, mime: str) -> str | None:
    ext = _IMG_EXTS.get(mime, "png")
    try:
        pasta = STATIC_DIR / "empresas" / eid
        pasta.mkdir(parents=True, exist_ok=True)
        caminho = pasta / f"{nome_arquivo}.{ext}"
        caminho.write_bytes(base64.b64decode(data_b64))
        return f"/static/empresas/{eid}/{nome_arquivo}.{ext}"
    except Exception:
        return None


def sincronizar_empresas(lista: list):
    """Recebe lista de dicts {empresa_id, nome, cnpj?, logo_data?, bg_data?, slogan?} e faz upsert."""
    agora = datetime.utcnow().isoformat()
    with _conn() as db:
        for emp in lista:
            eid    = str(emp.get("empresa_id", "")).strip()
            nome   = str(emp.get("nome", "")).strip()
            cnpj   = str(emp.get("cnpj",   "") or "").strip() or None
            slogan = str(emp.get("slogan", "") or "").strip() or None
            if not eid or not nome:
                continue

            logo_url = _salvar_imagem(eid, "logo",       emp["logo_data"], emp.get("logo_mime", "image/png")) \
                       if emp.get("logo_data") else None
            bg_url   = _salvar_imagem(eid, "background", emp["bg_data"],   emp.get("bg_mime",   "image/jpeg")) \
                       if emp.get("bg_data")   else None

            db.execute(
                """INSERT INTO empresas (empresa_id, nome, cnpj, ativo, sincronizado_em, slogan, logo_url, bg_url)
                   VALUES (?,?,?,1,?,?,?,?)
                   ON CONFLICT(empresa_id) DO UPDATE SET
                     nome=excluded.nome,
                     cnpj=excluded.cnpj,
                     ativo=1,
                     sincronizado_em=excluded.sincronizado_em,
                     slogan=COALESCE(excluded.slogan, slogan),
                     logo_url=COALESCE(excluded.logo_url, logo_url),
                     bg_url=COALESCE(excluded.bg_url, bg_url)""",
                (eid, nome, cnpj, agora, slogan, logo_url, bg_url),
            )


def listar_empresas() -> list:
    with _conn() as db:
        rows = db.execute("SELECT * FROM empresas ORDER BY nome").fetchall()
    return [dict(r) for r in rows]


def remover_empresa(empresa_id: str):
    with _conn() as db:
        db.execute("DELETE FROM empresas WHERE empresa_id = ?", (empresa_id,))


def listar_empresas_public() -> list:
    """Retorna apenas dados públicos (sem dados sensíveis) para a página de login."""
    with _conn() as db:
        rows = db.execute(
            "SELECT empresa_id, nome, logo_url, bg_url, slogan FROM empresas WHERE ativo=1 ORDER BY nome"
        ).fetchall()
    return [dict(r) for r in rows]


# ── Conexões ERP por empresa ─────────────────────────────────────────────────

def salvar_conexao_erp(*, empresa_id: str, db_host, db_port, db_name, db_user,
                        db_pass_enc, db_driver, filial, connection_key: str = "default",
                        nome: str = "", sistema_origem: str = "protheus", padrao: int = 0,
                        ativo: int = 1):
    agora = datetime.utcnow().isoformat()
    key = str(connection_key or "default").strip() or "default"
    nome_final = str(nome or ("Conexao padrao" if key == "default" else key)).strip()
    padrao_final = 1 if key == "default" else int(padrao or 0)
    with _conn() as db:
        if key == "default":
            db.execute(
                """INSERT INTO conexoes_erp
                   (empresa_id, db_host, db_port, db_name, db_user, db_pass_enc, db_driver, filial, atualizado_em)
                   VALUES (?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(empresa_id) DO UPDATE SET
                     db_host=excluded.db_host,
                     db_port=excluded.db_port,
                     db_name=excluded.db_name,
                     db_user=excluded.db_user,
                     db_pass_enc=COALESCE(excluded.db_pass_enc, db_pass_enc),
                     db_driver=excluded.db_driver,
                     filial=excluded.filial,
                     atualizado_em=excluded.atualizado_em""",
                (empresa_id, db_host, db_port, db_name, db_user, db_pass_enc, db_driver, filial, agora),
            )
        db.execute(
            """INSERT INTO conexoes_dados
               (empresa_id, connection_key, nome, sistema_origem, db_host, db_port, db_name,
                db_user, db_pass_enc, db_driver, filial, padrao, ativo, atualizado_em)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(empresa_id, connection_key) DO UPDATE SET
                 nome=excluded.nome,
                 sistema_origem=excluded.sistema_origem,
                 db_host=excluded.db_host,
                 db_port=excluded.db_port,
                 db_name=excluded.db_name,
                 db_user=excluded.db_user,
                 db_pass_enc=COALESCE(excluded.db_pass_enc, db_pass_enc),
                 db_driver=excluded.db_driver,
                 filial=excluded.filial,
                 padrao=excluded.padrao,
                 ativo=excluded.ativo,
                 atualizado_em=excluded.atualizado_em""",
            (empresa_id, key, nome_final, sistema_origem or "", db_host, db_port, db_name,
             db_user, db_pass_enc, db_driver, filial, padrao_final, int(ativo or 0), agora),
        )


def get_conexao_erp(empresa_id: str, connection_key: str = ""):
    if not empresa_id:
        return None
    key = str(connection_key or "").strip()
    with _conn() as db:
        if key:
            row = db.execute(
                "SELECT * FROM conexoes_dados WHERE empresa_id = ? AND connection_key = ? AND ativo = 1",
                (empresa_id, key),
            ).fetchone()
            return dict(row) if row else None
        row = db.execute(
            """SELECT * FROM conexoes_dados
               WHERE empresa_id = ? AND ativo = 1
               ORDER BY padrao DESC, CASE WHEN connection_key = 'default' THEN 0 ELSE 1 END, atualizado_em DESC
               LIMIT 1""",
            (empresa_id,),
        ).fetchone()
        if row:
            return dict(row)
        row = db.execute("SELECT * FROM conexoes_erp WHERE empresa_id = ?", (empresa_id,)).fetchone()
    return dict(row) if row else None


def listar_conexoes_erp() -> list:
    with _conn() as db:
        rows = db.execute("SELECT * FROM conexoes_dados ORDER BY empresa_id, padrao DESC, nome").fetchall()
    return [dict(r) for r in rows]


def remover_conexao_dados(empresa_id: str, connection_key: str) -> bool:
    if not empresa_id or not connection_key or connection_key == "default":
        return False
    with _conn() as db:
        cur = db.execute(
            "DELETE FROM conexoes_dados WHERE empresa_id = ? AND connection_key = ?",
            (empresa_id, connection_key),
        )
        return cur.rowcount > 0


def get_stats() -> dict:
    with _conn() as db:
        total   = db.execute("SELECT COUNT(*) FROM execucoes").fetchone()[0]
        sucesso = db.execute("SELECT COUNT(*) FROM execucoes WHERE status='ok'").fetchone()[0]
        erros   = db.execute("SELECT COUNT(*) FROM execucoes WHERE status='erro'").fetchone()[0]
        avg_ms  = db.execute("SELECT AVG(duracao_ms) FROM execucoes WHERE status='ok'").fetchone()[0]
        modulos = db.execute(
            "SELECT modulo, COUNT(*) as total FROM execucoes WHERE modulo != '' GROUP BY modulo ORDER BY total DESC"
        ).fetchall()
    return {
        "total":   total,
        "sucesso": sucesso,
        "erros":   erros,
        "avg_ms":  round(avg_ms or 0),
        "modulos": [dict(m) for m in modulos],
    }
