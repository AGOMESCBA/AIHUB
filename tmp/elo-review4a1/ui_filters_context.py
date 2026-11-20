from pathlib import Path
r=Path('C:/Apps/ELOGESTAO/apps/backoffice/src')
def read(p):return (r/p).read_text(encoding='utf-8')
def write(p,s):(r/p).write_text(s,encoding='utf-8',newline='\r\n')
p='app/app/administracao/admin-ui.tsx';s=read(p)
s=s.replace('columns, rows, render, columnFilters,','columns, rows, render, columnFilters, loading = false, error,')
s=s.replace('columnFilters?: (ReactNode | null)[];','columnFilters?: (ReactNode | null)[];\n  loading?: boolean;\n  error?: string;')
s=s.replace('{rows.length ? rows.map((row) => (','{error ? <tr><td colSpan={columns.length} className="p-6 text-center text-red-700" role="alert">{error}</td></tr> : loading ? <tr><td colSpan={columns.length} className="p-8 text-center text-slate-500" role="status">Atualizando registros…</td></tr> : rows.length ? rows.map((row) => (')
write(p,s)

p='app/app/cadastros/vehicle-screens.tsx';s=read(p)
s=s.replace('  Select,\n  Table,','  Select,\n  StatusBadge,\n  Table,',1)
s=s.replace("  const [fleet, setFleet] = useTabState('veiculos.frota', '');", "  const [fleet, setFleet] = useTabState('veiculos.frota', '');\n  const [modelFilter, setModelFilter] = useTabState('veiculos.modelo', '');",1)
s=s.replace("    ...(fleet ? { vehicle_fleet_id: fleet } : {}),\n  };", "    ...(fleet ? { vehicle_fleet_id: fleet } : {}),\n    ...(modelFilter ? { model_id: modelFilter } : {}),\n  };",1)
s=s.replace("  const fleets = useAdminQuery<Row>('/vehicle_fleets', { per_page: 100 });\n",'',1)
start=s.index('            <form\n',s.index('<Panel title="Registros">'));end=s.index('            {canExport && (',start)
s=s[:start]+'''            <p className="mr-auto text-sm text-slate-500">Filtre pelos campos no cabeçalho da tabela.</p>
            <button type="button" className={secondaryClass} disabled={!search && !draft && !fleet && !modelFilter && !status} onClick={() => {setSearch('');setDraft('');setFleet('');setModelFilter('');setStatus('');setPage(1);}}>Limpar filtros</button>
'''+s[end:]
start=s.index('          <QueryState query={query}>',s.index('<Panel title="Registros">'))
end=s.index('          </QueryState>',start)
block=s[start:end].replace('          <QueryState query={query}>','''          <div className="space-y-3">
            <p className="text-xs text-slate-500">{[search && `Identificação: ${search}`, modelFilter && 'Modelo selecionado', fleet && 'Frota selecionada', status && `Situação: ${label(status)}`].filter(Boolean).join(' · ') || 'Sem filtros aplicados'}</p>''',1)
block=block.replace('''              rows={items(row)}''','''              rows={items(row)}
              loading={query.isPending}
              error={query.isError ? failureText(query.error) : undefined}
              columnFilters={[
                <form key="identificacao" className="min-w-[190px] space-y-2" onSubmit={(e) => {e.preventDefault();setSearch(draft.trim());setPage(1);}}><label className="block"><span className="sr-only">Filtrar identificação</span><input name="filtro_identificacao" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" placeholder="Placa, chassi ou patrimônio" value={draft} onChange={(e) => setDraft(e.target.value)} /></label><button className={secondaryClass} type="submit">Aplicar busca</button></form>,
                <RefPicker key="modelo" title="Modelo do filtro" path="/vehicle_models" value={modelFilter} current={modelFilter ? {id:modelFilter,text:`Modelo selecionado #${modelFilter}`} : null} describe={(r) => `${r.code} · ${r.name}`} onChange={(v) => {setModelFilter(v);setPage(1);}} emptyText="Todos os modelos" />,
                <RefPicker key="frota" title="Frota do filtro" path="/vehicle_fleets" value={fleet} current={fleet ? {id:fleet,text:`Frota selecionada #${fleet}`} : null} describe={(r) => r.name} onChange={(v) => {setFleet(v);setPage(1);}} emptyText="Todas as frotas" />,
                <Select key="situacao" title="Filtrar situação" value={status} onChange={(v) => {setStatus(v);setPage(1);}}><option value="">Todas</option><option value="active">Ativos</option><option value="inactive">Inativos</option></Select>,
                null,
              ]}''',1)
block=block.replace('<Cell>{label(r.status)}</Cell>','<Cell><StatusBadge value={r.status} /></Cell>',1)
block=block.replace('className="text-blue-700 underline"','className="inline-flex rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 font-semibold text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"',1)
s=s[:start]+block+s[end:].replace('          </QueryState>','          </div>',1)
write(p,s)

