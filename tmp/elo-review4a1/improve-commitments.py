from pathlib import Path
import json
root=Path('C:/Apps/ELOGESTAO')
def edit(file,fn):
 p=root/file;p.write_text(fn(p.read_text(encoding='utf-8')),encoding='utf-8')
edit('apps/api/app/schemas/contracts.py',lambda s:s.replace('    authorization_reference: Text\n    authorized_by: Text','    authorization_reference: Annotated[str, StringConstraints(strip_whitespace=True,min_length=1,max_length=500)]\n    authorized_by: Annotated[str, StringConstraints(strip_whitespace=True,min_length=1,max_length=200)]'))
p=root/'apps/api/app/services/contracts.py'
s=p.read_text(encoding='utf-8')
marker='def commitment(db,ctx,request,body):'
block='''def commitment_view(db,ctx,e,c=None,supplier=None,realized=None):
    c=c or get_contract(db,ctx,e.contract_id)
    supplier=supplier or db.get(Supplier,c.supplier_id)
    if realized is None:
        realized=int(db.query(func.coalesce(func.sum(ContractMeasurement.amount_cents),0)).filter(
            ContractMeasurement.commitment_id==e.id,ContractMeasurement.status=='realized').scalar())
    return {**public(e),'contract_number':c.number,'supplier_name':supplier.company_name if supplier else None,
        'realized_cents':realized,'available_cents':e.amount_cents-realized if e.status=='active' else 0,
        'released_cents':e.amount_cents if e.status=='cancelled' else 0}

def commitment_detail(db,ctx,eid):
    operational.require_action(ctx,'empenhos.consultar')
    e=query(db,ContractCommitment,ctx).filter(ContractCommitment.id==eid).first()
    if e is None:raise Problem(404,'NOT_FOUND')
    r=commitment_view(db,ctx,e)
    c=get_contract(db,ctx,e.contract_id)
    r['contract_version']=c.version
    r['contract_balance']=balance(db,c)
    office=operational.office_of(ctx)
    r['measurements']=[];r['events']=[]
    if ctx.profile.allows('medicoes.consultar',office):
        r['measurements']=[{**public(m),'item_description':i.description} for m,i in db.query(ContractMeasurement,ContractItem).join(
            ContractItem,ContractItem.id==ContractMeasurement.item_id).filter(ContractMeasurement.commitment_id==e.id).order_by(ContractMeasurement.id)]
    if ctx.profile.allows('saldos.consultar',office):
        ids=[m[0] for m in db.query(ContractMeasurement.id).filter(ContractMeasurement.commitment_id==e.id)]
        from sqlalchemy import or_,and_
        r['events']=[public(event) for event in query(db,ContractLedger,ctx).filter(ContractLedger.contract_id==c.id,or_(
            and_(ContractLedger.kind.in_(['commitment','commitment_cancel']),ContractLedger.source_id==e.id),
            and_(ContractLedger.kind.in_(['measurement','measurement_reverse']),ContractLedger.source_id.in_(ids)))).order_by(ContractLedger.id)]
    return r

'''
assert marker in s;p.write_text(s.replace(marker,block+marker,1),encoding='utf-8')
p=root/'apps/api/app/routers/contracts.py';s=p.read_text(encoding='utf-8').replace('from typing import Literal','from datetime import date\nfrom typing import Literal').replace('from sqlalchemy import text','from sqlalchemy import text,func').replace('from ..models.contracts import Contract,','from ..models.definitions import Supplier\nfrom ..models.contracts import Contract,',1)
start=s.index("@router.get('/contract_commitments/')");end=s.index("@router.post('/contract_commitments/'",start)
s=s[:start]+'''@router.get('/contract_commitments/')
def commitments(page:Page=Depends(page_params),contract_id:int|None=Query(None,gt=0),q:str|None=Query(None,max_length=80),
                supplier_id:int|None=Query(None,gt=0),date_from:date|None=None,date_to:date|None=None,
                status:Literal['active','cancelled']|None=None,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    operational.require_action(ctx,'empenhos.consultar')
    if date_from and date_to and date_from>date_to:raise Problem(422,'DATE_RANGE_INVALID','A data inicial não pode ser posterior à final.')
    amounts=db.query(ContractMeasurement.commitment_id.label('eid'),func.sum(ContractMeasurement.amount_cents).label('realized')).filter(
        ContractMeasurement.status=='realized').group_by(ContractMeasurement.commitment_id).subquery()
    rows=svc.query(db,ContractCommitment,ctx).join(Contract,Contract.id==ContractCommitment.contract_id).join(Supplier,Supplier.id==Contract.supplier_id)
    if contract_id:rows=rows.filter(ContractCommitment.contract_id==contract_id)
    if supplier_id:rows=rows.filter(Contract.supplier_id==supplier_id)
    if q:rows=rows.filter(ContractCommitment.number.ilike(operational.like(q.strip())))
    if status:rows=rows.filter(ContractCommitment.status==status)
    if date_from:rows=rows.filter(ContractCommitment.date>=date_from)
    if date_to:rows=rows.filter(ContractCommitment.date<=date_to)
    total=rows.count()
    values=rows.outerjoin(amounts,amounts.c.eid==ContractCommitment.id).add_entity(Contract).add_entity(Supplier).add_columns(
        func.coalesce(amounts.c.realized,0)).order_by(ContractCommitment.id.desc()).offset(page.offset).limit(page.per_page)
    return paginated([svc.commitment_view(db,ctx,e,c,s,int(realized)) for e,c,s,realized in values],total,page)

@router.get('/contract_commitments/{commitment_id}')
def get_commitment(commitment_id:int,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    result=svc.commitment_detail(db,ctx,commitment_id)
    return JSONResponse(jsonable_encoder(result),headers={'ETag':etag(result['contract_version'])})

'''+s[end:];p.write_text(s,encoding='utf-8')
p=root/'contracts/authorization-inventory.json';data=json.loads(p.read_text(encoding='utf-8'))
def walk(o):
 if isinstance(o,list):
  for i,row in enumerate(o):
   if isinstance(row,dict) and row.get('path')=='/contract_commitments/' and row.get('method')=='GET':
    new={**row,'path':'/contract_commitments/{commitment_id}','relationships':'Consulta própria do empenho; medições exigem medicoes.consultar; razão exige saldos.consultar; ETag é a versão do contrato.'};o.insert(i+1,new);return True
   if walk(row):return True
 elif isinstance(o,dict):
  for v in o.values():
   if walk(v):return True
 return False
assert walk(data);p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Backend, validação e inventário atualizados')
