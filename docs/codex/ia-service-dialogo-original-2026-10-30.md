# IA Service — resposta original e diálogo

## Objetivo

Manter linguagem humana e menos formal na própria resposta da investigação, com perguntas úteis e continuidade entre turnos, sem uma segunda IA impor síntese ou seções fixas.

## Alterações locais

- Removida a chamada editorial de `investigacao-service.js`, após as validações técnicas. Preferências legadas NATURAL não acionam mais a reescrita nesse fluxo.
- Retirados os seletores de estilo do J2A, Radar legado, cadastro de números autorizados e cadastro administrativo. Contratos e valores legados foram mantidos para compatibilidade; não houve migração de dados.
- Orientações de conversa reforçadas no prompt e no fechamento do contexto: responder ao turno atual, conferir materiais já disponíveis, solicitar evidência específica quando faltar e analisar a resposta seguinte sem reiniciar o relatório.
- Corrigida a classificação que combinava “solicitação de compras” e “validação de campos” como solicitação de teste. Pedidos efetivos de validação continuam reconhecidos.
- Respostas e auditorias antigas permanecem legíveis, incluindo detalhes técnicos. A geração validada de arquivos corrigidos continua funcionando.

## Validação

Testes com provedores simulados, SQLite em memória e arquivos temporários; interfaces verificadas com Playwright e APIs locais simuladas.

- Backend, recuperação de fontes consultadas, anexos, correções e classificação: 35 testes aprovados (`tmp/dialogo-original-backend-testes.log`).
- Continuidade e preferências legadas: suíte de 15 testes reexecutada após ampliar o caso de diálogo; todos aprovados (`tmp/dialogo-original-continuidade.log`). Já integra os 35 testes acima.
- Regressões de turno, pendência e preservação legada: 41 aprovados e 3 TODOs preexistentes (`tmp/dialogo-original-regressoes.log`). Os TODOs são limitações conhecidas do antigo validador editorial, que não foi alterado.
- Interfaces de chat e auditoria: 5 aprovados (`tmp/dialogo-original-ui-testes.log`).
- Detalhes técnicos históricos: 4 aprovados (`tmp/dialogo-original-detalhes-testes.log`).
- Cadastro de números: runner aprovado, contabilizado como 1 teste (`tmp/dialogo-original-compatibilidade.log`; as quatro falhas de UI desse primeiro lote foram corrigidas e revalidadas no log de detalhes).
- Total sem duplicar reexecuções: 86 aprovados, 3 TODOs preexistentes, nenhuma falha pendente nas verificações executadas.
- Sintaxe dos scripts alterados e `git diff --check` aprovados.

## Limites e pendências

Na primeira validação não houve chamadas reais aos modelos nem publicação em produção. A auditoria posterior executou uma homologação real isolada, encontrou problemas de qualidade e **não aprovou a publicação como solução completa de diálogo**. Ver `ia-service-auditoria-pre-publicacao-2026-10-30.md`.

A auditoria posterior corrigiu um caminho de dispensa da pesquisa inicial e problemas de apresentação/preservação de perguntas. A retirada editorial não resolve, por si só, o diagnóstico inadequado do #036914 nem as limitações semânticas do Quality Gate.
