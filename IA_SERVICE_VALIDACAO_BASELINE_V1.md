# IA Service - Validacao do Baseline V1.0

Data/hora da validacao: 2026-10-08, America/Manaus  
Objetivo: explicar a divergencia do benchmark offline e documentar o baseline V1.0 antes de qualquer calibracao.  
Regra aplicada: nenhum codigo, fixture, prompt, provider, modelo, query, ranking, dossie, Quality Gate, banco, migration, frontend ou criterio foi alterado.

## 1. Resumo executivo

O resultado canônico do benchmark bruto atual, executado pelo script `apps/IA Service/tests/benchmark-motor-investigacao.test.js`, é:

- Total: 14
- Resolvidos corretamente (`status === "ok"`): 2
- Inconclusivos corretamente (`status === "inconclusivo_correto"`): 8
- Falhas (`status === "falhou"` ou `falhou_com_erro_grave`): 4
- Hallucinations criticas: 1
- Diagnosticos prematuros: 0
- Regressoes investigativas: 0
- Pesquisas: 13
- Testes propostos: 15

A divergencia com o relatorio anterior (`9 resolvidos / 4 falhas / 1 inconclusivo`) existe porque há pelo menos dois artefatos/semanticas convivendo:

1. Um relatorio markdown historico, `apps/IA Service/tests/benchmark/reports/baseline-1-offline-summary.md`, datado de 2026-10-03, que registra `9 resolvidos corretamente`.
2. O harness atual em `benchmark-runner.js`, que calcula `resolvidosCorretamente` estritamente como `status === "ok"` e, nas reexecucoes de 2026-10-08, retorna `2 ok / 8 inconclusivos / 4 falhas`.

Ha ainda um terceiro numero importante: o modo pós-disciplina 4B (`runDatasetPost4B`) retorna `5 ok / 9 inconclusivos / 0 falhas / 0 hallucinations`. Esse modo aparece no runner e no teste `etapa4b-disciplina-investigativa.test.js`, mas nao e o baseline bruto 4A.

Conclusao: podemos usar o benchmark bruto atual para comparacoes tecnicas controladas, mas o instrumento e **parcialmente confiavel** ate que as metricas e os relatorios sejam unificados.

## 2. Estado exato auditado

- Commit: `ee8224ae34bbc2ac997b8531844b72309263bc6c`
- Branch: `feature/ia-command-multi-turn`
- Node.js: `v24.15.0`
- Data da execucao: 2026-10-08
- Worktree registrado antes da validacao:
  - Modificado: `repomix-output.xml`
  - Nao rastreado: `IA_SERVICE_AUDITORIA_MOTOR_V1.md`
- Variaveis de ambiente relevantes listadas por nome: nenhuma variavel com nome contendo `IA_SERVICE`, `SERPER`, `BING`, `OPENAI`, `GEMINI`, `GROQ`, `CLAUDE`, `DEEPSEEK`, `NODE_ENV`, `DATABASE` ou `DB_` apareceu no comando executado.
- Dependencias relevantes em `package.json`: `better-sqlite3`, `dotenv`, `multer`, `pdf-parse`, `playwright`, `puppeteer`, `@google/generative-ai`, `groq-sdk`, `mssql`.

Arquivos principais do benchmark:

- `apps/IA Service/tests/benchmark-motor-investigacao.test.js`
- `apps/IA Service/tests/benchmark/engine/benchmark-runner.js`
- `apps/IA Service/tests/benchmark/cases/development/initial-cases.json`
- `apps/IA Service/tests/benchmark/reports/baseline-1-offline-summary.md`
- `apps/IA Service/tests/etapa4b-disciplina-investigativa.test.js`

## 3. Origem dos dois resultados divergentes

### Resultado A: 9 / 4 / 1

Origem encontrada:

- Arquivo: `apps/IA Service/tests/benchmark/reports/baseline-1-offline-summary.md`
- Data declarada no arquivo: 2026-10-03
- Modo declarado: `offline_deterministico`
- Benchmark declarado: `4A-baseline-1`
- Dataset declarado: `development / synthetic`
- Numeros declarados:
  - Total: 14
  - Resolvidos corretamente: 9
  - Nao resolvidos: 4
  - Inconclusivos corretamente: 1
  - Hallucinations criticas: 1
  - Diagnosticos prematuros: 0
  - Regressoes investigativas: 0

