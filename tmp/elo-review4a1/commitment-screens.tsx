'use client';
import { useState } from 'react';
import { RoutineLink, useTabState } from '@/workspace/workspace';
import { Row, useAdminApi, useAdminQuery } from '@/app/app/administracao/admin-api';
import {
  Back, base, Cell, compactButtonClass, compactSecondaryClass, Field, items,
  ListToolbar, Notice, Pagination, Panel, QueryState, RoutineHeader, SearchSelect,
  Select, Table, useColumnFilters,
} from '@/app/app/administracao/admin-ui';
import { contractDate } from './contract-overview';

const money=(v:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((v??0)/100);
function Position({values}:{values:[string,number][]}) {
  return <dl className="grid gap-3 sm:grid-cols-3">{values.map(([label,value])=><div key={label} className="rounded-lg border border-blue-100 bg-blue-50/50 p-3"><dt className="text-xs text-slate-600">{label}</dt><dd className="mt-1 text-lg font-semibold text-slate-900">{money(value)}</dd></div>)}</dl>;
}
export function CommitmentPreview({row,amount}:{row:Row;amount:string}) {
  const cleaned=amount.replace(/\./g,'').trim();
  const valid=/^\d+(,\d{1,2})?$/.test(cleaned);
  const value=valid?Math.round(Number(cleaned.replace(',','.'))*100):0;
  const balance=row.balance.available_to_commit_cents;
  return <Panel title="Conferência do empenho">
    <p className="mb-3 text-sm text-slate-600">Contrato {row.number} · {row.supplier?.name} · Vigência: {contractDate(row.starts_on)} a {contractDate(row.ends_on)}</p>
    <Position values={[["Disponível no contrato",balance],["Valor deste empenho",value],["Disponível após registrar",balance-value]]}/>
    {valid&&value>balance&&<Notice error text="O valor informado supera o disponível no contrato. Reduza o valor antes de registrar."/>}
    {!valid&&amount&&<Notice error text="Informe um valor em reais, por exemplo 1.250,50."/>}
    <p className="mt-2 text-xs text-slate-500">Simulação. O saldo e a versão do contrato são conferidos novamente pelo servidor ao registrar. A nota fiscal será vinculada à execução; não é exigida neste lançamento.</p>
  </Panel>;
}

function CommitmentRecord({id}:{id:string}) {
  const api=useAdminApi();
  const query=useAdminQuery(`/contract_commitments/${id}`);
  const r=query.data?.data;
  const [reason,setReason]=useState('');
  const canCancel=!!r&&r.status==='active'&&api.can('empenhos.cancelar')&&api.can('contratos.consultar');
  return <QueryState query={query}>{r&&<div className="space-y-3">
    <Panel title={`Empenho ${r.number}`} actions={<>
      {api.can('contratos.consultar')&&<RoutineLink className={compactSecondaryClass} href={`${base}/contratos/${r.contract_id}`}>Consultar contrato</RoutineLink>}
      {canCancel&&<button type="button" className={compactSecondaryClass} disabled={api.busy||!reason.trim()||r.realized_cents>0} onClick={async()=>{
        if(!window.confirm('Cancelar integralmente este empenho e devolver o valor ao disponível do contrato?'))return;
        const result=await api.send('post',`/contracts/${r.contract_id}/commitments/${r.id}/cancel`,{reason},query.data?.etag);
        if(result){setReason('');await query.refetch();}
      }}>Cancelar empenho</button>}
      <Back/>
    </>}>
      <Position values={[["Valor registrado",r.amount_cents],["Realizado",r.realized_cents],["Disponível no empenho",r.available_cents]]}/>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">{[
        ['Contrato',r.contract_number],['Fornecedor',r.supplier_name],['Data do empenho',contractDate(r.date)],
        ['Situação',r.status==='cancelled'?'Cancelado':r.available_cents===0?'Totalmente realizado':r.realized_cents>0?'Parcialmente realizado':'Registrado'],
        ['Referência da autorização',r.authorization_reference],['Responsável pela autorização',r.authorized_by],
        ['Registrado em',new Date(r.created_at).toLocaleString('pt-BR')],['Autor do registro',`Usuário #${r.created_by}`],
        ['Valor liberado por cancelamento',money(r.released_cents)],
      ].map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium">{value||'—'}</dd></div>)}</dl>
      {r.status==='active'&&<div className="mt-4"><p className="mb-1 text-xs text-slate-600">Execução do empenho · {(r.realized_cents/r.amount_cents*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</p><progress className="h-2 w-full accent-blue-600" aria-label="Execução do empenho" value={r.realized_cents} max={r.amount_cents}/></div>}
      {canCancel&&<div className="mt-3"><Field name="commitment_cancel_reason" title="Justificativa do cancelamento integral" value={reason} onChange={setReason}/>{r.realized_cents>0&&<p className="mt-1 text-xs text-amber-700">Há medições realizadas. O cancelamento integral exige estorná-las antes. Anulação parcial ainda não está disponível.</p>}</div>}
      {api.message&&<Notice error={!api.message.ok} text={api.message.text}/>}
    </Panel>
    <Panel title="Medições vinculadas">{api.can('medicoes.consultar')?<Table layoutKey="empenhos.medicoes" columns={['Data','Item','Quantidade','Valor','Situação','Referência do ateste']} rows={r.measurements} render={m=><><Cell>{contractDate(m.date)}</Cell><Cell>{m.item_description}</Cell><Cell>{Number(m.quantity).toLocaleString('pt-BR',{maximumFractionDigits:6})}</Cell><Cell>{money(m.amount_cents)}</Cell><Cell>{m.status==='realized'?'Realizada':'Estornada'}</Cell><Cell>{m.attestation_reference}</Cell></>}/>:<Notice text="Seu perfil não permite consultar as medições."/>}</Panel>
    <Panel title="Histórico financeiro">{api.can('saldos.consultar')?<Table layoutKey="empenhos.historico" columns={['Data','Movimento','Valor','Justificativa','Autor']} rows={r.events} render={e=><><Cell>{new Date(e.created_at).toLocaleString('pt-BR')}</Cell><Cell>{{commitment:'Registro do empenho',commitment_cancel:'Cancelamento do empenho',measurement:'Medição realizada',measurement_reverse:'Estorno de medição'}[e.kind as string]??e.kind}</Cell><Cell>{money(e.amount_cents)}</Cell><Cell>{e.reason}</Cell><Cell>Usuário #{e.created_by}</Cell></>}/>:<Notice text="Seu perfil não permite consultar o histórico financeiro."/>}</Panel>
  </div>}</QueryState>;
}

export function CommitmentWorkspace({id}:{id?:string}) {
  const api=useAdminApi();
  const [page,setPage]=useTabState('empenhos.pagina',1);
  const [perPage,setPerPage]=useTabState('empenhos.por_pagina',20);
  const [contract,setContract]=useTabState('empenhos.contrato','');
  const [contractText,setContractText]=useTabState('empenhos.contrato_texto','');
  const [supplier,setSupplier]=useTabState('empenhos.fornecedor','');
  const [supplierText,setSupplierText]=useTabState('empenhos.fornecedor_texto','');
  const [status,setStatus]=useTabState('empenhos.situacao','');
  const [from,setFrom]=useTabState('empenhos.inicio','');
  const [to,setTo]=useTabState('empenhos.fim','');
  const cols=useColumnFilters('empenhos',{q:'Número'},'-id',()=>setPage(1));
  const {sort,...params}=cols.params;
  const query=useAdminQuery('/contract_commitments',{page,per_page:perPage,...params,...(contract?{contract_id:contract}:{}),...(supplier?{supplier_id:supplier}:{}),...(status?{status}:{}),...(from?{date_from:from}:{}),...(to?{date_to:to}:{})},!id);
  const active=[...cols.active,...[
    {key:'contract',text:`Contrato: ${contractText}`,clear:()=>{setContract('');setContractText('');setPage(1);},value:contract},
    {key:'supplier',text:`Fornecedor: ${supplierText}`,clear:()=>{setSupplier('');setSupplierText('');setPage(1);},value:supplier},
    {key:'status',text:`Situação: ${status==='active'?'Registrado':'Cancelado'}`,clear:()=>{setStatus('');setPage(1);},value:status},
    {key:'from',text:`Desde: ${contractDate(from)}`,clear:()=>{setFrom('');setPage(1);},value:from},
    {key:'to',text:`Até: ${contractDate(to)}`,clear:()=>{setTo('');setPage(1);},value:to},
  ].filter(f=>f.value)];
  return <div className="space-y-3"><RoutineHeader title="Empenhos" back={id?<Back/>:undefined} description="Acompanhe a reserva e a execução do contrato, com origem, medições e saldo de cada empenho."/>
    {id?<CommitmentRecord key={id} id={id}/>:<Panel>
      <ListToolbar stateKey="empenhos" active={active} onClear={()=>active.forEach(f=>f.clear())} primary={api.can('empenhos.incluir')&&<RoutineLink className={compactButtonClass} href={`${base}/empenhos/novo`}>Registrar empenho</RoutineLink>}>
        <SearchSelect title="Fornecedor" path="/suppliers" value={supplier} valueText={supplierText} describe={r=>r.company_name} onChange={(v,t)=>{setSupplier(v);setSupplierText(t);setPage(1);}} emptyText="Todos os fornecedores"/>
        <Field name="commitment_from" title="Data inicial" type="date" value={from} onChange={v=>{setFrom(v);setPage(1);}}/>
        <Field name="commitment_to" title="Data final" type="date" value={to} onChange={v=>{setTo(v);setPage(1);}}/>
      </ListToolbar>
      <QueryState query={query}><Table layoutKey="empenhos.monitor" openOnRowClick columns={['Empenho','Contrato','Fornecedor','Data','Valor registrado','Realizado','Disponível','Situação','Ação']} filters={[
        cols.text('q'),<SearchSelect key="contract" title="Contrato" path="/contracts" value={contract} valueText={contractText} describe={r=>r.number} onChange={(v,t)=>{setContract(v);setContractText(t);setPage(1);}} emptyText="Todos" compact hideLabel/>,null,null,null,null,null,
        <Select key="status" title="Situação" compact value={status} onChange={v=>{setStatus(v);setPage(1);}}><option value="">Todas</option><option value="active">Registrados</option><option value="cancelled">Cancelados</option></Select>,null,
      ]} rows={items(query.data?.data)} render={r=><><Cell>{r.number}</Cell><Cell>{r.contract_number}</Cell><Cell>{r.supplier_name}</Cell><Cell>{contractDate(r.date)}</Cell><Cell>{money(r.amount_cents)}</Cell><Cell>{money(r.realized_cents)}</Cell><Cell>{money(r.available_cents)}</Cell><Cell>{r.status==='cancelled'?'Cancelado':r.available_cents===0?'Totalmente realizado':r.realized_cents>0?'Parcialmente realizado':'Registrado'}</Cell><Cell><RoutineLink className="font-medium text-blue-700" href={`${base}/empenhos/${r.id}`}>Consultar empenho</RoutineLink></Cell></>}/>
        <Pagination page={page} total={query.data?.data?.total??0} perPage={perPage} onPageSizeChange={undefined} onChange={setPage} onPerPage={v=>{setPerPage(v);setPage(1);}}/>
      </QueryState>
    </Panel>}
  </div>;
}
