import json
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "audit.db"


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


def registrar_execucao(
    *, uuid, modulo, operacao, sql_entrada, sql_executado,
    payload_saida, duracao_ms, status, erro, ip_origem,
):
    agora = datetime.utcnow().isoformat()
    saida_json = None
    if payload_saida is not None:
        try:
            saida_json = json.dumps(payload_saida, ensure_ascii=False, default=str)
        except Exception:
            saida_json = str(payload_saida)

    with _conn() as db:
        db.execute(
            """INSERT INTO execucoes
               (uuid, modulo, operacao, ip_origem, sql_entrada, sql_executado,
                payload_saida, duracao_ms, status, erro, chegada_em, finalizado_em)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (uuid, modulo, operacao, ip_origem, sql_entrada, sql_executado,
             saida_json, duracao_ms, status, erro, agora, agora),
        )


def listar_execucoes(*, modulo="", status="", data_ini="", data_fim="", limit=200):
    where, params = ["1=1"], []
    if modulo:   where.append("modulo = ?");          params.append(modulo)
    if status:   where.append("status = ?");          params.append(status)
    if data_ini: where.append("chegada_em >= ?");     params.append(data_ini)
    if data_fim: where.append("chegada_em <= ?");     params.append(data_fim + "T23:59:59")
    params.append(min(limit, 1000))

    with _conn() as db:
        rows = db.execute(
            f"SELECT * FROM execucoes WHERE {' AND '.join(where)} ORDER BY chegada_em DESC LIMIT ?",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


def limpar_historico():
    with _conn() as db:
        db.execute("DELETE FROM execucoes")


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
