from pathlib import Path
r=Path('C:/Apps/ELOGESTAO/apps/backoffice/src')
def put(p,s):(r/p).write_text(s,encoding='utf-8')
p=r/'app/app/contexto/page.tsx';s=p.read_text(encoding='utf-8')
start=s.index('  // Entrada direta somente');end=s.index('  const options = useMemo(',start)
# Explicit selection: no auto-entry to an organization or platform after fresh login.
s=s[:start]+s[end:]
s=s.replace('useEffect, useMemo, useRef, useState','useEffect, useMemo, useState').replace('  const autoEntered = useRef(false);\n','')
s=s.replace('// autoriza agora; com uma única opção inequívoca, entra direto. A escolha vale para esta\n// seleção de novas rotinas; a API valida cada requisição e as abas existentes mantêm seu contexto.', '// autoriza agora. A entrada exige escolha explícita do órgão/ambiente, mesmo com uma única opção.\n// A API valida cada requisição e as abas existentes mantêm seu contexto.')
s=s.replace('<ul className="mt-4 space-y-3" aria-label="Órgãos autorizados">','<ul className="mt-4 max-h-[360px] space-y-3 overflow-y-auto overscroll-contain py-1 pr-2 sm:max-h-[42vh]" aria-label="Órgãos autorizados">')
s=s.replace('<ul className="space-y-3" aria-label="Contextos autorizados">','<p className="mb-3 text-xs text-slate-400">{options.filter((option) => matches(option.label)).length} de {options.length} ambientes disponíveis</p>\n              <ul className="max-h-[360px] space-y-3 overflow-y-auto overscroll-contain py-1 pr-2 sm:max-h-[42vh]" aria-label="Contextos autorizados">')
start=s.index('              <button\n',s.index('Nenhum ambiente disponível nesta seleção.'))
end=s.index('              </button>',start)+len('              </button>')
block=s[start:end].replace('Voltar aos órgãos','Trocar órgão')
s=s[:start]+"              {customers && (customers.items.length > 1 || customers.platform.available) && (\n"+block+'\n              )}'+s[end:]
p.write_text(s,encoding='utf-8')

