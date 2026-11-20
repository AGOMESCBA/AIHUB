from pathlib import Path
import json
R=Path('C:/Apps/ELOGESTAO')
def edit(name,old,new):
 p=R/name;s=p.read_text(encoding='utf-8');assert old in s,(name,old[:80]);p.write_text(s.replace(old,new,1),encoding='utf-8')
p=R/'apps/api/app/services/contracts.py'
s=p.read_text(encoding='utf-8')
assert 'def approval_queue(' not in s
s+='''

def approval_queue(db,ctx):
    """Fila própria: filtra no banco ANTES da contagem/paginação; não concede autorização."""
    operational.require_action(ctx,'contratos.consultar')
    operational.require_action(ctx,'contratos.aprovar')
    return query(db,Contract,ctx).join(ApprovalRound,ApprovalRound.id==Contract.approval_round_id).filter(
        ApprovalRound.contract_id==Contract.id,ApprovalRound.status=='pending',
        Contract.status.in_(['awaiting_approval','approved','suspended']),
        text("""(contract_approval_rounds.allow_self_approval OR NOT
            (contract_approval_rounds.snapshot->'authors' @> jsonb_build_array(CAST(:approval_user AS integer))))
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(contract_approval_rounds.levels ->
            (contract_approval_rounds.current_level-1) -> 'approvers') candidate
            WHERE (candidate->>'user_id')::integer=:approval_user
              AND (candidate->>'limit_cents')::bigint>=contract_approval_rounds.amount_cents)
        AND NOT EXISTS (SELECT 1 FROM contract_approval_votes vote
            WHERE vote.round_id=contract_approval_rounds.id
              AND vote.level=contract_approval_rounds.current_level AND vote.created_by=:approval_user)""")
    ).params(approval_user=ctx.user_id)

def approval_summary(db,ctx,c):
    r=db.get(ApprovalRound,c.approval_round_id)
    level=r.levels[r.current_level-1]
    approver=next(a for a in level['approvers'] if a['user_id']==ctx.user_id)
    supplier=db.get(Supplier,c.supplier_id)
    return dict(round_id=r.id,kind='amendment' if r.amendment_id else 'contract',
        amendment_id=r.amendment_id,current_level=r.current_level,total_levels=len(r.levels),
        amount_cents=r.amount_cents,limit_cents=approver['limit_cents'],
        authority_margin_cents=approver['limit_cents']-r.amount_cents,
        supplier_name=supplier.company_name if supplier else None)
'''
p.write_text(s,encoding='utf-8')
p=R/'apps/api/app/routers/contracts.py';s=p.read_text(encoding='utf-8')
s+='''

@router.get('/contract_approvals/')
def my_contract_approvals(page:Page=Depends(page_params),q:str|None=Query(None,max_length=80),
    kind:Literal['contract','amendment']|None=None,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    rows=svc.approval_queue(db,ctx)
    if q:rows=rows.filter(Contract.number.ilike(operational.like(q.strip())))
    if kind=='contract':rows=rows.filter(ApprovalRound.amendment_id.is_(None))
    elif kind=='amendment':rows=rows.filter(ApprovalRound.amendment_id.is_not(None))
    values=rows.order_by(Contract.number,Contract.id).offset(page.offset).limit(page.per_page).all()
    return paginated([dict(id=c.id,number=c.number,description=c.description,version=c.version,
        approval=svc.approval_summary(db,ctx,c)) for c in values],rows.count(),page)

@router.get('/contract_approvals/{contract_id}')
def my_contract_approval(contract_id:int,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    c=svc.approval_queue(db,ctx).filter(Contract.id==contract_id).first()
    if c is None:raise Problem(404,'NOT_FOUND')
    return JSONResponse(jsonable_encoder({**svc.detail(db,ctx,c),'approval':svc.approval_summary(db,ctx,c)}),
        headers={'ETag':etag(c.version)})
'''
p.write_text(s,encoding='utf-8')
edit('apps/api/app/security/guard.py','    # 4B/4C: rotas explícitas;', '    ("GET", r"/contract_approvals/?"), ("GET", rf"/contract_approvals{_ID}"),\n    # 4B/4C: rotas explícitas;')
edit('apps/api/app/main.py','r"^/(contracts(/|$)|','r"^/(contract_approvals(/|$)|contracts(/|$)|')
edit('apps/api/app/routers/me.py','    ("ope.contratos",','    ("ope.aprovacoes", "operacao", "office", "contratos.aprovar", ("contratos.",), "Aprovações", "Contratos e aditivos que aguardam sua decisão."),\n    ("ope.contratos",')
edit('apps/backoffice/src/workspace/groups.ts',"  'ope.contratos': 'contratos',","  'ope.contratos': 'contratos',\n  'ope.aprovacoes': 'contratos',")
edit('apps/backoffice/src/workspace/registry.ts','const definitions: RoutineDefinition[] = [',"const definitions: RoutineDefinition[] = [\n  { code: 'ope.aprovacoes', area: 'operacao', mode: 'office', slug: 'aprovacoes', title: 'Aprovações', record: 'Análise de aprovação', hasRecord: true },")
edit('apps/backoffice/src/workspace/routine-icon.tsx',"const Icon = code.includes('alcadas')","const Icon = code.includes('alcadas') || code.includes('aprovacoes')")
edit('apps/backoffice/src/workspace/workspace-view.tsx',"import {\n  Contracts,","import { ContractApprovalQueue } from '@/app/app/contratos/approval-screens';\nimport {\n  Contracts,")
edit('apps/backoffice/src/workspace/workspace-view.tsx',"    case 'ope.contratos':","    case 'ope.aprovacoes':\n      return <ContractApprovalQueue id={id} />;\n    case 'ope.contratos':")
edit('apps/backoffice/src/lib/api-routes.ts',"  route(['GET', 'POST'], 'contracts'),","  route(['GET'], 'contract_approvals'),\n  route(['GET'], `contract_approvals/${ID}`),\n  route(['GET', 'POST'], 'contracts'),")
edit('apps/backoffice/src/lib/api-routes.ts','vehicles|contracts|contract_commitments','vehicles|contract_approvals|contracts|contract_commitments')
edit('apps/backoffice/src/app/app/contratos/contract-screens.tsx','function Approvals({ row }','export function Approvals({ row }')
edit('apps/backoffice/src/app/app/contratos/contract-screens.tsx',"  if (pending && api.can('contratos.aprovar'))\n    options.push(['approve', 'Aprovar nível atual'], ['reject', 'Recusar']);",'  // Decisões ficam na análise somente leitura da rotina Aprovações.')
edit('tools/dev/test-web-workspace.cjs','assert.equal(apiCodes.length, 31);','assert.equal(apiCodes.length, 32);')
p=R/'contracts/authorization-inventory.json';data=json.loads(p.read_text(encoding='utf-8'))
entries=next(v for v in data.values() if isinstance(v,list) and any(isinstance(x,dict) and x.get('path')=='/contracts/' for x in v))
template=next(x for x in entries if x.get('path')=='/contracts/{contract_id}' and x.get('method')=='GET')
for path in ['/contract_approvals/','/contract_approvals/{contract_id}']:
 entries.append({**template,'path':path,'actions':['contratos.consultar','contratos.aprovar'],
  'ownership':'Somente pendências da própria pessoa no nível atual, com alçada suficiente, sem voto anterior e respeitando autoaprovação, órgão e secretaria.',
  'consumers':['Elo Gestão › Gestão contratual › Aprovações'],'tests':['tests/test_contracts_api.py']})
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Fila própria protegida, navegação e análise dedicadas conectadas; sem migração.')
