from pathlib import Path
r=Path('C:/Apps/ELOGESTAO/apps/backoffice/src')
def put(p,s):(r/p).write_text(s,encoding='utf-8')

put('components/elo-brand.tsx', '''import { Link2 } from 'lucide-react';

export function EloBrand({ light = false }: { light?: boolean }) {
  return <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-950/10"><Link2 aria-hidden className="h-6 w-6" strokeWidth={2.4} /></span><span className={`text-xl font-bold tracking-tight ${light ? 'text-white' : 'text-slate-900'}`}>elo<span className={`ml-1 font-normal ${light ? 'text-slate-300' : 'text-slate-500'}`}>gestão</span></span></div>;
}
''')
put('components/app-frame.tsx', ''''use client';

import { PropsWithChildren } from 'react';
import { usePathname } from 'next/navigation';

import { ContextBar } from '@/components/context-bar';
import { Toaster } from '@/components/ui/toaster';
import { WorkspaceProvider, useWorkspace } from '@/workspace/workspace';
import { CloseDialog, RoutineMenu, TabBar, WorkspacePanels, WorkspaceStatus } from '@/workspace/workspace-view';

function Frame({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const ws = useWorkspace();
  const selecting = pathname === '/app/contexto';
  return <main className="min-h-screen w-full bg-[#f5f7fb] text-slate-800 print:bg-white">
    <Toaster />
    <div className={selecting ? 'hidden' : 'print:hidden'}><RoutineMenu /></div>
    <div className={selecting ? 'min-w-0' : 'min-w-0 lg:pl-64 print:pl-0'}>
      {!selecting && <ContextBar />}
      <div className={selecting ? 'hidden' : 'min-w-0'}><TabBar /><WorkspaceStatus /></div>
      <div hidden={selecting}><WorkspacePanels /></div>
      {(selecting || !ws.displayedId) && children}
    </div>
    <CloseDialog />
  </main>;
}

// Os painéis permanecem montados durante a escolha do ambiente; ocultar o shell não descarta edições.
export function AppFrame({ children }: PropsWithChildren) {
  return <WorkspaceProvider><Frame>{children}</Frame></WorkspaceProvider>;
}
''')
put('components/context-bar.tsx', ''''use client';

import Link from 'next/link';
import { ArrowLeftRight, Building2, ChevronDown, LogOut, User } from 'lucide-react';

import { ACCOUNT_PAGE_PATH, CONTEXT_PAGE_PATH } from '@/constants/routes-paths';
import { contextLabel, useEloContext } from '@/context/elo-context';
import { contextText, tabTitle, useWorkspace } from '@/workspace/workspace';

export function ContextBar() {
  const { identity, context, status, logout } = useEloContext();
  const ws = useWorkspace();
  const active = ws.tabs.find((t) => t.id === ws.displayedId);
  const unsaved = Object.values(ws.flags).filter((f) => f.dirty || f.secret).length;
  return <header className="print:hidden flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-7" aria-label="Contexto da aba">
    <div className="min-w-0 flex-1" data-testid="contexto-novas-abas">
      <Link href={`${CONTEXT_PAGE_PATH}?trocar=1`} aria-label="Trocar órgão ou secretaria" className="group flex w-fit max-w-full items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <span className="hidden rounded-lg bg-blue-50 p-2 text-blue-600 sm:block"><Building2 aria-hidden className="h-5 w-5" /></span>
        <span className="min-w-0"><span className="block text-[10px] font-semibold uppercase tracking-widest text-slate-400">Ambiente para novas rotinas</span><span className="mt-0.5 block truncate text-sm font-semibold text-slate-800">{status === 'loading' ? 'Validando ambiente…' : contextLabel(context)}</span></span>
        <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="hidden items-center gap-1.5 border-l border-slate-200 pl-3 text-xs font-semibold text-blue-600 xl:inline-flex"><ArrowLeftRight aria-hidden className="h-3.5 w-3.5" />Trocar</span>
      </Link>
      <span className="sr-only" data-testid="contexto-aba-ativa">{active ? `Aba ativa: ${tabTitle(active)} em ${contextText(active.context)}` : 'Nenhuma rotina exibida'}</span>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <Link href={ACCOUNT_PAGE_PATH} className="flex items-center gap-2 rounded-xl p-2 text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100"><User aria-hidden className="h-4 w-4" /></span><span className="hidden max-w-[180px] truncate text-xs font-medium sm:block">{identity?.userName ?? 'Minha conta'}</span><span className="sr-only">Minha conta</span></Link>
      <button type="button" title="Sair do sistema" aria-label="Sair" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => {if (unsaved && !window.confirm(`Há ${unsaved} aba(s) com alterações não salvas ou segredo exibido. Sair descarta esse conteúdo. Deseja sair?`)) return;ws.confirmLeave();logout();}}><LogOut aria-hidden className="h-4 w-4" /></button>
    </div>
  </header>;
}
''')

