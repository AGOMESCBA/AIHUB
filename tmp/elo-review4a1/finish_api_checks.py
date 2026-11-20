from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
p=R/'apps/api/app/routers/contracts.py';s=p.read_text(encoding='utf-8')
start=s.index("@router.post('/contracts/{contract_id}/status/{command}')")
end=s.index("@router.get('/contracts/{contract_id}/balance')",start)
s=s[:start]+'''def status_endpoint(command):
    def endpoint(contract_id:int,body:ReasonInput,request:Request,db:Session=Depends(get_db_session),ctx=Depends(org_context)):
        return svc.change_status(db,ctx,contract_id,request,command,body)
    endpoint.__name__='contract_'+command
    return endpoint
for command in ('suspend','resume','close','cancel'):
    router.add_api_route('/contracts/{contract_id}/status/'+command,status_endpoint(command),methods=['POST'])

'''+s[end:]
p.write_text(s,encoding='utf-8')
p=R/'apps/api/tests/test_contracts_api.py';s=p.read_text(encoding='utf-8')
s+='''
def test_approval_options_and_policy_scope_are_minimal_and_correct(finance):
    a=finance['api'];c,_=new(finance)
    r=a['client'].get(f"/customers/{a['ids']['A']}/contract-approval-options",params=dict(contract_id=c['id']),headers=_h(a,'admA','A'))
    assert r.status_code==200,r.text
    assert {u['id'] for u in r.json()['approvers']}=={a['ids']['tgtGrant'],a['ids']['tgtRevoke']}
    assert all(set(u)=={'id','name'} for u in r.json()['approvers'])
    r=a['client'].get(f"/customers/{a['ids']['B']}/contract-approval-options",params=dict(contract_id=c['id']),headers=_h(a,'admB','B'))
    assert r.status_code==404,r.text

def test_two_competing_commitments_cannot_overcommit_and_retry_checks_balance(finance):
    from concurrent.futures import ThreadPoolExecutor
    a=finance['api'];c=approved(finance);old=a['current']['factory'];a['current']['factory']=a['wide']
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(commitment,a,c,80000) for _ in range(2)]
            results=[f.result(timeout=30) for f in futures]
    finally:a['current']['factory']=old
    assert sorted(r.status_code for r in results)==[201,412],[r.text for r in results]
    c=get(a,c);assert c['balance']['committed_cents']==80000
    r=commitment(a,c,80000);assert r.status_code==409 and r.json()['code']=='INSUFFICIENT_CONTRACT_BALANCE'

def test_waiting_approval_rechecks_revocation_after_real_lock(finance):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    a=finance['api'];c,_=new(finance);policy(a,c);r=command(a,c,'submit');assert r.status_code==200;c=r.json()
    with a['owner'].connect() as db:
        aid=db.execute(text("SELECT ra.id FROM role_assignments ra JOIN customer_memberships m ON m.id=ra.membership_id JOIN role_templates rt ON rt.id=ra.role_id WHERE m.user_id=:u AND rt.code='APR' AND ra.status='active'"),dict(u=a['ids']['tgtGrant'])).scalar_one()
    old=a['current']['factory'];a['current']['factory']=a['wide']
    try:
        with a['owner'].connect() as blocker:
            transaction=blocker.begin();pid=blocker.execute(text('SELECT pg_backend_pid()')).scalar_one()
            blocker.execute(text('SELECT pg_advisory_xact_lock(3401,:c)'),dict(c=a['ids']['A']))
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending=pool.submit(command,a,c,'decisions','tgtGrant',dict(decision='approve',reason='Durante espera'))
                waiting=False
                for _ in range(200):
                    with a['owner'].connect() as db:waiting=db.execute(text('SELECT count(*) FROM pg_stat_activity WHERE :p=ANY(pg_blocking_pids(pid))'),dict(p=pid)).scalar()>0
                    if waiting or pending.done():break
                    threading.Event().wait(.025)
                assert waiting and not pending.done(),'A aprovação precisa estar esperando um bloqueio real.'
                blocker.execute(text("UPDATE role_assignments SET status='revoked',revoked_at=now() WHERE id=:a"),dict(a=aid))
                transaction.commit();response=pending.result(timeout=30)
        assert response.status_code==403,response.text
        assert get(a,c)['status']=='awaiting_approval'
        with a['owner'].connect() as db:assert db.execute(text('SELECT count(*) FROM contract_approval_votes WHERE contract_id=:c'),dict(c=c['id'])).scalar()==0
    finally:
        a['current']['factory']=old
        with a['owner'].begin() as db:db.execute(text("UPDATE role_assignments SET status='active',revoked_at=NULL WHERE id=:a"),dict(a=aid))
'''
p.write_text(s,encoding='utf-8')
print('Mais três verificações críticas: seletor, disputa por saldo e revogação sob bloqueio.')
