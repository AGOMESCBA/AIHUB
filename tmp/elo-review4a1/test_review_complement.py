import pytest
from jose import jwt
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_fase34_access_api import api, disposable_database, pytestmark, _h
from test_fase4a1_suppliers_api import _type, _create, _body, cnpj
from test_fase4a1_complemento_api import alnum


def test_database_correction_rejects_reader_without_action(api):
    kind = _type(api, 'Tipo da revisao independente')
    supplier = _create(api, 'gesMix', 'A', 'A1', _body(kind['id'], cnpj(8901))).json()
    headers = _h(api, 'conAll', 'A', 'A2')
    response = api['client'].post(f"/suppliers/{supplier['id']}/cnpj-correction",
        json={'cnpj': alnum(8901), 'reason': 'Correcao da revisao independente'},
        headers={**headers, 'Idempotency-Key': 'review-independent-8901', 'If-Match': '"v1"'})
    assert response.status_code == 403
    session_id = jwt.get_unverified_claims(api['tokens']['conAll'])['sid']
    with api['current']['factory']() as session:
        connection = session.connection()
        connection.execute(text('SET LOCAL ROLE elo_app'))
        for key, value in {'elo.customer_id': api['ids']['A'], 'elo.context_mode': 'office',
                           'elo.office_ids': api['ids']['A2'], 'elo.session_id': session_id,
                           'elo.idle_minutes': 60}.items():
            connection.execute(text('SELECT set_config(:k, :v, true)'), {'k': key, 'v': str(value)})
        assert connection.execute(text('SELECT elo_request_user_id()')).scalar_one() == api['ids']['conAll']
        with pytest.raises(DBAPIError):
            connection.execute(text("SELECT elo_supplier_correct_cnpj(:id, 1, :cnpj, :reason, :request, '{}'::jsonb)"),
                {'id': supplier['id'], 'cnpj': alnum(8901), 'reason': 'Correcao da revisao independente',
                 'request': 'review-independent-8901'})
        session.rollback()


def test_audit_dates_with_mixed_timezone_return_controlled_response(api):
    response = api['client'].get('/platform/audit-events', headers=_h(api, 'plt'),
        params={'date_from': '2026-11-01T00:00:00', 'date_to': '2026-11-14T00:00:00Z'})
    assert response.status_code in (200, 422), response.text
