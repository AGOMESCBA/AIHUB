from sqlalchemy import text
from test_fase34_access_api import api, disposable_database, pytestmark, _h, _key
from test_fase4a6_drivers_api import _driver, _get, _update_body


def test_inactivate_permission_can_manage_status_without_reading_documents(api):
    driver = _driver(api, 'gesMix', 'A', 'A1')
    with api['owner'].begin() as c:
        c.execute(text("""DELETE FROM role_permissions rp USING routine_actions a, routines r
            WHERE rp.routine_action_id=a.id AND a.routine_id=r.id AND rp.role_id=:role
              AND r.code='cad.motoristas' AND a.action_code='alterar'"""),
            {'role': api['ids']['roles']['OPE']})
    detail = _get(api, 'plainOpe', 'A', 'A1', driver['id']).json()
    assert detail['permissions'] == {'alterar': False, 'inativar': True}
    assert detail['cpf'] is None and detail['cnh'] is None
    headers = _h(api, 'plainOpe', 'A', 'A1', **{'If-Match': '"v1"', 'Idempotency-Key': _key()})
    inactive = api['client'].delete(f"/drivers/{driver['id']}", headers=headers)
    assert inactive.status_code == 200
    body = {'status': 'active'}
    headers = _h(api, 'plainOpe', 'A', 'A1', **{'If-Match': '"v2"', 'Idempotency-Key': _key()})
    response = api['client'].post(f"/drivers/{driver['id']}/status", json=body, headers=headers)
    assert response.status_code == 200, f'Reativacao com dados disponiveis ao usuario respondeu {response.status_code}'
    assert response.json()['cpf'] is None and response.json()['cnh'] is None
    assert response.json()['status'] == 'active'
