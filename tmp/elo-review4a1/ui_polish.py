from pathlib import Path
r=Path('C:/Apps/ELOGESTAO/apps/backoffice/src')
p=r/'workspace/workspace-view.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('shadow-sm lg:mt-0 lg:block`}', 'shadow-sm lg:mt-0 lg:block lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto`}',1)
s=s.replace('''        <p role="status" className="rounded-lg bg-blue-50 p-3 text-blue-900">
          {EMPTY_AREA[area]}
        </p>''','''        <div role="status" className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"><p>{EMPTY_AREA[area]}</p>{area === 'administracao' && <Link className="mt-3 inline-flex rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" href="/app/contexto?trocar=1">Escolher ambiente administrativo</Link>}</div>''',1)
p.write_text(s,encoding='utf-8')
p=r/'components/app-frame.tsx';s=p.read_text(encoding='utf-8')
s=s.replace("  const area = useDisplayedArea(pathname);", "  const area = useDisplayedArea(pathname);\n  const selectingContext = pathname === '/app/contexto';",1)
s=s.replace('''        <RoutineMenu />''','''        <div className={selectingContext ? 'hidden' : 'contents'}><RoutineMenu /></div>''',1)
p.write_text(s,encoding='utf-8')
p=r/'app/app/administracao/admin-ui.tsx';s=p.read_text(encoding='utf-8').replace('ring-emerald-600/15','ring-emerald-600/20');p.write_text(s,encoding='utf-8')
print('Navegação refinada sem alterar a política de acesso.')
