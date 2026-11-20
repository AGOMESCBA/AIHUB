"""Usa exclusivamente as APIs de segurança para conferir/conceder acessos aos dois testadores."""
from pathlib import Path
import json,uuid,httpx
R=Path('C:/Apps/ELOGESTAO');A='http://127.0.0.1:8012'
demo=json.loads((R/'.local/testes-municipios.json').read_text(encoding='utf-8'))
older=json.loads((R/'.local/lotacao-e2e.json').read_text(encoding='utf-8'))
people=[demo,older];clients=[];report=[]
def request(c,method,path,expected=200,**kwargs):
 r=c.request(method,A+path,**kwargs)
 if r.status_code!=expected:raise RuntimeError(f'{method} {path}: HTTP {r.status_code}; {r.text[:500]}')
 return r.json()
try:
 for person in people:
  c=httpx.Client(timeout=20)
  login=request(c,'POST','/login',data=dict(username=person['cpf'],password=person['password']))
  c.headers['Authorization']='Bearer '+login['access_token'];clients.append(c)
  person['actual_user_id']=request(c,'GET','/me')['id']
 required={'contratos.consultar','contratos.incluir','contratos.alterar','contratos.ativar','contratos.aprovar','contratos.aditar','empenhos.consultar','empenhos.incluir','empenhos.cancelar','medicoes.consultar','medicoes.incluir','saldos.consultar','saldos.estornar'}
 for idx,person in enumerate(people):
  # Quem concede é sempre a OUTRA identidade; A06 continua valendo.
  administrator=clients[1-idx];subject=clients[idx]
  for company in demo['customers']:
   cid=company['id'];office_ids=[o['id'] for o in company['offices']]
   members=request(administrator,'GET',f'/customers/{cid}/memberships',params={'per_page':100})['items']
   member=next(m for m in members if m['user']['id']==person['actual_user_id'])
   assignments=request(administrator,'GET',f'/customers/{cid}/memberships/{member["id"]}/assignments',params={'per_page':100,'status':'active'})['items']
   created=[]
   for role in ['GES','FIN','APR']:
    covered=set()
    for a in assignments:
     if a['role_code']==role:covered.update(office_ids if a['scope_mode']=='all_future' else a['municipal_office_ids'])
    if not set(office_ids)<=covered:
     request(administrator,'POST',f'/customers/{cid}/memberships/{member["id"]}/assignments',expected=201,json=dict(role_code=role,scope_mode='all_current',municipal_office_ids=office_ids,reason='Acesso dos usuários de teste às rotinas de contratos e execução, autorizado pelo responsável.'),headers={'Idempotency-Key':str(uuid.uuid4())});created.append(role)
   for office in company['offices']:
    access=request(administrator,'GET',f'/customers/{cid}/memberships/{member["id"]}/effective-access',params={'municipal_office_id':office['id']})
    missing=required-set(access['permissions'])
    assert not missing,f"Ações ausentes para usuário {person['actual_user_id']} / {cid}/{office['id']}: {sorted(missing)}"
    navigation=request(subject,'GET','/me/navigation',params=dict(mode='office',customer_id=cid,municipal_office_id=office['id']))
    codes={r['code'] for r in navigation['routines']}
    assert {'ope.contratos','ope.empenhos','ope.medicoes'}<=codes
   admin=request(subject,'GET','/me/navigation',params=dict(mode='customer_admin',customer_id=cid))
   assert 'adm.alcadas' in {r['code'] for r in admin['routines']}
   report.append(dict(user_id=person['actual_user_id'],customer=company['name'],offices=[o['name'] for o in company['offices']],roles_created=created,effective_access='confirmed',security_api=True))
 (R/'.local/logs/contracts-menu-access.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print('Acesso efetivo e menus conferidos pela API de segurança: 2 usuários, 2 órgãos e 5 secretarias. Concessões novas:',sum(len(r['roles_created']) for r in report))
finally:
 for c in clients:
  c.post(A+'/auth/logout');c.close()
