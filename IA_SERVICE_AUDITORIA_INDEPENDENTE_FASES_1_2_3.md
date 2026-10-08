# IA Service - Auditoria Independente das Fases 1, 2 e 3

Data: 2026-10-08
Escopo: auditoria funcional, arquitetura, integridade, seguranca, regressao e limites operacionais das Fases 1, 2 e 3.
Restricao aplicada: nao houve correcao de codigo de producao, commit, push, alteracao de provider, OTP ou dados reais.

## Conclusao executiva

Resultado: **C - Fase 3 nao homologada para operacao completa**.

As Fases 1 e 2 passaram nos testes automatizados executados. A Fase 3 tambem passa na suite existente, incluindo os 20 cenarios obrigatorios de confirmacao de solucao e as rotas HTTP basicas. Porem, a auditoria reproduziu defeitos relevantes fora da cobertura atual:

- **ALTO:** a rota GET de validacao aceita `atendimentoId` da URL, mas nao valida se `mensagemId` pertence a esse atendimento; dentro da mesma empresa, retorna historico de outra conversa.
- **ALTO:** confirmar uma orientacao antiga como `RESOLVEU` pode marcar o dossie global do atendimento como `RESOLVIDO`, mesmo com orientacoes posteriores ainda sem validacao.
- **MEDIO:** o resumo agregado da Fase 3 nao contabiliza orientacoes sem evento como `AGUARDANDO_VALIDACAO`, apesar de esse estado existir no contrato.
- **MEDIO:** a evidencia externa do SoftExpert usa chave idempotente sem timestamp/id de evento externo; duas transicoes semanticamente distintas com mesmo `chamadoId`, status e mensagem podem colapsar.
- **BAIXO/MEDIO:** eventos empatados em `criado_em` dependem de ordenacao implicita do SQLite, sem desempate contratual.
- **PRE-EXISTENTE:** `base-historica-import.test.js` falha porque o teste espera que `limparHistoricoFonte` remova atendimentos do Radar, mas o codigo atual separou essa operacao em `zerarBaseFonte`.

Nao houve homologacao visual autenticada, provider real ou teste em Protheus. Portanto, mesmo sem os defeitos acima, a classificacao A nao seria permitida.

## Arquivos examinados

- `apps/IA Service/backend/database/migrations.js`
- `apps/IA Service/backend/repositories/validacao-solucao-repository.js`
- `apps/IA Service/backend/services/validacao-solucao-service.js`
- `apps/IA Service/backend/repositories/chamado-repository.js`
- `apps/IA Service/backend/services/import/historical-import-service.js`
- `apps/IA Service/backend/routes/index.js`
- `apps/IA Service/backend/routes/externo-routes.js`
- `apps/IA Service/backend/services/resposta-operacional-service.js`
- `apps/IA Service/frontend/atendimento.html`
- `apps/IA Service/frontend/radar.html`
- Testes de Fases 1, 2, 3, anexos, dossie e importacao historica.

Arquivo temporario criado para reproducoes nao destrutivas: `tmp/audit-fase3-repros.js`.

## Achados principais

### A1 - GET de validacao ignora atendimento da rota

Severidade: **ALTA**

Evidencia de codigo:

- `apps/IA Service/backend/routes/index.js`: o GET `/api/ia-service/atendimentos/:id/mensagens/:mensagemId/validacao` chama `validacaoSolucaoRepo.obterEstadoAtual(empresaId, req.params.mensagemId)` sem validar `req.params.id`.
- `apps/IA Service/backend/routes/externo-routes.js`: mesmo padrao na rota externa.

Reproducao: `node tmp\audit-fase3-repros.js`.

Resultado observado: requisicao para `/atendimentos/A/mensagens/msgDeB/validacao` retornou **200** com historico de `msgDeB`, embora `msgDeB` pertencesse a outro atendimento da mesma empresa.

Impacto: vazamento/integridade cruzada entre atendimentos dentro da mesma empresa. POST esta melhor protegido porque passa pelo service, mas GET nao.

### A2 - Confirmacao individual resolve o dossie global

Severidade: **ALTA**

Evidencia de codigo:

- `apps/IA Service/backend/services/validacao-solucao-service.js`: `RESOLVEU` vira `REGISTRAR_VALIDACAO`.
- O dossie e unico por atendimento, nao por mensagem/orientacao.

