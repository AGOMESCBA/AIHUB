from pathlib import Path
r=Path('C:/Apps/ELOGESTAO');sc=Path('C:/Apps/iahub/tmp/elo-review4a1')
def edit(file,fn):
 p=r/file;p.write_text(fn(p.read_text(encoding='utf-8')),encoding='utf-8')
s=(sc/'invoice-screens.tsx').read_text(encoding='utf-8').replace('Disponível para nota','Realizado sem nota')
s+='''
export function InvoiceReferences({contractId,commitmentId}:{contractId:number;commitmentId?:number}){
 const api=useAdminApi();const allowed=api.can('notas_fiscais.consultar');
 const query=useAdminQuery('/contract_invoices',{contract_id:contractId,...(commitmentId?{commitment_id:commitmentId}:{}),page:1,per_page:100},allowed);
 if(!allowed)return null;
 return <Panel title="Notas fiscais vinculadas"><QueryState query={query}><Table layoutKey="notas_fiscais.referencias" columns={['Número','Emissão','Valor da nota','Situação','Ação']} rows={items(query.data?.data)} render={r=><><Cell>{typeName[r.document_type]} {r.number}</Cell><Cell>{contractDate(r.issued_on)}</Cell><Cell>{money(r.amount_cents)}</Cell><Cell>{r.status==='registered'?'Registrada':'Cancelada'}</Cell><Cell><RoutineLink className="text-blue-700 underline" href={`${base}/notas-fiscais/${r.id}`}>Consultar nota</RoutineLink></Cell></>}/><p className="text-xs text-slate-500">Até 100 notas exibidas. Consulte todas e filtre pela rotina de Notas fiscais. O valor da nota pode abranger outras medições deste contrato.</p></QueryState></Panel>;
}
'''
(r/'apps/backoffice/src/app/app/contratos/invoice-screens.tsx').write_text(s,encoding='utf-8')
edit('apps/backoffice/src/lib/api-routes.ts',lambda s:s.replace('export const API_ROUTES: Route[] = [',"""export const API_ROUTES: Route[] = [
  route(['GET','POST'], 'contract_invoices'),
  route(['GET'], 'contract_invoices/measurement-options'),
  route(['GET'], `contract_invoices/${ID}`),
  route(['POST'], `contracts/${ID}/invoices/${ID}/cancel`),""",1).replace('contract_commitments|contract_measurements)$/','contract_commitments|contract_measurements|contract_invoices)$/'))
edit('apps/backoffice/src/workspace/registry.ts',lambda s:s.replace('const definitions: RoutineDefinition[] = [',"""const definitions: RoutineDefinition[] = [
  {code:'ope.notas_fiscais',area:'operacao',mode:'office',slug:'notas-fiscais',title:'Notas fiscais',record:'Nota fiscal',create:'Nova nota fiscal',hasRecord:true},""",1))
edit('apps/backoffice/src/workspace/groups.ts',lambda s:s.replace("  'ope.medicoes': 'contratos',","  'ope.medicoes': 'contratos',\n  'ope.notas_fiscais': 'contratos',",1))
# Preserva os demais hunks de workspace-view.tsx, pertencentes à outra sessão.
edit('apps/backoffice/src/workspace/workspace-view.tsx',lambda s:s.replace("import { ContractApprovalQueue }", "import { ContractInvoices } from '@/app/app/contratos/invoice-screens';\nimport { ContractApprovalQueue }",1).replace("    case 'ope.medicoes':", "    case 'ope.notas_fiscais':\n      return <ContractInvoices key={id ?? 'list'} id={id} />;\n    case 'ope.medicoes':",1))
edit('apps/backoffice/src/workspace/routine-icon.tsx',lambda s:s.replace("code.includes('contratos')", "code.includes('contratos') || code.includes('notas_fiscais')",1))
edit('apps/api/app/routers/me.py',lambda s:s.replace('NAVIGATION_ROUTINES = (','''NAVIGATION_ROUTINES = (
    ("ope.notas_fiscais", "operacao", "office", "notas_fiscais.consultar", ("notas_fiscais.",), "Notas fiscais", "Documentos vinculados às medições, sem novo desconto de saldo."),''',1))
p=r/'apps/api/app/routers/invoices.py';s=p.read_text(encoding='utf-8').replace('ContractInvoice,Contract','ContractInvoice,Contract,ContractInvoiceLink,ContractMeasurement',1).replace('contract_id:int|None=Query(None,gt=0),','contract_id:int|None=Query(None,gt=0),commitment_id:int|None=Query(None,gt=0),',1)
s=s.replace('    if q:rows=',"""    if commitment_id:
        rows=rows.filter(ContractInvoice.id.in_(db.query(ContractInvoiceLink.invoice_id).join(ContractMeasurement,
            ContractMeasurement.id==ContractInvoiceLink.measurement_id).filter(ContractMeasurement.commitment_id==commitment_id)))
    if q:rows=""",1);p.write_text(s,encoding='utf-8')
p=r/'apps/backoffice/src/app/app/contratos/commitment-screens.tsx';s=p.read_text(encoding='utf-8').replace("import { contractDate } from './contract-overview';", "import { contractDate } from './contract-overview';\nimport { InvoiceReferences } from './invoice-screens';",1)
needle='          <Panel title="Medições vinculadas">';assert needle in s;s=s.replace(needle,'          <InvoiceReferences contractId={r.contract_id} commitmentId={r.id} />\n'+needle,1);p.write_text(s,encoding='utf-8')
p=r/'apps/backoffice/src/app/app/contratos/contract-screens.tsx';s=p.read_text(encoding='utf-8').replace("import { ContractOverview, ContractItems } from './contract-overview';","import { ContractOverview, ContractItems } from './contract-overview';\nimport { InvoiceReferences } from './invoice-screens';",1).replace("['Valor do contrato', b.limit_cents]","['Orçado', b.limit_cents]",1)
# Insere nas operações de execução do contrato, sem misturar notas com lançamentos financeiros.
needle='      <Panel title="Empenhos">';assert needle in s;s=s.replace(needle,'      <InvoiceReferences contractId={row.id} />\n'+needle,1);p.write_text(s,encoding='utf-8')
edit('apps/api/tests/test_fase38_navigation_api.py',lambda s:s.replace('OFFICE_FINANCIAL = sorted(OFFICE + ["ope.empenhos", "ope.medicoes"])','OFFICE_FINANCIAL = sorted(OFFICE + ["ope.empenhos", "ope.medicoes", "ope.notas_fiscais"])'))
edit('apps/api/tests/test_invoices_api.py',lambda s:s.replace('    with pytest.raises(Exception):\n        with a[\'owner\'].begin() as db:\n            db.execute(text("UPDATE contract_measurements', '    with pytest.raises(Exception) as reversed_error:\n        with a[\'owner\'].begin() as db:\n            db.execute(text("UPDATE contract_measurements',1).replace("    with pytest.raises(Exception):\n        with a['owner'].begin() as db:\n            _insert", "    assert 'invoice_measurement_exceeded_or_reversed' in str(reversed_error.value)\n    with pytest.raises(Exception) as total_error:\n        with a['owner'].begin() as db:\n            _insert",1).replace("    assert get(a,c)['balance']['realized_cents']==40000","    assert 'invoice_total_mismatch' in str(total_error.value)\n    assert get(a,c)['balance']['realized_cents']==40000",1))
print('Telas, referências, BFF, menus e catálogo de navegação integrados')
