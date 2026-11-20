from pathlib import Path
r=Path('C:/Apps/ELOGESTAO/apps/backoffice/src')
def read(p): return (r/p).read_text(encoding='utf-8')
def write(p,s): (r/p).write_text(s,encoding='utf-8',newline='\r\n')

p='app/app/administracao/admin-ui.tsx';s=read(p)
s=s.replace("'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 disabled:bg-slate-100'", "'w-full min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:cursor-not-allowed motion-reduce:transition-none'")
s=s.replace("'inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'", "'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-900/10 transition-colors hover:border-blue-700 hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none'")
s=s.replace("'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50'", "'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none'")
s=s.replace('space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6', 'space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6')
start=s.index('export function Table(');end=s.index('export function Back(',start)
s=s[:start]+'''export function Table({
  columns, rows, render, columnFilters,
}: {
  columns: string[];
  rows: Row[];
  render: (row: Row) => ReactNode;
  columnFilters?: (ReactNode | null)[];
}) {
  return (
    <div className="max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50/90">
          <tr>
            {columns.map((c) => (
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500" key={c} scope="col">{c}</th>
            ))}
          </tr>
          {columnFilters && (
            <tr className="border-t border-slate-100 bg-white">
              {columns.map((c,i) => <td className="min-w-[140px] px-3 py-2 align-top" key={c}>{columnFilters[i]}</td>)}
            </tr>
          )}
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length ? rows.map((row) => (
            <tr key={row.id} className="transition-colors even:bg-slate-50/40 hover:bg-blue-50/60 focus-within:bg-blue-50/60 motion-reduce:transition-none">{render(row)}</tr>
          )) : <tr><td colSpan={columns.length} className="px-6 py-12 text-center"><p className="font-semibold text-slate-700">Nenhum registro encontrado</p><p className="mt-1 text-sm text-slate-500">Revise os filtros ou cadastre um novo registro, se tiver permissão.</p></td></tr>}
        </tbody>
      </table>
    </div>
  );
}
export function Cell({ children }: { children: ReactNode }) {
  return <td className="px-4 py-3.5 align-middle text-slate-700">{children}</td>;
}
export function StatusBadge({ value }: { value: string }) {
  const active = value === 'active';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${active ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15' : 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-300'}`}><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />{label(value)}</span>;
}
''' + s[end:]
s=s.replace('className="flex flex-wrap items-center gap-3 text-sm"','className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600"')
write(p,s)

write('workspace/routine-icon.tsx', '''import { Building2, Car, ClipboardList, FileText, Fuel, History, Layers3, Package, Settings2, ShieldCheck, Truck, Users, UserRound, Waypoints } from 'lucide-react';

export function RoutineIcon({ code, className = 'h-5 w-5' }: { code: string; className?: string }) {
  const Icon = code.includes('auditoria') ? History : code.includes('fornecedor') ? Truck : code.includes('combust') ? Fuel : code.includes('modelo') || code.includes('categoria') ? Layers3 : code.includes('frota') ? Waypoints : code.includes('veicul') ? Car : code.includes('motorista') ? UserRound : code.includes('produto') || code.includes('unidade') ? Package : code.includes('perfil') || code.includes('sesso') ? ShieldCheck : code.includes('identidade') || code.includes('vinculo') || code.includes('convite') ? Users : code.includes('orgao') || code.includes('secretaria') || code.includes('departamento') ? Building2 : code.includes('document') || code.includes('projeto') ? FileText : code.includes('integrac') || code.includes('compartilhamento') ? Settings2 : ClipboardList;
  return <Icon className={className} aria-hidden="true" strokeWidth={1.8} />;
}
''')
p='workspace/workspace-view.tsx';s=read(p)
s=s.replace("import { Area, ROUTINES } from './registry';", "import { Area, ROUTINES } from './registry';\nimport { RoutineIcon } from './routine-icon';")
s=s.replace("  const [expanded, setExpanded] = useState(false);\n  const routines", "  const [expanded, setExpanded] = useState(false);\n  const [menuSearch, setMenuSearch] = useState('');\n  const activeRoutine = ws.tabs.find((t) => t.id === ws.displayedId)?.routine;\n  const routines",1)
s=s.replace('lg:w-64 lg:shrink-0','lg:sticky lg:top-4 lg:w-64 lg:shrink-0',1)
s=s.replace('mt-2 space-y-4 rounded-[10px] border border-slate-200 bg-white p-4 text-sm lg:mt-0 lg:block','mt-2 space-y-5 rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-sm lg:mt-0 lg:block',1)
needle='''        {navigation.isError && (
          <p role="alert" className="text-red-800">'''
s=s.replace(needle,'''        <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 px-3 py-4 text-white"><p className="text-xs font-medium text-blue-100">SEU ESPAÇO DE TRABALHO</p><p className="mt-1 font-semibold">O que vamos fazer hoje?</p></div>
        <label className="block"><span className="sr-only">Buscar rotina no menu</span><input type="search" value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} placeholder="Encontrar uma rotina…" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></label>
        {navigation.isError && (
          <p role="alert" className="text-red-800">''',1)
s=s.replace('const items = routines.filter((r) => r.area === area);', "const items = routines.filter((r) => r.area === area && ROUTINES[r.code].title.toLocaleLowerCase('pt-BR').includes(menuSearch.toLocaleLowerCase('pt-BR')));",1)
s=s.replace('className="font-semibold uppercase tracking-wide text-slate-500"','className="flex items-center gap-2 px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400"',1)
needle='''                        className="w-full rounded-lg px-2 py-1.5 text-left text-slate-800 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-60"
                      >
                        {ROUTINES[routine.code].title}'''