Reproducao: atendimento com tres mensagens `assistant`; confirmar somente a primeira como `RESOLVEU`.

Resultado observado: `dossie.status` ficou `RESOLVIDO`, mesmo com orientacoes posteriores sem validacao.

Impacto: o Context Engine pode tratar o atendimento inteiro como resolvido a partir de uma solucao parcial ou antiga. Isso contraria a premissa operacional de validar a solucao proposta sem concluir automaticamente todo o atendimento quando ha outras orientacoes pendentes.

### A3 - Resumo agregado nao conta aguardando sem evento

Severidade: **MEDIA**

Evidencia de codigo:

- `apps/IA Service/backend/repositories/validacao-solucao-repository.js`: `obterResumoPorEmpresa` agrega apenas `SELECT DISTINCT mensagem_assistente_id FROM validacoes_solucao`.

Reproducao: criar uma mensagem `assistant` sem validacao.

Resultado observado: `AGUARDANDO_VALIDACAO = 0`, mesmo existindo uma orientacao sem evento.

Impacto: painel/indicadores podem esconder backlog real de orientacoes aguardando validacao.

### A4 - Idempotencia externa sem identidade do evento

Severidade: **MEDIA**

Evidencia de codigo:

- `apps/IA Service/backend/services/validacao-solucao-service.js`: chave SHA-256 usa `chamadoId:de:para:mensagemAssistenteId`.

Reproducao: registrar duas vezes a mesma transicao `Andamento -> Encerrado` para o mesmo chamado/mensagem.

Resultado observado: primeiro evento `duplicado=false`; segundo `duplicado=true`.

Impacto: correto para ressincronizacao do mesmo evento, mas fragil para duas ocorrencias reais iguais em momentos diferentes, porque a origem nao fornece timestamp/id de evento na chave.

### A5 - Empate temporal sem desempate deterministico

Severidade: **BAIXA/MEDIA**

Evidencia de codigo:

- `validacao-solucao-repository.js` ordena eventos com `ORDER BY criado_em ASC` e pega o ultimo item do array.

Reproducao: inserir dois eventos da mesma mensagem com o mesmo `criado_em`.

Resultado observado: SQLite retornou em ordem de insercao no teste, mas isso nao esta garantido pelo contrato SQL.

Impacto: raro, mas possivel em concorrencia ou dupla acao no mesmo milissegundo. Recomenda-se desempate explicito por `rowid`/sequencia.

### A6 - Falha pre-existente em importacao historica

Severidade: **MEDIA**, fora do escopo direto da Fase 3.

Teste: `base-historica-import.test.js`.

Falha observada: `AssertionError: reset deve remover atendimentos do Radar vinculados aos chamados da fonte`.

Causa provavel: o teste chama `agenteRepo.limparHistoricoFonte`, mas o codigo atual documenta que essa rotina limpa somente logs de importacao; a limpeza radical de chamados/atendimentos foi separada em `zerarBaseFonte`.

Impacto: desalinhamento entre teste legado e contrato atual. Nao foi corrigido nesta auditoria.

## Matriz de testes