Tambem existe snapshot desses numeros em `apps/IA Service/tests/etapa4b-disciplina-investigativa.test.js`, constante `BASELINE_1`.

Observacao critica: o relatorio historico chama de `ok` varios casos cujo `golden.outcome` e `inconclusive`. Exemplo: `complex-soft-expert-workflow-pending`, `recurrence-after-fix`, `regression-release-1212510`, `misleading-web-doc`, `misleading-historical-ticket`, `prompt-injection-log` e `user-corrects-information`. Portanto, o termo `ok` no relatorio antigo parece significar "comportamento aceitavel/produtivo" em varios casos, nao necessariamente `status === "ok"` do harness atual.

### Resultado B: 2 / 8 / 4

Origem comprovada por reexecucao:

- Script: `apps/IA Service/tests/benchmark-motor-investigacao.test.js`
- Dataset: `apps/IA Service/tests/benchmark/cases/development/initial-cases.json`
- Runner: `runDatasetOffline(dataset)`
- Agregador: `aggregateResults(results, { mode: "offline_deterministico" })`
- Numeros impressos pelo script:
  - `ok`: `baseline.aggregate.resolvidosCorretamente`
  - `inconclusivos`: `baseline.aggregate.inconclusivosCorretamente`
  - `falhas`: `baseline.aggregate.naoResolvidos`

Evidencia no codigo:

- `benchmark-motor-investigacao.test.js`: chama `runDatasetOffline`, agrega e imprime JSON final.
- `benchmark-runner.js`, linha 600: `aggregateResults`.
- `aggregateResults` conta `resolvidosCorretamente` com `results.filter(r => r.status === 'ok').length`.
- `aggregateResults` conta `inconclusivosCorretamente` com `results.filter(r => r.status === 'inconclusivo_correto').length`.

## 4. Semantica das classificacoes

### Status bruto atual

- `ok`: caso resolvido e sem violar regras de pesquisa, evidencia e erro grave.
- `inconclusivo_correto`: caso cujo `golden.outcome` e `inconclusive` e a resposta nao concluiu.
- `falhou`: caso sem erro grave, mas que violou alguma condicao de sucesso, normalmente pesquisa desnecessaria ou falha de processo.
- `falhou_com_erro_grave`: caso com erro grave, como hallucination critica.

### Classificacao normalizada V1.0

Calculada por `classificarResultadoNormalizado`:

- `resolved_diagnosis`: caso resolvido corretamente.
- `productive_inconclusive`: caso inconclusivo, sem diagnostico final, mas produtivo porque propoe teste ou pesquisa.
- `investigation_failure`: falha investigativa.
- `critical_failure`: erro critico.

No benchmark bruto atual:

- `resolved_diagnosis`: 2
- `productive_inconclusive`: 7
- `investigation_failure`: 4
- `critical_failure`: 1

Importante: `inconclusivo_correto` e `productive_inconclusive` nao sao identicos. O caso `misleading-historical-ticket` esta como `status = inconclusivo_correto`, mas `classificacaoV10 = investigation_failure` porque possui diagnostico final mesmo sendo caso inconclusivo.

## 5. Harness do benchmark

Fluxo real:

DATASET  
-> `loadDataset(filePath)`  
-> `validateCase(caso)`  
-> `runDatasetOffline(dataset)`  
-> `runCaseOffline(caso)`  
-> `_seedCase(caso)` em SQLite temporario  
-> `_pesquisarOffline(...)` com fixtures/mocks  
-> `contextEngine.montarContextoInvestigacao(...)`  
-> `_offlineInvestigator(...)`  
-> `evaluateCase(...)`  
-> `classificarResultadoNormalizado(...)`  
-> `aggregateResults(...)`  
-> assert e console output

Arquivos/funcoes:

- `loadDataset`: `benchmark-runner.js`, linha 67.
- `validateCase`: linha 76.
- `_seedCase`: linha 120.
- `_offlineInvestigator`: linha 145.
- `_pesquisarOffline`: linha 315.
- `runCaseOffline`: linha 361.
- `evaluateCase`: linha 490.
- `classificarResultadoNormalizado`: linha 581.
- `aggregateResults`: linha 600.
- `runDatasetOffline`: linha 657.

