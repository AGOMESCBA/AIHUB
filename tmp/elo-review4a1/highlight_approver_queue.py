from pathlib import Path
R=Path('C:/Apps/ELOGESTAO');p=R/'apps/backoffice/src/app/app/contratos/contract-screens.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('<Panel title="Fluxo de aprovação">','<Panel title="Fila de aprovadores">',1)
s=s.replace('Níveis sequenciais. A versão submetida e os limites ficam preservados em\n        cada rodada.','Fluxo de aprovação por níveis: acompanhe quem já decidiu, quem aprova agora e quem aguarda a etapa anterior. A ordem e as alçadas são as da versão submetida.',1)
s=s.replace('<ol className="flex flex-wrap gap-3">','<ol aria-label="Fila de aprovadores" className="flex flex-wrap gap-3">',1)
old='''                  {l.approvers.map((a: Row) => (
                    <p key={a.user_id} className="break-words text-xs">
                      {a.name ?? `Usuário #${a.user_id}`} · alçada{' '}
                      {money(a.limit_cents)}
                    </p>
                  ))}'''
new='''                  {l.approvers.map((a: Row) => {
                    const vote = votes.find((v: Row) => v.created_by === a.user_id);
                    const status = vote ? (vote.decision === 'approve' ? 'Aprovou' : 'Reprovou') : complete ? 'Etapa concluída por outro aprovador' : r.status !== 'pending' ? 'Sem decisão nesta etapa' : current ? 'Aguardando decisão neste nível' : 'Aguardando nível anterior';
                    return <div key={a.user_id} className="mt-2 rounded-lg border border-white/80 bg-white/80 p-3" data-approval-user={a.user_id}>
                      <p className="break-words text-sm font-semibold text-slate-900">{a.name ?? `Usuário #${a.user_id}`}</p>
                      <p className="mt-1 text-xs text-slate-600">Alçada: {money(a.limit_cents)}</p>
                      <p className={`mt-2 text-xs font-medium ${vote ? vote.decision === 'approve' ? 'text-emerald-700' : 'text-red-700' : current ? 'text-blue-700' : 'text-slate-500'}`}>{status}</p>
                    </div>;
                  })}'''
assert old in s;s=s.replace(old,new,1);p.write_text(s,encoding='utf-8')
p=R/'apps/backoffice/src/app/app/contratos/approval-screens.tsx';s=p.read_text(encoding='utf-8');line='      <Approvals row={{ ...row, approval_rounds: [round] }} />';assert s.count(line)==1;s=s.replace(line+'\n','',1)
needle='      <Panel\n        title={';assert needle in s;s=s.replace(needle,line+'\n'+needle,1);p.write_text(s,encoding='utf-8')
print('Fila de aprovadores destacada no início, com nomes, alçadas e situação individual.')
