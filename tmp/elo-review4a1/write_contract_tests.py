from pathlib import Path
R=Path('C:/Apps/ELOGESTAO');p=R/'apps/api/tests/test_contracts_api.py';assert not p.exists()
p.write_text('''"""Amostra 4B/4C: API real, elo_app, banco descartável e casos financeiros críticos."""
from datetime import date,timedelta
from uuid import uuid4
import pytest
from sqlalchemy import text
from test_fase34_access_api import api,disposable_database,pytestmark,_h,_key
from test_fase3_foundation import _insert,_alembic,_url
from test_fase4a1_suppliers_api import _type,_body as supplier_body,_create as supplier_create,cnpj
from test_fase4a2_products_api import _unit,_base

@pytest.fixture(scope='module')
def finance(api):
    ids=api['ids']
    with api['owner'].begin() as c:
        for user,role in [('tgtGrant','APR'),('tgtRevoke','APR'),('tgtSelf','FIN')]:
            m=c.execute(text("SELECT id FROM customer_memberships WHERE user_id=:u AND customer_id=:c AND audience='internal'"),dict(u=ids[user],c=ids['A'])).scalar()
            if m is None:m=_insert(c,'customer_memberships',user_id=ids[user],customer_id=ids['A'],audience='internal')
            a=_insert(c,'role_assignments',customer_id=ids['A'],membership_id=m,role_id=ids['roles'][role],scope_mode='selected',granted_by=ids['admA'])
            _insert(c,'role_assignment_offices',customer_id=ids['A'],assignment_id=a,municipal_office_id=ids['A1']) if False else c.execute(text('INSERT INTO role_assignment_offices(customer_id,assignment_id,municipal_office_id) VALUES(:c,:a,:o)'),dict(c=ids['A'],a=a,o=ids['A1']))
    t=_type(api,'Contratos');s=supplier_create(api,'gesMix','A','A1',supplier_body(t['id'],cnpj(991100000001)))
    assert s.status_code==201,s.text
    u=_unit(api,'CT','Unidade contratual');product=_base(api,u['id'],'CONTRATO')
    return dict(api=api,supplier=s.json()['id'],product=product['id'])

def new(finance):
    a=finance['api'];now=date.today();body=dict(number=uuid4().hex,description='Contrato de avaliação',supplier_id=finance['supplier'],
        starts_on=str(now-timedelta(days=1)),ends_on=str(now+timedelta(days=30)),
        items=[dict(product_id=finance['product'],quantity='100',unit_price_cents=1000)])
    r=a['client'].post('/contracts/',json=body,headers=_h(a,'gesMix','A','A1',**{'Idempotency-Key':_key()}))
    assert r.status_code==201,r.text
    return r.json(),body

def get(a,c):
    r=a['client'].get('/contracts/'+str(c['id']),headers=_h(a,'gesMix','A','A1'));assert r.status_code==200,r.text
    return r.json()
def command(a,c,path,user='gesMix',body=None,key=None,version=None):
    return a['client'].post('/contracts/'+str(c['id'])+'/'+path,json=body or {'reason':'Avaliação'},
        headers=_h(a,user,'A','A1',**{'Idempotency-Key':key or _key(),'If-Match':f'"v{version or c["version"]}"'}))
def policy(a,c,mode='any',self_approval=False):
    levels=[dict(mode=mode,minimum_cents=0,approvers=[dict(user_id=a['ids']['tgtGrant'],limit_cents=200000),dict(user_id=a['ids']['tgtRevoke'],limit_cents=200000)])]
    r=a['client'].put(f"/customers/{a['ids']['A']}/contract-approval-policies",json=dict(contract_id=c['id'],levels=levels,allow_self_approval=self_approval),
        headers=_h(a,'admA','A',**{'Idempotency-Key':_key()}));assert r.status_code==200,r.text
    return r.json()
def approved(finance):
    a=finance['api'];c,_=new(finance);policy(a,c)
    r=command(a,c,'submit');assert r.status_code==200,r.text;c=r.json()
    r=command(a,c,'decisions','tgtGrant',dict(decision='approve',reason='Conferido'));assert r.status_code==200,r.text
    return r.json()
def commitment(a,c,amount=80000,**changes):
    body=dict(contract_id=c['id'],number=uuid4().hex,date=str(date.today()),amount_cents=amount,
              authorization_reference='Autorização contábil sintética',authorized_by='Responsável sintético',**changes)
    return a['client'].post('/contract_commitments/',json=body,headers=_h(a,'tgtSelf','A','A1',**{'Idempotency-Key':_key(),'If-Match':f'"v{c["version"]}"'}))
def measurement(a,c,e,quantity='30',**changes):
    body=dict(contract_id=c['id'],commitment_id=e,item_id=c['items'][0]['id'],quantity=quantity,date=str(date.today()),
              attestation_reference='Ateste sintético',attested_by='Fiscal sintético',**changes)
    return a['client'].post('/contract_measurements/',json=body,headers=_h(a,'tgtSelf','A','A1',**{'Idempotency-Key':_key(),'If-Match':f'"v{c["version"]}"'}))

def test_draft_isolation_conflicts_idempotency_and_supplier_reference(finance):
    a=finance['api'];c,body=new(finance)
    assert c['effective_status']=='pending' and c['limit_cents']==100000
    for user,cust,office in [('gesMix','A','A2'),('multi','B','B1')]:
        r=a['client'].get('/contracts/'+str(c['id']),headers=_h(a,user,cust,office));assert r.status_code==404,r.text
    key=_key();r=command(a,c,'submit',key=key);assert r.status_code==409 and r.json()['code']=='APPROVAL_POLICY_MISSING'
    r=commitment(a,c);assert r.status_code==409 and r.json()['code']=='CONTRACT_NOT_ACTIVE'
    r=a['client'].put('/contracts/'+str(c['id']),json=body,headers=_h(a,'gesMix','A','A1',**{'If-Match':'"v99"','Idempotency-Key':_key()}));assert r.status_code==412
    from test_fase4a1_suppliers_api import cnpj as valid_cnpj
    r=a['client'].post('/suppliers/'+str(finance['supplier'])+'/cnpj-correction',json=dict(cnpj=valid_cnpj(991100000002),reason='Conferência'),headers=_h(a,'gesMix','A','A1',**{'If-Match':'"v1"','Idempotency-Key':_key()}))
    assert r.status_code==409 and r.json()['code']=='SUPPLIER_REFERENCED',r.text

def test_all_approvers_and_frozen_policy_need_every_vote(finance):
    a=finance['api'];c,_=new(finance);policy(a,c,'all');r=command(a,c,'submit');assert r.status_code==200,r.text;c=r.json()
    r=command(a,c,'decisions','tgtGrant',dict(decision='approve',reason='Primeira análise'));assert r.status_code==200,r.text;c=r.json()
    assert c['status']=='awaiting_approval'
    r=command(a,c,'decisions','tgtGrant',dict(decision='approve',reason='Repetida'));assert r.status_code==409
    r=command(a,c,'decisions','tgtRevoke',dict(decision='approve',reason='Segunda análise'));assert r.status_code==200,r.text
    assert r.json()['status']=='approved'

def test_sequential_levels_reject_skip_and_preserve_old_votes(finance):
    a=finance['api'];c,_=new(finance)
    levels=[dict(mode='any',minimum_cents=0,approvers=[dict(user_id=a['ids'][u],limit_cents=200000)]) for u in ['tgtGrant','tgtRevoke']]
    r=a['client'].put(f"/customers/{a['ids']['A']}/contract-approval-policies",json=dict(contract_id=c['id'],levels=levels),headers=_h(a,'admA','A',**{'Idempotency-Key':_key()}));assert r.status_code==200,r.text
    r=command(a,c,'submit');assert r.status_code==200,r.text;c=r.json()
    r=command(a,c,'decisions','tgtRevoke',dict(decision='approve',reason='Tentativa de pular'));assert r.status_code==403,r.text
    r=command(a,c,'decisions','tgtGrant',dict(decision='approve',reason='Nível um'));assert r.status_code==200,r.text;c=r.json()
    assert c['status']=='awaiting_approval' and c['approval_rounds'][-1]['current_level']==2
    r=command(a,c,'decisions','tgtRevoke',dict(decision='approve',reason='Nível dois'));assert r.status_code==200,r.text
    assert len(r.json()['approval_rounds'][-1]['votes'])==2 and r.json()['status']=='approved'

def test_commitment_measurement_limits_reversal_no_double_discount_and_audit(finance):
    a=finance['api'];c=approved(finance)
    r=commitment(a,c);assert r.status_code==201,r.text;c=r.json();e=c['commitments'][-1]['id']
    r=commitment(a,c,30000);assert r.status_code==409 and r.json()['code']=='INSUFFICIENT_CONTRACT_BALANCE',r.text
    r=measurement(a,c,e);assert r.status_code==201,r.text;c=r.json();m=c['measurements'][-1]['id']
    assert c['balance']==dict(limit_cents=100000,committed_cents=80000,realized_cents=30000,available_to_commit_cents=20000,committed_to_realize_cents=50000)
    r=measurement(a,c,e,'60');assert r.status_code==409,r.text
    r=command(a,c,f'commitments/{e}/cancel','tgtSelf');assert r.status_code==409
    r=command(a,c,f'measurements/{m}/reverse','tgtSelf');assert r.status_code==200,r.text;c=r.json()
    assert c['balance']['realized_cents']==0 and c['balance']['committed_cents']==80000
    r=command(a,c,f'measurements/{m}/reverse','tgtSelf');assert r.status_code==409
    r=command(a,c,f'commitments/{e}/cancel','tgtSelf');assert r.status_code==200,r.text
    assert r.json()['balance']['available_to_commit_cents']==100000
    events=a['client'].get('/contracts/'+str(c['id'])+'/events',headers=_h(a,'gesMix','A','A1'));assert events.status_code==200 and events.json()['total']>=7,events.text

def test_amendment_requires_fresh_approval_and_preserves_execution_until_then(finance):
    a=finance['api'];c=approved(finance)
    r=command(a,c,'amendments',body=dict(reason='Acréscimo',changes=[dict(item_id=c['items'][0]['id'],new_quantity='150')]))
    assert r.status_code==201,r.text;c=r.json();assert c['limit_cents']==100000 and c['status']=='approved'
    r=command(a,c,'decisions','tgtGrant',dict(decision='approve',reason='Aditivo autorizado'));assert r.status_code==200,r.text;c=r.json()
    assert c['limit_cents']==150000 and c['balance']['committed_cents']==0
    r=command(a,c,'status/suspend');assert r.status_code==200,r.text;c=r.json()
    r=commitment(a,c);assert r.status_code==409 and r.json()['code']=='CONTRACT_NOT_ACTIVE'
    r=command(a,c,'status/resume');assert r.status_code==200,r.text

def test_missing_action_body_forgery_and_revoked_approver_are_denied(finance):
    a=finance['api'];c,_=new(finance);policy(a,c);r=command(a,c,'submit');assert r.status_code==200,r.text;c=r.json()
    r=command(a,c,'decisions','gesMix',dict(decision='approve',reason='Sem ação'));assert r.status_code==403
    r=a['client'].post('/contracts/',json=dict(number='X',customer_id=a['ids']['B']),headers=_h(a,'gesMix','A','A1',**{'Idempotency-Key':_key()}));assert r.status_code==422
    with a['owner'].begin() as db:
        aid=db.execute(text("SELECT ra.id FROM role_assignments ra JOIN customer_memberships m ON m.id=ra.membership_id JOIN role_templates rt ON rt.id=ra.role_id WHERE m.user_id=:u AND rt.code='APR' AND ra.status='active'"),dict(u=a['ids']['tgtGrant'])).scalar_one()
        db.execute(text("UPDATE role_assignments SET status='revoked',revoked_at=now(),revoked_by=:a,revoke_reason='Teste' WHERE id=:i"),dict(i=aid,a=a['ids']['admA']))
    try:
        r=command(a,c,'decisions','tgtGrant',dict(decision='approve',reason='Revogada'));assert r.status_code==403,r.text
    finally:
        with a['owner'].begin() as db:db.execute(text("UPDATE role_assignments SET status='active',revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL WHERE id=:i"),dict(i=aid))

def test_migration_empty_upgrade_downgrade_upgrade(disposable_database):
    db=disposable_database()
    for command in [('upgrade','head'),('downgrade','elo_fase4a_0024'),('upgrade','head')]:
        r=_alembic(db,*command);assert r.returncode==0,r.stderr[-4000:]
''',encoding='utf-8')
print('Amostra integrada preparada.')