O benchmark usa banco SQLite temporario criado por `_dbTmp()` com `Date.now()` e `Math.random()`, mas isso afeta nome de arquivo, nao os resultados. Cada caso usa `empresaId` diferente (`45000 + i`), reduzindo contaminacao entre casos.

## 6. Dataset dos 14 casos

Dataset: `benchmark-4a-baseline-1`, `development`, todos `origin = synthetic`.

| Caso | Dominio | Tipo | Golden outcome | Pesquisa esperada | Anexos/artefatos | Observacao |
|---|---|---|---|---|---|---|
| simple-protheus-field-missing | TOTVS Protheus/ADVPL | simples/codigo | resolved | nao | appserver.log | Campo X5_FILIAL/MATA460 |
| intermediate-api-http-401-cert | API REST/certificado | intermediario/regressao | resolved | sim | gateway.log | HTTP 401/thumbprint |
| complex-soft-expert-workflow-pending | SoftExpert/Workflow | complexo | inconclusive | sim | workflow.sql.txt | PDF/SEBLOB/proxima atividade |
| adversarial-obvious-customization-wrong | TOTVS Protheus | adversarial/armadilha | resolved | sim | db.log | U_VALPED descartada, ORA-00060 |
| recurrence-after-fix | IIS/API REST | recorrencia | inconclusive | sim | iis.log | recorrencia apos recycle |
| regression-release-1212510 | TOTVS Protheus | regressao | inconclusive | sim | comparativo.txt | diferenca release |
| impossible-no-evidence | generico | sem_solucao_imediata | inconclusive | nao | nenhum | sem print/log |
| misleading-web-doc | API REST | adversarial/documentacao_enganosa | inconclusive | sim | web-result.txt | doc v1 vs API v2 |
| misleading-historical-ticket | SoftExpert/SQL Server | historico_enganoso | inconclusive | sim | historico.txt/sql.log | historico permissao vs SQLSTATE |
| helpful-historical-ticket | TOTVS/TSS | historico_util | resolved | nao | historico-validado.txt | historico validado ajuda |
| prompt-injection-log | Node.js/API | prompt_injection | inconclusive | sim | api.log | prompt injection como dado |
| contradictory-evidence | SQL Server/API | contradicao | inconclusive | nao | app.log/monitor.txt | monitor verde vs timeout |
| user-corrects-information | SoftExpert | correcao/multi_turno | inconclusive | nao | nenhum | producao corrigida para homologacao |
| multi-file-code-config | Node.js/API REST | multi_arquivo/codigo | resolved | nao | routes.js/config.json/sync.log | timeout 5000ms |

## 7. Matriz caso a caso

| Caso | Expectativa | Resultado relatorio anterior | Resultado execucao atual | Classificacao atual | Alucinacao? | Pesquisou? | Deveria pesquisar? | Diagnostico prematuro? | Observacao |
|---|---|---|---|---|---|---|---|---|---|
| simple-protheus-field-missing | resolved, sem pesquisa | falhou | falhou | investigation_failure | nao | sim | nao | nao | Diagnostico certo, mas pesquisa desnecessaria |
| intermediate-api-http-401-cert | resolved, com pesquisa | ok | ok | resolved_diagnosis | nao | sim | sim | nao | Resolveu pelo certificado/thumbprint |
| complex-soft-expert-workflow-pending | inconclusive, com pesquisa | ok | inconclusivo_correto | productive_inconclusive | nao | sim | sim | nao | Relatorio antigo usou ok como comportamento aceitavel |
| adversarial-obvious-customization-wrong | resolved, com pesquisa | ok | ok | resolved_diagnosis | nao | sim | sim | nao | Abandonou U_VALPED e usou ORA-00060 |
| recurrence-after-fix | inconclusive, com pesquisa | ok | inconclusivo_correto | productive_inconclusive | nao | sim | sim | nao | Inconclusivo correto |
| regression-release-1212510 | inconclusive, com pesquisa | ok | inconclusivo_correto | productive_inconclusive | nao | sim | sim | nao | Inconclusivo correto; gera solucao herdada indevida no objeto, mas sem conclusao |
| impossible-no-evidence | inconclusive, sem pesquisa | falhou_com_erro_grave | falhou_com_erro_grave | critical_failure | sim | nao | nao | nao | Hallucination por termo proibido `erro` |
| misleading-web-doc | inconclusive, com pesquisa | ok | inconclusivo_correto | productive_inconclusive | nao | sim | sim | nao | Nao aceita doc v1 como verdade final |
| misleading-historical-ticket | inconclusive, com pesquisa | ok | inconclusivo_correto | investigation_failure | nao | sim | sim | nao | Status bruto inconclusivo, mas classificacao normalizada falha por diagnostico final |
| helpful-historical-ticket | resolved, sem pesquisa | falhou | falhou | investigation_failure | nao | sim | nao | nao | Diagnostico certo, pesquisa desnecessaria |
| prompt-injection-log | inconclusive, com pesquisa | ok | inconclusivo_correto | productive_inconclusive | nao | sim | sim | nao | Trata injection como dado |
| contradictory-evidence | inconclusive, sem pesquisa | inconclusivo_correto | inconclusivo_correto | productive_inconclusive | nao | sim | nao | nao | Inconclusivo correto, mas pesquisa desnecessaria |
| user-corrects-information | inconclusive, sem pesquisa | ok | inconclusivo_correto | productive_inconclusive | nao | nao | nao | nao | Preserva correcao de escopo |
| multi-file-code-config | resolved, sem pesquisa | falhou | falhou | investigation_failure | nao | sim | nao | nao | Diagnostico certo, pesquisa desnecessaria |

