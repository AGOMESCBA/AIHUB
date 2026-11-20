"""Três exemplos solicitados, criados exclusivamente pelas APIs existentes."""
from pathlib import Path
from datetime import date,timedelta
import json,httpx,uuid
R=Path('C:/Apps/ELOGESTAO');API='http://127.0.0.1:8012';out=R/'.local/approval-examples.json'
people=[json.loads((R/f).read_text(encoding='utf-8')) for f in ['.local/testes-municipios.json','.local/lotacao-e2e.json']]
company=next(c for c in people[0]['customers'] if c['name']=='Cuiabá');office=next(o for o in company['offices'] if o['name']=='Saúde')
H={'X-Elo-Customer-Id':str(company['id']),'X-Elo-Municipal-Office-Id':str(office['id'])};clients=[];identities=[]
def req(c,method,path,status=200,**kwargs):
 r=c.request(method,API+path,**kwargs);assert r.status_code==status,f'{method} {path}: {r.status_code} {r.text[:350]}';return r
try:
 for person in people:
  c=httpx.Client(timeout=20);data=req(c,'POST','/login',data=dict(username=person['cpf'],password=person['password'])).json();c.headers['Authorization']='Bearer '+data['access_token'];clients.append(c);identities.append(req(c,'GET','/me').json())
 source=req(clients[0],'GET','/contracts/1',headers=H).json();today=date.today()
 configs=[dict(number='DEMO-APROVACAO-USUARIO-27',author=1,price=1000,approvers=[(0,200000)],self_approval=False),dict(number='DEMO-APROVACAO-USUARIO-25',author=0,price=1500,approvers=[(1,300000)],self_approval=False),dict(number='DEMO-APROVACAO-EM-2-NIVEIS',author=0,price=2500,approvers=[(0,300000),(1,500000)],self_approval=True)]
 previous=json.loads(out.read_text(encoding='utf-8')) if out.exists() else None;result=[]
 for config in configs:
  existing=next((c for c in previous['contracts'] if c['number']==config['number']),None) if previous else None
  if existing:
   c=req(clients[config['author']],'GET',f'/contracts/{existing["id"]}',headers=H).json()
  else:
   body=dict(number=config['number'],description='Exemplo de aprovação solicitado pelo responsável: '+('dois níveis sequenciais, um usuário depois do outro' if len(config['approvers'])==2 else 'aprovação individual, com autor diferente do aprovador'),supplier_id=source['supplier_id'],starts_on=str(today),ends_on=str(today+timedelta(days=90)),items=[dict(product_id=source['items'][0]['product_id'],quantity='100',unit_price_cents=config['price'])])
   c=req(clients[config['author']],'POST','/contracts/',status=201,json=body,headers={**H,'Idempotency-Key':str(uuid.uuid4())}).json()
   levels=[dict(mode='any',minimum_cents=0,approvers=[dict(user_id=identities[i]['id'],limit_cents=limit)]) for i,limit in config['approvers']]
   policy=req(clients[0],'PUT',f'/customers/{company["id"]}/contract-approval-policies',json=dict(contract_id=c['id'],levels=levels,allow_self_approval=config['self_approval']),headers={'Idempotency-Key':str(uuid.uuid4())}).json()
   c=req(clients[config['author']],'POST',f'/contracts/{c["id"]}/submit',json={'reason':'Exemplo de aprovação configurado a pedido do responsável, sem registrar decisões automaticamente'},headers={**H,'Idempotency-Key':str(uuid.uuid4()),'If-Match':f'"v{c["version"]}"'}).json()
  assert c['status']=='awaiting_approval'
  round=c['approval_rounds'][-1];assert round['status']=='pending' and round['current_level']==1 and not round['votes']
  for i,client in enumerate(clients):
   queue=req(client,'GET','/contract_approvals/',params={'q':config['number']},headers=H).json();expected=i==config['approvers'][0][0]
   assert (queue['total']==1)==expected,(config['number'],identities[i]['id'],queue['total'])
   req(client,'GET',f'/contract_approvals/{c["id"]}',status=200 if expected else 404,headers=H)
  policy=req(clients[0],'GET',f'/customers/{company["id"]}/contract-approval-policies',params={'contract_id':c['id']}).json()['items'][0]
  result.append(dict(id=c['id'],number=c['number'],amount_cents=c['limit_cents'],author=identities[config['author']]['name'],allow_self_approval=policy['allow_self_approval'],levels=policy['levels'],status=c['status'],current_level=1,votes=0))
 report=dict(url='http://localhost:3006',customer=company['name'],customer_id=company['id'],office=office['name'],office_id=office['id'],users=[{'id':p['id'],'name':p['name']} for p in identities],contracts=result)
 out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'customer':company['name'],'office':office['name'],'contracts':[{'id':c['id'],'number':c['number'],'value':c['amount_cents']/100,'levels':[{'user':level['approvers'][0]['name'],'limit':level['approvers'][0]['limit_cents']/100} for level in c['levels']],'self_approval':c['allow_self_approval']} for c in result]},ensure_ascii=False,indent=2))
finally:
 for c in clients:c.post(API+'/auth/logout');c.close()
