from pathlib import Path
p=Path('C:/Apps/ELOGESTAO/docs/planejamento-consolidado.md');s=p.read_text(encoding='utf-8')
old='- As oito verificações visuais antecedem a incorporação final do retorno automático à lista do padrão de 52.1; a validação pontual desse retorno é registrada após a reconstrução da prévia, sem repetir o fluxo financeiro inteiro.'
new='- Após incorporar o padrão de 52.1 e reconstruir a prévia, 3/3 verificações pontuais adicionais passaram no navegador: inclusão na própria aba, Cancelar retornando à GRID e Salvar retornando à GRID com sucesso sem criar aba. Evidência em .local/logs/contracts-browser/pattern-result.json; monitor final capturado. Tipos sem erros; build concluído, com avisos de lint sem erros. Inventário revalidado após as alterações concorrentes: 3/3. OpenAPI atual com 196 operações, incluindo contratos e preferências. Não houve repetição do fluxo financeiro inteiro.'
assert old in s;s=s.replace(old,new,1)
# A linha inicial é um resumo atual, não a reescrita do histórico de fases.
s=s.replace('transferência de lotação pendente de regras (43.8); 4B não iniciada.','transferência de lotação e demais complementos conforme seções posteriores; núcleo 4B/4C implementado localmente, Em revisão (53).',1)
p.write_text(s,encoding='utf-8')
for line_no,line in enumerate(s.splitlines(),1):
 if line.startswith('# 53.'):print('Seção 53:',line_no)
 # Verifica apenas a nova seção; outros lotes permanecem preservados.
part=s[s.index('# 53.'):];width=None
for line in part.splitlines():
 if line.startswith('|'):
  n=line.count('|')
  if width is None:width=n
  assert n==width,line
 else:width=None
print('Documentação e colunas de tabelas conferidas.')
