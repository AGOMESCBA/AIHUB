"""Registro fiscal documental: vínculos não lançam valores no razão contratual."""
from sqlalchemy import and_,func,or_
from . import contracts as core,operational
from .http_contract import etag,respond
from ..models.contracts import Contract,ContractInvoice,ContractInvoiceLink,ContractMeasurement,ContractCommitment,ContractItem
from ..models.definitions import Supplier
from ..security.problems import Problem


def options(db,ctx,cid,commitment_id=None):
    for action in ('notas_fiscais.incluir','contratos.consultar','medicoes.consultar','empenhos.consultar'):
        operational.require_action(ctx,action)
    c=core.get_contract(db,ctx,cid)
    rows=db.query(ContractMeasurement,ContractCommitment,ContractItem).join(ContractCommitment,
        ContractCommitment.id==ContractMeasurement.commitment_id).join(ContractItem,ContractItem.id==ContractMeasurement.item_id).filter(
        ContractMeasurement.contract_id==c.id,ContractMeasurement.status=='realized')
    if commitment_id:rows=rows.filter(ContractMeasurement.commitment_id==commitment_id)
    sums=dict(db.query(ContractInvoiceLink.measurement_id,func.sum(ContractInvoiceLink.amount_cents)).join(
        ContractInvoice,ContractInvoice.id==ContractInvoiceLink.invoice_id).filter(ContractInvoice.contract_id==c.id,
        ContractInvoice.status=='registered').group_by(ContractInvoiceLink.measurement_id).all())
    values=[dict(id=m.id,commitment_id=e.id,commitment_number=e.number,item_description=i.description,
                 date=m.date,amount_cents=m.amount_cents,invoiced_cents=int(sums.get(m.id,0)),
                 available_cents=m.amount_cents-int(sums.get(m.id,0))) for m,e,i in rows.order_by(ContractMeasurement.id)]
    supplier=db.get(Supplier,c.supplier_id)
    return dict(contract_id=c.id,contract_number=c.number,contract_version=c.version,
        supplier_name=supplier.company_name if supplier else None,balance=core.balance(db,c),
        items=[v for v in values if v['available_cents']>0])


def view(db,ctx,i,full=False,c=None,supplier=None):
    c=c or core.get_contract(db,ctx,i.contract_id)
    supplier=supplier or db.get(Supplier,i.supplier_id)
    result={**core.public(i),'contract_number':c.number,'contract_version':c.version,
            'supplier_name':supplier.company_name if supplier else None}
    if full:
        lines=[]
        for link,m,e,item in db.query(ContractInvoiceLink,ContractMeasurement,ContractCommitment,ContractItem).join(
            ContractMeasurement,ContractMeasurement.id==ContractInvoiceLink.measurement_id).join(
            ContractCommitment,ContractCommitment.id==ContractMeasurement.commitment_id).join(
            ContractItem,ContractItem.id==ContractMeasurement.item_id).filter(ContractInvoiceLink.invoice_id==i.id).order_by(ContractInvoiceLink.id):
            data={'measurement_id':m.id,'amount_cents':link.amount_cents}
            if ctx.profile.allows('medicoes.consultar',c.municipal_office_id):
                data.update(item_description=item.description,measurement_date=m.date,measurement_status=m.status)
            if ctx.profile.allows('empenhos.consultar',c.municipal_office_id):
                data.update(commitment_id=e.id,commitment_number=e.number)
            lines.append(data)
        result['allocations']=lines
        result['balance']=core.balance(db,c)
    return result


def get(db,ctx,iid):
    operational.require_action(ctx,'notas_fiscais.consultar')
    i=core.query(db,ContractInvoice,ctx).filter(ContractInvoice.id==iid).first()
    if i is None:raise Problem(404,'NOT_FOUND')
    return i


def create(db,ctx,request,body):
    ctx,c,claimed=core.start(db,ctx,body.contract_id,'notas_fiscais.incluir',request,body.model_dump(mode='json'))
    if claimed.replay:return claimed.replay
    for action in ('notas_fiscais.consultar','empenhos.consultar','medicoes.consultar'):
        operational.require_action(ctx,action)
    if c.status not in ('approved','suspended','closed'):
        core.fail('INVOICE_CONTRACT_INVALID','A nota deve referenciar a execução de um contrato aprovado.')
    if body.issued_on>core.today(db):raise Problem(422,'INVOICE_DATE_FUTURE','A emissão não pode estar no futuro.')
    duplicate=db.query(ContractInvoice).filter(ContractInvoice.customer_id==ctx.customer_id,ContractInvoice.status=='registered',or_(
        and_(ContractInvoice.supplier_id==c.supplier_id,ContractInvoice.document_type==body.document_type,
             ContractInvoice.number==body.number,ContractInvoice.series==body.series),
        ContractInvoice.access_key==body.access_key if body.access_key else False)).first()
    if duplicate:core.fail('INVOICE_DUPLICATE','Documento já registrado neste órgão. Confira fornecedor, tipo, série, número e chave.')
    available={v['id']:v for v in options(db,ctx,c.id)['items']}
    for line in body.allocations:
        if line.measurement_id not in available:raise Problem(422,'INVOICE_MEASUREMENT_INVALID','Medição indisponível ou sem valor disponível neste contrato.')
        if line.amount_cents>available[line.measurement_id]['available_cents']:
            core.fail('INVOICE_MEASUREMENT_EXCEEDED','O vínculo supera o valor da medição ainda não documentado por notas ativas.')
    values=body.model_dump(exclude={'allocations'})
    i=ContractInvoice(**values,supplier_id=c.supplier_id,**core.owner(ctx));db.add(i);db.flush()
    for line in body.allocations:db.add(ContractInvoiceLink(**line.model_dump(),invoice_id=i.id,contract_id=c.id,**core.owner(ctx)))
    core.bump(db,c);db.flush()
    core.event(db,ctx,c,'notas_fiscais.incluir',invoice_id=i.id,amount_cents=i.amount_cents,measurement_ids=[l.measurement_id for l in body.allocations])
    return respond(db,201,view(db,ctx,i,True,c),headers={'ETag':etag(c.version)},claimed=claimed)


def cancel(db,ctx,cid,iid,request,body):
    ctx,c,claimed=core.start(db,ctx,cid,'notas_fiscais.cancelar',request,body.model_dump())
    if claimed.replay:return claimed.replay
    operational.require_action(ctx,'notas_fiscais.consultar')
    i=core.query(db,ContractInvoice,ctx).filter(ContractInvoice.id==iid,ContractInvoice.contract_id==c.id).with_for_update().first()
    if i is None:raise Problem(404,'NOT_FOUND')
    if i.status!='registered':core.fail('INVOICE_CANCELLED','O registro desta nota já está cancelado.')
    i.status='cancelled';i.cancel_reason=body.reason;i.cancelled_by=ctx.user_id
    i.cancelled_at=db.execute(__import__('sqlalchemy').text('SELECT clock_timestamp()')).scalar_one()
    core.bump(db,i);core.bump(db,c);db.flush()
    core.event(db,ctx,c,'notas_fiscais.cancelar',invoice_id=i.id,reason=body.reason)
    return respond(db,200,view(db,ctx,i,True,c),headers={'ETag':etag(c.version)},claimed=claimed)
