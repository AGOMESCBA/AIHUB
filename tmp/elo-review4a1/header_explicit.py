from pathlib import Path
p=Path('C:/Apps/ELOGESTAO/apps/backoffice/src/components/context-bar.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('  ChevronDown,\n','')
s=s.replace('  const unsaved =', '''  const displayed = active?.context ?? context;
  const differentSelection = !!active && (active.context.mode !== context?.mode || active.context.customer?.id !== context?.customer?.id || active.context.office?.id !== context?.office?.id);
  const unsaved =''',1)
start=s.index('      <div className="min-w-0 flex-1"');end=s.index('      <div className="flex shrink-0 items-center gap-2">',start)
s=s[:start]+'''      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-3" data-testid="contexto-novas-abas">
        <div className="flex min-w-0 basis-full items-center gap-3 sm:basis-auto sm:flex-1">
          <span className="hidden rounded-lg bg-blue-50 p-2 text-blue-600 sm:block"><Building2 aria-hidden className="h-5 w-5" /></span>
          <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{displayed?.mode === 'platform' ? 'Ambiente da plataforma' : 'Órgão / empresa'}</p>
          <p data-testid="contexto-empresa-ativa" className="mt-0.5 break-words text-sm font-semibold text-slate-800">{displayed?.customer?.name ?? (displayed?.mode === 'platform' ? 'Administração da plataforma' : status === 'loading' ? 'Validando ambiente…' : 'Nenhum órgão selecionado')}</p>
          <p data-testid="contexto-secretaria-ativa" className="mt-0.5 break-words text-xs text-slate-500">{displayed?.office ? `Secretaria: ${displayed.office.name}` : displayed?.mode === 'customer_admin' ? 'Administração do órgão' : displayed?.mode === 'platform' ? 'Gestão dos órgãos e identidades' : 'Selecione uma secretaria para trabalhar'}</p>
          {differentSelection && <p className="mt-1 break-words text-[11px] text-blue-600">Novas rotinas: {contextLabel(context)}</p>}
          </div>
        </div>
        <Link href={`${CONTEXT_PAGE_PATH}?trocar=1`} aria-label="Trocar empresa ou secretaria" title="Escolher o ambiente das novas rotinas; as abas existentes mantêm seu contexto" className="inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeftRight aria-hidden className="h-4 w-4" />Trocar empresa ou secretaria</Link>
        <span className="sr-only" data-testid="contexto-aba-ativa">{active ? `Aba ativa: ${tabTitle(active)} em ${contextText(active.context)}` : 'Nenhuma rotina exibida'}</span>
      </div>
''' +s[end:]
p.write_text(s,encoding='utf-8')
print('Empresa/órgão e secretaria da aba atual explícitos; troca sempre visível.')
