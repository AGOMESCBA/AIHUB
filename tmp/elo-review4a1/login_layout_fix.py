from pathlib import Path
import shutil
r=Path('C:/Apps/ELOGESTAO');p=r/'apps/backoffice/src/app/(auth)/layout.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('''  return (
    <main''','''  return (
    <>
    <Toaster />
    <main''',1).replace('''      <Toaster />
      <aside''','''      <aside''',1).replace('''    </main>
  );''','''    </main>
    </>
  );''',1)
p.write_text(s,encoding='utf-8')
print('Notificações fora da grid; painel institucional e formulário alinhados lado a lado.')
