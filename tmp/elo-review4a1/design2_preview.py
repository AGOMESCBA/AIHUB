from pathlib import Path
import shutil
r=Path('C:/Apps/ELOGESTAO');out=r/'.local/design-web';out.mkdir(exist_ok=True)
for p in (r/'.local/lotacao-web').iterdir():
    if p.is_file() and p.name!='tsconfig.tsbuildinfo':shutil.copy2(p,out/p.name)
for name in ('src','public'):shutil.copytree(r/'apps/backoffice'/name,out/name,dirs_exist_ok=True)
print('Compilação isolada preparada para substituir a prévia 3006 após validação.')
