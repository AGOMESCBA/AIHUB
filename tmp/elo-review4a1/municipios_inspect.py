import sys
sys.path.insert(0,'tools/dev')
from database import local_database_url
from sqlalchemy import create_engine,text
e=create_engine(local_database_url())
with e.connect() as c:
    for label,sql,params in [
        ('Órgãos existentes','SELECT id,name,status FROM customers WHERE lower(name) IN (:a,:b,:d)',dict(a='cuiabá',b='sinop',d='cuiaba')),
        ('Recursos','SELECT code,allowed_modes,default_mode FROM resource_definitions ORDER BY code',{}),
        ('Colunas da política',"SELECT column_name FROM information_schema.columns WHERE table_name='resource_sharing_policies' ORDER BY ordinal_position",{}),
        ('Perfis',"SELECT code,name FROM role_templates WHERE code IN ('GES','ORG-ADM')",{})]:
        print(label,[dict(x._mapping) for x in c.execute(text(sql),params)])
e.dispose()