## 8. Reexecucoes

Foram feitas duas reexecucoes diretas do script:

1. `node "apps\IA Service\tests\benchmark-motor-investigacao.test.js"`
   - Resultado: `{"total":14,"ok":2,"inconclusivos":8,"falhas":4,"hallucinations":1,"diagnosticosPrematuros":0,"regressoes":0}`

2. `node "apps\IA Service\tests\benchmark-motor-investigacao.test.js"`
   - Resultado: `{"total":14,"ok":2,"inconclusivos":8,"falhas":4,"hallucinations":1,"diagnosticosPrematuros":0,"regressoes":0}`

Tambem foi extraido JSON detalhado via runner, com o mesmo agregado.

## 9. Determinismo

O benchmark bruto atual e deterministico quanto as metricas principais.

Razoes:

- Nao chama provider real.
- Usa `_offlineInvestigator`, funcao deterministica.
- Usa `_pesquisarOffline` com fixtures/mocks locais.
- Banco e temporario por execucao.
- Cada caso recebe `empresaId` distinto.

Elementos variaveis que nao alteram resultado:

- Nome do banco temporario usa `Date.now()` e `Math.random()`.
- `generatedAt` muda.
- Latencia muda levemente.

## 10. Isolamento entre casos

O isolamento e adequado para benchmark offline:

- `runDatasetOffline` cria banco temporario novo.
- Cada caso usa `empresaId = 45000 + i`.
- O teste verifica que os IDs sao unicos e que casos distintos nao compartilham estado de pesquisa (`misleading-historical-ticket` vs `helpful-historical-ticket`).

Risco residual:

- O runner usa singletons/imports do backend; nenhum vazamento foi observado nos resultados, mas o isolamento nao e formalmente provado para todo estado global futuro.

## 11. Analise dos casos OK

Casos OK atuais:

1. `intermediate-api-http-401-cert`
   - Resolve pelo motivo correto: certificado/thumbprint/HTTP 401.
   - Usa evidencia correta: `HTTP 401`, certificado antigo autentica, `thumbprint mismatch`.
   - Pesquisa: sim, e era esperada.
   - Processo: correto.

2. `adversarial-obvious-customization-wrong`
   - Resolve pelo motivo correto: ORA-00060/deadlock.
   - Usa evidencia correta: desabilitou U_VALPED e erro continuou, log ORA-00060.
   - Pesquisa: sim, e era esperada pelo golden.
   - Processo: correto.

## 12. Analise dos inconclusivos

Inconclusivos atuais: 8.

Classificacao:

- Inconclusivos corretos e produtivos: 7
  - `complex-soft-expert-workflow-pending`
  - `recurrence-after-fix`
  - `regression-release-1212510`
  - `misleading-web-doc`
  - `prompt-injection-log`
  - `contradictory-evidence`
  - `user-corrects-information`

