from pathlib import Path
from datetime import date,timedelta
import json,httpx,uuid
R=Path('C:/Apps/ELOGESTAO');A='http://127.0.0.1:8012'
demo=json.loads((R/'.local/testes-municipios.json').read_text(encoding='utf-8'));older=json.loads((R/'.local/lotacao-e2e.json').read_text(encoding='utf-8'))
company=next(c for c in demo['customers'] if c['name']=='Cuiabá');office=next(o for o in company['offices'] if o['name']=='Saúde')
H={'X-Elo-Customer-Id':str(company['id']),'X-Elo-Municipal-Office-Id':str(office['id'])};clients=[]
def req(client,method,path,status=200,**kwargs):
 r=client.request(method,A+path,**kwargs);assert r.status_code==status,f'{path}: {r.status_code} {r.text[:300]}';return r
try:
 for person in [demo,older]:
  c=httpx.Client(timeout=20);r=req(c,'POST','/login',data=dict(username=person['cpf'],password=person['password'])).json();c.headers['Authorization']='Bearer '+r['access_token'];clients.append(c)
 approver,author=clients;uid=req(approver,'GET','/me').json()['id'];source=req(author,'GET','/contracts/1',headers=H).json();now=date.today();result=[]
 previous=json.loads((R/'.local/approval-demo.json').read_text(encoding='utf-8')) if (R/'.local/approval-demo.json').exists() else None
 if previous:
  for old in previous['contracts']:
   if old['purpose']!='TESTE-FILA':continue
   current=req(author,'GET',f'/contracts/{old["id"]}',headers=H).json()
   if any(r['status']=='pending' for r in current['approval_rounds']):
    req(author,'POST',f'/contracts/{old["id"]}/withdraw',json={'reason':'Ensaio anterior encerrado; preservar decisões e retirar pendência sintética'},headers={**H,'Idempotency-Key':str(uuid.uuid4()),'If-Match':f'"v{current["version"]}"'})
 for label in (['TESTE-FILA'] if previous else ['TESTE-FILA','AVALIAR-FILA']):
  body=dict(number=label+'-'+uuid.uuid4().hex[:7],description='Demonstração local da análise de aprovação somente leitura',supplier_id=source['supplier_id'],starts_on=str(now),ends_on=str(now+timedelta(days=60)),items=[dict(product_id=source['items'][0]['product_id'],quantity='100',unit_price_cents=1000)])
  c=req(author,'POST','/contracts/',status=201,json=body,headers={**H,'Idempotency-Key':str(uuid.uuid4())}).json()
  levels=[dict(mode='any',minimum_cents=0,approvers=[dict(user_id=uid,limit_cents=200000)]) for _ in range(2)]
  req(approver,'PUT',f'/customers/{company["id"]}/contract-approval-policies',json=dict(contract_id=c['id'],levels=levels),headers={'Idempotency-Key':str(uuid.uuid4())})
  c=req(author,'POST',f'/contracts/{c["id"]}/submit',json={'reason':'Avaliação local autorizada da nova fila de aprovação'},headers={**H,'Idempotency-Key':str(uuid.uuid4()),'If-Match':f'"v{c["version"]}"'}).json()
  own=req(author,'GET','/contract_approvals/',params={'q':c['number']},headers=H).json();assert own['total']==0
  own=req(approver,'GET','/contract_approvals/',params={'q':c['number']},headers=H).json();assert own['total']==1
  result.append({'id':c['id'],'number':c['number'],'purpose':label})
 if previous:result.extend(c for c in previous['contracts'] if c['purpose']=='AVALIAR-FILA')
 (R/'.local/approval-demo.json').write_text(json.dumps({'customer_id':company['id'],'office_id':office['id'],'contracts':result},ensure_ascii=False,indent=2),encoding='utf-8');print('Cenário sintético preparado via API, preservando a pendência de avaliação existente. Autor sem acesso à própria fila confirmado.')
finally:
 for c in clients:c.post(A+'/auth/logout');c.close()
