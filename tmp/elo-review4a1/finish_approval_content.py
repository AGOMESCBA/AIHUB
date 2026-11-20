from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
p=R/'apps/backoffice/src/app/app/contratos/contract-screens.tsx';s=p.read_text(encoding='utf-8');a=s.index('export function Approvals(');b=s.index('\nfunction Amendments(',a)
s=s[:a]+'''export function Approvals({ row }: { row: Row }) {
 return <Panel title="Fluxo de aprovação"><p className="text-xs text-slate-500">Níveis sequenciais. A versão submetida e os limites ficam preservados em cada rodada.</p>
 {!row.approval_rounds.length && <p className="text-sm">Nenhuma submissão registrada.</p>}
 {row.approval_rounds.map((r: Row) => <div key={r.id} className="mt-3 space-y-3 rounded-lg border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{r.amendment_id ? `Aditivo #${r.amendment_id}` : 'Contrato'} · análise #{r.id} · {money(r.amount_cents)}</h3><Badge value={r.status} /></div>
 <ol className="flex flex-wrap gap-3">{r.levels.map((l: Row, n: number) => {
 const votes = r.votes.filter((v: Row) => v.level === n + 1);
 const rejected = votes.some((v: Row) => v.decision === 'reject');
 const complete = !rejected && (l.mode === 'any' ? votes.some((v: Row) => v.decision === 'approve') : l.approvers.every((a: Row) => votes.some((v: Row) => v.created_by === a.user_id && v.decision === 'approve')));
 const current = r.status === 'pending' && r.current_level === n + 1;
 return <li key={n} className={`min-w-0 flex-1 basis-60 rounded-xl border p-3 ${rejected ? 'border-red-200 bg-red-50' : complete ? 'border-emerald-200 bg-emerald-50' : current ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nível {n + 1} {n < r.levels.length - 1 ? '→' : ''}</p><p className="my-1 text-sm font-semibold">{rejected ? 'Reprovado' : complete ? 'Aprovado' : current ? 'Em aprovação' : 'Aguardando'}</p><p className="mb-2 text-xs text-slate-500">{labels[l.mode]}</p>{l.approvers.map((a: Row) => <p key={a.user_id} className="break-words text-xs">{a.name ?? `Usuário #${a.user_id}`} · alçada {money(a.limit_cents)}</p>)}{votes.map((v: Row) => {const name = l.approvers.find((a: Row) => a.user_id === v.created_by)?.name;return <div key={v.id} className="mt-2 border-t border-slate-200 pt-2 text-xs"><p className="font-semibold">{name ?? `Usuário #${v.created_by}`} · {v.decision === 'approve' ? 'Aprovou' : 'Reprovou'}</p><p>{v.reason}</p><p className="mt-1 text-slate-500">{new Date(v.created_at).toLocaleString('pt-BR')}</p></div>;})}</li>;
 })}</ol></div>)}
 </Panel>;
}
''' +s[b:];p.write_text(s,encoding='utf-8')
p=R/'apps/backoffice/src/app/app/documentacao/access-manual.tsx';s=p.read_text(encoding='utf-8');s=s.replace('Elo Gestão › Operações › Contratos','Elo Gestão › Gestão contratual › Contratos')
needle="    title: 'Contratos, alçadas e execução contratual (4B/4C local)',\n    items: ["
assert needle in s;s=s.replace(needle,needle+"\n      'Aprovações fica em Elo Gestão › Gestão contratual. A grid mostra somente contratos e aditivos no seu nível atual, dentro da secretaria da aba. Analisar aprovação abre dados e itens somente leitura, fluxo dos níveis, valor submetido, sua alçada e a margem. Informe justificativa e use Aprovar ou Reprovar, confirmando a decisão. O registro sai da sua fila quando não houver mais decisão sua pendente; nenhum dado contratual é editável nessa tela.',\n      'Visão geral do contrato mostra cabeçalho completo, fornecedor, órgão/secretaria, vigência, objeto, valores e itens, além dos indicadores financeiros. A aba Itens continua disponível como atalho de consulta.',",1);p.write_text(s,encoding='utf-8')
p=R/'tools/dev/export_contracts.py';s=p.read_text(encoding='utf-8');s=s.replace('"/contracts/", "/contracts/{contract_id}",','"/contracts/", "/contracts/{contract_id}", "/contract_approvals/", "/contract_approvals/{contract_id}",',1);p.write_text(s,encoding='utf-8')
print('Fluxo visual aprimorado; manual e contrato atualizados.')
