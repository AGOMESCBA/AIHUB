from pathlib import Path
r=Path('C:/Apps/ELOGESTAO')
p=r/'apps/backoffice/src/lib/api-routes.ts';s=p.read_text(encoding='utf-8').replace("  route(['GET', 'POST'], 'contract_commitments'),","  route(['GET', 'POST'], 'contract_commitments'),\n  route(['GET'], `contract_commitments/${ID}`),");p.write_text(s,encoding='utf-8')
p=r/'tools/dev/test-web-workspace.cjs';s=p.read_text(encoding='utf-8');s+='''
test('consulta propria do empenho passa no BFF sem liberar edicao ou exclusao', () => {
  const routes = load('apps/backoffice/src/lib/api-routes.ts');
  assert.ok(routes.findApiRoute('GET', '/contract_commitments/12'));
  for (const method of ['POST','PUT','PATCH','DELETE'])
    assert.equal(routes.findApiRoute(method, '/contract_commitments/12'), undefined);
  const registry=load('apps/backoffice/src/workspace/registry.ts');
  assert.ok(registry.ROUTINES['ope.empenhos'].hasRecord);
});
''';p.write_text(s,encoding='utf-8')
p=r/'apps/api/tests/test_contracts_api.py';s=p.read_text(encoding='utf-8');s+='''

def test_commitment_detail_honors_child_permissions(finance):
    a=finance['api'];c=approved(finance)
    r=commitment(a,c);assert r.status_code==201,r.text;c=r.json();e=c['commitments'][0]
    r=measurement(a,c,e['id']);assert r.status_code==201,r.text
    url='/contract_commitments/'+str(e['id'])
    assert a['client'].get(url,headers=_h(a,'plainOpe','A','A1')).status_code==403
    assert a['client'].get(url,headers=_h(a,'plt','A','A1')).status_code==403
    with a['owner'].begin() as db:
        removed=[dict(row) for row in db.execute(text("DELETE FROM role_permissions WHERE role_id=:role AND routine_action_id IN (SELECT id FROM routine_actions WHERE code IN ('medicoes.consultar','saldos.consultar')) RETURNING role_id,routine_action_id"),dict(role=a['ids']['roles']['FIN'])).mappings()]
    assert len(removed)==2
    try:
        r=a['client'].get(url,headers=_h(a,'tgtSelf','A','A1'));assert r.status_code==200,r.text
        assert r.json()['measurements']==[] and r.json()['events']==[]
        assert r.json()['realized_cents']==30000 and r.json()['available_cents']==50000
    finally:
        with a['owner'].begin() as db:
            for row in removed:db.execute(text('INSERT INTO role_permissions(role_id,routine_action_id) VALUES(:role_id,:routine_action_id)'),row)
''';p.write_text(s,encoding='utf-8')
print('BFF e testes de consulta protegida atualizados')
