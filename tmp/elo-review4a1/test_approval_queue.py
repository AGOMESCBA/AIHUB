from pathlib import Path
p=Path('C:/Apps/ELOGESTAO/apps/api/tests/test_contracts_api.py');s=p.read_text(encoding='utf-8')
assert 'def test_personal_approval_queue' not in s
s+='''

def approval_list(a,c,user):
    return a['client'].get('/contract_approvals/',params={'q':c['number'],'per_page':1},headers=_h(a,user,'A','A1'))

def test_personal_approval_queue_tracks_levels_and_hides_other_users_and_orgs(finance):
    a=finance['api'];c,_=new(finance)
    levels=[dict(mode='any',minimum_cents=0,approvers=[dict(user_id=a['ids'][u],limit_cents=200000)]) for u in ['tgtGrant','tgtRevoke']]
    r=a['client'].put(f"/customers/{a['ids']['A']}/contract-approval-policies",json=dict(contract_id=c['id'],levels=levels),headers=_h(a,'admA','A',**{'Idempotency-Key':_key()}));assert r.status_code==200
    r=command(a,c,'submit');assert r.status_code==200;c=r.json()
    first=approval_list(a,c,'tgtGrant');assert first.status_code==200 and first.json()['total']==1,first.text
    assert first.json()['items'][0]['approval']['limit_cents']==200000
    assert approval_list(a,c,'tgtRevoke').json()['total']==0
    url='/contract_approvals/'+str(c['id'])
    r=a['client'].get(url,headers=_h(a,'tgtRevoke','A','A1'));assert r.status_code==404
    r=a['client'].get(url,headers=_h(a,'tgtGrant','A','A1'));assert r.status_code==200 and r.headers['etag']==f'"v{c["version"]}"'
    assert r.json()['supplier']['name'] and r.json()['items'] and r.json()['approval']['authority_margin_cents']==100000
    assert a['client'].get(url,headers=_h(a,'admB','B','B1')).status_code==403
    assert a['client'].get(url,headers=_h(a,'gesMix','A','A1')).status_code==403
    assert a['client'].get(url,headers=_h(a,'tgtGrant','A','A2')).status_code==403
    r=command(a,c,'decisions','tgtGrant',dict(decision='approve',reason='Primeiro nível'));assert r.status_code==200;c=r.json()
    assert approval_list(a,c,'tgtGrant').json()['total']==0
    assert approval_list(a,c,'tgtRevoke').json()['total']==1
    assert a['client'].get(url,headers=_h(a,'tgtGrant','A','A1')).status_code==404
    r=command(a,c,'decisions','tgtRevoke',dict(decision='reject',reason='Devolver para correção'));assert r.status_code==200
    assert approval_list(a,c,'tgtRevoke').json()['total']==0

def test_approval_queue_all_mode_removes_own_vote_and_accepts_only_decision_fields(finance):
    a=finance['api'];c,_=new(finance);policy(a,c,mode='all')
    r=command(a,c,'submit');assert r.status_code==200;c=r.json()
    bad=command(a,c,'decisions','tgtGrant',dict(decision='approve',reason='Não pode editar',limit_cents=1))
    assert bad.status_code==422
    r=command(a,c,'decisions','tgtGrant',dict(decision='approve',reason='Conferido'));assert r.status_code==200;c=r.json()
    assert c['limit_cents']==100000 and approval_list(a,c,'tgtGrant').json()['total']==0
    assert approval_list(a,c,'tgtRevoke').json()['total']==1
    r=command(a,c,'decisions','tgtRevoke',dict(decision='approve',reason='Conferido também'));assert r.status_code==200;c=r.json()
    r=command(a,c,'amendments',body=dict(reason='Ampliação',changes=[dict(item_id=c['items'][0]['id'],new_quantity='120')]))
    assert r.status_code==201;c=r.json()
    own=approval_list(a,c,'tgtGrant');assert own.json()['items'][0]['approval']['kind']=='amendment'
    detail=a['client'].get('/contract_approvals/'+str(c['id']),headers=_h(a,'tgtGrant','A','A1'))
    assert detail.status_code==200 and detail.json()['approval']['amount_cents']==120000
    assert detail.json()['limit_cents']==100000

def test_approval_queue_excludes_forbidden_self_approval_and_honors_revocation(finance):
    a=finance['api'];c,body=new(finance)
    with a['owner'].begin() as db:
        membership=db.execute(text("SELECT id FROM customer_memberships WHERE customer_id=:c AND user_id=:u AND audience='internal'"),dict(c=a['ids']['A'],u=a['ids']['tgtGrant'])).scalar_one()
        grant=_insert(db,'role_assignments',customer_id=a['ids']['A'],membership_id=membership,role_id=a['ids']['roles']['GES'],scope_mode='selected',granted_by=a['ids']['admA'])
        db.execute(text('INSERT INTO role_assignment_offices(customer_id,assignment_id,municipal_office_id) VALUES(:c,:a,:o)'),dict(c=a['ids']['A'],a=grant,o=a['ids']['A1']))
    try:
        body['number']=uuid4().hex
        r=a['client'].post('/contracts/',json=body,headers=_h(a,'tgtGrant','A','A1',**{'Idempotency-Key':_key()}));assert r.status_code==201;c=r.json()
        policy(a,c);r=command(a,c,'submit','tgtGrant');assert r.status_code==200;c=r.json()
        assert approval_list(a,c,'tgtGrant').json()['total']==0
        assert approval_list(a,c,'tgtRevoke').json()['total']==1
        r=command(a,c,'withdraw','tgtGrant');assert r.status_code==200;c=r.json()
        p=policy(a,c,self_approval=True);r=command(a,c,'submit','tgtGrant');assert r.status_code==200;c=r.json()
        assert approval_list(a,c,'tgtGrant').json()['total']==1
        with a['owner'].begin() as db:
            ids=db.execute(text("UPDATE role_assignments SET status='revoked',revoked_at=now() WHERE membership_id=:m AND role_id=:r AND status='active' RETURNING id"),dict(m=membership,r=a['ids']['roles']['APR'])).scalars().all()
        try:assert approval_list(a,c,'tgtGrant').status_code==403
        finally:
            with a['owner'].begin() as db:db.execute(text("UPDATE role_assignments SET status='active',revoked_at=NULL WHERE id=ANY(:ids)"),dict(ids=ids))
    finally:
        with a['owner'].begin() as db:db.execute(text("UPDATE role_assignments SET status='revoked',revoked_at=now() WHERE id=:i"),dict(i=grant))
'''
p.write_text(s,encoding='utf-8')
