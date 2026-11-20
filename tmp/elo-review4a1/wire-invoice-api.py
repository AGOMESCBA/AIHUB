from pathlib import Path
import json
r=Path('C:/Apps/ELOGESTAO');scratch=Path('C:/Apps/iahub/tmp/elo-review4a1')
for target,source in [('apps/api/app/services/invoices.py','invoices-service.py'),('apps/api/app/routers/invoices.py','invoices-router.py')]:
 (r/target).write_text((scratch/source).read_text(encoding='utf-8'),encoding='utf-8')
p=r/'apps/api/app/services/invoices.py';s=p.read_text(encoding='utf-8').replace('from sqlalchemy import and_,func,or_','from sqlalchemy import and_,func,or_,text').replace("__import__('sqlalchemy').text('SELECT clock_timestamp()')","text('SELECT clock_timestamp()')");p.write_text(s,encoding='utf-8')
p=r/'apps/api/app/main.py';s=p.read_text(encoding='utf-8').replace('from app.routers import contracts','from app.routers import contracts, invoices',1);s+='\napp.include_router(invoices.router)\n';p.write_text(s,encoding='utf-8')
p=r/'apps/api/app/security/guard.py';s=p.read_text(encoding='utf-8').replace('_ACCESS_ADMIN = [','''_ACCESS_ADMIN = [
    ("GET", r"/contract_invoices/?"), ("POST", r"/contract_invoices/?"),
    ("GET", r"/contract_invoices/measurement-options"), ("GET", rf"/contract_invoices{_ID}"),
    ("POST", rf"/contracts{_ID}/invoices{_ID}/cancel"),''',1);p.write_text(s,encoding='utf-8')
p=r/'apps/api/app/services/contracts.py';s=p.read_text(encoding='utf-8');needle="    m.status='reversed';bump(db,m);bump(db,c)";assert needle in s
s=s.replace(needle,"""    from ..models.contracts import ContractInvoice,ContractInvoiceLink
    if db.query(ContractInvoiceLink.id).join(ContractInvoice,ContractInvoice.id==ContractInvoiceLink.invoice_id).filter(
        ContractInvoiceLink.measurement_id==m.id,ContractInvoice.status=='registered').first():
        fail('MEASUREMENT_HAS_INVOICE','Cancele o registro fiscal vinculado antes de estornar a medição.')
"""+needle,1);p.write_text(s,encoding='utf-8')
p=r/'contracts/authorization-inventory.json';data=json.loads(p.read_text(encoding='utf-8'));base=next(o for o in data['operations'] if o['path']=='/contract_commitments/{commitment_id}' and o['method']=='GET')
for method,path,actions in [('GET','/contract_invoices/',['notas_fiscais.consultar']),('POST','/contract_invoices/',['notas_fiscais.incluir','notas_fiscais.consultar','contratos.consultar','medicoes.consultar','empenhos.consultar']),('GET','/contract_invoices/measurement-options',['notas_fiscais.incluir','contratos.consultar','medicoes.consultar','empenhos.consultar']),('GET','/contract_invoices/{invoice_id}',['notas_fiscais.consultar']),('POST','/contracts/{contract_id}/invoices/{invoice_id}/cancel',['notas_fiscais.cancelar','notas_fiscais.consultar','contratos.consultar'])]:
 data['operations'].append({**base,'method':method,'path':path,'actions':actions,'relationships':'Nota vinculada ao fornecedor do contrato e a medições realizadas desse contrato; valor dos vínculos igual ao documento e limitado ao realizado ainda não documentado; sem lançamento no razão.','tests':['tests/test_invoices_api.py'],'consumers':['Elo Gestão › Gestão contratual › Notas fiscais']})
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Serviço, rotas, guarda, proteção do estorno e inventário atualizados')
