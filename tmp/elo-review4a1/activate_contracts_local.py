from pathlib import Path
from datetime import datetime,timezone
import os,sys,subprocess,json
R=Path('C:/Apps/ELOGESTAO');sys.path[:0]=[str(R/'tools/dev'),str(R/'apps/api')]
from database import local_settings,local_database_url
from sqlalchemy import create_engine,text
import seed_access_demo as seed
cfg=local_settings();db=cfg['database'];assert db['name']=='elo_gestao_dev'
engine=create_engine(local_database_url())
with engine.connect() as c:
    revision=c.execute(text('SELECT version_num FROM alembic_version')).scalar_one()
    assert revision in ('elo_fase4a_0024','elo_fase4bc_0025'),revision
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=R/'.local/backups'/f'contratos-antes-{stamp}.dump'
subprocess.run([str(R/'.local/runtimes/postgresql/bin/pg_dump.exe'),'-h',db['host'],'-p',str(db['port']),'-U',db['user'],'-d',db['name'],'-Fc','-f',str(backup)],env={**os.environ,'PGPASSWORD':db['password']},check=True,capture_output=True)
env={**os.environ,'DB_URL':local_database_url(),'PSYCOPG_IMPL':'python','PATH':str(R/'.local/runtimes/postgresql/bin')+';'+os.environ['PATH']}
for command in [('upgrade','head'),('check',)]:
    result=subprocess.run([sys.executable,'-m','alembic',*command],cwd=R/'apps/api',env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
    if result.returncode:raise RuntimeError(' '.join(command)+': '+result.stderr[-2500:]+result.stdout[-2500:])
demo=json.loads((R/'.local/testes-municipios.json').read_text(encoding='utf-8'));old=json.loads((R/'.local/lotacao-e2e.json').read_text(encoding='utf-8'))
seed.REASON='Avaliação local autorizada de contratos, alçadas e execução 4B/4C'
with engine.begin() as c:
    actor=c.execute(text('SELECT id FROM users WHERE cpf=:cpf'),dict(cpf=cfg['user']['cpf'])).scalar_one()
    for person in [demo,old]:
        user=c.execute(text('SELECT id FROM users WHERE cpf=:cpf'),dict(cpf=person['cpf'])).scalar_one()
        for company in demo['customers']:
            for role in ['FIN','APR']:seed.grant(c,user,company['id'],role,'all_current',[o['id'] for o in company['offices']],actor)
            c.execute(text("INSERT INTO audit_events(customer_id,actor_user_id,action,object_type,object_id,result,details) VALUES(:c,:a,'dev.contratos.preparar','users',:u,'success',CAST(:d AS jsonb))"),dict(c=company['id'],a=actor,u=str(user),d=json.dumps(dict(purpose=seed.REASON,roles=['FIN','APR']))))
engine.dispose()
(R/'.local/contracts-preparation.json').write_text(json.dumps(dict(backup=str(backup.relative_to(R)),previous_revision=revision,revision='elo_fase4bc_0025',users=['.local/testes-municipios.json','.local/lotacao-e2e.json']),indent=2),encoding='utf-8')
print('Backup:',backup.name,'; migração e schema conferidos; usuários locais preparados sem trocar senhas.')
