from pathlib import Path
import sys,json
r=Path('C:/Apps/ELOGESTAO');sys.path.insert(0,str(r/'tools/dev'))
from database import local_database_url
from sqlalchemy import create_engine,text
e=create_engine(local_database_url())
with e.connect() as c:
    for name,file in [('Usuário anterior','lotacao-e2e.json'),('Usuário Cuiabá/Sinop','testes-municipios.json')]:
        cfg=json.loads((r/'.local'/file).read_text(encoding='utf-8'))
        rows=c.execute(text("SELECT u.id,u.name,cm.customer_id,cu.name AS orgao,cm.status FROM users u JOIN customer_memberships cm ON cm.user_id=u.id JOIN customers cu ON cu.id=cm.customer_id WHERE u.cpf=:cpf AND cm.audience='internal' ORDER BY cu.id"),dict(cpf=cfg['cpf'])).mappings().all()
        print(name,[dict(row) for row in rows])
    print('Nome antigo:',[dict(row) for row in c.execute(text("SELECT id,name,version,auth_version FROM customers WHERE name=:name"),dict(name='Órgão sintético de desenvolvimento')).mappings()])
e.dispose()
