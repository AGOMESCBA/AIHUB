from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
overview=r''' 'use client';
import { useAdminApi, Row } from '@/app/app/administracao/admin-api';
import { Panel, Table, Cell } from '@/app/app/administracao/admin-ui';
const currency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v / 100);
export const contractDate = (v: string) => v ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(v.slice(0, 10) + 'T12:00:00Z')) : '—';
export function ContractItems({ row }: { row: Row }) {
 return <Panel title="Itens do contrato"><Table layoutKey="contratos.itens" columns={['Descrição contratada', 'Unidade', 'Quantidade', 'Preço unitário', 'Total', 'Realizado']} rows={row.items ?? []} render={(i) => <><Cell>{i.description}</Cell><Cell>{i.unit_snapshot}</Cell><Cell>{Number(i.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 6 })}</Cell><Cell>{currency(i.unit_price_cents)}</Cell><Cell>{currency(i.total_cents)}</Cell><Cell>{Number(i.realized_quantity ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 6 })} · {currency(i.realized_cents ?? 0)}</Cell></>} /></Panel>;
}
export function ContractOverview({ row }: { row: Row }) {
 const api = useAdminApi();
 const fields = [['Número', row.number], ['Órgão / empresa', api.context?.customer?.name], ['Secretaria', api.context?.office?.name], ['Fornecedor', row.supplier?.name ?? `Fornecedor #${row.supplier_id}`], ['Início da vigência', contractDate(row.starts_on)], ['Fim da vigência', contractDate(row.ends_on)], ['Valor contratual', currency(row.limit_cents)], ['Versão', String(row.version)], ['Criado em', contractDate(row.created_at)], ['Autor do cadastro', `Usuário #${row.created_by}`]];
 return <><Panel title="Dados do contrato"><dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">{fields.map(([title, value]) => <div key={title}><dt className="text-xs font-medium text-slate-500">{title}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-900">{value ?? '—'}</dd></div>)}<div className="sm:col-span-2 xl:col-span-4"><dt className="text-xs font-medium text-slate-500">Objeto do contrato</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">{row.description}</dd></div></dl></Panel><ContractItems row={row} /></>;
}
'''
screen=r''' 'use client';
import { useRef, useState } from 'react';
import { RoutineLink, useTabState } from '@/workspace/workspace';
import { Row, useAdminApi, useAdminQuery } from '@/app/app/administracao/admin-api';
import { Back, base, Cell, Field, items, ListToolbar, Notice, Pagination, Panel, QueryState, RoutineHeader, Select, Table, useColumnFilters, useDirtyForm, compactButtonClass, compactSecondaryClass } from '@/app/app/administracao/admin-ui';
import { Approvals, money } from './contract-screens';
import { ContractOverview, contractDate } from './contract-overview';

function ApprovalAnalysis({ row, etag, onDone }: { row: Row; etag?: string; onDone: (message: string) => void }) {
 const api = useAdminApi(); const [reason, setReason] = useState(''); const form = useRef<HTMLFormElement>(null);
 useDirtyForm(!!reason.trim());
 const a = row.approval; const round = row.approval_rounds.find((r: Row) => r.id === a.round_id);
 const amendment = row.amendments.find((r: Row) => r.id === a.amendment_id);
 const submitted = a.kind === 'contract' ? { ...row, ...round.snapshot.contract, items: round.snapshot.items, supplier: row.supplier } : row;
 const decide = async (decision: 'approve' | 'reject') => {
  if (!form.current?.reportValidity() || api.busy) return;
  const verb = decision === 'approve' ? 'Aprovar' : 'Reprovar';
  if (!window.confirm(`${verb} ${a.kind === 'amendment' ? 'o aditivo do' : 'o'} contrato ${row.number}, no nível ${a.current_level}, pelo valor de ${money(a.amount_cents)}?`)) return;
  const response = await api.send('post', `/contracts/${row.id}/decisions`, { decision, reason }, etag);
  if (response) { setReason(''); onDone(`${decision === 'approve' ? 'Aprovação' : 'Reprovação'} registrada. ${response.data.status === 'approved' ? 'Confira a situação e a vigência no contrato.' : 'O fluxo foi atualizado.'}`); }
 };
 return <div className="space-y-3"><Notice text="Análise somente leitura. Nenhum dado do contrato pode ser alterado nesta tela." />
  <Panel title={a.kind === 'amendment' ? 'Aprovação de aditivo' : 'Aprovação do contrato'}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Valor submetido', money(a.amount_cents)], ['Sua alçada por operação', money(a.limit_cents)], ['Margem da alçada', money(a.authority_margin_cents)], ['Etapa atual', `Nível ${a.current_level} de ${a.total_levels}`]].map(([label, value]) => <div key={label} className="rounded-lg border border-blue-100 bg-blue-50/50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}</p></div>)}</div><p className="mt-2 text-xs text-slate-500">Alçada suficiente. Esse limite autoriza cada operação; não é um saldo financeiro consumido pelas aprovações.</p></Panel>
  <Approvals row={{ ...row, approval_rounds: [round] }} />
  <ContractOverview row={submitted} />
  {amendment && <Panel title="Alterações propostas pelo aditivo"><p className="text-sm">Justificativa: {amendment.reason}</p><p className="mb-3 text-sm">Novo término: {contractDate(amendment.new_ends_on)} · Total resultante: {money(amendment.resulting_limit_cents)}</p><Table columns={['Item', 'Quantidade vigente', 'Quantidade proposta', 'Novo total']} rows={amendment.changes} render={(change) => { const item = row.items.find((i: Row) => i.id === change.item_id); return <><Cell>{item?.description}</Cell><Cell>{item?.quantity}</Cell><Cell>{change.new_quantity}</Cell><Cell>{money(change.total_cents)}</Cell></>; }} /></Panel>}
  <Panel title="Sua decisão"><form ref={form} className="space-y-3" onSubmit={(e) => e.preventDefault()}><Field name="approval_reason" title="Justificativa da decisão" value={reason} onChange={setReason} required /><div className="flex flex-wrap gap-2"><button type="button" className={compactButtonClass} disabled={api.busy} onClick={() => void decide('approve')}>{api.busy ? 'Registrando…' : 'Aprovar'}</button><button type="button" className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50" disabled={api.busy} onClick={() => void decide('reject')}>Reprovar</button><Back /></div>{api.message && <Notice error={!api.message.ok} text={api.message.text} />}</form></Panel>
 </div>;
}

export function ContractApprovalQueue({ id }: { id?: string }) {
 const [page, setPage] = useTabState('aprovacoes.pagina', 1); const [perPage, setPerPage] = useTabState('aprovacoes.por_pagina', 20); const [kind, setKind] = useTabState('aprovacoes.tipo', '');
 const [result, setResult] = useState(''); const cols = useColumnFilters('aprovacoes', () => setPage(1));
 const list = useAdminQuery('/contract_approvals', { page, per_page: perPage, ...cols.params, ...(kind ? { kind } : {}) }, !id);
 const detail = useAdminQuery(`/contract_approvals/${id ?? '0'}`, {}, !!id && !result);
 return <div className="space-y-3"><RoutineHeader title={id ? 'Analisar aprovação' : 'Aprovações'} description="Somente contratos e aditivos que aguardam sua decisão no nível atual, nesta secretaria." back={id ? <Back /> : undefined} />
 {result ? <Panel title="Decisão registrada"><Notice text={result} /><RoutineLink href={`${base}/aprovacoes`} className={compactSecondaryClass}>Voltar às pendências</RoutineLink></Panel> : id ? <QueryState query={detail}>{detail.data?.data && <ApprovalAnalysis row={detail.data.data} etag={detail.data.etag} onDone={setResult} />}</QueryState> : <Panel><ListToolbar stateKey="aprovacoes" active={cols.active} onClear={() => { cols.active.forEach(f => f.clear()); setKind(''); }}><Select title="Tipo de aprovação" value={kind} onChange={(v) => { setKind(v); setPage(1); }}><option value="">Contratos e aditivos</option><option value="contract">Contratos</option><option value="amendment">Aditivos</option></Select></ListToolbar><QueryState query={list}><Table layoutKey="contratos.aprovacoes" openOnRowClick columns={['Contrato', 'Objeto', 'Fornecedor', 'Tipo', 'Valor submetido', 'Nível', 'Sua alçada', 'Ação']} filters={[cols.text('q'), null, null, null, null, null, null, null]} rows={items(list.data?.data)} render={(r) => <><Cell>{r.number}</Cell><Cell>{r.description}</Cell><Cell>{r.approval.supplier_name}</Cell><Cell>{r.approval.kind === 'amendment' ? 'Aditivo' : 'Contrato'}</Cell><Cell>{money(r.approval.amount_cents)}</Cell><Cell>{r.approval.current_level} de {r.approval.total_levels}</Cell><Cell>{money(r.approval.limit_cents)}</Cell><Cell><RoutineLink href={`${base}/aprovacoes/${r.id}`} className="font-medium text-blue-700 hover:underline">Analisar aprovação</RoutineLink></Cell></>} /><Pagination page={page} perPage={perPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} total={list.data?.data?.total ?? 0} onChange={setPage} /></QueryState><p className="mt-2 text-xs text-slate-500">A fila não inclui níveis futuros nem decisões que você já registrou. Para aprovar em outra secretaria, troque o contexto de trabalho.</p></Panel>}
 </div>;
}
'''
for name,content in [('contract-overview.tsx',overview),('approval-screens.tsx',screen)]:
 p=R/'apps/backoffice/src/app/app/contratos'/name;assert not p.exists();p.write_text(content.strip()+'\n',encoding='utf-8')
