from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
def change(name,old,new):
    p=R/name;b=p.read_bytes();a=old.encode();assert b.count(a)==1,(name,b.count(a));p.write_bytes(b.replace(a,new.encode()))
change('apps/api/app/main.py','from app.routers import (','from app.routers import contracts\nfrom app.routers import (')
change('apps/api/app/main.py','for router in (access_admin.router,','for router in (contracts.router, contracts.admin_router, access_admin.router,')
change('apps/api/app/main.py','r"^/(customers/','r"^/(contracts(/|$)|contract_commitments(/|$)|contract_measurements(/|$)|customers/')
change('apps/api/alembic/env.py','from app.models.definitions import Base','from app.models.definitions import Base\nfrom app.models import contracts  # noqa: F401 - registra as tabelas 4B/4C')
change('apps/api/app/security/guard.py','_ACCESS_ADMIN = [','''_ACCESS_ADMIN = [
    # 4B/4C: rotas explícitas; dependências conferem ação, objeto e secretaria.
    ("GET", r"/contracts/?"), ("POST", r"/contracts/?"),
    ("GET", r"/contracts/export"),
    ("GET", rf"/contracts{_ID}"), ("PUT", rf"/contracts{_ID}"),
    ("POST", rf"/contracts{_ID}/(submit|decisions|withdraw|amendments)"),
    ("POST", rf"/contracts{_ID}/status/(suspend|resume|close|cancel)"),
    ("GET", rf"/contracts{_ID}/(balance|events)"),
    ("POST", rf"/contracts{_ID}/commitments{_ID}/cancel"),
    ("POST", rf"/contracts{_ID}/measurements{_ID}/reverse"),
    ("GET", r"/contract_commitments/?"), ("POST", r"/contract_commitments/?"),
    ("GET", r"/contract_measurements/?"), ("POST", r"/contract_measurements/?"),
    ("GET", rf"{_CUSTOMER}/contract-approval-policies"),
    ("PUT", rf"{_CUSTOMER}/contract-approval-policies"),
    ("GET", rf"{_CUSTOMER}/contract-approval-options"),''')
change('apps/api/app/services/contracts.py','def public(row):return {c.key:getattr(row,c.key) for c in inspect(type(row)).column_attrs}',
'''def public(row):
    return {c.key:str(v) if isinstance(v:=getattr(row,c.key),Decimal) else v for c in inspect(type(row)).column_attrs}''')
change('apps/api/app/services/contracts.py',"def start(db,ctx,cid,action,request,body):\n    operational.require_action(ctx,action)","def start(db,ctx,cid,action,request,body):\n    operational.require_action(ctx,'contratos.consultar')\n    operational.require_action(ctx,action)")
change('apps/api/app/services/contracts.py',"    return r\ndef active(db,c):",'''    office=c.municipal_office_id
    if not ctx.profile.allows('empenhos.consultar',office):r['commitments']=[]
    if not ctx.profile.allows('medicoes.consultar',office):r['measurements']=[]
    if not ctx.profile.allows('saldos.consultar',office):r['ledger']=[]
    return r
def active(db,c):''')
change('apps/api/app/services/contracts.py',"    financial(ContractPosition,sum(i['total_cents'] for i in rows))",'''    total=sum(i['total_cents'] for i in rows)
    if total>9_000_000_000_000:fail('CONTRACT_VALUE_TOO_LARGE','O total excede o limite suportado para contratos.')
    financial(ContractPosition,total)''')
change('apps/api/app/services/contracts.py','    financial(position(db,c).with_amended_limit,limit)',"    if limit>9_000_000_000_000:fail('CONTRACT_VALUE_TOO_LARGE','O total excede o limite suportado para contratos.')\n    financial(position(db,c).with_amended_limit,limit)")
print('Registros pontuais adicionados; mudanças paralelas preservadas.')
