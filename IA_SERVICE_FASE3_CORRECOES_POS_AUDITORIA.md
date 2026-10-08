# IA Service - Fase 3 - Correcoes Pos-Auditoria

Data: 2026-10-08

## Escopo

Correcao cirurgica dos achados impeditivos da Fase 3 apontados pela auditoria independente, sem implementar Fase 4, sem alterar autenticacao/OTP, sem modificar providers, sem consumir APIs pagas, sem alterar dados produtivos e sem commit/push.

Relatorio de referencia consultado: `IA_SERVICE_AUDITORIA_INDEPENDENTE_FASES_1_2_3.md`.

## Arquivos modificados

| Arquivo | Alteracao |
|---|---|
| `apps/IA Service/backend/services/validacao-solucao-service.js` | Centralizada a validacao de empresa/atendimento/mensagem; confirmacoes individuais deixam de encerrar o dossie global; eventos externos recebem chave de idempotencia mais especifica quando ha evento/timestamp de origem. |
| `apps/IA Service/backend/routes/index.js` | GET interno de validacao passa pelo service e respeita o atendimento da rota; tratamento de erro respeita `err.status`. |
| `apps/IA Service/backend/routes/externo-routes.js` | GET externo de validacao passa pelo service e respeita o atendimento da rota; tratamento de erro respeita `err.status`. |
| `apps/IA Service/backend/repositories/validacao-solucao-repository.js` | Ordenacao append-only deterministica com `rowid`; resumo por empresa passa a considerar orientacoes sem evento como `AGUARDANDO_VALIDACAO`. |
| `apps/IA Service/backend/repositories/mensagem-repository.js` | Adicionada consulta direcionada para a ultima mensagem do assistente por empresa/atendimento. |
| `apps/IA Service/backend/services/import/historical-import-service.js` | Evidencia SoftExpert usa consulta direcionada para a ultima orientacao, sem depender da pagina limitada a 100 mensagens. |
| `apps/IA Service/tests/base-historica-import.test.js` | Expectativa ajustada ao contrato atual: reset destrutivo de atendimentos fica em `zerarBaseFonte`, nao em `limparHistoricoFonte`. |
| `apps/IA Service/tests/fase3-confirmacao-solucoes.test.js` | Testes atualizados para validar resultado individual no dossie, sem exigir encerramento global indevido. |
| `apps/IA Service/tests/fase3-pos-auditoria.test.js` | Nova suite cobrindo os defeitos corrigidos pela auditoria. |

Observacao: a working tree ja continha outros arquivos modificados/nao rastreados antes deste fechamento. Eles foram preservados e nao houve revert.

## Causas-raiz e correcoes