p=R/'apps/api/app/services/contracts.py';s=p.read_text(encoding='utf-8')
s=s.replace("    r=public(c);r['effective_status']=state(db,c);r['balance']=balance(db,c)","    r=public(c);r['effective_status']=state(db,c);r['balance']=balance(db,c)\n    supplier=db.get(Supplier,c.supplier_id)\n    r['supplier']={'id':c.supplier_id,'name':supplier.company_name if supplier else None}",1);p.write_text(s,encoding='utf-8')
p=R/'apps/backoffice/src/app/app/contratos/contract-screens.tsx';s=p.read_text(encoding='utf-8')
s=s.replace("import { useCsvExport } from '@/app/app/cadastros/csv-export';","import { useCsvExport } from '@/app/app/cadastros/csv-export';\nimport { ContractOverview, ContractItems } from './contract-overview';",1)
start=s.index("      {section === 'monitor' && (");end=s.index("      {section === 'approvals'",start)
s=s[:start]+"      {section === 'monitor' && <><ContractOverview row={row} /><Monitor row={row} /></>}\n      {section === 'items' && <ContractItems row={row} />}\n"+s[end:]
# Encaminha a decisão para a rotina dedicada; não oferece campos de edição nesta entrada.
needle='      <ContractActions row={row} />'
s=s.replace(needle,needle+"\n      {api.can('contratos.aprovar') && row.approval_rounds.some((r: Row) => r.status === 'pending') && <RoutineLink href={`${base}/aprovacoes`} className={compactSecondaryClass}>Minhas aprovações pendentes</RoutineLink>}",1)
p.write_text(s,encoding='utf-8')
print('Fila e análise somente leitura criadas; Visão geral inclui cabeçalho completo e itens.')