| Teste | Resultado | Evidencia | Pendencia |
|---|---|---|---|
| `fase1-fontes-corrigidos.test.js` | APROVADO | Exit code 0 | Nenhuma automatizada |
| `fase2-respostas-objetivas.test.js` | APROVADO | Exit code 0 | Nenhuma automatizada |
| `fase1-fase2-pos-auditoria.test.js` | APROVADO | Exit code 0 | Nenhuma automatizada |
| `fase3-confirmacao-solucoes.test.js` | APROVADO | 20/20 cenarios passaram | Nao cobre os achados A1/A2/A3/A5 |
| `fase3-rotas-http.test.js` | APROVADO | Exit code 0 | Nao testa GET com atendimento errado na mesma empresa |
| `etapa2-extracao-e-versionamento.test.js` | APROVADO | Exit code 0 | Nenhuma automatizada |
| `anexos-softexpert-sync.test.js` | APROVADO | Exit code 0 | Nenhuma automatizada |
| `etapa3a-dossie-persistente.test.js` | APROVADO | Exit code 0 | Nenhuma automatizada |
| `etapa3b-atualizacao-dossie.test.js` | APROVADO | Exit code 0 | Nao cobre validacao individual versus dossie global |
| `etapa3c-contexto-dossie.test.js` | APROVADO | Exit code 0 | Nenhuma automatizada |
| `benchmark-motor-investigacao.test.js` | APROVADO | `total=14`, `ok=2`, `inconclusivos=8`, `falhas=4`, `hallucinations=1`, `regressoes=0` | Benchmark nao prova homologacao operacional |
| `etapa3d-pesquisa-investigativa.test.js` | APROVADO | Exit code 0 | Nenhuma automatizada |
| `etapa3d1-fechamento-pesquisa-investigativa.test.js` | APROVADO | `total=54`, `corretos=51`, `ambiguos=3` | Nenhuma automatizada |
| `base-historica-import.test.js` | REPROVADO | Assertion na linha de reset/atendimentos Radar | Corrigir teste ou contrato `limparHistoricoFonte` vs `zerarBaseFonte` |
| Reproducao GET validacao cross-atendimento | REPROVADO | `tmp/audit-fase3-repros.js`: esperado 404, observado 200 | Corrigir rotas GET V1 e externa |
| Reproducao resumo aguardando sem evento | REPROVADO | `AGUARDANDO_VALIDACAO=0` com mensagem assistant sem evento | Rever regra de resumo/pendencias |
| Reproducao dossie global com 3 orientacoes | REPROVADO | `dossie.status=RESOLVIDO` apos validar apenas msg1 | Definir regra de produto e ajustar service/dossie |
| Reproducao idempotencia externa repetida | BLOQUEADO/PARCIAL | Duplicata correta para ressync; falta identidade de evento real | Precisa dado de origem ou decisao de contrato |
| Homologacao visual Atendimento V1 | NAO EXECUTADO | Sem sessao autenticada/browser validado nesta auditoria | Exige acesso visual autenticado real |
| Homologacao visual Radar | NAO EXECUTADO | Sem sessao autenticada/browser validado nesta auditoria | Exige acesso visual autenticado real |
| Provider real de IA | NAO EXECUTADO | Restricao de nao consumir provider pago/real sem autorizacao operacional explicita | Autorizar provider e custo |
| Compilacao/execucao ADVPL no Protheus | NAO EXECUTADO | Fora do ambiente desta auditoria | Exige ambiente Protheus homologacao |

## Regressao e compatibilidade

- Arquivos corrigidos/download/diff/historico: testes de Fase 1 e etapa2 passaram.
- Respostas objetivas/quality gate: testes de Fase 2 e benchmark offline passaram.
- Isolamento multiempresa: testes existentes passam para POST e leitura por empresa; porem A1 mostra falha dentro da mesma empresa entre atendimentos.
- Ficha operacional: validacao aparece na listagem de mensagens nos testes HTTP, mas o resumo agregado tem lacuna em orientacoes sem evento.
- Sem chamadas adicionais ao provider: `validacao-solucao-service.js` usa caminho deterministico e nao chama LLM.

## Recomendacoes antes de homologar

1. Corrigir as rotas GET de validacao para validar simultaneamente empresa, atendimento e mensagem.
2. Definir regra de produto para dossie global quando uma de varias orientacoes e validada; depois cobrir com teste.
3. Ajustar o resumo agregado ou explicitar que ele conta apenas orientacoes com evento, removendo ambiguidade do contrato.
4. Adicionar desempate deterministico em consultas de eventos append-only.
5. Reavaliar chave de idempotencia de evidencia externa com timestamp/id de evento da origem, se disponivel.
6. Alinhar `base-historica-import.test.js` ao contrato atual de `limparHistoricoFonte`/`zerarBaseFonte`, ou corrigir o contrato se a expectativa do teste ainda for valida.
7. Executar homologacao visual autenticada em Atendimento V1 e Radar antes de qualquer classificacao A.

## Veredito

As Fases 1 e 2 estao tecnicamente aptas para nova rodada de homologacao operacional automatizada, com ressalva de que a homologacao visual e provider real nao foram executados aqui.

A Fase 3 **nao esta apta para homologacao operacional completa** ate que os achados A1 e A2 sejam tratados ou conscientemente aceitos como risco pelo produto. A suite automatizada atual e boa como base, mas ainda nao cobre os cenarios que reproduziram os defeitos desta auditoria.