| Achado | Causa-raiz | Correcao aplicada | Antes | Depois |
|---|---|---|---|---|
| P0 - GET de validacao entre atendimentos | A leitura aceitava `mensagemId` isolado e nao provava que a mensagem pertencia ao atendimento da URL. | Rotas interna/externa chamam o service, que valida empresa, atendimento, mensagem assistant e vinculo mensagem-atendimento antes de retornar estado. | Mensagem de outro atendimento da mesma empresa podia ser consultada. | Retorna 404 generico, sem revelar recurso externo ao atendimento. |
| P0 - Confirmacao individual encerrando dossie global | `confirmarSolucao` propagava `RESOLVEU` para o atualizador global do dossie. | Confirmacao agora registra item individual `VALIDACAO_SOLUCAO_INDIVIDUAL` no dossie e preserva o estado global investigativo. | Uma orientacao antiga poderia marcar o atendimento inteiro como resolvido. | Resultado fica vinculado a mensagem especifica; dossie global nao e encerrado isoladamente. |
| P1 - Evidencia SoftExpert na mensagem errada | Fluxo buscava mensagens com limite padrao e filtrava em memoria; em atendimentos longos a ultima orientacao podia ficar fora da janela. | Criada consulta `getUltimaMensagemAssistente` com `ORDER BY criado_em DESC, rowid DESC LIMIT 1`. | Evidencia externa podia ser associada arbitrariamente. | Evidencia externa usa consulta direcionada e deterministica por empresa/atendimento. |
| P1 - Resumo sem `AGUARDANDO_VALIDACAO` | Agregado partia apenas de eventos existentes em `validacoes_solucao`. | Resumo considera mensagens assistant elegiveis e trata ausencia de evento como `AGUARDANDO_VALIDACAO`. | Orientacoes sem validacao sumiam do indicador. | Orientacoes pendentes aparecem no total correto. |
| P2 - Append-only nao deterministico | Empates em `criado_em` dependiam de ordenacao implicita do SQLite. | Consultas usam `ORDER BY criado_em ASC, rowid ASC` para historico e estado atual. | Ultimo evento podia variar sob timestamps iguais. | O desempate e estavel pelo `rowid`. |
| P2 - Idempotencia SoftExpert | Chave considerava estados, mas nao diferenciava eventos distintos quando havia identificador/timestamp de origem. | Chave inclui `eventoId/idEvento` e `ocorridoEm/dataEvento` quando disponiveis; mantem estrategia antiga quando nao ha esses dados. | Transicoes distintas podiam colidir. | Eventos distintos com id/timestamp de origem sao registrados separadamente; ressincronizacao do mesmo evento continua idempotente. |
| Falha pre-existente - importacao historica | Teste esperava efeito destrutivo em `limparHistoricoFonte`, mas o contrato atual separa limpeza de logs e reset radical. | Teste passou a validar `zerarBaseFonte` para remocao de atendimentos do Radar. | Regressao falsa por expectativa desatualizada. | Teste reflete o contrato atual sem alterar rotina de limpeza. |

## Testes adicionados

`apps/IA Service/tests/fase3-pos-auditoria.test.js`

Cobertura incluida:

- GET interno de validacao para mensagem correta, outro atendimento da mesma empresa, outra empresa e mensagem inexistente.
- GET externo de validacao sem sessao e com sessao autorizada bloqueando mensagem de outro atendimento.
- Dossie global preservado apos `RESOLVEU`, `NAO_RESOLVEU`, `PARCIALMENTE` e reavaliacao.
- Historico append-only preservado e estado atual deterministico.
- Resumo agregado distinguindo `AGUARDANDO_VALIDACAO` e `NAO_TESTADO`.
- Evidencia SoftExpert em atendimento com 105 mensagens vinculada a ultima orientacao correta.
- Idempotencia de evidencia externa por `eventoId`.

## Resultado dos testes

