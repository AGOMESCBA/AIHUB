from pathlib import Path
from datetime import datetime, timezone
import sys, os, subprocess, shutil, json
r=Path('C:/Apps/ELOGESTAO'); sys.path.insert(0,str(r/'tools/dev'))
from database import local_settings, local_database_url
from sqlalchemy import create_engine,text
db=local_settings()['database']
assert db['host'] in ('localhost','127.0.0.1') and db['name']=='elo_gestao_dev'
engine=create_engine(local_database_url())
tables=('customers','municipal_offices','vehicles','vehicle_fuel_types','drivers','audit_events')
with engine.connect() as c:
    head=c.execute(text('SELECT version_num FROM alembic_version')).scalar_one()
    assert head=='elo_fase4a_0022', head
    before={t:c.execute(text(f'SELECT count(*) FROM {t}')).scalar_one() for t in tables}
backup=r/'.local/backups'/('lotacao-antes-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.dump')
env={**os.environ,'PGPASSWORD':db['password']}
subprocess.run([str(r/'.local/runtimes/postgresql/bin/pg_dump.exe'),'-h',db['host'],'-p',str(db['port']),'-U',db['user'],'-d',db['name'],'-Fc','-f',str(backup)],env=env,check=True,capture_output=True)
env={**os.environ,'DB_URL':local_database_url()}
subprocess.run([sys.executable,'-m','alembic','upgrade','head'],cwd=r/'apps/api',env=env,check=True,capture_output=True)
with engine.connect() as c:
    after={t:c.execute(text(f'SELECT count(*) FROM {t}')).scalar_one() for t in tables}
    assert c.execute(text('SELECT version_num FROM alembic_version')).scalar_one()=='elo_fase4a_0023'
assert before==after
engine.dispose()
report={'backup':str(backup.relative_to(r)),'revision':'elo_fase4a_0023','counts_preserved':before}
(r/'.local/logs/lotacao-upgrade.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
preview=r/'.local/lotacao-web';preview.mkdir(exist_ok=True)
source=r/'apps/backoffice'
for item in source.iterdir():
    if item.is_dir():
        if item.name in ('src','public'):shutil.copytree(item,preview/item.name,dirs_exist_ok=True)
    elif item.name!='tsconfig.tsbuildinfo':
        shutil.copy2(item,preview/item.name)
for p in preview.glob('.env*'):
    content=p.read_text(encoding='utf-8')
    lines=[]
    for line in content.splitlines():
        if line.startswith('NEXTAUTH_URL='):line='NEXTAUTH_URL=http://localhost:3006'
        if line.startswith('NEXT_PUBLIC_API_BASE_URL='):line='NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8012'
        lines.append(line)
    p.write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Prévia isolada preparada em .local/lotacao-web.')
