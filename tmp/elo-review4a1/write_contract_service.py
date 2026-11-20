from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
p=R/'apps/api/app/services/contracts.py';assert not p.exists()
p.write_text('''"""Serviço transacional 4B/4C; não reutiliza os saldos legados da secretaria.

Ordem de bloqueios: administração do órgão → contrato → operação filha.
Cada gravação relê autorização depois dos bloqueios; sucesso e auditoria são atômicos.
"""
from dataclasses import replace
from decimal import Decimal
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, inspect, text
from . import operational, access_service
from .audit import record
from .contract_finance import ContractPosition, CommitmentPosition, FinancialRuleError, item_total
from .http_contract import claim, etag, require_if_match, respond
from ..models.contracts import (Contract,ContractItem,ContractPolicy,ContractAmendment,ApprovalRound,
    ApprovalVote,ContractCommitment,ContractMeasurement,ContractLedger)
from ..models.definitions import Supplier,Product,MeasurementUnit
from ..security.authorization import load_profile
from ..security.authentication import HumanPrincipal
from ..security.context import require_admin,require_customer_not_revoked
from ..security.problems import Problem


def fail(code,detail):raise Problem(409,code,detail)
def public(row):return {c.key:getattr(row,c.key) for c in inspect(type(row)).column_attrs}
def today(db):return db.execute(text('SELECT current_date')).scalar_one()
def query(db,model,ctx):
    return db.query(model).filter(model.customer_id==ctx.customer_id,model.municipal_office_id==operational.office_of(ctx))
def bump(db,row):
    row.version+=1
    row.updated_at=db.execute(text('SELECT clock_timestamp()')).scalar_one()
def owner(ctx):return dict(customer_id=ctx.customer_id,municipal_office_id=operational.office_of(ctx),created_by=ctx.user_id)
def event(db,ctx,c,action,**details):
    record(db,action=action,result='success',actor_user_id=ctx.user_id,customer_id=ctx.customer_id,
           object_type='contracts',object_id=c.id,details={'secretaria_da_operacao':c.municipal_office_id,**details})
def get_contract(db,ctx,cid,locked=False):
    q=query(db,Contract,ctx).filter(Contract.id==cid)
    if locked:q=q.with_for_update().populate_existing()
    c=q.first()
    if c is None:raise Problem(404,'NOT_FOUND')
    return c
def start(db,ctx,cid,action,request,body):
    operational.require_action(ctx,action)
    ctx=operational.current(db,ctx,action)
    c=get_contract(db,ctx,cid,True)
    ctx=operational.current(db,ctx,action)
    claimed=claim(db,request,user_id=ctx.user_id,customer_id=ctx.customer_id,body=body)
    if not claimed.replay:require_if_match(request,c.version)
    return ctx,c,claimed
def finish(db,ctx,c,claimed,action,status=200,**details):
    db.flush()
    event(db,ctx,c,action,**details)
    db.flush()
    return respond(db,status,detail(db,ctx,c),headers={'ETag':etag(c.version)},claimed=claimed)
def item_rows(db,c):return db.query(ContractItem).filter(ContractItem.contract_id==c.id).order_by(ContractItem.id).all()
def sum_cents(db,model,cid):
    state='active' if model is ContractCommitment else 'realized'
    return int(db.query(func.coalesce(func.sum(model.amount_cents),0)).filter(model.contract_id==cid,model.status==state).scalar())
def position(db,c):return ContractPosition(c.limit_cents,sum_cents(db,ContractCommitment,c.id),sum_cents(db,ContractMeasurement,c.id))
def balance(db,c):
    p=position(db,c)
    return dict(limit_cents=p.limit_cents,committed_cents=p.committed_cents,realized_cents=p.realized_cents,
                available_to_commit_cents=p.available_to_commit_cents,committed_to_realize_cents=p.committed_to_realize_cents)
def state(db,c):
    if c.status!='approved':return c.status
    now=today(db)
    return 'scheduled' if now<c.starts_on else 'expired' if now>c.ends_on else 'active'
def detail(db,ctx,c):
    r=public(c);r['effective_status']=state(db,c);r['balance']=balance(db,c)
    r['items']=[public(i) for i in item_rows(db,c)]
    for i in r['items']:
        qty,amount=db.query(func.coalesce(func.sum(ContractMeasurement.quantity),0),func.coalesce(func.sum(ContractMeasurement.amount_cents),0)).filter(ContractMeasurement.item_id==i['id'],ContractMeasurement.status=='realized').one()
        i['realized_quantity']=str(qty);i['realized_cents']=int(amount)
    rounds=db.query(ApprovalRound).filter(ApprovalRound.contract_id==c.id).order_by(ApprovalRound.id).all()
    r['approval_rounds']=[{**public(a),'votes':[public(v) for v in db.query(ApprovalVote).filter(ApprovalVote.round_id==a.id).order_by(ApprovalVote.id)]} for a in rounds]
    r['amendments']=[public(a) for a in db.query(ContractAmendment).filter(ContractAmendment.contract_id==c.id).order_by(ContractAmendment.id)]
    r['commitments']=[public(a) for a in db.query(ContractCommitment).filter(ContractCommitment.contract_id==c.id).order_by(ContractCommitment.id)]
    r['measurements']=[public(a) for a in db.query(ContractMeasurement).filter(ContractMeasurement.contract_id==c.id).order_by(ContractMeasurement.id)]
    r['ledger']=[public(a) for a in db.query(ContractLedger).filter(ContractLedger.contract_id==c.id).order_by(ContractLedger.id)]
    return r
def active(db,c):
    if state(db,c)!='active':fail('CONTRACT_NOT_ACTIVE','O contrato deve estar aprovado, vigente e sem suspensão.')
def financial(call,*args):
    try:return call(*args)
    except FinancialRuleError as exc:raise Problem(409,exc.code,'A operação excede o saldo ou tem valores inválidos.') from exc
def items_from_input(db,ctx,entries):
    rows=[]
    for entry in entries:
        product=db.get(Product,entry.product_id)
        office=operational.office_of(ctx)
        if (product is None or product.status!='active' or
            not (product.owner_kind=='platform' or product.customer_id==ctx.customer_id and
                 (product.scope_mode=='customer' or product.municipal_office_id==office))):
            raise Problem(422,'REFERENCE_INVALID','Produto indisponível neste contexto.')
        unit=db.get(MeasurementUnit,product.unit_id)
        if unit is None or unit.status!='active':raise Problem(422,'REFERENCE_INVALID','Unidade de medida indisponível.')
        total=financial(item_total,entry.quantity,entry.unit_price_cents)
        rows.append(dict(product_id=product.id,product_version=product.version,description=product.name,
                         unit_snapshot=f'{unit.code} — {unit.name}',quantity=Decimal(entry.quantity),
                         unit_price_cents=entry.unit_price_cents,total_cents=total))
    financial(ContractPosition,sum(i['total_cents'] for i in rows))
    return rows
def check_supplier(db,ctx,sid):
    s=db.get(Supplier,sid)
    if s is None or s.customer_id!=ctx.customer_id or s.status!='active' or (s.scope_mode!='customer' and s.municipal_office_id!=operational.office_of(ctx)):
        raise Problem(422,'REFERENCE_INVALID','Fornecedor indisponível nesta secretaria.')
def create(db,ctx,request,body):
    ctx=operational.current(db,ctx,'contratos.incluir')
    claimed=claim(db,request,user_id=ctx.user_id,customer_id=ctx.customer_id,body=body.model_dump(mode='json'))
    if claimed.replay:return claimed.replay
    check_supplier(db,ctx,body.supplier_id)
    entries=items_from_input(db,ctx,body.items)
    c=Contract(**body.model_dump(exclude={'items'}),**owner(ctx),limit_cents=sum(i['total_cents'] for i in entries))
    db.add(c);db.flush()
    for i in entries:db.add(ContractItem(**i,contract_id=c.id,**owner(ctx)))
    return finish(db,ctx,c,claimed,'contratos.incluir',201)
def edit(db,ctx,cid,request,body):
    ctx,c,claimed=start(db,ctx,cid,'contratos.alterar',request,body.model_dump(mode='json'))
    if claimed.replay:return claimed.replay
    if c.status!='pending':fail('CONTRACT_NOT_DRAFT','Somente contratos pendentes podem ser editados; use aditivo para contrato aprovado.')
    check_supplier(db,ctx,body.supplier_id);entries=items_from_input(db,ctx,body.items)
    for k,v in body.model_dump(exclude={'items'}).items():setattr(c,k,v)
    c.limit_cents=sum(i['total_cents'] for i in entries);bump(db,c)
    db.query(ContractItem).filter(ContractItem.contract_id==c.id).delete(synchronize_session=False)
    for i in entries:db.add(ContractItem(**i,contract_id=c.id,**owner(ctx)))
    return finish(db,ctx,c,claimed,'contratos.alterar')

def eligible(db,ctx,c,levels,amount,author,allow_self):
    result=[]
    for config in levels:
        if amount<config['minimum_cents']:continue
        users=[]
        for a in config['approvers']:
            if amount>a['limit_cents'] or (not allow_self and a['user_id']==author):continue
            profile=load_profile(db,customer_id=ctx.customer_id,user_id=a['user_id'])
            if profile and profile.allows('contratos.aprovar',c.municipal_office_id):users.append(a)
        if not users:fail('APPROVAL_LEVEL_UNCOVERED','Há nível obrigatório sem aprovador ativo com alçada suficiente.')
        result.append({**config,'approvers':users})
    if not result:fail('APPROVAL_POLICY_MISSING','Não há nível de aprovação aplicável ao valor do contrato.')
    return result
def make_round(db,ctx,c,amount,snapshot,amendment=None):
    policy=db.query(ContractPolicy).filter(ContractPolicy.contract_id==c.id).first()
    if policy is None:fail('APPROVAL_POLICY_MISSING','Cadastre as alçadas deste contrato na Administração antes de submeter.')
    levels=eligible(db,ctx,c,policy.levels,amount,ctx.user_id,policy.allow_self_approval)
    r=ApprovalRound(**owner(ctx),contract_id=c.id,amendment_id=amendment,amount_cents=amount,
                    levels=levels,snapshot=jsonable_encoder({'policy_version':policy.version,**snapshot}),
                    allow_self_approval=policy.allow_self_approval)
    db.add(r);db.flush();c.approval_round_id=r.id
    return r
def submit(db,ctx,cid,request,body):
    ctx,c,claimed=start(db,ctx,cid,'contratos.ativar',request,body.model_dump())
    if claimed.replay:return claimed.replay
    if c.status!='pending':fail('CONTRACT_NOT_DRAFT','O contrato não está pendente.')
    if c.ends_on<today(db):fail('CONTRACT_EXPIRED','A vigência terminou; revise o contrato antes da submissão.')
    check_supplier(db,ctx,c.supplier_id)
    rows=item_rows(db,c)
    make_round(db,ctx,c,c.limit_cents,{'contract':public(c),'items':[public(i) for i in rows]})
    c.status='awaiting_approval';bump(db,c)
    return finish(db,ctx,c,claimed,'contratos.ativar',reason=body.reason)
def propose_amendment(db,ctx,cid,request,body):
    ctx,c,claimed=start(db,ctx,cid,'contratos.aditar',request,body.model_dump(mode='json'))
    if claimed.replay:return claimed.replay
    if c.status not in ('approved','suspended'):fail('CONTRACT_NOT_APPROVED','O contrato precisa estar aprovado para receber aditivo.')
    if db.query(ApprovalRound.id).filter(ApprovalRound.contract_id==c.id,ApprovalRound.status=='pending').first():
        fail('AMENDMENT_PENDING','Já existe aprovação pendente para este contrato.')
    changes={a.item_id:a.new_quantity for a in body.changes};rows=item_rows(db,c)
    if set(changes)-{i.id for i in rows}:raise Problem(422,'REFERENCE_INVALID','Item não pertence ao contrato.')
    snapshot=[];limit=0
    for i in rows:
        qty=changes.get(i.id,str(i.quantity));total=financial(item_total,qty,i.unit_price_cents)
        used=db.query(func.coalesce(func.sum(ContractMeasurement.quantity),0)).filter(ContractMeasurement.item_id==i.id,ContractMeasurement.status=='realized').scalar()
        if Decimal(qty)<used:fail('ITEM_ALREADY_CONSUMED','A quantidade proposta é inferior à quantidade realizada.')
        limit+=total;snapshot.append(dict(item_id=i.id,new_quantity=qty,total_cents=total))
    financial(position(db,c).with_amended_limit,limit)
    end=body.new_ends_on or c.ends_on
    if end<c.starts_on or end<today(db):fail('INVALID_AMENDMENT_DATE','O término proposto não pode anteceder o início nem a data atual.')
    a=ContractAmendment(**owner(ctx),contract_id=c.id,reason=body.reason,changes=snapshot,
                        new_ends_on=end,resulting_limit_cents=limit)
    db.add(a);db.flush()
    make_round(db,ctx,c,limit,{'amendment':public(a),'previous_limit_cents':c.limit_cents},a.id)
    bump(db,c)
    return finish(db,ctx,c,claimed,'contratos.aditar',201,amendment_id=a.id,reason=body.reason)
def decide(db,ctx,cid,request,body):
    ctx,c,claimed=start(db,ctx,cid,'contratos.aprovar',request,body.model_dump())
    if claimed.replay:return claimed.replay
    r=db.query(ApprovalRound).filter(ApprovalRound.id==c.approval_round_id,ApprovalRound.contract_id==c.id).with_for_update().populate_existing().first()
    if r is None or r.status!='pending':fail('APPROVAL_NOT_PENDING','Não há aprovação pendente.')
    if not r.allow_self_approval and ctx.user_id==r.created_by:raise Problem(403,'SELF_APPROVAL_FORBIDDEN','O fluxo não permite aprovar a própria submissão.')
    level=r.levels[r.current_level-1]
    if not any(a['user_id']==ctx.user_id and a['limit_cents']>=r.amount_cents for a in level['approvers']):
        raise Problem(403,'APPROVER_NOT_CURRENT_LEVEL','Você não é aprovador habilitado do nível atual.')
    if db.query(ApprovalVote.id).filter(ApprovalVote.round_id==r.id,ApprovalVote.level==r.current_level,ApprovalVote.created_by==ctx.user_id).first():
        fail('APPROVAL_ALREADY_DECIDED','Sua decisão neste nível já foi registrada.')
    db.add(ApprovalVote(**owner(ctx),contract_id=c.id,round_id=r.id,level=r.current_level,decision=body.decision,reason=body.reason));db.flush()
    if body.decision=='reject':
        r.status='rejected'
        if r.amendment_id:db.get(ContractAmendment,r.amendment_id).status='rejected'
        else:c.status='pending'
    else:
        voters={v.created_by for v in db.query(ApprovalVote).filter(ApprovalVote.round_id==r.id,ApprovalVote.level==r.current_level,ApprovalVote.decision=='approve')}
        complete=level['mode']=='any' or all(a['user_id'] in voters for a in level['approvers'])
        if complete:
            if r.current_level<len(r.levels):r.current_level+=1
            else:
                r.status='approved'
                if r.amendment_id:
                    a=db.get(ContractAmendment,r.amendment_id)
                    # Durante a análise, a versão vigente pode ter sido consumida. Valida novamente após os bloqueios.
                    financial(position(db,c).with_amended_limit,a.resulting_limit_cents)
                    for change in a.changes:
                        i=db.get(ContractItem,change['item_id'])
                        qty=db.query(func.coalesce(func.sum(ContractMeasurement.quantity),0)).filter(ContractMeasurement.item_id==i.id,ContractMeasurement.status=='realized').scalar()
                        if Decimal(change['new_quantity'])<qty:fail('ITEM_ALREADY_CONSUMED','O consumo atual supera a quantidade proposta no aditivo.')
                    c.limit_cents=a.resulting_limit_cents;db.flush()
                    for change in a.changes:
                        i=db.get(ContractItem,change['item_id']);i.quantity=Decimal(change['new_quantity']);i.total_cents=change['total_cents'];bump(db,i)
                    c.ends_on=a.new_ends_on;a.status='approved';bump(db,a)
                    db.add(ContractLedger(**owner(ctx),contract_id=c.id,kind='amendment',source_id=a.id,
                        amount_cents=c.limit_cents-r.snapshot['previous_limit_cents'],reason=a.reason))
                else:c.status='approved'
    bump(db,r);bump(db,c)
    return finish(db,ctx,c,claimed,'contratos.aprovar',round_id=r.id,level=r.current_level,decision=body.decision,reason=body.reason)

def change_status(db,ctx,cid,request,target,body):
    action={'suspend':'contratos.cancelar','resume':'contratos.ativar','close':'contratos.encerrar','cancel':'contratos.cancelar'}[target]
    ctx,c,claimed=start(db,ctx,cid,action,request,body.model_dump())
    if claimed.replay:return claimed.replay
    allowed={'suspend':('approved',),'resume':('suspended',),'close':('approved','suspended'),'cancel':('pending','approved','suspended')}
    if c.status not in allowed[target]:fail('CONTRACT_STATE_INVALID','Transição indisponível para a situação atual.')
    if db.query(ApprovalRound.id).filter(ApprovalRound.contract_id==c.id,ApprovalRound.status=='pending').first():
        fail('APPROVAL_PENDING','Conclua a aprovação pendente antes de mudar a situação.')
    if target in ('close','cancel'):
        p=position(db,c)
        if p.committed_to_realize_cents or target=='cancel' and p.realized_cents:fail('CONTRACT_HAS_BALANCE_OPERATIONS','Regularize empenhos e realizações antes de encerrar ou cancelar.')
    c.status={'suspend':'suspended','resume':'approved','close':'closed','cancel':'cancelled'}[target];bump(db,c)
    return finish(db,ctx,c,claimed,action,operation=target,reason=body.reason)

def ledger(db,ctx,c,kind,source,amount,reason):
    db.add(ContractLedger(**owner(ctx),contract_id=c.id,kind=kind,source_id=source,amount_cents=amount,reason=reason))
def commitment(db,ctx,request,body):
    ctx,c,claimed=start(db,ctx,body.contract_id,'empenhos.incluir',request,body.model_dump(mode='json'))
    if claimed.replay:return claimed.replay
    active(db,c)
    if not c.starts_on<=body.date<=min(c.ends_on,today(db)):fail('DATE_OUTSIDE_CONTRACT','Data do empenho fora da vigência ou futura.')
    financial(position(db,c).reserve,body.amount_cents)
    e=ContractCommitment(**body.model_dump(),**owner(ctx));db.add(e);db.flush();bump(db,c)
    ledger(db,ctx,c,'commitment',e.id,e.amount_cents,body.authorization_reference)
    return finish(db,ctx,c,claimed,'empenhos.incluir',201,commitment_id=e.id)
def cancel_commitment(db,ctx,cid,eid,request,body):
    ctx,c,claimed=start(db,ctx,cid,'empenhos.cancelar',request,body.model_dump())
    if claimed.replay:return claimed.replay
    e=query(db,ContractCommitment,ctx).filter(ContractCommitment.id==eid,ContractCommitment.contract_id==cid).with_for_update().first()
    if e is None:raise Problem(404,'NOT_FOUND')
    if e.status!='active':fail('COMMITMENT_CANCELLED','Empenho já cancelado.')
    used=db.query(func.coalesce(func.sum(ContractMeasurement.amount_cents),0)).filter(ContractMeasurement.commitment_id==eid,ContractMeasurement.status=='realized').scalar()
    if used:fail('COMMITMENT_HAS_MEASUREMENTS','Estorne as medições antes de cancelar o empenho.')
    e.status='cancelled';bump(db,e);bump(db,c)
    ledger(db,ctx,c,'commitment_cancel',e.id,-e.amount_cents,body.reason)
    return finish(db,ctx,c,claimed,'empenhos.cancelar',commitment_id=e.id,reason=body.reason)
def measurement(db,ctx,request,body):
    ctx,c,claimed=start(db,ctx,body.contract_id,'medicoes.incluir',request,body.model_dump(mode='json'))
    if claimed.replay:return claimed.replay
    active(db,c)
    e=query(db,ContractCommitment,ctx).filter(ContractCommitment.id==body.commitment_id,ContractCommitment.contract_id==c.id,ContractCommitment.status=='active').first()
    i=query(db,ContractItem,ctx).filter(ContractItem.id==body.item_id,ContractItem.contract_id==c.id).first()
    if e is None or i is None:raise Problem(422,'REFERENCE_INVALID','Item ou empenho indisponível neste contrato.')
    if not max(c.starts_on,e.date)<=body.date<=min(c.ends_on,today(db)):fail('DATE_OUTSIDE_CONTRACT','Data da medição fora da vigência, futura ou anterior ao empenho.')
    qty,used=db.query(func.coalesce(func.sum(ContractMeasurement.quantity),0),func.coalesce(func.sum(ContractMeasurement.amount_cents),0)).filter(ContractMeasurement.item_id==i.id,ContractMeasurement.status=='realized').one()
    new_qty=qty+Decimal(body.quantity)
    if new_qty>i.quantity:fail('INSUFFICIENT_ITEM_QUANTITY','Quantidade superior ao saldo do item.')
    amount=financial(item_total,str(new_qty),i.unit_price_cents)-int(used)
    if amount<=0:fail('MEASUREMENT_BELOW_CENT','A quantidade deve resultar em valor positivo em centavos.')
    realized=db.query(func.coalesce(func.sum(ContractMeasurement.amount_cents),0)).filter(ContractMeasurement.commitment_id==e.id,ContractMeasurement.status=='realized').scalar()
    financial(position(db,c).realize,CommitmentPosition(e.amount_cents,int(realized)),amount)
    m=ContractMeasurement(**body.model_dump(exclude={'quantity'}),quantity=Decimal(body.quantity),amount_cents=amount,**owner(ctx));db.add(m);db.flush();bump(db,c)
    ledger(db,ctx,c,'measurement',m.id,amount,body.attestation_reference)
    return finish(db,ctx,c,claimed,'medicoes.incluir',201,measurement_id=m.id)
def reverse_measurement(db,ctx,cid,mid,request,body):
    ctx,c,claimed=start(db,ctx,cid,'saldos.estornar',request,body.model_dump())
    if claimed.replay:return claimed.replay
    if c.status in ('closed','cancelled'):fail('CONTRACT_STATE_INVALID','Reabra o processo administrativo antes de estornar um contrato finalizado.')
    m=query(db,ContractMeasurement,ctx).filter(ContractMeasurement.id==mid,ContractMeasurement.contract_id==cid).with_for_update().first()
    if m is None:raise Problem(404,'NOT_FOUND')
    if m.status!='realized':fail('MEASUREMENT_ALREADY_REVERSED','Medição já estornada.')
    m.status='reversed';bump(db,m);bump(db,c)
    ledger(db,ctx,c,'measurement_reverse',m.id,-m.amount_cents,body.reason)
    return finish(db,ctx,c,claimed,'saldos.estornar',measurement_id=m.id,reason=body.reason)

def admin_current(db,ctx,action,office=None):
    access_service.lock_administration(db,ctx.customer_id)
    if db.execute(text('SELECT elo_request_user_id()')).scalar()!=ctx.user_id:raise Problem(401,'AUTHENTICATION_REQUIRED')
    require_customer_not_revoked(db,HumanPrincipal(ctx.user_id,db.info['elo_session_id']),ctx.customer_id)
    profile=load_profile(db,customer_id=ctx.customer_id,user_id=ctx.user_id)
    if profile is None:raise Problem(403,'ACTION_FORBIDDEN')
    return require_admin(replace(ctx,profile=profile),action,office)
def policy_write(db,ctx,request,body):
    ctx=admin_current(db,ctx,'config.alcadas.alterar')
    c=db.query(Contract).filter(Contract.id==body.contract_id,Contract.customer_id==ctx.customer_id).with_for_update().populate_existing().first()
    if c is None:raise Problem(404,'NOT_FOUND')
    ctx=admin_current(db,ctx,'config.alcadas.alterar',c.municipal_office_id)
    claimed=claim(db,request,user_id=ctx.user_id,customer_id=ctx.customer_id,body=body.model_dump())
    if claimed.replay:return claimed.replay
    if db.query(ApprovalRound.id).filter(ApprovalRound.contract_id==c.id,ApprovalRound.status=='pending').first():
        fail('APPROVAL_PENDING','As alçadas não podem mudar enquanto houver aprovação pendente.')
    for level in body.levels:
        for a in level.approvers:
            p=load_profile(db,customer_id=ctx.customer_id,user_id=a.user_id)
            if p is None or not p.allows('contratos.aprovar',c.municipal_office_id):
                raise Problem(422,'APPROVER_INVALID','Há aprovador sem vínculo ou permissão válida na secretaria do contrato.')
    p=db.query(ContractPolicy).filter(ContractPolicy.contract_id==c.id).first()
    if p is not None:require_if_match(request,p.version);bump(db,p)
    else:
        if request.headers.get('If-Match') is not None:raise Problem(412,'PRECONDITION_FAILED')
        p=ContractPolicy(customer_id=c.customer_id,municipal_office_id=c.municipal_office_id,created_by=ctx.user_id,contract_id=c.id);db.add(p)
    p.levels=[l.model_dump() for l in body.levels];p.allow_self_approval=body.allow_self_approval;db.flush()
    event(db,ctx,c,'config.alcadas.alterar',policy_id=p.id,version=p.version,levels=p.levels,allow_self_approval=p.allow_self_approval)
    return respond(db,200,public(p),headers={'ETag':etag(p.version)},claimed=claimed)
''',encoding='utf-8')
print('Serviço novo de contratos preparado.')