replacement='''                        aria-current={activeRoutine === routine.code ? 'page' : undefined}
                        className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-60 motion-reduce:transition-none ${activeRoutine === routine.code ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100' : 'text-slate-600 hover:bg-slate-50 hover:text-blue-700'}`}
                      >
                        <RoutineIcon code={routine.code} className="h-[18px] w-[18px] shrink-0" />
                        {ROUTINES[routine.code].title}'''
assert needle in s;s=s.replace(needle,replacement,1)
s=s.replace('<p className="mt-1 text-slate-600">{EMPTY_AREA[area]}</p>', '<p className="mt-2 px-2 text-xs leading-relaxed text-slate-500">{menuSearch ? \'Nenhuma rotina corresponde à busca.\' : EMPTY_AREA[area]}</p>',1)
s=s.replace('''      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {AREA_TITLE[area]}''','''      <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-indigo-50 px-5 py-5 sm:px-6">
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-blue-600">Seu acesso rápido</p>
        <h1 className="text-2xl font-semibold text-slate-900">
          {AREA_TITLE[area]}''',1)
s=s.replace("'Cada rotina abre em uma aba com o órgão e a secretaria em que foi aberta. O acesso aos órgãos depende de vínculo e autorização próprios.'", "'Organize seu órgão e seus acessos. Escolha uma rotina para começar.'",1)
s=s.replace("'Rotinas operacionais autorizadas na secretaria selecionada. Os módulos de negócio serão exibidos somente quando implementados e autorizados.'", "'Tudo o que você precisa para trabalhar na secretaria selecionada. Escolha uma rotina abaixo.'",1)
s=s.replace('className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"','className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"',1)
s=s.replace('''            onClick={() => openRoutine(routine.code)}
            className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <span className="block font-semibold text-slate-900">''','''            disabled={useOpenPendingPlaceholder}
            onClick={() => openRoutine(routine.code)}
            className="group relative flex min-h-[132px] flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-60 motion-reduce:transform-none motion-reduce:transition-none"
          >
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white motion-reduce:transition-none"><RoutineIcon code={routine.code} /></span>
            <span aria-hidden className="absolute right-5 top-5 text-lg text-slate-300 group-hover:text-blue-600">↗</span>
            <span className="block font-semibold text-slate-900">''',1)
# AreaHome already relies on the workspace's central open operation; pending state is explicit here too.
s=s.replace('''export function AreaHome({ area }: { area: Area }) {
  const elo''','''export function AreaHome({ area }: { area: Area }) {
  const ws = useWorkspace();
  const elo''',1).replace('useOpenPendingPlaceholder','ws.pending')
write(p,s)

p='app/app/dashboard/page.tsx';s=read(p).replace('''      <ContextOverview />
      <AreaHome area="operacao" />''','''      <AreaHome area="operacao" />
      <ContextOverview />''');write(p,s)
p='app/app/dashboard/context-overview.tsx';s=read(p)
s=s.replace('mx-auto grid w-full max-w-4xl gap-4 px-4 pb-8','mx-auto grid w-full max-w-6xl gap-4 px-3 pb-8 sm:px-6')
s=s.replace('''        Os módulos operacionais (cadastros, contratos, empenhos, saldos,
        cotações e operação) continuam indisponíveis até as fases 4A a 4E, mesmo
        com o login ativo. O Configurador completo é da etapa 3.7; menus por
        permissão e abas internas, da etapa 3.8.''','''        Administração e cadastros já estão disponíveis conforme suas permissões.
        Contratos, financeiro, cotações e demais operações serão liberados nas
        próximas entregas. As abas abertas preservam o órgão e a secretaria de origem.''')
write(p,s)

p='components/app-frame.tsx';s=read(p)
s=s.replace('bg-slate-50 pt-6','bg-slate-50 pt-4')
s=s.replace('''className={`rounded-lg px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
        area === target ? 'bg-blue-600 text-white' : 'bg-white text-blue-700'
      }`}''','''className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 py-2 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 motion-reduce:transition-none ${area === target ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/20' : 'text-slate-500 hover:bg-blue-50 hover:text-blue-700'}`}''')
s=s.replace('''      {label}
    </Link>''','''      <span aria-hidden className="text-base">{target === 'administracao' ? '⚙' : '▦'}</span>{label}
    </Link>''',1)
s=s.replace('className="print:hidden mx-4 mb-4 flex flex-wrap items-center gap-2 text-sm"','className="print:hidden mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 text-sm shadow-sm"')
s=s.replace('<span className="mr-3 font-bold text-slate-900">Elo Gestão</span>','<span className="mr-1 flex items-center gap-2 px-2 font-bold tracking-tight text-slate-900"><span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-sm text-white">EG</span>Elo Gestão</span>')
write(p,s)

p='components/context-bar.tsx';s=read(p)
s=s.replace('className="text-slate-600" data-testid="contexto-novas-abas"','className="mt-2 flex flex-wrap items-center gap-2 text-slate-600" data-testid="contexto-novas-abas"')
s=s.replace('''            className="font-semibold text-blue-700 hover:underline"''','''            className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"''',1)
s=s.replace("{context ? 'Trocar órgão ou secretaria' : 'Selecionar contexto'}", "<span aria-hidden>⇄</span>{context ? 'Trocar órgão ou secretaria' : 'Selecionar contexto'}")
write(p,s)
print('Componentes compartilhados, menu, atalhos e contexto atualizados.')