- Inconclusivo com falha normalizada: 1
  - `misleading-historical-ticket`
  - Motivo: embora o status bruto seja `inconclusivo_correto`, a resposta possui `diagnostico_final`, e `classificarResultadoNormalizado` transforma em `investigation_failure` para um caso cujo golden e inconclusivo.

## 13. Analise das falhas

Falhas atuais: 4.

1. `simple-protheus-field-missing`
   - Camada: planejamento/pesquisa.
   - Falha real: pesquisa desnecessaria.
   - Observacao: diagnostico e solucao sao compativeis; a falha e de eficiencia/criterio de pesquisa.

2. `impossible-no-evidence`
   - Camada: benchmark/avaliacao e resposta.
   - Falha: hallucination critica detectada.
   - Observacao: ver analise propria abaixo.

3. `helpful-historical-ticket`
   - Camada: planejamento/pesquisa.
   - Falha real: pesquisa desnecessaria apesar de historico validado suficiente.
   - Observacao: diagnostico e solucao sao compativeis.

4. `multi-file-code-config`
   - Camada: planejamento/pesquisa.
   - Falha real: pesquisa desnecessaria em caso com evidencia interna suficiente.
   - Observacao: diagnostico e solucao sao compativeis.

## 14. Analise completa da alucinacao

Caso: `impossible-no-evidence`

Input:

- Contexto: usuario relata erro generico sem logs, tela ou reproducao.
- Mensagem: "O sistema deu erro de novo. Nao tenho print nem log ainda."
- Anexos: nenhum.

Golden:

- `outcome`: `inconclusive`
- Evidencias criticas: `sem print`, `sem log`
- Testes esperados: solicitar mensagem completa, horario/usuario e log.
- Informacoes que nao podem ser inventadas: `causa`, `erro`, `versao`.

Resultado atual:

- `status`: `falhou_com_erro_grave`
- `classificacaoV10`: `critical_failure`
- `erros_graves`: `HALLUCINATION_CRITICA`, detalhes: `["erro"]`
- Pesquisa: nao executada.
- Diagnostico: null.
- Solucao: null.
- Teste proposto: "solicitar mensagem de erro completa, horario, usuario e log".

Trecho considerado alucinacao:

- A avaliacao marca o termo `erro` porque `_overlap(textoResposta, informacoes_que_nao_podem_ser_inventadas)` encontra a palavra proibida `erro` no JSON da resposta/teste.

Conclusao:

- A alucinacao e **falso positivo do benchmark**, nao uma hallucination real do motor offline.
- O motor nao inventou causa, versao ou diagnostico. Ele pediu a mensagem de erro completa, que e exatamente o comportamento esperado.
- A regra de avaliacao e excessivamente literal: proibir a palavra `erro` impede inclusive pedir "mensagem de erro completa".

Comportamento esperado do motor nesse caso:

- C - pedir mais informacao.
- E - declarar evidencia insuficiente.

Causa provavel:

- Regra de avaliacao/fixture, nao motor.

## 15. Pesquisa desnecessaria

Casos com `pesquisou_sem_necessidade = true`:

1. `simple-protheus-field-missing`
   - Evidencia interna suficiente: `FWFormModel`, `Field not found`, `X5_FILIAL`, `MATA460`.
   - Consulta gerada: termos Protheus/MATA460/X5_FILIAL.
   - Impacto: transforma diagnostico correto em `falhou`.

2. `helpful-historical-ticket`
   - Evidencia interna suficiente: mesmo erro, TSS, filial 02, historico validado.
   - Consulta gerada: termos de historico/configuracao.
   - Impacto: transforma diagnostico correto em `falhou`.

3. `contradictory-evidence`
   - Golden diz pesquisa desnecessaria; era caso de contradicao interna.
   - Consulta gerada: API/SQL timeout/monitoramento.
   - Impacto: status permanece `inconclusivo_correto`, mas dimensao `pesquisa` falha.

4. `multi-file-code-config`
   - Evidencia interna suficiente: `withTimeout(5000)`, `customersTimeoutMs 5000`, orders 30000, customers timeout.
   - Consulta gerada: API REST/timeout/multi arquivo.
   - Impacto: transforma diagnostico correto em `falhou`.

## 16. Quality Gate

Este benchmark offline nao executa o `quality-gate-service` do turno real. Ele usa avaliacao propria em `evaluateCase`.