p='app/app/contexto/page.tsx';s=read(p)
s=s.replace("  const [error, setError]", "  const [search, setSearch] = useState('');\n  const matches = (name: string) => name.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLocaleLowerCase('pt-BR').includes(search.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLocaleLowerCase('pt-BR'));\n  const [error, setError]",1)
s=s.replace("    setBusy(`customer-${customerId}`);", "    setBusy(`customer-${customerId}`);\n    setSearch('');",1)
# Keep the existing context-resolution API and direct-entry behavior. Only the destination screen follows the selected mode.
s=s.replace('router.push(DASHBOARD_PAGE_PATH);', "router.push(option.request.mode === 'office' ? DASHBOARD_PAGE_PATH : '/app/administracao');",1)
s=s.replace('className="mx-auto w-full max-w-3xl px-4 pb-12"','className="mx-auto w-full max-w-4xl px-4 pb-12"')
s=s.replace('className="rounded-[10px] border border-slate-200 bg-white p-6 text-slate-800"','className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 shadow-sm sm:p-8"',1)
s=s.replace('''        <p className="text-xs font-semibold tracking-wider text-blue-600">
          CONTEXTO DE TRABALHO
        </p>''','''        <div className="mb-5 flex items-center gap-3"><span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 font-bold text-white shadow-sm">EG</span><div><p className="font-bold tracking-tight text-slate-900">Elo Gestão</p><p className="text-xs text-slate-500">Seu ambiente de trabalho</p></div></div>
        <p className="text-xs font-semibold tracking-wider text-blue-600">{contexts ? 'PASSO 2 · ESCOLHA SEU AMBIENTE' : 'PASSO 1 · ESCOLHA O ÓRGÃO'}</p>''',1)
s=s.replace('''          A escolha vale somente para esta aba. Outras abas podem trabalhar em
          outro órgão ou secretaria ao mesmo tempo.''','''          A escolha define o contexto das novas rotinas. As abas já abertas
          mantêm seu órgão e sua secretaria.''',1)
needle='''        {customers && !contexts && (
          <ul'''
s=s.replace(needle,'''        {customers && <label className="mt-5 block"><span className="sr-only">{contexts ? 'Buscar secretaria ou administração' : 'Buscar órgão'}</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={contexts ? 'Encontrar secretaria ou administração…' : 'Encontrar órgão pelo nome…'} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100" /></label>}
        {customers && !contexts && (
          <ul''',1)
s=s.replace('className="mt-6 grid gap-3" aria-label="Órgãos autorizados"','className="mt-5 grid gap-3 sm:grid-cols-2" aria-label="Órgãos autorizados"',1)
s=s.replace('customers.items.map((customer)', 'customers.items.filter((customer) => matches(customer.name)).map((customer)',1)
card='w-full rounded-[10px] border border-slate-200 p-4 text-left hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60'
newcard='group relative h-full w-full rounded-xl border border-slate-200 bg-slate-50/60 p-5 pr-10 text-left shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none'
s=s.replace(card,newcard)
s=s.replace('''                  <span className="block font-semibold text-slate-900">
                    {customer.name}''','''                  <span aria-hidden className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 font-bold text-blue-700">{customer.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span><span aria-hidden className="absolute right-4 top-5 text-lg text-slate-400 group-hover:text-blue-600">→</span>
                  <span className="block break-words font-semibold text-slate-900">
                    {customer.name}''',1)
s=s.replace('''                    Sem acesso operacional aos órgãos; telas do Configurador na
                    etapa 3.7.''','''                    Órgãos clientes, identidades e configurações da plataforma.
                    Sem acesso operacional aos órgãos.''',1)
s=s.replace('className="mt-3 grid gap-3" aria-label="Contextos autorizados"','className="mt-3 grid gap-3 sm:grid-cols-2" aria-label="Contextos autorizados"',1)
s=s.replace('options.map((option)', 'options.filter((option) => matches(option.label)).map((option)',1)
s=s.replace('''                    <span className="block font-semibold text-slate-900">
                      {option.label}''','''                    <span aria-hidden className={`mb-3 inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${option.key === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>{option.key === 'admin' ? 'Administração' : 'Operação'}</span><span aria-hidden className="absolute right-4 top-5 text-lg text-slate-400 group-hover:text-blue-600">→</span>
                    <span className="block break-words font-semibold text-slate-900">
                      {option.label}''',1)
s=s.replace("{busy === option.key ? 'Validando…' : option.hint}","{busy === option.key ? 'Validando…' : option.hint}")
s=s.replace('''            </ul>
            <Button''','''            </ul>
            {search && !options.some((option) => matches(option.label)) && <p role="status" className="mt-4 text-sm text-slate-500">Nenhum ambiente corresponde à busca.</p>}
            <Button''',1)
s=s.replace('onClick={() => setContexts(null)}',"onClick={() => {setContexts(null);setSearch('');}}",1)
s=s.replace('''        {contexts && (
          <div''','''        {customers && !contexts && search && !customers.items.some((customer) => matches(customer.name)) && !customers.platform.available && <p role="status" className="mt-4 text-sm text-slate-500">Nenhum órgão corresponde à busca.</p>}
        {contexts && (
          <div''',1)
write(p,s)
print('Grid de veículos com filtros reais; seletor de contexto com cards e busca atualizados.')
