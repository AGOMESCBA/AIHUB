from pathlib import Path
import sys,json,secrets
from datetime import datetime,timezone
r=Path('C:/Apps/ELOGESTAO');sys.path[:0]=[str(r/'apps/api'),str(r/'tools/dev'),str(r/'apps/api/tests')]
from sqlalchemy import create_engine,text
from database import local_database_url
from test_fase34_access_api import valid_cpf,_user
from test_fase3_foundation import _insert
from app.services.crypt_service import CryptService
engine=create_engine(local_database_url()); password=secrets.token_urlsafe(24)
with engine.begin() as c:
    offices=c.execute(text("SELECT id,customer_id,name FROM municipal_offices WHERE name IN ('Unidade sintética','Secretaria sintética de saúde') AND deleted_at IS NULL ORDER BY id")).all()
    assert len(offices)==2 and offices[0].customer_id==offices[1].customer_id
    source=next(o for o in offices if o.name=='Unidade sintética');target=next(o for o in offices if o.id!=source.id)
    cpf=valid_cpf(990000000+secrets.randbelow(9000000))
    user=_insert(c,'users',cpf=cpf,rg='SINT',name='Gestor sintético de transferência',email=f'lotacao-{cpf}@example.invalid',phone='0',password=CryptService().encrypt(password))
    membership=_insert(c,'customer_memberships',customer_id=source.customer_id,user_id=user,audience='internal')
    role=c.execute(text("SELECT id FROM role_templates WHERE code='GES'")).scalar_one()
    assignment=_insert(c,'role_assignments',customer_id=source.customer_id,membership_id=membership,role_id=role,scope_mode='selected',granted_by=user)
    for office in (source,target):
        c.execute(text('INSERT INTO role_assignment_offices(customer_id,assignment_id,municipal_office_id) VALUES(:c,:a,:o)'),dict(c=source.customer_id,a=assignment,o=office.id))
    stamp=datetime.now(timezone.utc).strftime('%H%M%S')
    category=_insert(c,'vehicle_model_categories',name='Categoria sintética de transferência '+stamp)
    model=_insert(c,'vehicle_models',code='LOT-'+stamp,name='Modelo sintético de transferência',owner_kind='platform',category_id=category)
    fleets=[_insert(c,'vehicle_fleets',customer_id=source.customer_id,municipal_office_id=o.id,name='Frota transferência '+stamp,created_by=user) for o in (source,target)]
    result=dict(cpf=cpf,password=password,customer_id=source.customer_id,source_office_id=source.id,target_office_id=target.id,
                source_fleet_id=fleets[0],target_fleet_id=fleets[1],model_id=model,user_id=user)
(r/'.local/lotacao-e2e.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print('Gestor sintético restrito às duas secretarias criado; credenciais somente em .local/lotacao-e2e.json.')
engine.dispose()
