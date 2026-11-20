"""Homologação 3.9: cenários integrados de maior risco contra a API real em execução (8010) e o banco
sintético local. Complementa as suítes automatizadas (bancos descartáveis) demonstrando a integração
atual. Somente usuários sintéticos de .local/access.json; nenhum token, CPF ou senha é impresso.
Gravações tentadas devem ser recusadas; o banco é conferido depois. A revogação por órgão afeta apenas
a sessão criada pelo próprio ensaio. Uso: python tools/dev/smoke_foundation_39.py
"""
import json
import sys
import uuid
from pathlib import Path

import httpx
import psycopg

ROOT = Path(r'C:/Apps/ELOGESTAO')
access = json.loads((ROOT / ".local" / "access.json").read_text(encoding="utf-8"))
API = access["api"]
if API != "http://127.0.0.1:8010":
    raise SystemExit("Somente a API local sintética.")
db = access["database"]
users = {"plataforma": access["user"], **access["demo_users"]}
client = httpx.Client(base_url=API, timeout=30)
results = []


def check(name, ok, detail=None):
    results.append({"verificacao": name, "ok": bool(ok), **({} if detail is None else {"detalhe": detail})})
    print(("OK    " if ok else "FALHA ") + name + ("" if ok or detail is None else f" — {detail}"))


def scalar(sql, *params):
    with psycopg.connect(host=db["host"], port=db["port"], user=db["user"], password=db["password"],
                         dbname=db["name"]) as c:
        return c.execute(sql, params).fetchone()[0]


def login(key, password=None):
    user = users[key]
    return client.post("/login", data={"username": user["cpf"], "password": password or user["password"]})


def session(key):
    response = login(key)
    assert response.status_code == 200, (key, response.status_code)
    return response.json()


def h(token, customer=None, office=None, **extra):
    headers = {"Authorization": f"Bearer {token}", **extra}
    if customer is not None:
        headers["X-Elo-Customer-Id"] = str(customer)
    if office is not None:
        headers["X-Elo-Municipal-Office-Id"] = str(office)
    return headers


def code(response):
    try:
        body = response.json()
    except ValueError:
        return None
    return body.get("code") if isinstance(body, dict) else None


def status(response):
    return {"status": response.status_code, "code": code(response)}



sessions=[]
try:
    p=session('plataforma'); a=session('admin_orgao_a'); m=session('multi_orgao')
    sessions=[p,a,m]
    mine=client.get('/me/customers',headers=h(m['access_token'])).json()['items']
    A=next(c['id'] for c in mine if 'desenvolvimento' in c['name'])
    B=next(c['id'] for c in mine if c['name'].endswith(' B'))
    ca=client.get(f'/me/customers/{A}/contexts',headers=h(m['access_token'])).json()
    cb=client.get(f'/me/customers/{B}/contexts',headers=h(m['access_token'])).json()
    A1=ca['offices'][0]['id']; B1=cb['offices'][0]['id']
    na=client.get('/me/navigation',params={'mode':'office','customer_id':A,'municipal_office_id':A1},headers=h(m['access_token'])).json()
    nb=client.get('/me/navigation',params={'mode':'office','customer_id':B,'municipal_office_id':B1},headers=h(m['access_token'])).json()
    check('Mesma identidade mantém permissões distintas por órgão',na['customer']['id']==A and nb['customer']['id']==B and set(na['permissions'])!=set(nb['permissions']))
    original=client.get(f'/officers/{B1}',headers=h(m['access_token'],B,B1))
    assert original.status_code==200
    row=original.json()
    valid={k:row[k] for k in ('customer_id','name','email','phone','status')}
    crossed=client.put(f'/officers/{B1}',json=valid,headers=h(a['access_token'],A,**{'If-Match':original.headers['etag']}))
    check('PUT com corpo válido e versão atual de outro órgão recusado',crossed.status_code in (403,404),status(crossed))
    marker='Revisão independente 39 '+uuid.uuid4().hex
    ref=client.post('/departments/',json={'name':marker,'email':'review39@example.com','phone':'0','municipal_office_id':B1},headers=h(a['access_token'],A,**{'Idempotency-Key':str(uuid.uuid4())}))
    problem=ref.json()
    check('Referência cruzada válida chega à regra de propriedade e é recusada',ref.status_code==422 and problem.get('code')=='VALIDATION_FAILED' and isinstance(problem.get('detail'),str) and 'Secretaria' in problem['detail'],status(ref))
    check('Tentativas recusadas não alteram secretaria nem criam departamento',scalar('SELECT name FROM municipal_offices WHERE id=%s',B1)==row['name'] and scalar('SELECT version FROM municipal_offices WHERE id=%s',B1)==row['version'] and scalar('SELECT count(*) FROM departments WHERE name=%s',marker)==0)
    denied=client.get('/officers/',headers=h(p['access_token'],A))
    check('Plataforma continua sem acesso operacional implícito',denied.status_code==403,status(denied))
    denied=client.get(f'/customers/{B}/memberships',headers=h(a['access_token']))
    check('Administrador de A não consulta vínculos de B',denied.status_code in (403,404),status(denied))
    revoked=client.post(f"/customers/{A}/sessions/{m['session_id']}/revoke-customer-access",json={'reason':'Revisão independente da homologação 3.9'},headers=h(a['access_token']))
    check('Revogação limitada ao órgão aceita para a sessão do ensaio',revoked.status_code==200,status(revoked))
    denied=client.get('/officers/',headers=h(m['access_token'],A,A1))
    check('Próxima requisição em A bloqueada após revogação',denied.status_code==403 and code(denied)=='CUSTOMER_ACCESS_REVOKED',status(denied))
    allowed=client.get('/officers/',headers=h(m['access_token'],B,B1))
    check('A mesma sessão conserva seu acesso independente em B',allowed.status_code==200,status(allowed))
    out=client.post('/auth/logout',json={'refresh_token':m['refresh_token']})
    denied=client.get('/me',headers=h(m['access_token']))
    check('Saída encerra a sessão e o token anterior é recusado',out.status_code==204 and denied.status_code==401)
finally:
    for issued in sessions:
        client.post('/auth/logout',json={'refresh_token':issued['refresh_token']})
failed=[r for r in results if not r['ok']]
Path(r'C:/Apps/iahub/tmp/elo-review39-da00605/http.json').write_text(json.dumps({'aprovadas':len(results)-len(failed),'total':len(results),'resultados':results},ensure_ascii=False,indent=2),encoding='utf8')
print(f'\n{len(results)-len(failed)}/{len(results)} verificações aprovadas.')
sys.exit(1 if failed else 0)
