import time
from config import get_config

_BLOCKED_KEYWORDS = [
    "INSERT ", "UPDATE ", "DELETE ", "DROP ", "TRUNCATE ", "ALTER ",
    "CREATE ", "EXEC ", "EXECUTE ", "SP_", "XP_", "OPENROWSET",
]
MAX_ROWS_HARD = 50_000


async def testar_conexao() -> dict:
    try:
        import pyodbc
        conn = _get_pyodbc_conn()
        conn.execute("SELECT 1")
        conn.close()
        return {"ok": True, "mensagem": "Conexão com o banco ERP estabelecida com sucesso."}
    except ImportError:
        return {"ok": False, "erro": "pyodbc não instalado. Execute: pip install pyodbc"}
    except Exception as e:
        return {"ok": False, "erro": str(e)}


async def executar_sql(sql: str, limit: int = 10_000) -> dict:
    sql = sql.strip()
    if not sql:
        return _erro("SQL vazio.", sql, 0)

    # Remove quaisquer instruções SET iniciais (SET ROWCOUNT, SET NOCOUNT, SET TRANSACTION ISOLATION LEVEL, etc.)
    import re as _re
    sql = _re.sub(r'^(SET\s+[^;]+;\s*)+', '', sql, flags=_re.IGNORECASE).strip()

    upper = sql.upper()

    # Aceita CTEs (WITH ... AS (...) SELECT ...) além de SELECT direto
    stripped = upper.lstrip()
    is_select = stripped.startswith("SELECT")
    is_cte    = stripped.startswith("WITH")
    if not is_select and not is_cte:
        return _erro("Apenas comandos SELECT são permitidos.", sql, 0)
    # CTE deve conter SELECT para ser leitura — rejeita WITH sem SELECT
    if is_cte and "SELECT" not in upper:
        return _erro("Apenas comandos SELECT são permitidos.", sql, 0)

    for kw in _BLOCKED_KEYWORDS:
        if kw in upper:
            return _erro(f"Palavra-chave bloqueada detectada: '{kw.strip()}'", sql, 0)

    limit_eff = min(limit, MAX_ROWS_HARD)
    sql_final = _injetar_top(sql, upper, limit_eff)

    t0 = time.perf_counter()
    try:
        import pyodbc
        conn   = _get_pyodbc_conn()
        cursor = conn.cursor()
        cursor.execute(sql_final)
        cols = [d[0] for d in cursor.description]
        rows = [dict(zip(cols, row)) for row in cursor.fetchmany(limit_eff)]
        conn.close()
        duracao = _ms(t0)
        return {"rows": rows, "status": "ok", "duracao_ms": duracao, "sql_executado": sql_final}
    except ImportError:
        return _erro("pyodbc não instalado. Execute: pip install pyodbc", sql_final, _ms(t0))
    except Exception as e:
        return _erro(str(e), sql_final, _ms(t0))


def _injetar_top(sql: str, upper: str, limit: int) -> str:
    if "TOP " in upper or "ROWCOUNT" in upper or "OFFSET" in upper:
        return sql
    # CTEs já controlam volume internamente (ROW_NUMBER, GROUP BY, etc.) — não injetar TOP
    if upper.lstrip().startswith("WITH"):
        return sql
    # Injeta TOP logo após SELECT (ignora DISTINCT)
    idx = sql.upper().find("SELECT") + len("SELECT")
    return sql[:idx] + f" TOP {limit}" + sql[idx:]


def _get_pyodbc_conn():
    import pyodbc
    cfg    = get_config()
    driver = cfg.get("DB_DRIVER") or "ODBC Driver 17 for SQL Server"
    host   = cfg.get("DB_HOST",  "")
    port   = cfg.get("DB_PORT",  "1433")
    db     = cfg.get("DB_NAME",  "")
    user   = cfg.get("DB_USER",  "")
    passwd = cfg.get("DB_PASS",  "")
    conn_str = (
        f"DRIVER={{{driver}}};"
        f"SERVER={host},{port};"
        f"DATABASE={db};"
        f"UID={user};"
        f"PWD={passwd};"
        f"TrustServerCertificate=yes;"
        f"Connection Timeout=15;"
    )
    return pyodbc.connect(conn_str, timeout=30)


def _ms(t0: float) -> int:
    return round((time.perf_counter() - t0) * 1000)


def _erro(msg: str, sql: str, duracao: int) -> dict:
    return {"rows": [], "status": "erro", "erro": msg, "duracao_ms": duracao, "sql_executado": sql}
