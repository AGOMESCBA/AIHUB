from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
p=R/'apps/backoffice/src/workspace/groups.ts';s=p.read_text(encoding='utf-8')
s=s.replace("  | 'operacoes'","  | 'operacoes'\n  | 'contratos'",1)
needle="  {\n    code: 'operacoes',"
assert needle in s;s=s.replace(needle,"  {\n    code: 'contratos',\n    title: 'Gestão contratual',\n    description: 'Contratos, alçadas de aprovação e acompanhamento da execução financeira.',\n  },\n"+needle,1)
for code,old in [('adm.alcadas','acessos'),('ope.contratos','operacoes'),('ope.empenhos','operacoes'),('ope.medicoes','operacoes')]:
 a=f"'{code}': '{old}'";assert a in s;s=s.replace(a,f"'{code}': 'contratos'",1)
p.write_text(s,encoding='utf-8')
p=R/'apps/backoffice/src/workspace/routine-icon.tsx';s=p.read_text(encoding='utf-8');assert '  operacoes: Workflow,' in s;s=s.replace('  operacoes: Workflow,','  contratos: FileText,\n  operacoes: Workflow,',1);p.write_text(s,encoding='utf-8')
p=R/'docs/planejamento-consolidado.md';s=p.read_text(encoding='utf-8')
s+='''

## 53.7 Menu lateral e cards — Gestão contratual

Por solicitação do responsável, as rotinas deste lote usam o grupo **Gestão contratual** tanto no menu lateral quanto nos cards da página inicial. Em Elo Gestão: Contratos, Empenhos e Medições, nesta ordem. Em Administração do órgão: Alçadas contratuais. Cada rotina conserva seu ícone e abre na própria estrutura de abas; ícone do grupo é documento. Menu e cards usam o mesmo groupRoutines, sem segunda lista independente. Grupos recolhíveis, busca, preferência de apresentação e abertura do grupo ativo seguem os componentes existentes. Rotinas e grupos só aparecem quando retornados pela navegação autorizada da API; nenhuma permissão foi ampliada. Ambiente principal: http://localhost:3006.
'''
p.write_text(s,encoding='utf-8')
print('Grupo Gestão contratual aplicado ao menu e aos cards, preservando a navegação autorizada.')
