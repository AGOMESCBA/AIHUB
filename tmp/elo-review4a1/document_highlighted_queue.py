from pathlib import Path
p=Path('C:/Apps/ELOGESTAO/docs/planejamento-consolidado.md');s=p.read_text(encoding='utf-8');assert '## 53.10 Fila de aprovadores em destaque' not in s
s=s.replace('Versão 2.46 consolidada','Versão 2.47 consolidada',1)
s=s.replace('## 24.6 Registro das entregas e mudanças de direção\n','## 24.6 Registro das entregas e mudanças de direção\n\nFila de aprovadores em destaque — 17 de novembro de 2026, versão 2.47: fila como primeiro bloco da análise, antes dos indicadores, com nomes e situações individuais explícitos por nível; 7/7 verificações visuais aprovadas em 3006, sem decisões nos exemplos. Seção 53.10.\n',1)
text='''

## 53.10 Fila de aprovadores em destaque

O responsável reiterou que a análise de aprovação precisa mostrar a fila dos aprovadores. O fluxo existente foi destacado como **Fila de aprovadores**, primeiro bloco da análise, antes dos valores/alçadas e dos dados do contrato. Os níveis aparecem em sequência, com nome de cada participante, alçada e situação individual: Aprovou, Reprovou, Aguardando decisão neste nível, Aguardando nível anterior ou etapa concluída por outro aprovador. As decisões anteriores continuam com justificativa e data. O mesmo componente é utilizado na consulta das aprovações do contrato.

Mudança somente de apresentação: sem migração, nova API, concessão ou alteração das regras de decisão. Registros da rodada submetida continuam preservados. Os três exemplos de 53.9 foram mantidos para avaliação, sem decisões automáticas. Na análise do contrato DEMO-APROVACAO-EM-2-NIVEIS, o nível 1 identifica o Gestor de testes como aguardando decisão e o nível 2 identifica o Gestor de transferência como aguardando nível anterior.

Validação proporcional: lint dos arquivos afetados sem erros (aviso anterior de declaração de PolicyForm); build completo aprovado, incluindo tipos; 7/7 verificações reais no navegador, cobrindo ambas as identidades, nomes/alçadas, ordem dos níveis, posição da fila no topo, estados individuais e recusa do segundo aprovador antes da sua vez. Logs em .local/logs/approver-queue-* e resultado em .local/logs/contracts-browser/approver-queue-highlight-result.json. Não repetida a suíte da API, pois não houve mudança no servidor. Prévia http://localhost:3006 atualizada, compilada fora da pasta então ativa e ativada em .local/lotacao-web; API 8012 mantida. Sem commit, push ou produção.
'''
pos=s.find('\n## 52.5 ',s.index('## 53.9'));s=s[:pos]+text+'\n'+s[pos:] if pos>=0 else s+text
p.write_text(s,encoding='utf-8');print('Controle 2.47 atualizado com a fila em destaque e evidências.')
