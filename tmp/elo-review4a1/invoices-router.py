"""Notas fiscais documentam medições; não emitem documento nem movimentam saldo."""
from datetime import date
from typing import Literal
from fastapi import APIRouter,Depends,Query,Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from ..dependencies import get_db_session
from ..models.contracts import ContractInvoice,Contract
from ..models.definitions import Supplier
from ..schemas.contracts import InvoiceInput,ReasonInput
from ..security.context import org_context
from ..security.problems import Problem
from ..services import invoices as svc,contracts as core,operational
from ..services.http_contract import Page,page_params,paginated,etag

router=APIRouter(tags=['Notas fiscais da execução contratual'])

@router.get('/contract_invoices/')
def list_invoices(page:Page=Depends(page_params),contract_id:int|None=Query(None,gt=0),
                  q:str|None=Query(None,max_length=80),status:Literal['registered','cancelled']|None=None,
                  date_from:date|None=None,date_to:date|None=None,
                  db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    operational.require_action(ctx,'notas_fiscais.consultar')
    if date_from and date_to and date_from>date_to:raise Problem(422,'DATE_RANGE_INVALID','Período inválido.')
    rows=core.query(db,ContractInvoice,ctx).join(Contract,Contract.id==ContractInvoice.contract_id).outerjoin(Supplier,Supplier.id==ContractInvoice.supplier_id)
    if contract_id:rows=rows.filter(ContractInvoice.contract_id==contract_id)
    if q:rows=rows.filter(ContractInvoice.number.ilike(operational.like(q.strip())))
    if status:rows=rows.filter(ContractInvoice.status==status)
    if date_from:rows=rows.filter(ContractInvoice.issued_on>=date_from)
    if date_to:rows=rows.filter(ContractInvoice.issued_on<=date_to)
    total=rows.count()
    rows=rows.add_entity(Contract).add_entity(Supplier).order_by(ContractInvoice.id.desc()).offset(page.offset).limit(page.per_page)
    return paginated([svc.view(db,ctx,i,c=c,supplier=s) for i,c,s in rows],total,page)

@router.get('/contract_invoices/measurement-options')
def measurement_options(contract_id:int=Query(gt=0),commitment_id:int|None=Query(None,gt=0),
                        db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    result=svc.options(db,ctx,contract_id,commitment_id)
    return JSONResponse(jsonable_encoder(result),headers={'ETag':etag(result['contract_version'])})

@router.get('/contract_invoices/{invoice_id}')
def get_invoice(invoice_id:int,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    result=svc.view(db,ctx,svc.get(db,ctx,invoice_id),True)
    return JSONResponse(jsonable_encoder(result),headers={'ETag':etag(result['contract_version'])})

@router.post('/contract_invoices/',status_code=201)
def create_invoice(body:InvoiceInput,request:Request,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.create(db,ctx,request,body)

@router.post('/contracts/{contract_id}/invoices/{invoice_id}/cancel')
def cancel_invoice(contract_id:int,invoice_id:int,body:ReasonInput,request:Request,
                   db:Session=Depends(get_db_session),ctx=Depends(org_context)):
    return svc.cancel(db,ctx,contract_id,invoice_id,request,body)
