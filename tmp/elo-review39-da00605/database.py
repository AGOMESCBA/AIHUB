"""Homologação 3.9: conferência somente leitura do banco sintético local com a conexão real da API.

Usa DB_URL de apps/api/.env (usuário da API) em uma única conexão física, para provar que o contexto
aplicado com SET LOCAL não sobrevive ao fim da transação, nem a erro com rollback. A revisão do
banco é lida com o usuário dono de .local/access.json. Nenhuma credencial é impressa; qualquer
escrita tentada fica dentro de transação desfeita. Somente loopback e banco de desenvolvimento local.
"""
import json
import sys
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import StaticPool

ROOT = Path(r'C:/Apps/ELOGESTAO')
API = ROOT / "apps" / "api"
ROLES = ("elo_app", "elo_auth", "elo_platform")
results = []


def check(name, ok, detail=None):
    results.append({"verificacao": name, "ok": bool(ok), **({} if detail is None else {"detalhe": detail})})
    print(("OK    " if ok else "FALHA ") + name + ("" if ok or detail is None else f" — {detail}"))


def api_url():
    for line in (API / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("DB_URL="):
            return make_url(line.split("=", 1)[1].strip())
    raise SystemExit("DB_URL ausente em apps/api/.env")


url = api_url()
if url.host not in ("127.0.0.1", "localhost") or not url.database.endswith("_dev"):
    raise SystemExit("Somente o banco de desenvolvimento local em loopback.")

owner = json.loads((ROOT / ".local" / "access.json").read_text(encoding="utf-8"))["database"]
owner_url = url.set(username=owner["user"], password=owner["password"], database=owner["name"])
with create_engine(owner_url).connect() as c:
    current = c.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    customers = c.execute(text("SELECT id FROM customers WHERE deleted_at IS NULL ORDER BY id LIMIT 2")).scalars().all()
head = ScriptDirectory.from_config(Config(str(API / "alembic.ini"))).get_current_head()
check("Banco na revisão head das migrações", current == head, {"banco": current, "head": head})

# Uma única conexão física, reaproveitada por todas as transações abaixo (como no pool da API).
engine = create_engine(url, poolclass=StaticPool)
with engine.connect() as c:
    login = c.execute(text("SELECT current_user")).scalar_one()
    rows = c.execute(text("""SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole
                             FROM pg_roles WHERE rolname = ANY(:names) ORDER BY rolname"""),
                     {"names": [login, *ROLES]}).mappings().all()
    attrs = {r["rolname"]: dict(r) for r in rows}
    check("Conexão da API sem SUPERUSER, BYPASSRLS, CREATEDB ou CREATEROLE",
          all(not any(a[k] for k in ("rolsuper", "rolbypassrls", "rolcreatedb", "rolcreaterole")) for a in attrs.values()),
          attrs)
    check("Login da API sem herança automática de privilégios (NOINHERIT)", not attrs[login]["rolinherit"])
    owned = c.execute(text("SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = :u"),
                      {"u": login}).scalar_one()
    check("Login da API não é dono de tabelas", owned == 0, owned)
    rls = c.execute(text("""SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
                            WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity
                            ORDER BY relname""")).mappings().all()
    names = [r["relname"] for r in rls]
    expected = {"departments", "municipal_offices", "customer_memberships", "role_assignments"}
    check("RLS ativa nas tabelas organizacionais e de acesso previstas", expected <= set(names),
          {"tabelas_com_rls": len(names), "ausentes": sorted(expected - set(names))})
    # A RLS não é FORCE (decisão de 28/30): vale para quem não é dono. A garantia é que nenhum papel usado
    # pela API seja dono dessas tabelas; o dono é o papel de migração, nunca usado pela aplicação.
    owners = c.execute(text("""SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'
                               AND tablename = ANY(:t)"""), {"t": names}).scalars().all()
    check("Tabelas com RLS pertencem ao papel de migração, não ao login nem aos papéis da aplicação",
          not (set(owners) & {login, *ROLES}), {"donos": owners, "forcadas": sum(r["relforcerowsecurity"] for r in rls)})
    c.commit()

    # Sem papel aplicado: nenhuma tabela de negócio é acessível ao login da API.
    try:
        c.execute(text("SELECT count(*) FROM departments"))
        check("Sem papel aplicado, o login da API não lê tabelas", False)
    except Exception as error:  # permissão negada esperada
        check("Sem papel aplicado, o login da API não lê tabelas", "permission denied" in str(error).lower())
    c.rollback()

    def scoped(customer, mode="customer_admin", all_offices="true"):
        c.execute(text("SET LOCAL ROLE elo_app"))
        for key, value in (("elo.customer_id", str(customer)), ("elo.context_mode", mode),
                           ("elo.office_ids", ""), ("elo.all_offices", all_offices)):
            c.execute(text("SELECT set_config(:k, :v, true)"), {"k": key, "v": value})

    def count(table, customer_column="customer_id", customer=None):
        where = "" if customer is None else f" WHERE {customer_column} = :c"
        return c.execute(text(f"SELECT count(*) FROM {table}{where}"), {"c": customer}).scalar_one()

    c.execute(text("SET LOCAL ROLE elo_app"))
    check("Papel da aplicação sem contexto não vê departamentos nem secretarias",
          count("departments") == 0 and count("municipal_offices") == 0)
    c.rollback()

    a, b = customers[0], customers[1]
    scoped(a)
    seen_a, seen_b = count("municipal_offices", customer=a), count("municipal_offices", customer=b)
    check("Contexto do órgão A vê secretarias de A e nenhuma de B", seen_a > 0 and seen_b == 0, {"A": seen_a, "B": seen_b})
    changed = c.execute(text("UPDATE municipal_offices SET name = name WHERE customer_id = :b"), {"b": b}).rowcount
    check("Escrita sobre o órgão B no contexto de A não alcança linhas (desfeita)", changed == 0, changed)
    c.rollback()

    # Mesma conexão física: a transação seguinte começa sem papel nem contexto.
    state = c.execute(text("SELECT current_user, current_setting('elo.customer_id', true)")).one()
    check("Conexão reutilizada volta ao login da API, sem contexto herdado", state[0] == login and not state[1],
          {"usuario": state[0], "contexto": state[1]})
    c.rollback()

    scoped(a)
    try:
        c.execute(text("SELECT 1 / 0"))
    except Exception:
        c.rollback()
    state = c.execute(text("SELECT current_user, current_setting('elo.customer_id', true)")).one()
    c.execute(text("SET LOCAL ROLE elo_app"))
    after_error = count("municipal_offices")
    check("Erro com rollback descarta papel e contexto; nada visível sem novo contexto",
          state[0] == login and not state[1] and after_error == 0, {"usuario": state[0], "visiveis": after_error})
    c.rollback()

failed = [r for r in results if not r["ok"]]
out = Path(r'C:/Apps/iahub/tmp/elo-review39-da00605/database.json')
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"aprovadas": len(results) - len(failed), "total": len(results), "resultados": results},
                          ensure_ascii=False, indent=2, default=str), encoding="utf-8")
print(f"\n{len(results) - len(failed)}/{len(results)} verificações aprovadas.")
sys.exit(1 if failed else 0)
