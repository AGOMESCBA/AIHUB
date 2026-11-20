from pathlib import Path
import zipfile
root=Path('C:/Apps/facilita')
for archive in ['backend.zip','app-whitelabel.zip']:
    with zipfile.ZipFile(root/archive) as z:
        paths=[n for n in z.namelist() if any(w in n.lower() for w in ['contract','endeavour','effort','balance','measurement']) and not any(w in n for w in ['node_modules/','.git/','vendor/']) and n.endswith(('.py','.ts','.sql','.prisma','.js'))]
        print(archive, 'arquivos relevantes:',len(paths))
        for n in paths[:35]:print(n)
