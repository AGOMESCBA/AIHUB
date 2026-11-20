from pathlib import Path
import shutil
r=Path('C:/Apps/ELOGESTAO');p=r/'apps/backoffice/src/app/(auth)/page.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('loading={form.formState.isSubmitting}', 'loading={form.formState.isSubmitting}\n              disabled={form.formState.isSubmitting}\n              aria-busy={form.formState.isSubmitting}\n              aria-label={form.formState.isSubmitting ? \'Entrando no sistema\' : \'Entrar no sistema\'}',1)
p.write_text(s,encoding='utf-8')
out=r/'.local/login-web';out.mkdir(exist_ok=True)
for p in (r/'.local/lotacao-web').iterdir():
    if p.is_file() and p.name!='tsconfig.tsbuildinfo':shutil.copy2(p,out/p.name)
for name in ('src','public'):shutil.copytree(r/'apps/backoffice'/name,out/name,dirs_exist_ok=True)
print('Prévia de login preparada sem interromper a versão em uso.')
