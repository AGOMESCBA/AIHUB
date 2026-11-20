from pathlib import Path
R=Path('C:/Apps/ELOGESTAO');p=R/'apps/api/app/services/contracts.py';s=p.read_text(encoding='utf-8')
old='''        AND EXISTS (SELECT 1 FROM jsonb_array_elements(contract_approval_rounds.levels ->
            (contract_approval_rounds.current_level-1) -> 'approvers') candidate
            WHERE (candidate->>'user_id')::integer=:approval_user
              AND (candidate->>'limit_cents')::bigint>=contract_approval_rounds.amount_cents)
        AND NOT EXISTS (SELECT 1 FROM contract_approval_votes vote
            WHERE vote.round_id=contract_approval_rounds.id
              AND vote.level=contract_approval_rounds.current_level AND vote.created_by=:approval_user)'''
new='''        AND EXISTS (SELECT 1 FROM jsonb_array_elements(contract_approval_rounds.levels)
            WITH ORDINALITY AS upcoming(config, level_number)
            CROSS JOIN LATERAL jsonb_array_elements(upcoming.config->'approvers') candidate
            WHERE upcoming.level_number>=contract_approval_rounds.current_level
              AND (candidate->>'user_id')::integer=:approval_user
              AND (candidate->>'limit_cents')::bigint>=contract_approval_rounds.amount_cents
              AND NOT EXISTS (SELECT 1 FROM contract_approval_votes vote
                WHERE vote.round_id=contract_approval_rounds.id
                  AND vote.level=upcoming.level_number AND vote.created_by=:approval_user))'''
assert old in s;s=s.replace(old,new,1)
a=s.index('def approval_summary(')
s=s[:a]+'''def approval_summary(db,ctx,c):
    r=db.get(ApprovalRound,c.approval_round_id)
    voted={v.level for v in db.query(ApprovalVote).filter(ApprovalVote.round_id==r.id,ApprovalVote.created_by==ctx.user_id)}
    mine=next((n,a) for n,level in enumerate(r.levels,1) if n>=r.current_level and n not in voted
        for a in level['approvers'] if a['user_id']==ctx.user_id and a['limit_cents']>=r.amount_cents)
    my_level,approver=mine
    supplier=db.get(Supplier,c.supplier_id)
    return dict(round_id=r.id,kind='amendment' if r.amendment_id else 'contract',
        amendment_id=r.amendment_id,current_level=r.current_level,my_level=my_level,
        total_levels=len(r.levels),can_decide=my_level==r.current_level,
        decision_block_reason=None if my_level==r.current_level else f'Aguardando aprovação do nível {r.current_level} antes de liberar sua decisão no nível {my_level}.',
        amount_cents=r.amount_cents,limit_cents=approver['limit_cents'],
        authority_margin_cents=approver['limit_cents']-r.amount_cents,
        supplier_name=supplier.company_name if supplier else None)
'''
p.write_text(s,encoding='utf-8')
p=R/'apps/api/tests/test_contracts_api.py';s=p.read_text(encoding='utf-8')
s=s.replace("assert approval_list(a,c,'tgtRevoke').json()['total']==0\n    url=", "future=approval_list(a,c,'tgtRevoke').json();assert future['total']==1\n    assert future['items'][0]['approval']['my_level']==2 and future['items'][0]['approval']['can_decide'] is False\n    url=",1)
s=s.replace("r=a['client'].get(url,headers=_h(a,'tgtRevoke','A','A1'));assert r.status_code==404", "r=a['client'].get(url,headers=_h(a,'tgtRevoke','A','A1'));assert r.status_code==200\n    assert r.json()['approval']['can_decide'] is False and len(r.json()['approval_rounds'][-1]['levels'])==2\n    for decision in ['approve','reject']:\n        denied=command(a,c,'decisions','tgtRevoke',dict(decision=decision,reason='Ainda não é minha vez'))\n        assert denied.status_code==403 and denied.json()['code']=='APPROVER_NOT_CURRENT_LEVEL'",1)
s=s.replace("assert approval_list(a,c,'tgtRevoke').json()['total']==1\n    assert a['client'].get(url", "assert approval_list(a,c,'tgtRevoke').json()['items'][0]['approval']['can_decide'] is True\n    assert a['client'].get(url",1)
p.write_text(s,encoding='utf-8')
p=R/'apps/api/tests/test_fase34_access_api.py';s=p.read_text(encoding='utf-8');s=s.replace('assert role != "APR" or all(code.endswith(".consultar") for code in granted)','assert role != "APR" or all(code.endswith(".consultar") or code == "contratos.aprovar" for code in granted)\n        if role == "APR": assert "contratos.aprovar" in granted',1);p.write_text(s,encoding='utf-8')
p=R/'apps/api/tests/test_fase38_navigation_api.py';s=p.read_text(encoding='utf-8');s=s.replace('CUSTOMER_ADMIN = ["adm.auditoria"','CUSTOMER_ADMIN = ["adm.alcadas", "adm.auditoria"',1)
s=s.replace('OFFICE = ["ope.departamentos"','OFFICE = ["ope.contratos", "ope.departamentos"',1)
idx=s.index('\n\n\ndef _nav');s=s[:idx]+'\nOFFICE_FINANCIAL = sorted(OFFICE + ["ope.empenhos", "ope.medicoes"])'+s[idx:]
s=s.replace('assert _codes(data) == OFFICE\n        body', 'assert _codes(data) == OFFICE_FINANCIAL\n        body',1)
s=s.replace('        actions = {r["code"]: r["actions"] for r in body["routines"]}', '        actions = {r["code"]: r["actions"] for r in body["routines"]}\n        assert "ope.aprovacoes" not in actions  # GES/CON não concede aprovação.\n        assert "contratos.aprovar" not in body["permissions"]',1);p.write_text(s,encoding='utf-8')
p=R/'apps/api/tests/test_fase3_foundation.py';s=p.read_text(encoding='utf-8');a=s.index('def test_sharing_policies_follow');b=s.index('\n\n# Papéis',a);part=s[a:b]
part=part.replace("VALUES (:a, 'contracts', 'customer', :u)","VALUES (:a, 'products', 'customer', :u)")
part+='''\n    # Contratos passaram a ser exclusivos de secretaria na 4B; nem órgão inteiro nem subconjunto.
    _rejects(engine, "INSERT INTO resource_sharing_policies (customer_id, resource_code, mode, updated_by) "
                     "VALUES (:a, 'contracts', 'customer', :u)", {"a": org["A"], "u": org["platform_admin"]})
'''
s=s[:a]+part+s[b:];p.write_text(s,encoding='utf-8')
print('Visibilidade dos próximos níveis habilitada; decisão segue protegida. Cinco expectativas antigas atualizadas.')
