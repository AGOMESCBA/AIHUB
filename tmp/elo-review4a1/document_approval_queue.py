from pathlib import Path
R=Path('C:/Apps/ELOGESTAO');p=R/'docs/planejamento-consolidado.md';s=p.read_text(encoding='utf-8')
s=s.replace('Versão 2.44 consolidada','Versão 2.45 consolidada',1)
s=s.replace('## 24.6 Registro das entregas e mudanças de direção\n','## 24.6 Registro das entregas e mudanças de direção\n\nAprovações e Visão geral — 17 de novembro de 2026, versão 2.45: fila pessoal de contratos/aditivos, análise somente leitura e botões Aprovar/Reprovar; cabeçalho e itens juntos na Visão geral. Reutiliza decisões e alçadas existentes, sem migração ou nova concessão; seção 53.8. Entrega local, Em revisão, sem commit ou push.\n',1)
s+='''

## 53.8 Fila pessoal de aprovações e Visão geral completa

Decisão do responsável: uma rotina separada com a grid somente dos contratos que aguardam aprovação do usuário. Solicitação adicional: Visão geral deve mostrar todos os dados do contrato, cabeçalho e itens.

**Entregue:** Elo Gestão › Gestão contratual › Aprovações, no menu e nos cards, com a mesma navegação por permissão. A fila inclui contratos e aditivos no nível atual, por órgão/secretaria da aba; filtro do número na coluna, tipo contrato/aditivo, paginação e preferências comuns de grid. Não agrega outros órgãos ou secretarias. Alçadas continuam na Administração do órgão.

**API:** GET /contract_approvals/ e /contract_approvals/{contract_id}. Exigem contratos.consultar e contratos.aprovar; filtro de pessoa, nível, limite suficiente, autoaprovação e ausência de voto anterior aplicado no banco antes da contagem/paginação. Detalhe fora da fila recebe 404. Papel sem a ação recebe 403. A configuração de alçada não concede a ação de aprovar. As decisões reutilizam POST /contracts/{id}/decisions com If-Match, Idempotency-Key, justificativa, auditoria e revalidação de autoridade depois do bloqueio. Nenhuma migração ou novo perfil.

**Análise:** tela somente leitura com dados e itens, versão submetida, fluxo sequencial de níveis, nomes dos aprovadores, limites, decisão/justificativa/data já registradas, nível atual e próximos. Mostra valor submetido, alçada individual e margem; alçada é limite por operação, não carteira consumível. Aprovar/Reprovar exigem justificativa e confirmação. Não há botão de alterar, de aditar ou de movimentar saldo nessa análise. Aditivos apresentam também quantidades propostas, novo término e total resultante; a base vigente permanece identificada. As decisões saíram do seletor genérico de Ação do cadastro para evitar confundir aprovação com manutenção.

**Visão geral:** cabeçalho do contrato (número, órgão, secretaria, fornecedor, vigência, objeto, valor, versão e autoria/data), grid dos itens e indicadores financeiros na mesma aba, sem exigir abrir Itens. Itens continua como atalho de consulta. Componentes de cabeçalho/itens reutilizados na análise; os dados nunca viram campos editáveis ali.

**Verificações direcionadas:** três testes novos da fila aprovados (níveis/visibilidade, voto único em modo todos/aditivo, autoaprovação/revogação); regressões anteriores de contratos executadas; inventário 3/3; testes web 32/32; tipos sem erros. A primeira execução encontrou uma falha no teste que tentava atualizar alçada sem If-Match; o teste foi corrigido para informar a versão, preservando a exigência do produto. OpenAPI com 198 operações; inventário, intermediário, compatibilidade e manual atualizados. Logs em .local/logs/approval-queue-*.

Ambiente principal preservado em http://localhost:3006 com API 8012. Compilação em pasta local isolada para não substituir arquivos da prévia durante o uso. Cenário sintético preparado pelas APIs em .local/approval-demo.json: contrato TESTE-FILA para conferir avanço/reprovação e AVALIAR-FILA para o responsável avaliar com o usuário de .local/testes-municipios.json. Autor distinto do aprovador, sem exceção de autoaprovação. A aprovação de dois níveis pelo mesmo usuário foi configurada apenas como demonstração; níveis com usuários distintos e modo todos estão cobertos pelos testes de API. Sem dados reais, commit, push ou produção. Revisão independente continua pendente.
'''
p.write_text(s,encoding='utf-8');print('Controle 2.45 atualizado, com seção 53.8 e limites da entrega.')