p=r/'app/app/contexto/page.tsx';s=p.read_text(encoding='utf-8')
s=s.replace("import { Button } from '@/components/ui/button';", "import { ArrowRight, Building2, CheckCircle2, ChevronLeft, Layers, Search, ShieldCheck } from 'lucide-react';\nimport Link from 'next/link';\n\nimport { EloBrand } from '@/components/elo-brand';")
start=s.index('  return (\n    <section',s.index('export default function ContextSelection'))
s=s[:start]+'''  const cardClass = 'group flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:border-blue-400 hover:bg-blue-50/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-50 motion-reduce:transition-none';
  return (
    <section className="grid min-h-screen lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]" aria-labelledby="context-title">
      <aside className="relative hidden overflow-hidden bg-[#101d35] p-10 text-white lg:flex lg:flex-col xl:p-14">
        <EloBrand light />
        <div className="relative z-10 my-auto py-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1.5 text-xs font-medium text-blue-200"><span className="h-1.5 w-1.5 rounded-full bg-teal-300" />Conectando setores e operações</span>
          <h2 className="mt-7 max-w-md text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">Uma gestão mais<br /><span className="text-blue-300">próxima de tudo.</span></h2>
          <p className="mt-5 max-w-sm text-base leading-relaxed text-slate-300">Pessoas, cadastros e operações no ambiente certo. Comece escolhendo onde você vai trabalhar.</p>
          <div className="mt-10 space-y-5">
            {[[Building2,'Cada órgão, seu espaço','Informações organizadas por órgão e secretaria.'],[ShieldCheck,'Acesso com responsabilidade','Cada pessoa vê as rotinas que pode utilizar.'],[Layers,'Seu trabalho continua','Abra rotinas em abas e mantenha cada contexto.']].map(([Icon,title,description]) => {const I=Icon as typeof Building2;return <div key={String(title)} className="flex gap-3"><span className="mt-0.5 rounded-lg bg-white/5 p-2 text-blue-200"><I aria-hidden className="h-4 w-4" /></span><div><p className="text-sm font-semibold">{String(title)}</p><p className="mt-0.5 text-xs leading-relaxed text-slate-400">{String(description)}</p></div></div>;})}
          </div>
        </div>
        <p className="relative z-10 text-xs text-slate-500">Elo Gestão · Ambiente de trabalho</p>
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-40 h-96 w-96 rounded-full border-[60px] border-blue-400/5" />
        <div aria-hidden className="pointer-events-none absolute -right-14 top-24 h-48 w-48 rounded-full border border-blue-200/10" />
      </aside>
      <div className="flex min-w-0 flex-col bg-white px-5 py-6 sm:px-10 lg:px-12 xl:px-20">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="lg:hidden"><EloBrand /></div><p className="text-xs text-slate-500 lg:ml-auto">Olá, <span className="font-semibold text-slate-700">{identity?.userName ?? 'bem-vindo'}</span></p></div>
        <div className="mx-auto my-auto w-full max-w-xl py-10">
          <ol aria-label="Etapas da seleção" className="mb-8 flex items-center gap-3 text-xs font-medium"><li className="flex items-center gap-2 text-blue-600"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white">{contexts ? <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> : '1'}</span>Órgão</li><li aria-hidden className="h-px w-9 bg-slate-200" /><li className={`flex items-center gap-2 ${contexts ? 'text-blue-600' : 'text-slate-400'}`}><span className={`flex h-6 w-6 items-center justify-center rounded-full ${contexts ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>2</span>Ambiente</li></ol>
          <h1 id="context-title" className="text-3xl font-semibold tracking-tight text-slate-900">{contexts ? 'Escolha sua secretaria' : 'Onde vamos trabalhar?'}</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">{contexts ? 'Entre na secretaria em que deseja trabalhar ou acesse a administração, se disponível para seu perfil.' : 'Selecione um órgão para acessar seus ambientes de trabalho.'}</p>
          {contexts && <div className="mt-5 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600"><Building2 aria-hidden className="h-4 w-4 shrink-0 text-slate-400" /><span className="break-words font-medium">{contexts.customer.name}</span></div>}
          {reason === 'acesso-encerrado' && <Alert className="mt-5" variant="destructive"><AlertTitle>Acesso encerrado</AlertTitle><AlertDescription>O acesso desta sessão ao órgão foi encerrado pela administração.</AlertDescription></Alert>}
          {error && <Alert className="mt-5" variant="destructive"><AlertTitle>Não foi possível continuar</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          {!customers && !error && <p role="status" className="mt-7 text-sm text-slate-500">Consultando seus ambientes…</p>}
          {empty && <Alert className="mt-5"><AlertTitle>Nenhum órgão disponível</AlertTitle><AlertDescription>Procure a administração para receber seu acesso.</AlertDescription></Alert>}
          {customers && !empty && <label className="relative mt-6 block"><Search aria-hidden className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" /><span className="sr-only">{contexts ? 'Buscar secretaria ou administração' : 'Buscar órgão'}</span><input autoComplete="off" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={contexts ? 'Buscar secretaria ou administração…' : 'Buscar órgão pelo nome…'} className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>}
          {customers && !contexts && <ul className="mt-4 space-y-3" aria-label="Órgãos autorizados">
            {customers.items.filter((customer) => matches(customer.name)).map((customer) => <li key={customer.id}><button type="button" disabled={busy !== null} onClick={() => openCustomer(customer.id)} className={cardClass}><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Building2 aria-hidden className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-slate-800">{customer.name}</span><span className="mt-1 block text-xs text-slate-500">{customer.office_count} {customer.office_count === 1 ? 'secretaria disponível' : 'secretarias disponíveis'}{customer.customer_admin ? ' · Administração' : ''}</span></span><ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-blue-600" /></button></li>)}
            {customers.platform.available && matches('Administração da plataforma') && <li><button type="button" disabled={busy !== null} onClick={() => enter({key:'platform',request:{mode:'platform'}})} className={cardClass}><span className="rounded-xl bg-indigo-50 p-3 text-indigo-600"><ShieldCheck aria-hidden className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800">Administração da plataforma</span><span className="mt-1 block text-xs text-slate-500">Gerencie órgãos, identidades e configurações.</span></span><ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-slate-300" /></button></li>}
          </ul>}
          {customers && !contexts && search && !customers.items.some((customer) => matches(customer.name)) && !(customers.platform.available && matches('Administração da plataforma')) && <p role="status" className="py-8 text-center text-sm text-slate-500">Nenhum órgão corresponde à busca.</p>}
          {contexts && <div className="mt-4"><ul className="space-y-3" aria-label="Contextos autorizados">{options.filter((option) => matches(option.label)).map((option) => <li key={option.key}><button type="button" disabled={busy !== null} onClick={() => enter(option)} className={cardClass}><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${option.key === 'admin' ? 'bg-indigo-50 text-indigo-600' : 'bg-teal-50 text-teal-600'}`}>{option.key === 'admin' ? <ShieldCheck aria-hidden className="h-5 w-5" /> : <Building2 aria-hidden className="h-5 w-5" />}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-slate-800">{option.label}</span><span className="mt-1 block text-xs text-slate-500">{busy === option.key ? 'Entrando…' : option.key === 'admin' ? 'Gerenciar o órgão e os acessos' : 'Entrar na secretaria'}</span></span><ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-blue-600" /></button></li>)}</ul>{!options.filter((option) => matches(option.label)).length && <p role="status" className="py-7 text-center text-sm text-slate-500">Nenhum ambiente disponível nesta seleção.</p>}<button type="button" className="mt-6 inline-flex min-h-[40px] items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => {setContexts(null);setSearch('');}}><ChevronLeft aria-hidden className="h-4 w-4" />Voltar aos órgãos</button></div>}
          <p className="mt-8 border-t border-slate-100 pt-5 text-xs leading-relaxed text-slate-400">{changing ? 'Esta escolha será usada nas novas rotinas. As abas abertas mantêm seu órgão e sua secretaria.' : 'Você pode trocar de órgão ou secretaria a qualquer momento, pelo cabeçalho do sistema.'}</p>
          {context && <Link href={context.mode === 'office' ? '/app/dashboard' : '/app/administracao'} className="mt-3 inline-flex text-xs font-medium text-blue-600 hover:underline">Continuar no ambiente atual</Link>}
        </div>
        <p className="text-center text-[11px] text-slate-400">Acesso restrito aos ambientes autorizados para seu perfil.</p>
      </div>
    </section>
  );
}
'''
p.write_text(s,encoding='utf-8')

