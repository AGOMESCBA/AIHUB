from pathlib import Path
R=Path('C:/Apps/ELOGESTAO');p=R/'docs/planejamento-consolidado.md';s=p.read_text(encoding='utf-8')
assert '# 53.' not in s
s=s.replace('Atualização: 16 de novembro de 2026 • Versão 2.43 consolidada','Atualização: 17 de novembro de 2026 • Versão 2.44 consolidada',1)
s=s.replace('| 4B — contratos | Pendente | Telas recebidas; API correspondente não localizada no acervo. | Especificar e implementar o módulo completo. |','| 4B — contratos | Implementado no recorte local; Em revisão | Contrato por secretaria, itens, vigência, alçadas sequenciais configuráveis, estados, aditivos e monitor (53). | Revisão independente, aceite funcional e complementos registrados em 53.6. |',1)
s=s.replace('| 4C — empenhos e saldos | Pendente; legado parcial | Há rotas e modelos de saldo direto, sem homologação financeira. | Definir carteiras e movimentos, integrar contratos e implementar consistência e reconciliação. |','| 4C — empenhos e saldos | Núcleo contratual implementado localmente; Em revisão | Empenhos autorizados na origem, reserva, medição sem nova alçada, estorno e saldo por contrato (53). Saldo direto legado não convertido. | Revisão independente e aceite do núcleo. Pagamentos, dados bancários/PIX e integrações contábeis permanecem pendentes. |',1)
at='## 24.6 Registro das entregas e mudanças de direção\n'
s=s.replace(at,at+'\nContratos e execução — 17 de novembro de 2026, versão 2.44: núcleo conjunto 4B/4C implementado por autorização do responsável, preservando o padrão compartilhado de GRID/CRUD, menu, cards e abas. Alçadas por contrato com níveis e limites por aprovador; empenho autorizado externamente; medição sem nova aprovação. Implementado localmente, Em revisão, sem commit, push ou produção. Evidências, sequência de migrações e limitações em 53.\n',1)
s += '''
# 53. Contratos e execução contratual — 4B/4C

## 53.1 Situação e decisões

**Implementado no recorte local, Em revisão.** O responsável autorizou desenvolver contratos e empenhos/saldos em conjunto, preparando a integração com etapas posteriores e seguindo o padrão de telas da worktree. Não representa encerramento integral da Fase 4 nem liberação de produção. Alterações das outras sessões preservadas; nenhum commit ou push deste lote.

- Contrato pertence exclusivamente a um órgão e uma secretaria. Não há compartilhamento ou transferência do contrato entre secretarias.
- Aprovação do contrato inteiro por níveis sequenciais configurados na Administração: usuários, limite individual em reais, valor mínimo de aplicação do nível e modo um/todos. O limite é autoridade para aprovar o valor, não uma carteira consumível do aprovador. Aditivo usa o valor total resultante.
- Autoaprovação desabilitada por padrão, podendo ser explicitamente permitida na política. Mesmo habilitada, exige ação e limite válidos. Sem política ou sem aprovador elegível em um nível obrigatório, submissão recusada.
- Medição de contrato aprovado não recebe nova alçada; continua exigindo permissão de registro, vigência, referência de ateste, responsável e saldo de item/empenho.
- Empenho registra uma autorização obtida no sistema contábil de origem, com referência e responsável; Elo não emite nem substitui essa autorização. Esta decisão refina o planejamento anterior sobre nova aprovação interna de cada empenho.
- Saldo: empenho reserva limite contratual; medição realiza parte do empenho. Não descontar a medição novamente do disponível para empenhar. Saldo esgotado não encerra automaticamente o contrato.
- O artigo TOTVS indicado trata de legendas de Solicitação de Compras do SIGACOM; foi referência de entendimento, sem adotar seus estados como contrato de SIGAGCT.

## 53.2 Fluxo operacional e interface

1. Elo Gestão › Contratos: incluir número, descrição, fornecedor, início/fim e itens com quantidade e preço em reais. Total calculado pelo servidor; descrição/unidade/versão do produto preservadas no item.
2. Administração do órgão › Alçadas contratuais: selecionar contrato, configurar níveis, aprovadores e limites. Atribuir antes a ação contratos.aprovar aos usuários aprovadores na secretaria correspondente.
3. Submeter contrato pendente: sistema congela política e conteúdo da rodada; não permite edição enquanto aguarda aprovação. Decisão do nível atual somente; recusa devolve o contrato a pendente, mantendo o histórico. Retirada também preserva decisões e justificativa.
4. Aprovado: vigência determina Aguardando vigência, Vigente ou Vigência expirada. Suspensão impede nova execução. Encerramento exige regularizar saldo empenhado a realizar; cancelamento não admite realização mantida. Não há reabertura de encerrado neste recorte.
5. Empenhos: registrar documento já autorizado, valor, data e referência/responsável da autorização. Não aceita reserva acima do disponível.
6. Medições: selecionar contrato vigente, empenho e item; registrar quantidade, data e ateste. Valida quantidade do item, saldo do empenho e contrato, inclusive sob concorrência.
7. Monitor no contrato: indicadores de valor, empenhado, realizado e disponível; barras de execução; níveis de aprovação; itens; aditivos; execução e linha do tempo. Cancelamentos e estornos justificados preservam os registros de origem e geram compensações.
8. Aditivo: propor novas quantidades dos itens existentes e/ou novo término. Versão aprovada continua utilizável enquanto o aditivo aguarda; aprovação revalida consumo e saldo antes de aplicar a nova versão.

GRID e CRUD reutilizam Panel, RoutineHeader, Table, filtros de coluna, paginação, seletores com busca, botões e estados compartilhados. Menu e cards recebem rotinas pelo mesmo registro. Inclusão abre na própria aba; salvar/cancelar segue o retorno à lista do padrão atual. Contratos têm filtro de número/situação, ordenação e CSV; listas financeiras filtram contrato/situação. Preferências visuais e colunas usam o componente comum da outra sessão.

## 53.3 Impacto técnico e compatibilidade

| Camada | Entrega |
| --- | --- |
| Banco | contracts, contract_items, contract_approval_policies, contract_amendments, contract_approval_rounds, contract_approval_votes, contract_commitments, contract_measurements e contract_ledger. FKs de órgão/secretaria/contrato, RLS, imutabilidade de origem, limites e controles financeiros. Votos e razão não têm UPDATE/DELETE para a aplicação. |
| Migração | elo_fase4bc_0025, agora após elo_fase4a_0025 (preferências), mantendo uma ponta. DDL de contratos preservado. Downgrade recusado se existirem contratos. Preferências aplicadas no banco sintético que já tinha contratos, em transação, após novo backup, sem stamp e sem recriar contratos. |
| API operacional | /contracts, detalhe/edição, export, submit, decisions, withdraw, amendments, status/suspend/resume/close/cancel, balance e events; /contract_commitments e /contract_measurements; cancelamento de empenho e estorno de medição vinculados ao contrato. |
| API administrativa | /customers/{id}/contract-approval-policies e /contract-approval-options; opções mínimas de usuários elegíveis, sem CPF. |
| Autorização | Ações separadas de cadastro, submissão, decisão, aditivo, execução e estorno. Alçadas exigem Administração do órgão; plataforma não opera contratos. Autoridade e sessão revalidadas depois da espera por bloqueios. Motor de alçada no serviço; banco aplica isolamento e integridade financeira, não substitui esse motor. |
| Transação | Ordem de bloqueios órgão → contrato → filhos; If-Match e Idempotency-Key nos comandos; auditoria e gravação atômicas; alterações incrementam versão do contrato. Valores monetários inteiros em centavos, quantidades decimais de até seis casas. |
| Legado | Telas/schemas recebidos usados como referência de campos e itens. Não foi localizada API original de contratos; /endeavours creditava saldo direto e permanece indisponível. Endereços /app/contract e /app/effort abrem as novas rotinas; não houve importação nem conversão de saldo legado. |
| Consumidores | Backoffice, documentação operacional, OpenAPI, inventário de autorização e compatibilidade atualizados. Produtos/fornecedores referenciados por FK passam a contar na proteção de correção do documento. Futuras cotações, aplicativo e pagamentos devem usar os comandos e vínculos deste domínio, sem gravação livre de saldo. |

## 53.4 Evidências proporcionais

| Verificação | Resultado e alcance |
| --- | --- |
| API e domínio financeiro | 20/20: 11 testes integrados, 6 de cálculo e 3 de inventário. Incluem níveis sequenciais/todos, recusa por falta de política, conflito, isolamento, reserva/medição/estorno, aditivo, concorrência, revogação durante bloqueio real e proteção financeira direta no banco. .local/logs/contracts-api-final.log. |
| Migração após compatibilização | Nova execução direcionada aprovada em banco descartável: upgrade, downgrade até 0024, upgrade e alembic check sem diferenças. .local/logs/contracts-migration-chain-test.log. |
| Banco sintético local | Uma ponta elo_fase4bc_0025; preferências preservadas; alembic check sem diferenças. .local/logs/contracts-migration-reconcile.log. |
| Navegador | 8/8: GRID, criação real, dois níveis configurados/aprovados pela tela, empenho, medição sem nova alçada/desconto duplicado, monitor a 390 px e contrato de Cuiabá invisível em Sinop. .local/logs/contracts-browser/result.json. |
| Testes web | 32/32 após ajustar expectativas de rotinas e URL, que antes tratavam contratos como inexistentes. .local/logs/contracts-web-final.log. |
| Tipos e compilação | Verificações de tipos e build da prévia própria; resultados finais registrados nos logs contracts-types-final e contracts-build-final. |

Os primeiros quatro cenários de navegador foram preservados; os quatro finais foram executados após corrigir uma espera do roteiro pelo botão habilitado. Não se tratava de rejeição da API: nenhuma requisição havia sido enviada. Não foi repetida a suíte completa de todos os módulos; foco nos riscos e consumidores alterados, conforme pedido do responsável.

## 53.5 Ambiente de avaliação

Prévia própria http://localhost:3008 e API http://127.0.0.1:8013/docsapi. Credenciais já existentes em .local/testes-municipios.json (gestão dos dois órgãos) e .local/lotacao-e2e.json (segundo aprovador); senhas não alteradas. Ambos receberam FIN/APR somente no cenário sintético de avaliação, com registro de preparação. Processos em .local/contracts-processes.json. Outras prévias preservadas.

Contrato de demonstração id 1, DEMO-4BC-857507397, Cuiabá › Saúde: valor R$ 1.000,00, empenho R$ 800,00, medição R$ 300,00, disponível para empenhar R$ 200,00 e empenhado a realizar R$ 500,00. Criado e aprovado pela interface em dois níveis. É exemplo sintético, não dado contábil real.

Backups: .local/backups/contratos-antes-20261116T192801Z.dump antes de contratos e .local/backups/contratos-preferencias-antes-20261117T130559Z.dump antes da compatibilização com preferências. Fora do Git. Nenhum dado real ou ambiente de produção alterado.

## 53.6 Limitações, aceite e próximo passo

- Revisão independente e aceite funcional ainda pendentes; **4B e o núcleo 4C permanecem Em revisão**.
- Aditivo altera quantidade de itens existentes e término; inclusão de novos itens, reajuste de preço e troca de fornecedor não entregues. Preço unitário tem precisão de centavos, não quatro casas decimais.
- Cada medição registra um item. Cancelamento de empenho é integral e exige ausência de medições realizadas; redução parcial e reabertura de encerrado não entregues.
- Documentos mantidos como pendência conforme decisão do responsável, sem novo armazenamento de anexos. Não há importação do legado, aprovação do empenho no sistema contábil, pagamento/liquidação, PIX/dados bancários ou redistribuição de saldo para veículos.
- Alçadas por contrato, sem modelos reutilizáveis ou delegação temporária de aprovador. Integrações técnicas de terceiros não foram liberadas para operar este novo módulo.
- As oito verificações visuais antecedem a incorporação final do retorno automático à lista do padrão de 52.1; a validação pontual desse retorno é registrada após a reconstrução da prévia, sem repetir o fluxo financeiro inteiro.
- Bloqueios de produção da fundação continuam válidos (36.6). O próximo trabalho é revisar e avaliar este recorte; após aceite, priorizar complementos de contrato/financeiro necessários ao piloto antes das cotações (4D) e indicadores amplos (4E).
'''
p.write_text(s,encoding='utf-8')
print('Controle 2.44 atualizado; seção 53, situação Em revisão e limitações explícitas.')
