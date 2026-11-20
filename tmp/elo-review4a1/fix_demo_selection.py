from pathlib import Path
from datetime import datetime, timezone
import sys, json, os, subprocess
root=Path('C:/Apps/ELOGESTAO')
sys.path[:0]=[str(root/'tools/dev'),str(root/'apps/api')]
from database import local_settings, local_database_url
import seed_access_demo as seed
from sqlalchemy import create_engine,text
cfg=local_settings()
db=cfg['database'] if 'database' in cfg else cfg['db']
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=root/'.local/backups'/f'acessos-demo-antes-{stamp}.dump'
subprocess.run([str(root/'.local/runtimes/postgresql/bin/pg_dump.exe'),'-h',db['host'],'-p',str(db['port']),'-U',db['user'],'-d',db['name'],'-Fc','-f',str(backup)],env={**os.environ,'PGPASSWORD':db['password']},check=True,capture_output=True)
old=json.loads((root/'.local/lotacao-e2e.json').read_text(encoding='utf-8'))
demo=json.loads((root/'.local/testes-municipios.json').read_text(encoding='utf-8'))
seed.REASON='Avaliação local de Cuiabá e Sinop solicitada pelo responsável'
engine=create_engine(local_database_url())
with engine.begin() as c:
    c.execute(text('SELECT pg_advisory_xact_lock(88401,1)'))
    uid=c.execute(text('SELECT id FROM users WHERE cpf=:cpf'),dict(cpf=old['cpf'])).scalar_one()
    assert uid==25
    actor=c.execute(text("SELECT u.id FROM users u JOIN platform_assignments pa ON pa.user_id=u.id WHERE u.cpf=:cpf AND pa.status='active' LIMIT 1"),dict(cpf=cfg['user']['cpf'])).scalar_one()
    c.execute(text("UPDATE customers SET name=:new,version=version+1,auth_version=auth_version+1 WHERE id=1 AND name=:old"),dict(new='Órgão de demonstração',old='Órgão sintético de desenvolvimento'))
    for customer in demo['customers']:
        cid=customer['id']
        assert cid in (41,42)
        seed.grant(c,uid,cid,'ORG-ADM','all_future',(),actor)
        seed.grant(c,uid,cid,'GES','all_current',[o['id'] for o in customer['offices']],actor)
        c.execute(text("INSERT INTO audit_events(customer_id,actor_user_id,action,object_type,object_id,result,details) VALUES(:c,:a,'dev.demonstracao.ajustar_acessos','users',:i,'success',CAST(:d AS jsonb))"),dict(c=cid,a=actor,i=str(uid),d=json.dumps(dict(user_id=uid,profiles=['ORG-ADM','GES'],purpose=seed.REASON))))
    c.execute(text("INSERT INTO audit_events(customer_id,actor_user_id,action,object_type,object_id,result,details) VALUES(1,:a,'dev.demonstracao.renomear','customers','1','success',CAST(:d AS jsonb))"),dict(a=actor,d=json.dumps(dict(previous='Órgão sintético de desenvolvimento',name='Órgão de demonstração'))))
engine.dispose()
for relative in ['tools/dev/seed.py','tools/dev/browser-e2e-35.cjs','tools/dev/browser-e2e-37.cjs','tools/dev/browser-e2e-38.cjs']:
    path=root/relative
    data=path.read_bytes();before='Órgão sintético de desenvolvimento'.encode();after='Órgão de demonstração'.encode()
    assert before in data
    path.write_bytes(data.replace(before,after))
print('Acessos e nome atualizados; backup:',backup.name)
