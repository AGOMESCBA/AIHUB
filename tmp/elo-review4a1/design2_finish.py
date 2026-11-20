from pathlib import Path
import shutil
r=Path('C:/Apps/ELOGESTAO');p=r/'apps/backoffice/src/app/app/contexto/page.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('  Layers,\n','  Layers,\n  LogOut,\n',1)
s=s.replace("import { EloBrand } from '@/components/elo-brand';", "import { EloBrand } from '@/components/elo-brand';\nimport { useWorkspace } from '@/workspace/workspace';",1)
s=s.replace('  const { identity, context, select } = useEloContext();','  const { identity, context, select, logout } = useEloContext();\n  const ws = useWorkspace();',1)
s=s.replace('''          <p className="text-xs text-slate-500 lg:ml-auto">''','''          <p className="text-xs text-slate-500 lg:ml-auto">''',1)
# Add a sign-out action near the footer without bypassing the existing protection of dirty tabs.
needle='''        <p className="text-center text-[11px] text-slate-400">'''
s=s.replace(needle,'''        <button type="button" className="mx-auto mb-4 inline-flex min-h-[36px] items-center gap-2 rounded-lg px-3 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => {const unsaved = Object.values(ws.flags).filter((f) => f.dirty || f.secret).length;if(unsaved && !window.confirm(`Há ${unsaved} aba(s) com alterações não salvas ou segredo exibido. Sair descarta esse conteúdo. Deseja sair?`))return;ws.confirmLeave();logout();}}><LogOut aria-hidden className="h-3.5 w-3.5" />Sair da conta</button>
        <p className="text-center text-[11px] text-slate-400">''',1)
s=s.replace('// aba e é validada novamente pela API em cada requisição.','// seleção de novas rotinas; a API valida cada requisição e as abas existentes mantêm seu contexto.')
p.write_text(s,encoding='utf-8')
print('Saída segura incluída na seleção de ambiente.')