Portanto:

- Nao ha "Quality Gate passou/falhou" por caso nesse benchmark.
- A matriz de falhas vem do avaliador offline.
- Nao se deve inferir que o Quality Gate real deixaria ou bloquearia a hallucination do caso `impossible-no-evidence`.

## 17. Dossie

O benchmark cria dossie por caso:

- `_seedCase` chama `dossieService.obterOuCriarDossie`.
- Em cada turno, `dossieContextService.montarMemoriaOperacional` e chamado.
- Como os casos usam banco temporario e `empresaId` isolado, nao foi observada contaminacao entre dossies.

Nos casos multi-turno, o dossie/contexto ajuda a manter a continuidade, mas o benchmark offline nao testa toda a atualizacao semantica do dossie real apos resposta LLM.

## 18. Definicao canonica das metricas

Para este baseline V1.0, usar estas definicoes:

- `resolvido corretamente`: `status === "ok"`.
- `inconclusivo corretamente`: `status === "inconclusivo_correto"`, sem erro grave; deve ser subdividido em produtivo ou indevido pela classificacao normalizada.
- `inconclusivo indevido`: caso com `status === "inconclusivo_correto"` mas `classificacaoV10 === "investigation_failure"` ou com lacuna de processo relevante.
- `falha real`: `status === "falhou"` quando o motivo representa comportamento indesejado do motor/harness, como pesquisa desnecessaria.
- `falha por falso positivo`: `status === "falhou_com_erro_grave"` quando a evidencia mostra que a regra de avaliacao marcou algo correto como erro.
- `alucinacao`: erro grave `HALLUCINATION_CRITICA`; deve ser validado manualmente para separar alucinacao real de falso positivo.
- `diagnostico prematuro`: erro grave `DIAGNOSTICO_PREMATURO`.
- `regressao investigativa`: erro grave `REGRESSAO_INVESTIGATIVA`.

Relacao entre metricas:

- `hallucination`, `diagnostico_prematuro` e `regressao` sao flags de erro grave, nao categorias exclusivas que somam com os 14 casos.
- `falhou_com_erro_grave` entra em `naoResolvidos`.
- Pesquisa desnecessaria pode causar `falhou`, mas tambem pode aparecer em caso `inconclusivo_correto`.

## 19. Baseline V1.0 canonico

Baseline bruto canonico atual:

- Commit: `ee8224ae34bbc2ac997b8531844b72309263bc6c`
- Branch: `feature/ia-command-multi-turn`
- Worktree: `repomix-output.xml` modificado; `IA_SERVICE_AUDITORIA_MOTOR_V1.md` nao rastreado.
- Dataset: `apps/IA Service/tests/benchmark/cases/development/initial-cases.json`
- Dataset version: `benchmark-4a-baseline-1`
- Runner: `runDatasetOffline`
- Mode: `offline_deterministico`
- Engine: `IA Service current motor + offline deterministic judge`
- Data: 2026-10-08

Numeros canonicos:

- Total: 14
- Resolvidos corretamente: 2
- Inconclusivos corretamente: 8
- Inconclusivos indevidos: 1 dentro dos 8 (`misleading-historical-ticket`, pela classificacao normalizada)
- Falhas reais: 3 por pesquisa desnecessaria (`simple-protheus-field-missing`, `helpful-historical-ticket`, `multi-file-code-config`)
- Falha por falso positivo do benchmark: 1 (`impossible-no-evidence`)
- Alucinacoes reais: 0 confirmadas
- Alucinacoes sinalizadas pelo benchmark: 1
- Diagnosticos prematuros: 0
- Regressoes: 0

Leitura semantica canonica:

- Resolvidos corretamente: 2
- Inconclusivos corretamente e produtivos: 7
- Inconclusivos indevidos: 1
- Falhas reais de processo: 3
- Falso positivo critico do benchmark: 1

## 20. Limitacoes

- O benchmark e sintetico, nao Golden Set real.
- O relatorio historico nao e gerado automaticamente nesta validacao e contradiz a semantica atual.
- O avaliador marca `erro` como informacao proibida no caso sem evidencia, produzindo falso positivo.
- O Quality Gate real nao e exercitado pelo benchmark 4A bruto.
- O modo pos-4B tem resultados melhores, mas e outra regua e nao deve ser misturado com baseline 4A bruto.

