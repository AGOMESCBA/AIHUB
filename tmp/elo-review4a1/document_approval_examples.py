from pathlib import Path
import json
R=Path('C:/Apps/ELOGESTAO');p=R/'docs/planejamento-consolidado.md';s=p.read_text(encoding='utf-8');data=json.loads((R/'.local/approval-examples.json').read_text(encoding='utf-8'))
assert '## 53.9 Exemplos de aprovação para os dois usuários' not in s
s=s.replace('Versão 2.45 consolidada','Versão 2.46 consolidada',1)
marker='## 24.6 Registro das entregas e mudanças de direção\n'
s=s.replace(marker,marker+'\nExemplos de aprovação — 17 de novembro de 2026, versão 2.46: três contratos pendentes em Cuiabá/Saúde, um para cada testador e um sequencial (27 → 25), com regras cadastradas pelas APIs existentes e nenhuma decisão registrada automaticamente. Correção de retorno à fila ativada em 3006; 8/8 verificações do fluxo e 4/4 dos exemplos aprovadas. Seção 53.9; sem commit ou push nesta preparação.\n',1)
text='''

## 53.9 Exemplos de aprovação para os dois usuários

Preparação expressamente solicitada pelo responsável: contrato individual para cada usuário e um terceiro com aprovação de ambos, em sequência. Todos em **Cuiabá › Saúde**, no ambiente sintético http://localhost:3006. As alçadas foram cadastradas pelas APIs de Administração existentes; contratos criados e submetidos pelas APIs operacionais; sem SQL direto e sem novas permissões. Os perfis de teste já possuem as ações necessárias, dentro de seus órgãos/secretarias.

| Contrato | Valor | Nível 1 / alçada | Nível 2 / alçada | Autoaprovação |
| --- | --- | --- | --- | --- |
'''
fmt=lambda n:f'R$ {n/100:,.2f}'.replace(',','_').replace('.',',').replace('_','.')
for c in data['contracts']:
 levels=[f"{l['approvers'][0]['name']} / {fmt(l['approvers'][0]['limit_cents'])}" for l in c['levels']]
 text+=f"| {c['number']} (id {c['id']}) | {fmt(c['amount_cents'])} | {levels[0]} | {levels[1] if len(levels)>1 else '—'} | {'Habilitada somente neste exemplo' if c['allow_self_approval'] else 'Bloqueada'} |\n"
text+='''
As regras de cada contrato estão em **Administração do órgão › Gestão contratual › Alçadas contratuais**: selecionar o contrato para ver os usuários, os níveis, o modo um aprovador e os limites. Todos os níveis têm mínimo de aplicação zero. Os limites são de autorização por operação; não são um saldo consumível.

Nos individuais, a autoria foi cruzada: usuário 25 criou o contrato do 27 e vice-versa, mantendo a autoaprovação bloqueada. No sequencial, o usuário 27 criou e submete, participa do nível 1, e o 25 participa do nível 2; por isso a autoaprovação está explicitamente habilitada apenas nesse exemplo. Não houve exceção no motor ou concessão implícita. A fila do segundo usuário não mostra esse contrato antes da aprovação do primeiro; acesso direto à análise fora do nível atual foi recusado com 404.

Todos os três ficaram em Aguardando aprovação, nível 1, sem votos, para o responsável testar. A análise mostra o fluxo, nomes, alçadas e dados/itens somente leitura. Exemplos e evidências sem senhas em .local/approval-examples.json e .local/logs/contracts-browser/approval-examples-result.json.

**Validação e ativação:** compilação final aprovada; prévia 3006 ativada a partir de .local/approval-web-final, API 8012, processos em .local/lotacao-processes.json. Oito verificações do fluxo no navegador aprovadas, incluindo o retorno à fila após a decisão, avanço de nível, reprovação, preservação dos dados e cabeçalho/itens na Visão geral (.local/logs/approval-queue-browser-final.log). Quatro verificações adicionais dos exemplos aprovadas: análise individual em ambas as identidades, apresentação dos dois níveis e bloqueio do segundo aprovador antes da sua vez (.local/logs/approval-examples-browser.log). As decisões automáticas do ensaio ficaram exclusivamente no contrato sintético TESTE-FILA; os três novos exemplos não foram aprovados nem reprovados pelo roteiro. A pendência de ativação da correção relatada durante o limite de uso está resolvida. Revisão independente e limites de produção permanecem conforme 53.6.
'''
anchor=s.find('\n## 52.5 ',s.index('## 53.8'))
s=s[:anchor]+text+'\n'+s[anchor:] if anchor>=0 else s+text
p.write_text(s,encoding='utf-8');print('Controle 2.46: três exemplos e conclusão da validação registrados.')
