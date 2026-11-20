from pathlib import Path
import shutil
r=Path('C:/Apps/ELOGESTAO');out=r/'.local/ux-web';out.mkdir(exist_ok=True)
for p in (r/'.local/lotacao-web').iterdir():
    if p.is_file() and p.name!='tsconfig.tsbuildinfo':
        shutil.copy2(p,out/p.name)
for name in ('src','public'):
    shutil.copytree(r/'apps/backoffice'/name,out/name,dirs_exist_ok=True)
for p in out.glob('.env*'):
    s=p.read_text(encoding='utf-8').replace('http://localhost:3006','http://localhost:3007')
    p.write_text(s,encoding='utf-8')
print('Prévia visual isolada preparada; demais prévias preservadas.')
