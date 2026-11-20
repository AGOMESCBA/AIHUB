from pathlib import Path
from datetime import datetime,timezone
import sys,json,secrets,os,subprocess
r=Path('C:/Apps/ELOGESTAO');sys.path[:0]=[str(r/'tools/dev'),str(r/'apps/api')]
from database import local_database_url,local_settings
from seed_access_demo import valid_cpf,grant
import seed_access_demo
seed_access_demo.REASON='Avaliação local de Cuiabá e Sinop solicitada pelo responsável'
from app.services.crypt_service import CryptService
from sqlalchemy import create_engine,text

config=local_settings();db=config['database'];assert db['name']=='elo_gestao_dev'
access_path=r/'.local/testes-municipios.json'
if access_path.exists():
    print('Cenário já preparado; credenciais preservadas em .local/testes-municipios.json.');sys.exit(0)
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=r/'.local/backups'/f'municipios-antes-{stamp}.dump'
subprocess.run([str(r/'.local/runtimes/postgresql/bin/pg_dump.exe'),'-h',db['host'],'-p',str(db['port']),'-U',db['user'],'-d',db['name'],'-Fc','-f',str(backup)],env={**os.environ,'PGPASSWORD':db['password']},check=True,capture_output=True)
engine=create_engine(local_database_url())
password='Elo!'+secrets.token_urlsafe(12)
def cnpj(base):
    s=str(base)
    for weights in ([5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]):
        n=sum(int(d)*w for d,w in zip(s,weights))%11;s+=str(0 if n<2 else 11-n)
    return s
def one(connection,sql,**params):return connection.execute(text(sql),params).scalar_one()
def audit(c,actor,customer,object_type,object_id,details):
    c.execute(text("INSERT INTO audit_events(customer_id,actor_user_id,action,object_type,object_id,result,details) VALUES(:c,:a,'dev.testes_municipios.preparar',:t,:i,'success',CAST(:d AS jsonb))"),dict(c=customer,a=actor,t=object_type,i=str(object_id),d=json.dumps(details,ensure_ascii=False)))
with engine.begin() as c:
    c.execute(text('SELECT pg_advisory_xact_lock(88401,1)'))
    assert one(c,'SELECT current_database()')=='elo_gestao_dev'
    assert one(c,'SELECT version_num FROM alembic_version')=='elo_fase4a_0023'
    assert not c.execute(text("SELECT 1 FROM customers WHERE lower(name) IN ('cuiabá','cuiaba','sinop')")).first(), 'Já há cadastro com os nomes pedidos; não sobrescrever.'
    actor=one(c,"SELECT u.id FROM users u JOIN platform_assignments pa ON pa.user_id=u.id WHERE u.cpf=:cpf AND pa.status='active' LIMIT 1",cpf=config['user']['cpf'])
    cpf=valid_cpf(990000000+secrets.randbelow(9000000))
    assert not c.execute(text('SELECT 1 FROM users WHERE cpf=:cpf'),dict(cpf=cpf)).first()
    user=one(c,"INSERT INTO users(cpf,rg,name,email,phone,password) VALUES(:cpf,'TESTE','Gestor de testes — Cuiabá e Sinop','gestor.municipios@example.com','0000000000',:password) RETURNING id",cpf=cpf,password=CryptService().encrypt(password))
    customers=[]
    for index,(name,offices,mode) in enumerate([('Cuiabá',['Saúde','Educação'],'customer'),('Sinop',['Meio Ambiente','SEMA','Saúde'],'office')]):
        customer=one(c,"INSERT INTO customers(cnpj,name,email,phone,status,city,state) VALUES(:cnpj,:name,:email,'0000000000','active',:name,'MT') RETURNING id",cnpj=cnpj(991100000001+index),name=name,email=('cuiaba' if index==0 else 'sinop')+'.teste@example.com')
        created=[]
        for office_name in offices:
            office=one(c,"INSERT INTO municipal_offices(customer_id,name,email,phone,status,balance_in_cents,city,state) VALUES(:c,:name,'secretaria.teste@example.com','0000000000','active',0,:city,'MT') RETURNING id",c=customer,name=office_name,city=name)
            created.append(dict(id=office,name=office_name))
            audit(c,actor,customer,'municipal_offices',office,dict(cenario='Avaliação local solicitada',secretaria=office_name,orgao=name))
        for role,scope,office_ids in [('ORG-ADM','all_future',()),('GES','all_current',tuple(o['id'] for o in created))]:
            grant(c,user,customer,role,scope,office_ids,actor)
        c.execute(text("UPDATE customer_memberships SET created_by=:a WHERE user_id=:u AND customer_id=:c"),dict(a=actor,u=user,c=customer))
        for resource in ('suppliers','products','vehicle_models'):
            c.execute(text("INSERT INTO resource_sharing_policies(customer_id,resource_code,mode,version,updated_by) VALUES(:c,:r,:m,1,:a)"),dict(c=customer,r=resource,m=mode,a=actor))
        audit(c,actor,customer,'customers',customer,dict(cenario='Teste solicitado pelo responsável',nome=name,usuario_id=user,perfis=['ORG-ADM','GES'],abrangencias=['all_future','all_current'],secretarias=[o['id'] for o in created],politica=mode,recursos=['suppliers','products','vehicle_models']))
        customers.append(dict(id=customer,name=name,offices=created,sharing_mode=mode))
    result=dict(cpf=cpf,password=password,user_id=user,name='Gestor de testes — Cuiabá e Sinop',url='http://localhost:3006',customers=customers,backup=str(backup.relative_to(r)))
    temporary=access_path.with_suffix('.tmp');temporary.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
temporary.replace(access_path)
engine.dispose()
print(json.dumps(dict(orgaos=[dict(nome=x['name'],secretarias=[o['name'] for o in x['offices']],modo=x['sharing_mode']) for x in customers],backup=str(backup.relative_to(r)),credenciais='.local/testes-municipios.json'),ensure_ascii=False))
