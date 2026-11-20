'use client';
import { useRef, useState } from 'react';
import { RoutineLink, useBackToList, useTabSave, useTabState } from '@/workspace/workspace';
import { Row, useAdminApi, useAdminQuery } from '@/app/app/administracao/admin-api';
import { Back, base, CancelToList, Cell, compactButtonClass, compactSecondaryClass, Field, items, ListToolbar, Notice, Pagination, Panel, QueryState, RoutineHeader, SearchSelect, Select, Table, useColumnFilters, useDirtyForm } from '@/app/app/administracao/admin-ui';
import { contractDate } from './contract-overview';

const money=(v:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((v??0)/100);
const moneyInput=(v:number)=>(v/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false});
const typeName:Record<string,string>={nfe:'NF-e',nfse:'NFS-e',other:'Outro documento fiscal'};
function cents(raw:string){const value=raw.replace(/\./g,'').trim();if(!/^\d+(,\d{1,2})?$/.test(value))throw new Error('Informe valores em reais, por exemplo 1.250,50.');const [a,b='']=value.split(',');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<=0||n>9_000_000_000_000)throw new Error('Informe um valor positivo dentro do limite permitido.');return n;}
function Balances({balance}:{balance:Row}){return <dl className="grid gap-3 sm:grid-cols-3">{[['Orçado',balance.limit_cents],['Empenhado',balance.committed_cents],['Realizado',balance.realized_cents]].map(([label,value])=><div key={label} className="rounded-lg border border-blue-100 bg-blue-50/50 p-3"><dt className="text-xs text-slate-600">{label}</dt><dd className="mt-1 text-lg font-semibold">{money(Number(value))}</dd></div>)}</dl>;}
function InvoiceForm(){
 const api=useAdminApi();const back=useBackToList();const ref=useRef<HTMLFormElement>(null);
 const [contract,setContract]=useState('');const [contractText,setContractText]=useState('');
 const [dirty,setDirty]=useState(false);const [saved,setSaved]=useState(false);
 const [fields,setFields]=useState<Row>({document_type:'nfse',number:'',series:'',issued_on:new Date().toLocaleDateString('en-CA'),amount:'',access_key:'',notes:''});
 const [amounts,setAmounts]=useState<Record<string,string>>({});
 useDirtyForm(dirty);
 const options=useAdminQuery('/contract_invoices/measurement-options',{contract_id:contract},!!contract);
 const row=options.data?.data;
 const allowed=['notas_fiscais.incluir','notas_fiscais.consultar','contratos.consultar','empenhos.consultar','medicoes.consultar'].every(api.can);
 const update=(key:string,value:string)=>{setFields(f=>({...f,[key]:value}));setDirty(true);};
 const save=async()=>{
  if(!ref.current?.reportValidity()||!row||!contract||saved||!allowed||api.busy)return false;
  try{
   const allocations=Object.entries(amounts).filter(([,value])=>value.trim()).map(([id,value])=>({measurement_id:Number(id),amount_cents:cents(value)}));
   const total=cents(fields.amount);
   if(!allocations.length)throw new Error('Vincule pelo menos uma medição realizada.');
   if(allocations.reduce((sum,a)=>sum+a.amount_cents,0)!==total)throw new Error('A soma dos vínculos deve ser igual ao valor total da nota.');
   if(allocations.some(a=>a.amount_cents>(row.items.find((m:Row)=>m.id===a.measurement_id)?.available_cents??0)))throw new Error('O vínculo supera o valor disponível da medição.');
   const response=await api.send('post','/contract_invoices',{contract_id:Number(contract),document_type:fields.document_type,number:fields.number,series:fields.series,issued_on:fields.issued_on,amount_cents:total,access_key:fields.access_key.trim()||null,notes:fields.notes,allocations},options.data?.etag);
   if(!response)return false;setDirty(false);setSaved(true);return true;
  }catch(error){api.setMessage({ok:false,text:error instanceof Error?error.message:'Confira os dados da nota.'});return false;}
 };
 useTabSave(save,allowed&&!saved);
 let allocated=0;let invalid=false;for(const v of Object.values(amounts)){if(v.trim())try{allocated+=cents(v);}catch{invalid=true;}}
 return <Panel title="Registrar nota fiscal" guide="Registre o documento recebido e vincule seus valores às medições realizadas. O fornecedor vem do contrato. Este cadastro não emite nota, não efetua pagamento e não desconta novamente o saldo." actions={<>{allowed&&<button type="button" className={compactButtonClass} disabled={api.busy||!row||saved||options.isFetching} onClick={()=>ref.current?.requestSubmit()}>Registrar nota fiscal</button>}<CancelToList/></>}>
  <form ref={ref} className="space-y-4" onSubmit={async e=>{e.preventDefault();if(await save())back('Nota fiscal registrada. Os saldos contratuais foram preservados.');}}>
   <fieldset disabled={!allowed||api.busy||saved} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <SearchSelect title="Contrato" path="/contracts" value={contract} valueText={contractText} describe={c=>`${c.number} — ${c.description}`} onChange={(id,text)=>{setContract(id);setContractText(text);setAmounts({});setDirty(true);}} required emptyText="Selecionar contrato"/>
    <Select title="Tipo de documento" value={fields.document_type} onChange={v=>update('document_type',v)}>{Object.entries(typeName).map(([v,label])=><option key={v} value={v}>{label}</option>)}</Select>
    <Field name="invoice_number" title="Número da nota" value={fields.number} onChange={v=>update('number',v)} required/>
    <Field name="invoice_series" title="Série (quando houver)" value={fields.series} onChange={v=>update('series',v)}/>
    <Field name="invoice_issued_on" title="Data de emissão" type="date" value={fields.issued_on} onChange={v=>update('issued_on',v)} required/>
    <Field name="invoice_amount" title="Valor total da nota (R$)" value={fields.amount} onChange={v=>update('amount',v)} required/>
    <div className="sm:col-span-2"><Field name="invoice_access_key" title={fields.document_type==='nfe'?'Chave de acesso (44 dígitos, quando informada)':'Chave de acesso (quando houver)'} value={fields.access_key} onChange={v=>update('access_key',v)}/></div>
    <Field name="invoice_notes" title="Observações" value={fields.notes} onChange={v=>update('notes',v)}/>
   </fieldset>
   {contract&&<QueryState query={options}>{row&&<>
    <p className="text-sm text-slate-600">Contrato {row.contract_number} · Fornecedor: <strong>{row.supplier_name}</strong></p><Balances balance={row.balance}/>
    <h3 className="font-semibold">Vincular medições realizadas</h3><p className="text-xs text-slate-500">Informe a parcela desta nota em cada medição. Pode haver várias notas parciais, sem ultrapassar o valor realizado.</p>
    {!row.items.length&&<Notice text="Não há medições realizadas com valor disponível para vincular neste contrato."/>}
    <Table layoutKey="notas_fiscais.vinculos" columns={['Medição','Empenho','Item','Realizado','Disponível para nota','Vincular nesta nota (R$)']} rows={row.items} render={m=><><Cell>#{m.id} · {contractDate(m.date)}</Cell><Cell>{m.commitment_number}</Cell><Cell>{m.item_description}</Cell><Cell>{money(m.amount_cents)}</Cell><Cell>{money(m.available_cents)}</Cell><Cell><div className="flex min-w-[190px] items-end gap-2"><Field compact name={`invoice_allocation_${m.id}`} title={`Valor na medição ${m.id}`} value={amounts[m.id]??''} disabled={!allowed||api.busy||saved} onChange={v=>{setAmounts(a=>({...a,[m.id]:v}));setDirty(true);}}/><button type="button" className={compactSecondaryClass} disabled={!allowed||api.busy||saved} onClick={()=>{setAmounts(a=>({...a,[m.id]:moneyInput(m.available_cents)}));setDirty(true);}}>Usar disponível</button></div></Cell></>}/>
    <p className="text-sm font-semibold">Total vinculado: {invalid?'Confira os valores':money(allocated)}</p><p className="text-xs text-slate-500">Orçado, Empenhado e Realizado não se alteram ao registrar esta nota.</p>
   </>}</QueryState>}
   {api.message&&<Notice error={!api.message.ok} text={api.message.text}/>}
  </form>
 </Panel>;
}

function InvoiceRecord({id}:{id:string}){
 const api=useAdminApi();const query=useAdminQuery(`/contract_invoices/${id}`);const r=query.data?.data;const [reason,setReason]=useState('');useDirtyForm(!!reason.trim());
 const canCancel=r?.status==='registered'&&api.can('notas_fiscais.cancelar')&&api.can('contratos.consultar');
 return <QueryState query={query}>{r&&<div className="space-y-3"><Panel title={`${typeName[r.document_type]} ${r.number}`} actions={<>
  {api.can('contratos.consultar')&&<RoutineLink className={compactSecondaryClass} href={`${base}/contratos/${r.contract_id}`}>Consultar contrato</RoutineLink>}
  <button type="button" className={compactSecondaryClass} disabled={api.busy||query.isFetching} onClick={()=>void query.refetch()}>Atualizar</button>
  {canCancel&&<button type="button" className={compactSecondaryClass} disabled={api.busy||!reason.trim()} onClick={async()=>{if(!window.confirm('Cancelar este registro no Elo? Isso não cancela o documento na SEFAZ ou na prefeitura e não altera os saldos contratuais.'))return;const result=await api.send('post',`/contracts/${r.contract_id}/invoices/${r.id}/cancel`,{reason},query.data?.etag);if(result){setReason('');await query.refetch();}}}>Cancelar registro</button>}<Back/>
 </>}>
  <Balances balance={r.balance}/><dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">{[['Situação',r.status==='registered'?'Registrada':'Registro cancelado'],['Contrato',r.contract_number],['Fornecedor',r.supplier_name],['Número',r.number],['Série',r.series||'Sem série'],['Emissão',contractDate(r.issued_on)],['Valor da nota',money(r.amount_cents)],['Chave de acesso',r.access_key||'Não informada'],['Observações',r.notes||'—']].map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}</dl>
  <Notice text="Registro documental: não representa pagamento ou validação fiscal externa. A nota não desconta novamente os valores já realizados."/>
  {canCancel&&<Field name="invoice_cancel_reason" title="Justificativa para cancelar o registro" value={reason} onChange={setReason}/>}
  {api.message&&<Notice error={!api.message.ok} text={api.message.text}/>}
 </Panel><Panel title="Contrato, empenhos e medições vinculadas"><Table layoutKey="notas_fiscais.medicoes" columns={['Medição','Empenho','Item','Valor vinculado']} rows={r.allocations} render={a=><><Cell>#{a.measurement_id}{a.measurement_date?` · ${contractDate(a.measurement_date)}`:''}</Cell><Cell>{a.commitment_id?<RoutineLink className="text-blue-700 underline" href={`${base}/empenhos/${a.commitment_id}`}>{a.commitment_number}</RoutineLink>:'Consulta não permitida'}</Cell><Cell>{a.item_description??'Consulta não permitida'}</Cell><Cell>{money(a.amount_cents)}</Cell></>}/></Panel>
 <Panel title="Rastreabilidade"><ol className="space-y-3 text-sm"><li><strong>Registro da nota</strong> · {new Date(r.created_at).toLocaleString('pt-BR')} · Usuário #{r.created_by} · {money(r.amount_cents)}</li>{r.status==='cancelled'&&<li><strong>Cancelamento do registro</strong> · {new Date(r.cancelled_at).toLocaleString('pt-BR')} · Usuário #{r.cancelled_by}<p>{r.cancel_reason}</p></li>}</ol></Panel></div>}</QueryState>;
}

function InvoiceList(){
 const api=useAdminApi();const [page,setPage]=useTabState('notas_fiscais.pagina',1);const [perPage,setPerPage]=useTabState('notas_fiscais.por_pagina',20);
 const [contract,setContract]=useTabState('notas_fiscais.contrato','');const [contractText,setContractText]=useTabState('notas_fiscais.contrato_texto','');const [status,setStatus]=useTabState('notas_fiscais.situacao','');
 const [from,setFrom]=useTabState('notas_fiscais.inicio','');const [to,setTo]=useTabState('notas_fiscais.fim','');
 const cols=useColumnFilters('notas_fiscais',{q:'Número'},'-id',()=>setPage(1));
 const query=useAdminQuery('/contract_invoices',{page,per_page:perPage,...(cols.params.q?{q:cols.params.q}:{}),...(contract?{contract_id:contract}:{}),...(status?{status}:{}),...(from?{date_from:from}:{}),...(to?{date_to:to}:{})});
 const active=[...cols.active,...[{key:'contract',text:`Contrato: ${contractText}`,value:contract,clear:()=>{setContract('');setContractText('');setPage(1);}},{key:'status',text:`Situação: ${status==='registered'?'Registrada':'Cancelada'}`,value:status,clear:()=>{setStatus('');setPage(1);}},{key:'from',text:`Desde: ${contractDate(from)}`,value:from,clear:()=>{setFrom('');setPage(1);}},{key:'to',text:`Até: ${contractDate(to)}`,value:to,clear:()=>{setTo('');setPage(1);}}].filter(f=>f.value)];
 const allowed=['notas_fiscais.incluir','contratos.consultar','empenhos.consultar','medicoes.consultar'].every(api.can);
 return <Panel><ListToolbar stateKey="notas_fiscais" active={active} onClear={()=>active.forEach(f=>f.clear())} primary={allowed&&<RoutineLink className={compactButtonClass} href={`${base}/notas-fiscais/novo`}>Registrar nota fiscal</RoutineLink>}>
  <Field name="invoice_from" title="Emissão inicial" type="date" value={from} onChange={v=>{setFrom(v);setPage(1);}}/><Field name="invoice_to" title="Emissão final" type="date" value={to} onChange={v=>{setTo(v);setPage(1);}}/>
 </ListToolbar><QueryState query={query}><Table layoutKey="notas_fiscais.lista" openOnRowClick columns={['Número','Série','Tipo','Contrato','Fornecedor','Emissão','Valor','Situação','Ação']} filters={[cols.text('q'),null,null,api.can('contratos.consultar')?<SearchSelect key="contract" title="Contrato" path="/contracts" compact hideLabel value={contract} valueText={contractText} describe={r=>r.number} onChange={(id,text)=>{setContract(id);setContractText(text);setPage(1);}} emptyText="Todos"/>:null,null,null,null,<Select key="status" title="Situação" compact value={status} onChange={v=>{setStatus(v);setPage(1);}}><option value="">Todas</option><option value="registered">Registradas</option><option value="cancelled">Canceladas</option></Select>,null]} rows={items(query.data?.data)} render={r=><><Cell>{r.number}</Cell><Cell>{r.series||'—'}</Cell><Cell>{typeName[r.document_type]}</Cell><Cell>{r.contract_number}</Cell><Cell>{r.supplier_name}</Cell><Cell>{contractDate(r.issued_on)}</Cell><Cell>{money(r.amount_cents)}</Cell><Cell>{r.status==='registered'?'Registrada':'Cancelada'}</Cell><Cell><RoutineLink className="font-medium text-blue-700" href={`${base}/notas-fiscais/${r.id}`}>Consultar nota</RoutineLink></Cell></>}/><Pagination page={page} perPage={perPage} total={query.data?.data?.total??0} onChange={setPage} onPerPage={v=>{setPerPage(v);setPage(1);}}/></QueryState></Panel>;
}
export function ContractInvoices({id}:{id?:string}){return <div className="space-y-3"><RoutineHeader title="Notas fiscais" back={id?<Back/>:undefined} description="Documentos vinculados à execução do contrato. Acompanhe as notas sem descontar novamente o saldo realizado."/>{id==='novo'?<InvoiceForm/>:id?<InvoiceRecord key={id} id={id}/>:<InvoiceList/>}</div>;}
