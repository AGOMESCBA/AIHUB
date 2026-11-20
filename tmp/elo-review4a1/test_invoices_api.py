"""Amostra fiscal: API real e banco descartável; sem liquidação ou pagamento."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date,timedelta
from uuid import uuid4
import pytest
from sqlalchemy import text
from test_contracts_api import (api,disposable_database,pytestmark,finance,approved,commitment,measurement,command,get,_h,_key)
from test_fase3_foundation import _insert

def executed(finance):
    a=finance['api'];c=approved(finance)
    r=commitment(a,c);assert r.status_code==201,r.text;c=r.json();eid=c['commitments'][0]['id']
    r=measurement(a,c,eid,'30');assert r.status_code==201,r.text
    return r.json()

def body(c,amount=30000):
    return dict(contract_id=c['id'],document_type='nfse',number=uuid4().hex,series='',issued_on=str(date.today()),
        amount_cents=amount,allocations=[dict(measurement_id=c['measurements'][0]['id'],amount_cents=amount)])

def create(a,c,b,key=None):
    return a['client'].post('/contract_invoices/',json=b,headers=_h(a,'tgtSelf','A','A1',**{'If-Match':f'"v{c["version"]}"','Idempotency-Key':key or _key()}))

def test_register_cancel_replay_preserves_three_balances_and_protects_reversal(finance):
    a=finance['api'];c=executed(finance);before=c['balance'];ledger=len(c['ledger']);b=body(c,20000);key=_key()
    r=create(a,c,b,key);assert r.status_code==201,r.text;i=r.json();iid=i['id']
    replay=create(a,c,b,key);assert replay.status_code==201 and replay.json()['id']==iid and replay.headers['idempotent-replayed']=='true'
    c=get(a,c);assert c['balance']==before and len(c['ledger'])==ledger
    options=a['client'].get('/contract_invoices/measurement-options',params={'contract_id':c['id']},headers=_h(a,'tgtSelf','A','A1'))
    assert options.status_code==200,options.text
    assert options.json()['items'][0]['available_cents']==10000
    r=command(a,c,f'measurements/{c["measurements"][0]["id"]}/reverse','tgtSelf');assert r.status_code==409 and r.json()['code']=='MEASUREMENT_HAS_INVOICE'
    url=f'/contracts/{c["id"]}/invoices/{iid}/cancel';h=_h(a,'tgtSelf','A','A1',**{'If-Match':f'"v{c["version"]}"','Idempotency-Key':_key()})
    r=a['client'].post(url,json={'reason':'Correção do registro interno'},headers=h);assert r.status_code==200,r.text
    assert r.json()['status']=='cancelled' and r.json()['cancel_reason']
    assert a['client'].post(url,json={'reason':'Correção do registro interno'},headers=h).json()['id']==iid
    c=get(a,c);assert c['balance']==before and len(c['ledger'])==ledger
    r=command(a,c,f'measurements/{c["measurements"][0]["id"]}/reverse','tgtSelf');assert r.status_code==200,r.text
    assert create(a,get(a,c),body(c)).status_code==422

def test_identity_duplicates_filters_key_validation_and_isolation(finance):
    a=finance['api'];c=executed(finance);b=body(c,10000);b.update(document_type='nfe',number='000000123',series='001',access_key='1'*44)
    r=create(a,c,b);assert r.status_code==201,r.text;i=r.json();c=get(a,c)
    assert i['number']=='123' and i['series']=='1'
    assert create(a,c,{**b,'number':'123','series':'1'}).json()['code']=='INVOICE_DUPLICATE'
    assert create(a,c,{**b,'number':'456'}).json()['code']=='INVOICE_DUPLICATE'
    assert create(a,c,{**b,'number':'789','access_key':'invalida'}).status_code==422
    assert create(a,c,{**body(c),'issued_on':str(date.today()+timedelta(days=1))}).status_code==422
    url=f'/contract_invoices/{i["id"]}'
    assert a['client'].get(url,headers=_h(a,'tgtSelf','A','A1')).status_code==200
    assert a['client'].get(url,headers=_h(a,'plainOpe','A','A1')).status_code==403
    assert a['client'].get(url,headers=_h(a,'plt','A','A1')).status_code==403
    assert a['client'].get(url,headers=_h(a,'multi','B','B1')).status_code==404
    assert a['client'].get(url,headers=_h(a,'gesMix','A','A2')).status_code==404
    r=a['client'].get('/contract_invoices/',params={'q':'123','contract_id':c['id'],'status':'registered'},headers=_h(a,'tgtSelf','A','A1'))
    assert r.status_code==200 and r.json()['total']==1,r.text
    assert a['client'].get('/contract_invoices/',params={'date_from':'2030-01-02','date_to':'2030-01-01'},headers=_h(a,'tgtSelf','A','A1')).status_code==422

def test_allocations_scope_total_limits_and_competing_registration(finance):
    a=finance['api'];c=executed(finance);other=executed(finance);b=body(c)
    assert create(a,c,{**b,'allocations':body(other)['allocations']}).status_code==422
    assert create(a,c,{**b,'amount_cents':29999}).status_code==422
    assert create(a,c,body(c,30001)).status_code==409
    old=a['current']['factory'];a['current']['factory']=a['wide']
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses=list(pool.map(lambda _:create(a,c,body(c)),range(2)))
        assert sorted(r.status_code for r in responses)==[201,412],[(r.status_code,r.text) for r in responses]
    finally:a['current']['factory']=old
    c=get(a,c)
    assert create(a,c,body(c,1)).status_code==422

def test_multiple_measurements_and_database_rejects_excess_or_reversal(finance):
    a=finance['api'];c=executed(finance);e=c['commitments'][0]['id']
    r=measurement(a,c,e,'10');assert r.status_code==201,r.text;c=r.json()
    b=body(c,35000);b['allocations']=[dict(measurement_id=c['measurements'][0]['id'],amount_cents=30000),dict(measurement_id=c['measurements'][1]['id'],amount_cents=5000)]
    r=create(a,c,b);assert r.status_code==201,r.text;i=r.json()
    assert len(i['allocations'])==2
    with pytest.raises(Exception):
        with a['owner'].begin() as db:
            db.execute(text("UPDATE contract_measurements SET status='reversed' WHERE id=:id"),dict(id=c['measurements'][0]['id']))
    with pytest.raises(Exception):
        with a['owner'].begin() as db:
            _insert(db,'contract_invoices',contract_id=c['id'],supplier_id=finance['supplier'],customer_id=a['ids']['A'],municipal_office_id=a['ids']['A1'],created_by=a['ids']['tgtSelf'],document_type='other',number=uuid4().hex,series='',issued_on=date.today(),amount_cents=1)
    assert get(a,c)['balance']['realized_cents']==40000
