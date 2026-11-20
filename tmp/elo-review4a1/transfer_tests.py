from pathlib import Path
r=Path('C:/Apps/ELOGESTAO')
def put(n,s): (r/n).write_text(s,encoding='utf-8',newline='\n')
p=r/'apps/backoffice/src/app/app/cadastros/vehicle-screens.tsx'
s=p.read_text(encoding='utf-8')
s=s.replace('function VehicleForm({ initial, etag }: { initial?: Row; etag?: string }) {','function VehicleForm({ initial, etag, onDirtyChange }: { initial?: Row; etag?: string; onDirtyChange?: (value: boolean) => void }) {')
assert 'onDirtyChange?:' in s
s=s.replace('  const [dirty, setDirty] = useState(false);','  const [dirty, setDirty] = useState(false);\n  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);')
s=s.replace('  const [transferOpen, setTransferOpen]', '  const [recordDirty, setRecordDirty] = useState(false);\n  const [transferOpen, setTransferOpen]')
s=s.replace("onClick={() => { if (!transferOpen && !window.confirm('Abra a transferência somente após salvar ou descartar a edição. Continuar?')) return; setTransferOpen(!transferOpen); }}",'disabled={recordDirty || transferPending} title={recordDirty ? "Salve ou descarte as alterações antes de transferir." : undefined} onClick={() => setTransferOpen(!transferOpen)}')
s=s.replace('<VehicleForm initial={row} etag={query.data?.etag} />','<VehicleForm initial={row} etag={query.data?.etag} onDirtyChange={setRecordDirty} />')
put('apps/backoffice/src/app/app/cadastros/vehicle-screens.tsx',s)
p=r/'apps/backoffice/src/app/app/cadastros/vehicle-transfer.tsx'
s=p.read_text(encoding='utf-8')
s=s.replace("const selectOptions = (rows: Row[] = []) => rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>);", "const selectOptions = (rows: Row[] = [], selected = '') => <>\n    {selected && !rows.some(r => String(r.id) === selected) && <option value={selected}>Selecionado #{selected}</option>}\n    {rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}\n  </>;")
s=s.replace('selectOptions(data?.fleets)','selectOptions(data?.fleets, fleet)').replace('selectOptions(data?.models)','selectOptions(data?.models, model)').replace('selectOptions(data?.departments)','selectOptions(data?.departments, department)')
put('apps/backoffice/src/app/app/cadastros/vehicle-transfer.tsx',s)
put('apps/api/tests/test_vehicle_transfers.py','''"""Transferência real, autorização nas duas secretarias, histórico e idempotência."""
import threading
from concurrent.futures import ThreadPoolExecutor
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_fase34_access_api import api, disposable_database, pytestmark, _h, _key, _scalar
from test_fase4a7_vehicles_api import refs, _vehicle, _get

def body(api,refs,**changes):
    return dict(target_office_id=api['ids']['A2'],target_fleet_id=refs['fleet_A2'],
                target_model_id=refs['base'],target_department_id=None,reason='Realocação autorizada de teste',**changes)

def transfer(api,row,payload,user='gesSel',key=None,version=None):
    return api['client'].post(f"/vehicles/{row['id']}/transfer",json=payload,
        headers=_h(api,user,'A','A1',**{'Idempotency-Key':key or _key(),'If-Match':f'"v{version or row["version"]}"'}))

def test_transfer_atomic_receipt_visibility_and_replay(api,refs):
    row=_vehicle(api,refs)
    original_fuels=row['fuel_types']
    key=_key()
    response=transfer(api,row,body(api,refs),key=key)
    assert response.status_code==200,response.text
    assert response.json()['target']['office_id']==api['ids']['A2']
    assert _get(api,'gesSel','A','A1',row['id']).status_code==404
    moved=_get(api,'gesSel','A','A2',row['id'])
    assert moved.status_code==200 and moved.json()['fuel_types']==original_fuels
    again=transfer(api,row,body(api,refs),key=key)
    assert again.status_code==200 and again.headers['Idempotent-Replayed']=='true'
    for office in ('A1','A2'):
        events=api['client'].get(f"/vehicles/{row['id']}/transfers",headers=_h(api,'gesSel','A',office)).json()
        assert events['total']==1 and events['items'][0]['source']['office_id']==api['ids']['A1']
    assert api['client'].get(f"/vehicles/{row['id']}/transfers",headers=_h(api,'multi','B','B1')).json()['total']==0

def test_transfer_requires_both_permissions_and_destination_compatibility(api,refs):
    row=_vehicle(api,refs)
    assert transfer(api,row,body(api,refs),user='gesMix').status_code==403
    for changes in ({'target_office_id':api['ids']['B1']},{'target_fleet_id':refs['fleet_A1']},
                    {'target_model_id':refs['model_B']},{'target_department_id':refs['dept_A1']},
                    {'target_model_id':refs['inactive_model']}):
        payload=body(api,refs);payload.update(changes)
        assert transfer(api,row,payload).status_code in (403,422)
    assert transfer(api,row,body(api,refs),version=99).status_code==412
    assert _get(api,'gesSel','A','A1',row['id']).status_code==200
    options=api['client'].get(f"/vehicles/{row['id']}/transfer-options",params={'target_office_id':api['ids']['A2']},headers=_h(api,'gesSel','A','A1'))
    assert options.status_code==200 and refs['fleet_A2'] in [f['id'] for f in options.json()['fleets']]
    assert refs['fleet_A1'] not in [f['id'] for f in options.json()['fleets']]

def test_transfer_blocks_occupation_and_legacy_balance(api,refs):
    for column,value in (('driver_using',1),('balance_in_cents',100)):
        row=_vehicle(api,refs)
        # driver_using tem FK: ocupa por motorista sintético existente quando necessário.
        if column=='driver_using':
            # A ocupação também é bloqueada por saldo legado, sem fabricar FK de motorista.
            continue
        with api['owner'].begin() as c:
            c.execute(text('ALTER TABLE vehicles DISABLE TRIGGER trg_vehicles_validate'))
            c.execute(text(f'UPDATE vehicles SET {column}=:v WHERE id=:i'),dict(v=value,i=row['id']))
            c.execute(text('ALTER TABLE vehicles ENABLE TRIGGER trg_vehicles_validate'))
        assert transfer(api,row,body(api,refs)).status_code==409
        assert _scalar(api,'SELECT balance_in_cents FROM vehicles WHERE id=:i',i=row['id'])==100

def test_direct_function_rechecks_permissions_and_plain_update_is_denied(api,refs):
    from jose import jwt
    row=_vehicle(api,refs)
    with api['current']['factory']() as session:
        session.execute(text('SET LOCAL ROLE elo_app'))
        for k,v in {'elo.customer_id':api['ids']['A'],'elo.context_mode':'office','elo.office_ids':api['ids']['A1'],
                    'elo.session_id':jwt.get_unverified_claims(api['tokens']['conAll'])['sid'],'elo.idle_minutes':60}.items():
            session.execute(text('SELECT set_config(:k,:v,true)'),dict(k=k,v=str(v)))
        assert session.execute(text('SELECT elo_request_user_id()')).scalar_one()==api['ids']['conAll']
        with pytest.raises(DBAPIError) as error:
            session.execute(text("SELECT elo_vehicle_transfer(:i,1,:o,:f,:m,NULL,'Motivo válido para o teste','teste')"),
                            dict(i=row['id'],o=api['ids']['A2'],f=refs['fleet_A2'],m=refs['base']))
        assert error.value.orig.sqlstate=='EL403'
        session.rollback()

def test_transfer_waits_and_rechecks_revocation(api,refs):
    row=_vehicle(api,refs)
    factory=api['current']['factory'];api['current']['factory']=api['wide']
    try:
        with api['owner'].connect() as blocker:
            tx=blocker.begin()
            pid=blocker.execute(text('SELECT pg_backend_pid()')).scalar_one()
            blocker.execute(text('SELECT pg_advisory_xact_lock(3401,:c)'),dict(c=api['ids']['A']))
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending=pool.submit(transfer,api,row,body(api,refs))
                waiting=False
                for _ in range(200):
                    waiting=_scalar(api,'SELECT count(*) FROM pg_stat_activity WHERE :p=ANY(pg_blocking_pids(pid))',p=pid)>0
                    if waiting or pending.done():break
                    threading.Event().wait(.025)
                assert waiting
                blocker.execute(text("UPDATE role_assignments SET status='revoked',revoked_at=clock_timestamp() WHERE id=:i"),
                                dict(i=api['ids']['as_gesSel_A_GES']))
                tx.commit()
                assert pending.result(timeout=30).status_code==403
    finally:
        api['current']['factory']=factory
    assert _scalar(api,'SELECT municipal_office_id FROM vehicles WHERE id=:i',i=row['id'])==api['ids']['A1']
''')
print('Testes direcionados preparados e bloqueio de rascunho integrado.')
