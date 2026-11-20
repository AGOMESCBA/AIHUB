from pathlib import Path
import json, importlib.util
r=Path('C:/Apps/ELOGESTAO')
p=r/'apps/api/alembic/versions/elo_fase4a_0023_transferencia_de_lotacao.py'
spec=importlib.util.spec_from_file_location('migration',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
p.write_text('''"""Transferência com autorização nas duas secretarias e histórico imutável em audit_events.

O papel da aplicação não recebe UPDATE da secretaria. O comando é executado pelo dono,
confere sessão, ações nas duas secretarias e referências após os bloqueios. Saldo legado
não nulo/zero e ocupação bloqueiam a operação. O downgrade preserva os eventos e a lotação.
"""
from alembic import op

revision = "elo_fase4a_0023"
down_revision = "elo_fase4a_0022"
branch_labels = None
depends_on = None

UPGRADE = r"""
'''+m.UPGRADE+'\n"""\n\nDOWNGRADE = r"""\n'+m.DOWNGRADE+'\n"""\n\n\ndef upgrade():\n    op.execute(UPGRADE)\n\n\ndef downgrade():\n    op.execute(DOWNGRADE)\n',encoding='utf-8')
p=r/'contracts/authorization-inventory.json';d=json.loads(p.read_text(encoding='utf-8'))
template=next(o for o in d['operations'] if o['path']=='/vehicles/{vehicle_id}/status' and o['method']=='POST')
for method,suffix,actions in [('POST','transfer',['cad.veiculos.consultar','cad.veiculos.transferir_lotacao']),
                               ('GET','transfer-options',['cad.veiculos.consultar','cad.veiculos.transferir_lotacao']),
                               ('GET','transfers',['cad.veiculos.consultar'])]:
    entry={**template,'method':method,'path':'/vehicles/{vehicle_id}/'+suffix,'actions':actions,
       'context':'Secretaria da origem; transferência exige consultar e transferir_lotacao também no destino.',
       'ownership':'Mesmo órgão; origem e destino autorizados explicitamente; nenhum saldo financeiro transferido.',
       'relationships':'Frota ativa no destino; modelo e departamento compatíveis; sem ocupação ou saldo legado pendente.',
       'database':'elo_app; função restrita elo_vehicle_transfer revalida depois dos bloqueios; histórico append-only nas duas secretarias.',
       'tests':['test_vehicle_transfers.py'],'consumers':['Veículos: transferência e histórico'],'office_sharing':'Não compartilhado: muda a lotação por comando próprio.'}
    d['operations'].append(entry)
if 'summary' in d:
    print('Estrutura do resumo:',type(d['summary']).__name__)
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
p=r/'tools/dev/export_contracts.py';s=p.read_text(encoding='utf-8')
s=s.replace('"etapa-4a7-em-revisao-local-sintetico"','"etapa-4a-transferencia-validacao-local"')
needle='        "implemented": [\n'
assert needle in s
s=s.replace(needle,needle+'            {"flow": "transferencia-lotacao", "paths": ["/vehicles/{vehicle_id}/transfer", "/vehicles/{vehicle_id}/transfer-options", "/vehicles/{vehicle_id}/transfers"], "scope": "Mesmo órgão, permissão nas duas secretarias, motivo, versão, idempotência e histórico; sem ocupação nem saldo legado pendente."},\n')
p.write_text(s,encoding='utf-8')
print('Contratos e migração legíveis preparados.')
