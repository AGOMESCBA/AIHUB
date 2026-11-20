from pathlib import Path
p=Path('C:/Apps/ELOGESTAO/docs/planejamento-consolidado.md')
s=p.read_text(encoding='utf-8')
assert '## 53.11 ' not in s
s=s.replace('Versão 2.47 consolidada','Versão 2.48 consolidada',1)
entry='Revisão da aprovação contratual — 17 de novembro de 2026, versão 2.48: ações no topo, fila lateral completa e consulta dos próximos aprovadores sem decisão antecipada. Cinco regressões da API corrigidas. Seção 53.11.\n\n'
s=s.replace('Fila de aprovadores em destaque — 17 de novembro de 2026, versão 2.47:',entry+'Fila de aprovadores em destaque — 17 de novembro de 2026, versão 2.47:',1)
section='''## 53.11 Ações no topo e visibilidade sequencial

Os formulários de contratos, empenhos, medições, aditivos e alçadas apresentam suas ações no cabeçalho do painel. A submissão mantém a validação nativa. A análise apresenta Aprovar, Reprovar, Voltar e Exibir/Recolher fila no topo.

O contrato aparece nas pendências dos aprovadores elegíveis dos níveis atuais e futuros. A lista informa o nível da pessoa e se pode decidir ou aguarda o nível anterior. O servidor mantém a exigência de nível atual para aprovar e reprovar, após bloqueios e revalidação da autorização. Órgão, secretaria, permissão, alçada, votos e autoaprovação continuam limitando a visibilidade. Essa regra substitui a exclusão dos níveis futuros descrita historicamente em 53.9.

A fila mostra todos os níveis da rodada, nomes, alçadas, decisões e espera pelo nível anterior. Em telas largas, ocupa uma barra lateral à esquerda com rolagem independente e pode ser recolhida. No celular, inicia recolhida. Cabeçalho e itens permanecem somente leitura na área principal.

As cinco falhas anteriores eram expectativas desatualizadas: perfil APR sem aprovação de contratos; navegação administrativa sem Alçadas; navegação operacional sem contratos/empenhos/medições; navegação após revogação sem contratos; compartilhamento de contratos por órgão. Foram alinhadas às regras entregues, preservando negações de aprovação para Gestor/Consulta e exclusividade de contratos por secretaria. O cenário multi-órgão respeita os perfis diferentes em A (Operador) e B (Gestor), sem exigir menus iguais.

| Verificação proporcional | Resultado |
| --- | --- |
| Cinco testes da API anteriormente falhos | 5/5 aprovados; `.local/logs/approval-five-regressions-final2.log`. |
| Módulo de contratos | 14/14 aprovados, incluindo consulta futura, recusa de aprovar/reprovar antes da vez e liberação após o nível anterior. |
| Testes web do espaço de trabalho | 25/25 aprovados. |
| Tipos, lint dos arquivos alterados e build | Sem erros; permanece o aviso anterior de declaração de PolicyForm. |
| Navegador real em 3006 | 12/12: ambas as identidades, ações no topo, fila lateral completa, consulta futura, bloqueio das decisões, recolhimento e celular sem transbordamento. |
| OpenAPI e inventário | Atualizados; 198 operações, sem novas rotas ou migrações. |

Outra sessão executava migrações em bancos descartáveis no mesmo cluster e houve conflito transitório em ALTER ROLE elo_ (tuple concurrently updated). O auxiliar de testes repete somente esse conflito específico de upgrade, até quatro tentativas; outros erros continuam falhando. A primeira execução teve 14 testes de contratos aprovados e erro de preparação da outra fixture; as cinco regressões foram executadas novamente com preparação concluída e todas aprovadas. A suíte completa não foi repetida nesta rodada.

Prévia recompilada em http://localhost:3006, API 8012 reiniciada com o código atualizado. Não houve alteração de schema, concessões ou decisões nos contratos de demonstração 6, 7 e 8: continuam pendentes para avaliação manual. Evidências em `.local/logs/contracts-browser/approval-revision-result.json`. Sem commit, push ou produção; permanece a revisão independente do conjunto.

'''
assert '## 52.5 Botões do formulário no topo' in s
s=s.replace('## 52.5 Botões do formulário no topo',section+'## 52.5 Botões do formulário no topo',1)
p.write_text(s,encoding='utf-8')
print('Planejamento atualizado: 2.48, seção 53.11')