| Teste | Resultado | Evidencia | Observacao |
|---|---|---|---|
| `node "apps\IA Service\tests\fase3-pos-auditoria.test.js"` | APROVADO | `fase3-pos-auditoria.test.js: ok` | Suite nova dos achados pos-auditoria. |
| `node "apps\IA Service\tests\fase3-confirmacao-solucoes.test.js"` | APROVADO | `fase3-confirmacao-solucoes.test.js: ok` | Confirma dossie sem encerramento global indevido. |
| `node "apps\IA Service\tests\fase3-rotas-http.test.js"` | APROVADO | `fase3-rotas-http.test.js: ok` | Rotas HTTP internas/externalizadas. |
| `node "apps\IA Service\tests\fase1-fontes-corrigidos.test.js"` | APROVADO | `fase1-fontes-corrigidos.test.js: ok` | Regressao Fase 1. |
| `node "apps\IA Service\tests\fase2-respostas-objetivas.test.js"` | APROVADO | `fase2-respostas-objetivas.test.js: ok` | Regressao Fase 2. |
| `node "apps\IA Service\tests\fase1-fase2-pos-auditoria.test.js"` | APROVADO | `fase1-fase2-pos-auditoria.test.js: ok` | Regressao pos-auditoria Fases 1/2. |
| `node "apps\IA Service\tests\etapa3a-dossie-persistente.test.js"` | APROVADO | `etapa3a-dossie-persistente.test.js: ok` | Regressao dossie persistente. |
| `node "apps\IA Service\tests\etapa3b-atualizacao-dossie.test.js"` | APROVADO | `etapa3b-atualizacao-dossie.test.js: ok` | Regressao atualizacao semantica. |
| `node "apps\IA Service\tests\etapa3c-contexto-dossie.test.js"` | APROVADO | `etapa3c-contexto-dossie.test.js: ok` | Regressao Context Engine/dossie. |
| `node "apps\IA Service\tests\etapa3d-pesquisa-investigativa.test.js"` | APROVADO | `etapa3d-pesquisa-investigativa.test.js: ok` | Regressao pesquisa investigativa. |
| `node "apps\IA Service\tests\etapa3d1-fechamento-pesquisa-investigativa.test.js"` | APROVADO | `ok {"total":54,"corretos":51,"falsoPesquisar":0,"falsoNaoPesquisar":0,"ambiguos":3,"chamadasSemanticas":39}` | Benchmark de decisao de fechamento. |
| `node "apps\IA Service\tests\anexos-softexpert-sync.test.js"` | APROVADO | `anexos-softexpert-sync.test.js: ok` | Regressao sincronizacao/anexos SoftExpert. |
| `node "apps\IA Service\tests\etapa2-extracao-e-versionamento.test.js"` | APROVADO | `etapa2-extracao-e-versionamento.test.js: ok` | Regressao extracao/versionamento. |
| `node "apps\IA Service\tests\base-historica-import.test.js"` | APROVADO | `base-historica-import.test.js: ok` | Contrato de limpeza/reset historico validado. |
| `node "apps\IA Service\tests\benchmark-motor-investigacao.test.js"` | APROVADO | `ok {"total":14,"ok":2,"inconclusivos":8,"falhas":4,"hallucinations":1,"diagnosticosPrematuros":0,"regressoes":0}` | Benchmark offline existente, sem provider pago. |
| `node "apps\IA Service\tests\etapa2-contexto-pesquisa-quality.test.js"` | APROVADO | `etapa2-contexto-pesquisa-quality.test.js: ok` | Regressao de contexto, pesquisa e quality gate. |

## Impacto na integridade do dossie

- O dossie continua sendo unico por atendimento.
- Confirmacoes individuais passam a ser evidencias estruturadas dentro do dossie, com `mensagemAssistenteId`, `validacaoId`, resultado e relacoes de proveniencia.
- `RESOLVEU` individual nao altera mais automaticamente o estado global para `RESOLVIDO`.
- Reavaliacoes continuam append-only: o historico e preservado e o estado atual vem do ultimo evento deterministico.
- Feedback negativo fica disponivel ao Context Engine como dado estruturado para a proxima investigacao.

## Impacto na sincronizacao SoftExpert

- A evidencia externa deixa de depender de listagem paginada/limitada de mensagens.
- Atendimentos longos passam a usar a ultima orientacao assistant consultada de forma direta e deterministica.
- Eventos com identificador/timestamp externo disponivel ficam mais bem diferenciados.
- A idempotencia do mesmo evento de origem permanece preservada.

## Pendencias e limites da validacao

- Nao foi executada homologacao visual autenticada em navegador.
- Nao foi usado provider real de IA.
- Nao houve compilacao/execucao ADVPL no Protheus.
- Nao houve teste contra base produtiva nem alteracao de dados reais.
- O benchmark offline ainda registra `falhas: 4` e `hallucinations: 1` como resultado conhecido da suite atual, mas `regressoes: 0`; isso nao se relacionou aos defeitos corrigidos da Fase 3 nesta entrega.

## Parecer tecnico final

Classificacao: **A - Tecnicamente apta a homologacao operacional**.

Os defeitos impeditivos de seguranca, integridade e estabilidade apontados para a Fase 3 foram corrigidos e cobertos por testes especificos. As regressoes relevantes das Fases 1, 2 e 3 foram executadas com sucesso. Esta classificacao nao equivale a homologacao visual autenticada, validacao com provider real ou teste de compilacao/execucao no Protheus.
