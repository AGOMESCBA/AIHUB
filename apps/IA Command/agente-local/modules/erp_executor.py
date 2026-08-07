import time
import asyncio
from config import get_config
from database import get_conexao_erp
from crypto_envelope import decrypt_text

_BLOCKED_KEYWORDS = [
    "INSERT ", "UPDATE ", "DELETE ", "DROP ", "TRUNCATE ", "ALTER ",
    "CREATE ", "EXEC ", "EXECUTE ", "SP_", "XP_", "OPENROWSET",
]
MAX_ROWS_HARD = 50_000


def _resolver_credenciais(empresa_id: str = "", connection_key: str = "") -> dict:
    """Resolve host/porta/banco/usuário/senha/driver para a empresa informada.
    Se não houver conexão própria cadastrada (empresa nova ou instalação single-tenant),
    cai no .env global — comportamento legado preservado."""
    cfg = get_config()
    row = get_conexao_erp(empresa_id, connection_key) if empresa_id else None

    if empresa_id and connection_key and not row:
        return {
            "driver": cfg.get("DB_DRIVER") or "ODBC Driver 17 for SQL Server",
            "host":   "",
            "port":   cfg.get("DB_PORT", "1433"),
            "db":     "",
            "user":   "",
            "passwd": "",
            "origem": "conexao_nao_encontrada",
            "connection_key": connection_key,
            "connection_nome": "",
        }

    if row and row.get("db_host"):
        senha = ""
        if row.get("db_pass_enc"):
            crypto_key = cfg.get("CRYPTO_KEY", "")
            senha = decrypt_text(row["db_pass_enc"], crypto_key) if crypto_key else ""
        return {
            "driver": row.get("db_driver") or "ODBC Driver 17 for SQL Server",
            "host":   row.get("db_host")   or "",
            "port":   row.get("db_port")   or "1433",
            "db":     row.get("db_name")   or "",
            "user":   row.get("db_user")   or "",
            "passwd": senha,
            "origem": "conexao_propria",
            "connection_key": row.get("connection_key") or "default",
            "connection_nome": row.get("nome") or "",
        }

    return {
        "driver": cfg.get("DB_DRIVER") or "ODBC Driver 17 for SQL Server",
        "host":   cfg.get("DB_HOST",  ""),
        "port":   cfg.get("DB_PORT",  "1433"),
        "db":     cfg.get("DB_NAME",  ""),
        "user":   cfg.get("DB_USER",  ""),
        "passwd": cfg.get("DB_PASS",  ""),
        "origem": "padrao_env",
        "connection_key": "",
        "connection_nome": "",
    }


def _get_pyodbc_conn(empresa_id: str = "", connection_key: str = ""):
    import pyodbc
    cred = _resolver_credenciais(empresa_id, connection_key)
    if cred.get("origem") == "conexao_nao_encontrada":
        raise RuntimeError(f"Conexao '{connection_key}' nao encontrada para a empresa {empresa_id}. Sincronize a conexao pelo IA Command.")
    conn_str = (
        f"DRIVER={{{cred['driver']}}};"
        f"SERVER={cred['host']},{cred['port']};"
        f"DATABASE={cred['db']};"
        f"UID={cred['user']};"
        f"PWD={cred['passwd']};"
        f"TrustServerCertificate=yes;"
        f"Connection Timeout=15;"
    )
    return pyodbc.connect(conn_str, timeout=30)


async def testar_conexao(empresa_id: str = "", connection_key: str = "") -> dict:
    def _test():
        import pyodbc
        conn = _get_pyodbc_conn(empresa_id, connection_key)
        conn.execute("SELECT 1")
        conn.close()

    try:
        await asyncio.to_thread(_test)
        return {"ok": True, "mensagem": "Conexão com o banco ERP estabelecida com sucesso."}
    except ImportError:
        return {"ok": False, "erro": "pyodbc não instalado. Execute: pip install pyodbc"}
    except Exception as e:
        return {"ok": False, "erro": str(e)}


async def executar_sql(sql: str, limit: int = 10_000, empresa_id: str = "", connection_key: str = "") -> dict:
    sql = sql.strip()
    if not sql:
        return _erro("SQL vazio.", sql, 0)

    import re as _re
    sql = _re.sub(r'^(SET\s+[^;]+;\s*)+', '', sql, flags=_re.IGNORECASE).strip()

    upper = sql.upper()

    stripped = upper.lstrip()
    is_select = stripped.startswith("SELECT")
    is_cte    = stripped.startswith("WITH")
    if not is_select and not is_cte:
        return _erro("Apenas comandos SELECT são permitidos.", sql, 0)
    if is_cte and "SELECT" not in upper:
        return _erro("Apenas comandos SELECT são permitidos.", sql, 0)

    for kw in _BLOCKED_KEYWORDS:
        if kw in upper:
            return _erro(f"Palavra-chave bloqueada detectada: '{kw.strip()}'", sql, 0)

    limit_eff = min(limit, MAX_ROWS_HARD)
    sql_final = _injetar_top(sql, upper, limit_eff)

    t0 = time.perf_counter()
    cred_resolvida = _resolver_credenciais(empresa_id, connection_key)
    origem_conexao = cred_resolvida["origem"]

    def _run_query():
        import pyodbc
        conn   = _get_pyodbc_conn(empresa_id, connection_key)
        try:
            cursor = conn.cursor()
            cursor.execute(sql_final)
            cols = [d[0] for d in cursor.description]
            rows = [dict(zip(cols, row)) for row in cursor.fetchmany(limit_eff)]
            cursor.close()
            return rows
        finally:
            conn.close()

    try:
        rows = await asyncio.to_thread(_run_query)
        duracao = _ms(t0)
        return {
            "rows": rows,
            "status": "ok",
            "duracao_ms": duracao,
            "sql_executado": sql_final,
            "origem_conexao": origem_conexao,
            "connection_key": cred_resolvida.get("connection_key") or "",
            "connection_nome": cred_resolvida.get("connection_nome") or "",
        }
    except ImportError:
        return _erro("pyodbc não instalado. Execute: pip install pyodbc", sql_final, _ms(t0), origem_conexao)
    except Exception as e:
        return _erro(str(e), sql_final, _ms(t0), origem_conexao)


def _injetar_top(sql: str, upper: str, limit: int) -> str:
    if "TOP " in upper or "ROWCOUNT" in upper or "OFFSET" in upper:
        return sql
    if upper.lstrip().startswith("WITH"):
        return sql
    idx = sql.upper().find("SELECT") + len("SELECT")
    return sql[:idx] + f" TOP {limit}" + sql[idx:]


def _ms(t0: float) -> int:
    return round((time.perf_counter() - t0) * 1000)


def _erro(msg: str, sql: str, duracao: int, origem_conexao: str = "") -> dict:
    return {"rows": [], "status": "erro", "erro": msg, "duracao_ms": duracao, "sql_executado": sql, "origem_conexao": origem_conexao}
