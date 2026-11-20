"""Compatibiliza somente o banco sintético já em 4bc_0025 com a nova ancestralidade."""
from pathlib import Path
from datetime import datetime,timezone
import importlib.util,os,sys,subprocess,json
R=Path('C:/Apps/ELOGESTAO');sys.path[:0]=[str(R/'tools/dev'),str(R/'apps/api')]
from database import local_settings,local_database_url
from sqlalchemy import create_engine,text
from alembic.migration import MigrationContext
from alembic.operations import Operations
cfg=local_settings();db=cfg['database'];assert db['name']=='elo_gestao_dev'
engine=create_engine(local_database_url())
with engine.connect() as c:
 revision=c.execute(text('SELECT version_num FROM alembic_version')).scalar_one()
 assert revision=='elo_fase4bc_0025',revision
 exists=c.execute(text("SELECT to_regclass('public.user_preferences') IS NOT NULL")).scalar_one()
if not exists:
 stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=R/'.local/backups'/f'contratos-preferencias-antes-{stamp}.dump'
 subprocess.run([str(R/'.local/runtimes/postgresql/bin/pg_dump.exe'),'-h',db['host'],'-p',str(db['port']),'-U',db['user'],'-d',db['name'],'-Fc','-f',str(backup)],env={**os.environ,'PGPASSWORD':db['password']},check=True,capture_output=True)
 spec=importlib.util.spec_from_file_location('preferences_migration',R/'apps/api/alembic/versions/elo_fase4a_0025_preferencias_de_usuario.py')
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 with engine.begin() as c:
  # O DDL dessa nova ancestral não foi aplicado ao banco que já tinha o contrato.
  # Executa exatamente a migração, na mesma transação, sem stamp e sem repetir contratos.
  with Operations.context(MigrationContext.configure(c)):m.upgrade()
 print('Backup:',backup.name,'; ancestral de preferências aplicada, sem alterar contratos.')
env={**os.environ,'DB_URL':local_database_url(),'PSYCOPG_IMPL':'python','PATH':str(R/'.local/runtimes/postgresql/bin')+';'+os.environ['PATH']}
for args in [('heads',),('upgrade','head'),('check',)]:
 r=subprocess.run([sys.executable,'-m','alembic',*args],cwd=R/'apps/api',env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
 assert r.returncode==0,r.stdout[-2000:]+r.stderr[-3000:]
 print(' '.join(args)+': '+r.stdout.strip()[-350:])
engine.dispose()
