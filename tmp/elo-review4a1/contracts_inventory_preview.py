from pathlib import Path
import json,sys,shutil,re
R=Path('C:/Apps/ELOGESTAO');sys.path.insert(0,str(R/'apps/api'))
from dotenv import load_dotenv
load_dotenv(R/'apps/api/.env')
from app.routers.contracts import router,admin_router
path=R/'contracts/authorization-inventory.json';data=json.loads(path.read_text(encoding='utf-8'))
for route in [*router.routes,*admin_router.routes]:
    for method in route.methods-{'HEAD','OPTIONS'}:
        admin=route.path.startswith('/customers/')
        actions=[]
        if admin:actions=['config.alcadas.alterar' if method=='PUT' else 'config.alcadas.consultar']
        elif route.path.startswith('/contract_measurements'):actions=['medicoes.incluir' if method=='POST' else 'medicoes.consultar']
        elif route.path.startswith('/contract_commitments'):actions=['empenhos.incluir' if method=='POST' else 'empenhos.consultar']
        elif '/decisions' in route.path:actions=['contratos.aprovar']
        elif '/amendments' in route.path:actions=['contratos.aditar']
        elif '/commitments/' in route.path:actions=['empenhos.cancelar']
        elif '/measurements/' in route.path:actions=['saldos.estornar']
        elif '/balance' in route.path:actions=['saldos.consultar']
        elif '/submit' in route.path or '/resume' in route.path:actions=['contratos.ativar']
        elif '/withdraw' in route.path or method=='PUT':actions=['contratos.alterar']
        elif '/close' in route.path:actions=['contratos.encerrar']
        elif '/suspend' in route.path or '/cancel' in route.path:actions=['contratos.cancelar']
        elif '/export' in route.path:actions=['contratos.consultar','contratos.exportar']
        else:actions=['contratos.incluir' if method=='POST' else 'contratos.consultar']
        if any(x['path']==route.path and x['method']==method for x in data['operations']):continue
        data['operations'].append(dict(method=method,path=route.path,status='protegida',audience=['interno'],
            area='Administração do órgão' if admin else 'Elo Gestão',actions=actions,
            context='Órgão administrativo, abrangência da atribuição ORG-ADM' if admin else 'Órgão e secretaria da aba',
            ownership='Órgão e secretaria definidos pelo servidor; IDs fora do contexto recebem 404',
            office_sharing='Contratos e execução exclusivos de uma secretaria; nunca compartilhados',
            relationships='Fornecedor visível ativo e itens de produto com snapshot; execução vinculada ao contrato por FK; alçadas não concedem permissões',
            database='elo_app sem superusuário; RLS por órgão/secretaria; bloqueio administrativo e do contrato; razão e votos sem UPDATE/DELETE; limites financeiros no banco',
            consumers=['Administração › Alçadas contratuais' if admin else 'Elo Gestão › Contratos, Empenhos e Medições'],
            tests=['tests/test_contracts_api.py','tests/test_contract_finance.py'],pending=None,
            evidence_scope='Amostra crítica 4B/4C; homologação local e revisão independente ainda necessárias'))
path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
preview=R/'.local/contracts-web';preview.mkdir(exist_ok=True)
for p in (R/'.local/login-final-web').iterdir():
    if p.is_file() and p.name not in ('tsconfig.tsbuildinfo',):shutil.copy2(p,preview/p.name)
for name in ('src','public'):shutil.copytree(R/'apps/backoffice'/name,preview/name,dirs_exist_ok=True)
env=preview/'.env.local';s=env.read_text(encoding='utf-8')
print('Chaves de configuração da prévia:',','.join(re.findall(r'^([A-Z_0-9]+)=',s,re.M)))
for key in ('API_INTERNAL_URL','API_URL','NEXT_PUBLIC_API_URL','ELO_API_URL'):
    s=re.sub(rf'^{key}=.*$',f'{key}=http://127.0.0.1:8013',s,flags=re.M)
env.write_text(s,encoding='utf-8')
print('Inventário atualizado e prévia isolada preparada.')