put('app/(auth)/layout.tsx','''import { PropsWithChildren } from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { Building2, Layers, ShieldCheck } from 'lucide-react';

import { Toaster } from '@/components/ui/toaster';
import { EloBrand } from '@/components/elo-brand';
import { authOptions } from '@/lib/auth';
import { DASHBOARD_PAGE_PATH } from '@/constants/routes-paths';

export default async function AuthLayout({ children }: PropsWithChildren<unknown>) {
  const session = await getServerSession(authOptions);
  if (session && !session.error) redirect(DASHBOARD_PAGE_PATH);
  return <main className="grid min-h-screen bg-white text-slate-800 lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]"><Toaster />
    <aside className="relative hidden overflow-hidden bg-[#101d35] p-10 text-white lg:flex lg:flex-col xl:p-14"><EloBrand light /><div className="relative z-10 my-auto py-14"><span className="inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1.5 text-xs font-medium text-blue-200"><span className="h-1.5 w-1.5 rounded-full bg-teal-300" />Conectando setores e operações</span><h2 className="mt-7 max-w-md text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">Tudo conectado.<br /><span className="text-blue-300">Seu trabalho flui.</span></h2><p className="mt-5 max-w-sm text-base leading-relaxed text-slate-300">Um só acesso para organizar seu dia, conectar equipes e cuidar das operações do seu órgão.</p><div className="mt-10 space-y-5">{[[Building2,'Seu órgão, seu ambiente','Escolha onde trabalhar depois de entrar.'],[ShieldCheck,'Acesso com responsabilidade','Permissões respeitadas em cada rotina.'],[Layers,'Mais organização no dia a dia','Rotinas em abas, cada uma no seu contexto.']].map(([Icon,title,description]) => {const I=Icon as typeof Building2;return <div key={String(title)} className="flex gap-3"><span className="mt-0.5 rounded-lg bg-white/5 p-2 text-blue-200"><I aria-hidden className="h-4 w-4" /></span><div><p className="text-sm font-semibold">{String(title)}</p><p className="mt-0.5 text-xs leading-relaxed text-slate-400">{String(description)}</p></div></div>;})}</div></div><p className="relative z-10 text-xs text-slate-500">Elo Gestão · Ambiente de trabalho</p><div aria-hidden className="pointer-events-none absolute -bottom-24 -right-40 h-96 w-96 rounded-full border-[60px] border-blue-400/5" /></aside>
    <div className="flex min-w-0 flex-col px-6 py-6 sm:px-12 lg:px-16"><div className="lg:hidden"><EloBrand /></div><div className="mx-auto my-auto w-full max-w-[400px] py-12">{children}</div><p className="text-center text-[11px] text-slate-400">Elo Gestão · Conectando setores e operações</p></div>
  </main>;
}
''')
put('app/(auth)/components/header.tsx','''export function Header({ title, description }: {title: string;description?: string;}) {
  return <div className="mb-7"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-blue-600">Seu ambiente de trabalho</p><h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>{description && <p className="mt-3 text-sm leading-relaxed text-slate-500">{description}</p>}</div>;
}
''')
p=r/'app/(auth)/page.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('    resolver: zodResolver(signInFormSchema),','    resolver: zodResolver(signInFormSchema),\n    defaultValues: { username: \'\', password: \'\' },',1)
s=s.replace('title="Bem-vindo"','title="Bem-vindo de volta."').replace('description="Digite seu usuário e senha abaixo para acessar sua conta"','description="Entre com seu CPF e senha. Depois, escolha o órgão e a secretaria em que vai trabalhar."')
s=s.replace('className="mt-4 sm:mx-auto sm:w-full sm:max-w-sm"','className="w-full"',1).replace('className="space-y-4"','className="space-y-5"',1)
s=s.replace('''                      placeholder="000.000.000-00"
                      {...field}''','''                      placeholder="000.000.000-00"
                      autoComplete="username"
                      inputMode="numeric"
                      maxLength={14}
                      className="h-12 rounded-lg border-slate-200 bg-white text-slate-900 focus-visible:ring-blue-500"
                      {...field}''',1)
s=s.replace('<Input type="password" placeholder="••••••••" {...field} />','<Input type="password" autoComplete="current-password" placeholder="Digite sua senha" className="h-12 rounded-lg border-slate-200 bg-white text-slate-900 focus-visible:ring-blue-500" {...field} />',1)
start=s.index('            {/* Sem opção de lembrar:');end=s.index('          </form>',start)
s=s[:start]+'''            <div className="flex justify-end"><Link href={FORGOT_PASSWORD_PAGE_PATH} className="text-xs font-semibold text-blue-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Esqueceu sua senha?</Link></div>
            <Button className="h-12 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus-visible:ring-blue-500" type="submit" loading={form.formState.isSubmitting}>Entrar no sistema</Button>
            <p className="pt-2 text-center text-xs text-slate-500">Recebeu um convite? <Link className="font-semibold text-blue-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" href={INVITATION_REGISTER_PAGE_PATH}>Ative seu acesso</Link></p>
            <p className="border-t border-slate-100 pt-5 text-center text-[11px] leading-relaxed text-slate-400">Acesso exclusivo para pessoas autorizadas. Seus ambientes são definidos pelos vínculos do seu cadastro.</p>
'''+s[end:]
p.write_text(s,encoding='utf-8')

p=r/'components/ui/input.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('            className\n',"            isPasswordType && 'pr-12',\n            className\n",1)
s=s.replace('className="absolute inset-y-0 right-0 flex items-center px-4 text-gray-300"', 'className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-4 text-slate-400 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"\n            aria-label={isPasswordHidden ? \'Mostrar senha\' : \'Ocultar senha\'}\n            aria-pressed={!isPasswordHidden}')
p.write_text(s,encoding='utf-8')
print('Login estruturado, escolha explícita do órgão e listas com rolagem implementados.')
