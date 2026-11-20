from pathlib import Path
from datetime import datetime,timezone
import os,sys,subprocess
from dotenv import dotenv_values
from sqlalchemy.engine import make_url
r=Path('C:/Apps/ELOGESTAO');sys.path.insert(0,str(r/'tools/dev'))
from database import local_settings,local_database_url
db=local_settings()['database'];configured=make_url(dotenv_values(r/'apps/api/.env')['DB_URL'])
assert (configured.host,configured.port,configured.database)==(db['host'],db['port'],db['name'])
bin=r/'.local/runtimes/postgresql/bin';env={**os.environ,'PGPASSWORD':db['password'],'DB_URL':local_database_url()}
dump=r/'.local/backups'/('notas-fiscais-antes-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.dump')
args=['-h',db['host'],'-p',str(db['port']),'-U',db['user']]
for command in ([str(bin/'pg_dump.exe'),*args,'-Fc','-d',db['name'],'-f',str(dump)],
                [str(bin/'pg_restore.exe'),'--list',str(dump)]):
 result=subprocess.run(command,env=env,capture_output=True,text=True)
 if result.returncode:raise RuntimeError('Backup não concluído; upgrade não executado.')
print('Destino confirmado: elo_gestao_dev; backup: '+str(dump.relative_to(r)))
subprocess.run([sys.executable,'-m','alembic','upgrade','head'],cwd=r/'apps/api',env=env,check=True)
print('Upgrade local de notas fiscais concluído.')
