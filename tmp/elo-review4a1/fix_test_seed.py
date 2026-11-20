from pathlib import Path
p=Path('C:/Apps/ELOGESTAO/apps/api/tests/test_contracts_api.py');s=p.read_text(encoding='utf-8').replace('cnpj(991100000001)','cnpj(99110001)').replace('valid_cnpj(991100000002)','valid_cnpj(99110002)')
s=s.replace("            _insert(c,'role_assignment_offices',customer_id=ids['A'],assignment_id=a,municipal_office_id=ids['A1']) if False else c.execute",'            c.execute')
p.write_text(s,encoding='utf-8')