p=r/'workspace/workspace-view.tsx';s=p.read_text(encoding='utf-8')
s=s.replace("import { ACCOUNT_PAGE_PATH } from '@/constants/routes-paths';", "import { ACCOUNT_PAGE_PATH } from '@/constants/routes-paths';\nimport { EloBrand } from '@/components/elo-brand';\nimport { usePathname } from 'next/navigation';\nimport { ArrowRight, BookOpen, Home, LayoutGrid, Menu, Search, Settings, X } from 'lucide-react';")
start=s.index('export function RoutineMenu()');end=s.index('// Página inicial de uma área',start)
s=s[:start]+'''export function RoutineMenu() {
  const ws = useWorkspace();
  const pathname = usePathname();
  const area = useDisplayedArea(pathname) ?? 'operacao';
  const navigation = useSelectionNavigation();
  const { openRoutine, message } = useOpenRoutine();
  const [expanded, setExpanded] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');
  const activeRoutine = ws.tabs.find((t) => t.id === ws.displayedId)?.routine;
  const routines = navigation.data?.routines ?? [];
  const items = routines.filter((r) => r.area === area && ROUTINES[r.code].title.toLocaleLowerCase('pt-BR').includes(menuSearch.toLocaleLowerCase('pt-BR')));
  return <nav aria-label="Rotinas autorizadas" className="print:hidden bg-[#101d35] text-slate-300 lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col">
    <div className="flex h-[76px] items-center justify-between px-5"><EloBrand light /><button type="button" className="rounded-lg p-2 text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 lg:hidden" aria-expanded={expanded} aria-controls="menu-rotinas" aria-label={expanded ? 'Fechar menu' : 'Abrir menu'} onClick={() => setExpanded(!expanded)}>{expanded ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}</button></div>
    <div id="menu-rotinas" className={`${expanded ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col lg:flex`}>
      <div className="mx-4 mb-5 rounded-xl border border-white/10 bg-white/5 p-1"><div className="grid grid-cols-2 gap-1">{(['operacao','administracao'] as Area[]).map((target) => <Link key={target} href={target === 'operacao' ? '/app/dashboard' : '/app/administracao'} aria-current={area === target ? 'page' : undefined} onClick={() => {setExpanded(false);setMenuSearch('');}} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 ${area === target ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>{target === 'operacao' ? <LayoutGrid aria-hidden className="h-3.5 w-3.5" /> : <Settings aria-hidden className="h-3.5 w-3.5" />}{target === 'operacao' ? 'Operação' : 'Administração'}</Link>)}</div></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5"><Link href={area === 'operacao' ? '/app/dashboard' : '/app/administracao'} className="mb-5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white"><Home aria-hidden className="h-4 w-4" />Visão geral</Link><label className="relative mb-6 block"><Search aria-hidden className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><span className="sr-only">Buscar rotina no menu</span><input type="search" value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} placeholder="Encontrar uma rotina…" className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-2 text-xs text-white outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-1 focus:ring-blue-400" /></label>
      <section aria-labelledby={`area-${area}`}><h2 id={`area-${area}`} className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{area === 'operacao' ? 'Rotinas de trabalho' : 'Gestão e segurança'}</h2>
      {navigation.isPending ? <p role="status" className="p-3 text-xs">Carregando rotinas…</p> : items.length ? <ul className="space-y-1">{items.map((routine) => <li key={routine.code}><button type="button" disabled={ws.pending} data-routine={routine.code} aria-current={activeRoutine === routine.code ? 'page' : undefined} onClick={() => {openRoutine(routine.code);setExpanded(false);}} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 disabled:opacity-50 ${activeRoutine === routine.code ? 'bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-400/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><RoutineIcon code={routine.code} className="h-[18px] w-[18px] shrink-0" /><span>{ROUTINES[routine.code].title}</span></button></li>)}</ul> : <div className="px-3 py-3 text-xs leading-relaxed text-slate-400"><p>{menuSearch ? 'Nenhuma rotina corresponde à busca.' : area === 'administracao' ? 'Escolha um ambiente administrativo autorizado para gerenciar os acessos.' : 'Escolha uma secretaria para ver suas rotinas.'}</p>{!menuSearch && <Link href="/app/contexto?trocar=1" className="mt-3 inline-flex items-center gap-1.5 font-semibold text-blue-300 hover:text-white">Escolher ambiente<ArrowRight aria-hidden className="h-3.5 w-3.5" /></Link>}</div>}
      </section>{navigation.isError && <p role="alert" className="mt-3 rounded-lg bg-red-400/10 p-3 text-xs text-red-200">{navigationFailure(navigation.error)}</p>}{message && <p role="alert" className="mt-3 text-xs text-red-200">{message}</p>}</div>
      <div className="border-t border-white/10 px-5 py-5"><Link href="/app/documentacao" className="flex items-center gap-2 text-xs text-slate-400 hover:text-white"><BookOpen aria-hidden className="h-4 w-4" />Central de ajuda</Link><p className="mt-3 text-[10px] text-slate-500">Elo Gestão · Conectando operações</p></div>
    </div>
  </nav>;
}

''' + s[end:]
start=s.index('export function AreaHome(');end=s.index('export function WorkspaceStatus()',start)
s=s[:start]+'''export function AreaHome({ area }: { area: Area }) {
  const ws = useWorkspace();
  const elo = useEloContext();
  const navigation = useSelectionNavigation();
  const { openRoutine, message } = useOpenRoutine();
  const items = (navigation.data?.routines ?? []).filter((r) => r.area === area);
  return <div className="mx-auto w-full max-w-7xl px-5 py-7 sm:px-8 lg:py-9">
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-blue-600">{area === 'administracao' ? 'Administração' : 'Seu espaço de trabalho'}</p><h1 className="text-3xl font-semibold tracking-tight text-slate-900">{area === 'administracao' ? 'Organização que faz a diferença.' : 'Seu trabalho, organizado.'}</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-500">{area === 'administracao' ? 'Gerencie os cadastros, as pessoas e os acessos do seu ambiente.' : 'Acesse os cadastros e as rotinas da sua secretaria. Cada atividade tem seu lugar.'}</p></div><span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">{items.length} rotinas disponíveis</span></div>
    <section aria-label="Acesso rápido"><div className="mb-4 flex items-center gap-2"><LayoutGrid aria-hidden className="h-4 w-4 text-slate-400" /><h2 className="text-sm font-semibold text-slate-700">{area === 'administracao' ? 'Gestão e segurança' : 'O que você precisa fazer?'}</h2></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map((routine,index) => <button key={routine.code} type="button" disabled={ws.pending} onClick={() => openRoutine(routine.code)} className="group flex min-h-[168px] flex-col rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none"><span className="mb-4 flex w-full items-center justify-between"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${['bg-blue-50 text-blue-600','bg-teal-50 text-teal-600','bg-indigo-50 text-indigo-600'][index % 3]}`}><RoutineIcon code={routine.code} /></span><ArrowRight aria-hidden className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-blue-600 motion-reduce:transform-none" /></span><span className="text-[15px] font-semibold text-slate-800">{ROUTINES[routine.code].title}</span><span className="mt-2 text-xs leading-relaxed text-slate-500">{routine.description}</span></button>)}</div></section>
    {elo.status === 'ready' && navigation.isPending && <p role="status" className="py-10 text-center text-sm text-slate-500">Organizando suas rotinas…</p>}
    {navigation.isError && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{navigationFailure(navigation.error)}</p>}
    {navigation.isSuccess && !items.length && <div role="status" className="rounded-xl border border-slate-200 bg-white p-7 text-sm text-slate-500"><p>{EMPTY_AREA[area]}</p><Link href="/app/contexto?trocar=1" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">Escolher ambiente<ArrowRight aria-hidden className="h-4 w-4" /></Link></div>}
    {message && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p>}
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 text-xs text-slate-400"><span>Cada rotina mantém o órgão e a secretaria em que foi aberta.</span><Link href={ACCOUNT_PAGE_PATH} className="font-medium text-slate-500 hover:text-blue-600">Minha conta e segurança →</Link></div>
  </div>;
}

''' + s[end:]
s=s.replace("const AREA_TITLE: Record<Area, string> = {\n  administracao: 'Administração',\n  operacao: 'Elo Gestão',\n};\n",'')
p.write_text(s,encoding='utf-8')
put('app/app/dashboard/page.tsx', '''import { AreaHome } from '@/workspace/workspace-view';

export default function Dashboard() { return <AreaHome area="operacao" />; }
''')
print('Nova estrutura visual aplicada: seleção independente, menu lateral e início organizado.')
