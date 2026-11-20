from pathlib import Path
import json
R=Path('C:/Apps/ELOGESTAO')
p=R/'apps/api/app/services/contracts.py';s=p.read_text(encoding='utf-8');s=s.replace('Fila própria: filtra no banco ANTES da contagem/paginação; não concede autorização.','Pendências próprias nos níveis atual e futuros, filtradas antes da paginação; visibilidade não autoriza decisão.');p.write_text(s,encoding='utf-8')
p=R/'apps/api/app/routers/me.py';s=p.read_text(encoding='utf-8');s=s.replace('Contratos e aditivos que aguardam sua decisão.','Contratos e aditivos dos seus níveis, com decisão liberada ou aguardando a etapa anterior.');p.write_text(s,encoding='utf-8')
p=R/'apps/api/app/routers/contracts.py';s=p.read_text(encoding='utf-8');needle="    rows=svc.approval_queue(db,ctx)";assert needle in s;s=s.replace(needle,'    """Pendências nos níveis atuais e futuros. can_decide informa a liberação real; my_level é o nível do usuário e current_level é o nível atual da rodada."""\n'+needle,1);p.write_text(s,encoding='utf-8')
p=R/'contracts/authorization-inventory.json';data=json.loads(p.read_text(encoding='utf-8'))
for value in data.values():
 if isinstance(value,list):
  for entry in value:
   if isinstance(entry,dict) and entry.get('path','').startswith('/contract_approvals'):
    entry['ownership']='Pendências da própria pessoa em nível atual ou futuro, no órgão/secretaria autorizado, com alçada e sem voto anterior; nível futuro pode consultar, mas a API recusa aprovar/reprovar antes da vez.'
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
p=R/'apps/backoffice/src/app/app/documentacao/access-manual.tsx';s=p.read_text(encoding='utf-8');s=s.replace('A grid mostra somente contratos e aditivos no seu nível atual, dentro da secretaria da aba.','A grid mostra contratos e aditivos dos seus níveis atuais e futuros, dentro da secretaria da aba. Níveis futuros aparecem como aguardando o nível anterior e permitem somente consulta; Aprovar e Reprovar ficam bloqueados na tela e na API até chegar sua vez.');s=s.replace('Analisar aprovação abre dados e itens somente leitura, fluxo dos níveis, valor submetido, sua alçada e a margem.','A análise abre dados e itens somente leitura; os botões ficam no topo. A fila completa dos níveis aparece à esquerda, com nomes, alçadas e situações, podendo ser recolhida para ampliar os dados. No celular, use Exibir fila de aprovadores para abri-la.');p.write_text(s,encoding='utf-8')
print('Contratos e manual descrevem consulta dos próximos níveis e decisão bloqueada.')
