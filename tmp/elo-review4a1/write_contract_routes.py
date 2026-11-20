from pathlib import Path
R=Path('C:/Apps/ELOGESTAO');p=R/'apps/api/app/routers/contracts.py';assert not p.exists()
p.write_text('''"""API de contratos e execução contratual: alçadas no contrato; sem alçada nas medições."""
from typing import Literal
from fastapi import APIRouter,Depends,Query,Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse,Response
from sqlalchemy import text
from sqlalchemy.orm import Session
from ..dependencies import get_db_session
from ..models.contracts import Contract,ContractPolicy,ContractCommitment,ContractMeasurement,ApprovalRound
from ..schemas.contracts import (ContractInput,PolicyInput,ReasonInput,DecisionInput,AmendmentInput,CommitmentInput,MeasurementInput)
from ..security.context import org_context,customer_admin_context,require_admin
from ..security.authorization import load_profile
from ..security.problems import Problem
from ..services import contracts as svc,operational
from ..services.http_contract import Page,page_params,paginated,etag

router=APIRouter(tags=['Contratos e execução contratual'])
admin_router=APIRouter(prefix='/customers/{customer_id}',tags=['Alçadas contratuais'])

def filtered(db,ctx,q,status):
    rows=svc.query(db,Contract,ctx)
    if q:rows=rows.filter(Contract.number.ilike(operational.like(q.strip())))
    if status in ('active','scheduled','expired'):
        rows=rows.filter(Contract.status=='approved')
        date=svc.today(db)
        if status=='active':rows=rows.filter(Contract.starts_on<=date,Contract.ends_on>=date)
        elif status=='scheduled':rows=rows.filter(Contract.starts_on>date)
        else:rows=rows.filter(Contract.ends_on<date)
    elif status:rows=rows.filter(Contract.status==status)
    return rows

@router.get('/contracts/')
def list_contracts(page:Page=Depends(page_params),q:str|None=Query(None,max_length=80),
    status:Literal['pending','awaiting_approval','active','scheduled','expired','suspended','closed','cancelled']|None=None,
    sort_by:Literal['number','starts_on','ends_on','limit_cents']='number',sort_dir:Literal['asc','desc']='asc',
    db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    operational.require_action(ctx,'contratos.consultar')
    rows=filtered(db,ctx,q,status);col=getattr(Contract,sort_by)
    values=rows.order_by(col.desc() if sort_dir=='desc' else col.asc(),Contract.id).offset(page.offset).limit(page.per_page).all()
    return paginated([{**svc.public(c),'effective_status':svc.state(db,c)} for c in values],rows.count(),page)

@router.get('/contracts/export',response_class=Response)
def export_contracts(q:str|None=Query(None,max_length=80),
    status:Literal['pending','awaiting_approval','active','scheduled','expired','suspended','closed','cancelled']|None=None,
    db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    ctx=operational.current(db,ctx,'contratos.exportar');operational.require_action(ctx,'contratos.consultar')
    rows=filtered(db,ctx,q,status);operational.check_export_limit(rows.count(),'a busca e a situação')
    values=rows.order_by(Contract.number,Contract.id).all()
    for c in values:svc.event(db,ctx,c,'contratos.exportar',format='csv')
    response=operational.csv_response((('Número',lambda c:c.number),('Situação',lambda c:svc.state(db,c)),
        ('Início',lambda c:c.starts_on),('Término',lambda c:c.ends_on),('Valor em centavos',lambda c:c.limit_cents)),
        [(c,) for c in values],'contratos')
    db.commit();return response

@router.get('/contracts/{contract_id}')
def get_contract(contract_id:int,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    operational.require_action(ctx,'contratos.consultar');c=svc.get_contract(db,ctx,contract_id)
    return JSONResponse(jsonable_encoder(svc.detail(db,ctx,c)),headers={'ETag':etag(c.version)})

@router.post('/contracts/',status_code=201)
def create_contract(body:ContractInput,request:Request,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.create(db,ctx,request,body)

@router.put('/contracts/{contract_id}')
def update_contract(contract_id:int,body:ContractInput,request:Request,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.edit(db,ctx,contract_id,request,body)

@router.post('/contracts/{contract_id}/submit')
def submit_contract(contract_id:int,body:ReasonInput,request:Request,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.submit(db,ctx,contract_id,request,body)

@router.post('/contracts/{contract_id}/decisions')
def decide_contract(contract_id:int,body:DecisionInput,request:Request,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.decide(db,ctx,contract_id,request,body)

@router.post('/contracts/{contract_id}/withdraw')
def withdraw_approval(contract_id:int,body:ReasonInput,request:Request,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    ctx,c,claimed=svc.start(db,ctx,contract_id,'contratos.alterar',request,body.model_dump())
    if claimed.replay:return claimed.replay
    r=db.query(ApprovalRound).filter(ApprovalRound.id==c.approval_round_id,ApprovalRound.contract_id==c.id).with_for_update().first()
    if r is None or r.status!='pending':svc.fail('APPROVAL_NOT_PENDING','Não há aprovação pendente para retirar.')
    r.status='rejected';svc.bump(db,r)
    if r.amendment_id:
        from ..models.contracts import ContractAmendment
        a=db.get(ContractAmendment,r.amendment_id);a.status='rejected';svc.bump(db,a)
    else:c.status='pending'
    svc.bump(db,c)
    return svc.finish(db,ctx,c,claimed,'contratos.alterar',operation='withdraw_approval',reason=body.reason)

@router.post('/contracts/{contract_id}/amendments',status_code=201)
def amend_contract(contract_id:int,body:AmendmentInput,request:Request,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.propose_amendment(db,ctx,contract_id,request,body)

@router.post('/contracts/{contract_id}/status/{command}')
def contract_status(contract_id:int,command:Literal['suspend','resume','close','cancel'],body:ReasonInput,request:Request,
                    db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.change_status(db,ctx,contract_id,request,command,body)

@router.get('/contracts/{contract_id}/balance')
def contract_balance(contract_id:int,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    operational.require_action(ctx,'saldos.consultar');return svc.balance(db,svc.get_contract(db,ctx,contract_id))

@router.get('/contracts/{contract_id}/events')
def contract_events(contract_id:int,page:Page=Depends(page_params),db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    operational.require_action(ctx,'contratos.consultar');svc.get_contract(db,ctx,contract_id)
    where="customer_id=:customer AND object_type='contracts' AND object_id=:id"
    params=dict(customer=ctx.customer_id,id=str(contract_id),limit=page.per_page,offset=page.offset)
    total=db.execute(text('SELECT count(*) FROM audit_events WHERE '+where),params).scalar_one()
    rows=db.execute(text('SELECT id,action,result,actor_user_id,created_at,details FROM audit_events WHERE '+where+' ORDER BY id DESC LIMIT :limit OFFSET :offset'),params).mappings().all()
    return paginated([dict(r) for r in rows],total,page)

@router.get('/contract_commitments/')
def commitments(page:Page=Depends(page_params),contract_id:int|None=Query(None,gt=0),q:str|None=Query(None,max_length=80),
                status:Literal['active','cancelled']|None=None,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    operational.require_action(ctx,'empenhos.consultar');rows=svc.query(db,ContractCommitment,ctx)
    if contract_id:rows=rows.filter(ContractCommitment.contract_id==contract_id)
    if q:rows=rows.filter(ContractCommitment.number.ilike(operational.like(q.strip())))
    if status:rows=rows.filter(ContractCommitment.status==status)
    return paginated([svc.public(r) for r in rows.order_by(ContractCommitment.id.desc()).offset(page.offset).limit(page.per_page)],rows.count(),page)

@router.post('/contract_commitments/',status_code=201)
def create_commitment(body:CommitmentInput,request:Request,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.commitment(db,ctx,request,body)

@router.post('/contracts/{contract_id}/commitments/{commitment_id}/cancel')
def cancel_commitment(contract_id:int,commitment_id:int,body:ReasonInput,request:Request,
                      db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.cancel_commitment(db,ctx,contract_id,commitment_id,request,body)

@router.get('/contract_measurements/')
def measurements(page:Page=Depends(page_params),contract_id:int|None=Query(None,gt=0),
                 status:Literal['realized','reversed']|None=None,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    operational.require_action(ctx,'medicoes.consultar');rows=svc.query(db,ContractMeasurement,ctx)
    if contract_id:rows=rows.filter(ContractMeasurement.contract_id==contract_id)
    if status:rows=rows.filter(ContractMeasurement.status==status)
    return paginated([svc.public(r) for r in rows.order_by(ContractMeasurement.id.desc()).offset(page.offset).limit(page.per_page)],rows.count(),page)

@router.post('/contract_measurements/',status_code=201)
def create_measurement(body:MeasurementInput,request:Request,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.measurement(db,ctx,request,body)

@router.post('/contracts/{contract_id}/measurements/{measurement_id}/reverse')
def reverse_measurement(contract_id:int,measurement_id:int,body:ReasonInput,request:Request,
                        db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.reverse_measurement(db,ctx,contract_id,measurement_id,request,body)

@admin_router.get('/contract-approval-policies')
def policies(page:Page=Depends(page_params),contract_id:int|None=Query(None,gt=0),db:Session=Depends(get_db_session),ctx=Depends(customer_admin_context)):
    ctx=require_admin(ctx,'config.alcadas.consultar')
    rows=db.query(ContractPolicy).filter(ContractPolicy.customer_id==ctx.customer_id)
    if contract_id:rows=rows.filter(ContractPolicy.contract_id==contract_id)
    return paginated([svc.public(r) for r in rows.order_by(ContractPolicy.id).offset(page.offset).limit(page.per_page)],rows.count(),page)

@admin_router.put('/contract-approval-policies')
def save_policy(body:PolicyInput,request:Request,db:Session=Depends(get_db_session),ctx=Depends(customer_admin_context)):
    return svc.policy_write(db,ctx,request,body)

@admin_router.get('/contract-approval-options')
def approval_options(page:Page=Depends(page_params),q:str|None=Query(None,max_length=80),contract_id:int|None=Query(None,gt=0),
                     db:Session=Depends(get_db_session),ctx=Depends(customer_admin_context)):
    ctx=require_admin(ctx,'config.alcadas.consultar')
    rows=db.query(Contract).filter(Contract.customer_id==ctx.customer_id)
    if q:rows=rows.filter(Contract.number.ilike(operational.like(q.strip())))
    if contract_id:rows=rows.filter(Contract.id==contract_id)
    contracts=rows.order_by(Contract.number,Contract.id).offset(page.offset).limit(page.per_page).all()
    result=paginated([dict(id=c.id,number=c.number,municipal_office_id=c.municipal_office_id,limit_cents=c.limit_cents) for c in contracts],rows.count(),page)
    if contract_id:
        if not contracts:raise Problem(404,'NOT_FOUND')
        c=contracts[0]
        members=db.execute(text("SELECT u.id,u.name FROM customer_memberships m JOIN users u ON u.id=m.user_id WHERE m.customer_id=:id AND m.status='active' AND m.audience='internal' AND u.status='active' AND u.deleted_at IS NULL ORDER BY u.name,u.id"),dict(id=ctx.customer_id)).all()
        result['approvers']=[dict(id=m.id,name=m.name) for m in members if (p:=load_profile(db,customer_id=ctx.customer_id,user_id=m.id)) and p.allows('contratos.aprovar',c.municipal_office_id)]
    return result
''',encoding='utf-8')
print('Roteadores novos preparados, ainda não registrados no aplicativo.')