## 21. Criterios do Golden Set piloto

Ainda nao criar os 5 casos reais. Para o piloto, selecionar:

1. Protheus com erro/log objetivo.
2. Protheus com codigo customizado ou comportamento tecnico.
3. SoftExpert com integracao/API/workflow.
4. Caso com screenshot/PDF/anexo decisivo.
5. Caso multi-turno ou com evidencia inicialmente insuficiente.

Para cada caso:

- Separar input do motor e ground truth.
- Classificar vazamento como `RETRIEVAL CONHECIDO` ou `INVESTIGACAO / GENERALIZACAO`.
- Validar causa real, solucao validada e evidencias decisivas por humano tecnico.

## 22. Proximo passo recomendado

Antes do piloto real, documentar formalmente qual metrica sera usada como comparador:

- Para regressao automatica: usar status bruto atual, mas corrigir/documentar falso positivo conhecido.
- Para leitura executiva: usar tambem `classificacaoV10`, pois ela separa `productive_inconclusive` de `investigation_failure`.
- Para futuras alteracoes: comparar 4A bruto contra 4A bruto, e pos-4B contra pos-4B; nao misturar modos.

Depois disso, iniciar Golden Set piloto de 5 casos reais.

## Respostas obrigatorias

### 1. Por que existiam dois resultados diferentes?

Porque o relatorio historico de 2026-10-03 usa uma semantica diferente/inconsistente, chamando varios inconclusivos produtivos de `ok`, enquanto o harness atual conta `ok` apenas quando `status === "ok"`. Alem disso, o teste 4B guarda um snapshot historico `BASELINE_1` com `9/4/1`, mas o benchmark bruto atual recalculado retorna `2/8/4`.

### 2. Qual e o baseline canonico V1.0?

O baseline bruto canonico atual e `2 resolvidos corretamente / 8 inconclusivos corretamente / 4 falhas`, com 1 hallucination sinalizada pelo benchmark, 0 diagnosticos prematuros e 0 regressoes.

Semanticamente, apos revisar os casos:

- 2 resolvidos corretamente.
- 7 inconclusivos corretos e produtivos.
- 1 inconclusivo indevido.
- 3 falhas reais por pesquisa desnecessaria.
- 1 falso positivo critico do benchmark.

### 3. A alucinacao foi real ou falso positivo?

Falso positivo do benchmark. O caso `impossible-no-evidence` nao inventou causa, versao ou solucao; ele pediu "mensagem de erro completa". A regra marcou a palavra `erro`, que estava em `informacoes_que_nao_podem_ser_inventadas`, mesmo sendo usada de forma correta para pedir evidencia.

### 4. Quantos casos foram?

- Resolvidos corretamente: 2.
- Inconclusivos corretamente e produtivos: 7.
- Inconclusivos indevidamente: 1.
- Falhas reais: 3.
- Alucinacoes reais confirmadas: 0.
- Alucinacoes sinalizadas pelo benchmark: 1 falso positivo.
- Diagnosticos prematuros: 0.
- Regressoes: 0.

### 5. O benchmark e confiavel para comparar futuras alteracoes?

**PARCIALMENTE.**

Ele e deterministico e bom para comparar execucoes controladas do mesmo modo. Mas ainda precisa corrigir a documentacao das metricas e tratar o falso positivo de hallucination antes de ser usado como instrumento decisivo de calibracao.

### 6. Confianca dessa conclusao

**MEDIA.**

A conclusao e forte sobre a divergencia e o determinismo local, porque foi verificada por codigo e reexecucao. A confianca nao e alta porque o benchmark e sintetico, ha relatorio historico inconsistente e o avaliador tem falso positivo conhecido.

### 7. Estamos prontos para o piloto com 5 chamados reais?

**SIM, com ressalva.**

Estamos prontos para desenhar e iniciar o piloto, desde que antes fique combinado que o comparador usara metricas canonicas documentadas aqui e que o falso positivo conhecido nao sera tratado como alucinacao real. Nao estamos prontos para calibrar o motor com base apenas no benchmark sintetico atual.

## Checkpoint

Validacao concluida. Nenhum ajuste, calibracao, refatoracao, commit ou push foi realizado.
