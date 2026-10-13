# IA Service — Correções P0 da Auditoria Independente e Reconciliação de Resultados

**Executor:** Claude (Sonnet 5)
**Data:** 2026-10-12
**Âmbito:** Correção dos 4 defeitos identificados na auditoria de 2026-10-11, com validação por instrumentação direta, testes de regressão e reexecução completa dos 10 casos reais pelo fluxo de produção real.
**Alterações de código:** sim, nesta sessão, autorizadas explicitamente pelo usuário. Nenhum commit, push ou deploy realizado.

---

## 0. Correção de precisão em relação ao relatório anterior

Antes de descrever o trabalho desta sessão, duas correções sobre a auditoria de 2026-10-11, levantadas corretamente pelo usuário:

1. **A nota "84/100" era uma avaliação qualitativa própria** (Claude avaliando 5 dimensões com critério próprio), não uma medição objetiva de assertividade técnica. Mantenho essa distinção explícita em todo este documento.
2. **"0/7 aprovações do Quality Gate" misturava dois conceitos diferentes.** A auditoria anterior usou um script que chamava `qualityGateService.avaliarResposta` **uma única vez, sem o retry corretivo automático** que o fluxo real (`investigacaoService.processarTurno`) sempre executa quando a primeira tentativa falha. O **status final persistido real** (`concluido_com_alerta_quality_gate` = entregue ao consultor com ressalva registrada, vs. `revisao_necessaria_quality_gate` = suprimido) só existe depois desse retry. A reexecução desta sessão (seção 3) usa o fluxo real completo e reporta o status final correto.

---

## 1. Resumo das correções aplicadas

| # | Defeito | Arquivo(s) | Status |
|---|---|---|---|
| 1 | Timeout de socket-idle (não duração total) em chamadas HTTP | `ai-provider-client.js`, `safe-web-fetch-service.js` | Corrigido (robustez geral; causa do travamento original não confirmada por instrumentação — ver seção 2) |
| 2 | PRR não capturava termos técnicos de anexos/histórico selecionados | `context-engine.js`, `plano-resposta-rastreavel-service.js` | Corrigido e validado contra os 4 casos reais com falso positivo |
| 3 | `ATTACHMENT_NOT_ANALYZED` disparava sem nenhum anexo existir | `quality-gate-service.js` | Corrigido e validado |
| 4 | `CRITICAL_EVIDENCE_OMITTED` disparava para mensagens de histórico | `quality-gate-service.js` | Corrigido e validado |
| 5 (novo achado, não estava na lista original) | Afirmação numérica que não fecha aritmeticamente, nunca verificada pelo QG | `quality-gate-service.js` | Checagem nova adicionada e validada |

Suíte completa de testes (40 arquivos) executada **duas vezes** nesta sessão, arquivo por arquivo: **40/40 passando em ambas, zero regressão**. 6 novos testes de regressão adicionados em `tests/etapa1-quadro-investigativo.test.js`.

---

## 2. Travamento HTTP — investigação com instrumentação direta (requisito explícito do usuário)

O usuário pediu explicitamente para não presumir `req.write(string)` como causa sem reprodução conclusiva. Segui essa instrução e o resultado honesto é:

**O que foi feito:**
1. Peguei a versão original do código (via `git show HEAD`, antes de qualquer edição) e instrumentei `_httpPost` com logging granular: tamanho do corpo declarado (`Content-Length`) vs. tamanho real do buffer UTF-8, eventos de socket (`connect`, `secureConnect`, `close`, `timeout`), eventos da requisição (`finish`, `drain`, `error`), callback de `write()`.
2. Executei o código **original, não corrigido**, 9 vezes contra os payloads reais que haviam travado na auditoria anterior (5 imagens, 65KB a 1.2MB de payload).

**Resultado:** 9 de 9 execuções completaram com sucesso, em 11-17 segundos cada. Em nenhuma delas o `Content-Length` declarado divergiu do tamanho real do buffer (`declarado === bufferReal: true` em 100% dos casos). O travamento original **não foi reproduzido**.

**Conclusão honesta:** a hipótese específica de dessincronia de encoding Buffer/string **não se confirma com evidência direta**. É possível que o travamento original tenha sido causado por instabilidade transitória de rede ou do provider durante a sessão da auditoria anterior, não por um defeito determinístico no código.

**O que foi mantido, e por quê:** a troca de `req.setTimeout` (fato documentado do Node.js: mede inatividade do socket, não duração total da requisição) por `AbortController` com temporizador de duração total é uma correção de robustez legítima e independente da causa exata do travamento original — ela fecha uma classe real de risco (conexão que o provider mantém aberta sem nunca enviar os headers de resposta) que `req.setTimeout` **nunca teria detectado**, qualquer que fosse a causa raiz. `Buffer.from()` explícito no corpo da requisição também foi mantido (não há desvantagem em usá-lo), mas sem reivindicar que ele "resolveu" o bug original.

**Evidência observacional pós-correção:** na reexecução completa dos 10 casos reais (seção 3), os 3 casos que travavam indefinidamente na auditoria anterior (034178, 033910, 034658) completaram normalmente com o código corrigido (73-102 segundos cada). Isso é consistente com a correção ajudando, mas não é prova de causa — a mesma sessão também pode ter tido condições de rede diferentes.

---

## 3. Reconciliação: os 10 casos pelo fluxo real completo (com retry)

Diferente da auditoria anterior (que avaliava só a primeira tentativa, sem retry), esta execução usa `investigacaoService.processarTurno` real, com o banco de produção limpo (cópia isolada nova) e a configuração real de providers da empresa.

| Caso | Status final persistido | QG aprovado | Falhas | Duração total do turno |
|---|---|---|---|---:|
| 036381 | `concluido` | sim | nenhuma | 45,4 s |
| 035068 | `concluido` | sim | nenhuma | 61,2 s |
| 035398 | `concluido` | sim | nenhuma | 83,5 s |
| 035635 | `concluido` | sim | nenhuma | 61,1 s |
| 033521 | `concluido` | sim | nenhuma | 62,7 s |
| 036166 | `revisao_necessaria_quality_gate` | não | `VISUAL_EVIDENCE_TOO_GENERIC` | 117,5 s |
| 036558 | `concluido` | sim | nenhuma | 79,3 s |
| 034178 *(travava antes)* | `concluido` | sim | nenhuma | 81,5 s |
| 033910 *(travava antes)* | `revisao_necessaria_quality_gate` | não | `VISUAL_EVIDENCE_TOO_GENERIC` | 102,3 s |
| 034658 *(travava antes)* | `concluido` | sim | nenhuma | 73,9 s |

**8 de 10 casos: `concluido` com Quality Gate aprovado.** Os 2 bloqueios restantes (036166, 033910) são por `VISUAL_EVIDENCE_TOO_GENERIC` — uma checagem de estilo não relacionada ao PRR, que verifica se a resposta cita conteúdo concreto de uma imagem analisada (texto, campo, percentual) em vez de só mencionar "a imagem mostra" de forma vaga. Isso **não é o tipo de falso positivo corrigido nesta sessão** — é uma checagem de qualidade de descrição visual que continua ativa e pode ou não estar bem calibrada; não investiguei a fundo esses dois casos específicos porque está fora do escopo das 4 correções solicitadas.

**Nenhum dos 3 casos que travavam indefinidamente na auditoria anterior travou nesta execução.**

### 3.1 Confirmação direta dos 4 casos com falso positivo de PRR (auditoria anterior)

| Caso | Falha antes da correção | Resultado depois |
|---|---|---|
| 033521 | `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED` (MATA300/SB2/SB8 citados pelo histórico) | Ausente — `concluido`, aprovado |
| 035398 | `UNTRACEABLE_TECHNICAL_REFERENCE` + `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED` (campos do PDF DOC044) | Ausente — `concluido`, aprovado |
| 036166 | `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED` (campos do log JSON) | Ausente nesta execução — bloqueio atual é por `VISUAL_EVIDENCE_TOO_GENERIC`, não relacionado ao PRR |
| 036558 | `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED` (código-fonte `danfeii_new.prw`) | Ausente — `concluido`, aprovado |

Também testado isoladamente (fora do fluxo completo, direto em `qualityGateService.avaliarResposta`): o caso 036381 (`ATTACHMENT_NOT_ANALYZED` com 0 anexos) e 035068 (`CRITICAL_EVIDENCE_OMITTED` só com mensagens de histórico omitidas) — ambos confirmados eliminados, e na reexecução completa ambos aparecem como `concluido`/aprovado.

---

## 4. Achado adicional: inconsistência aritmética não detectada (caso 035635)

Investigando o caso que o usuário apontou (inferência numérica possivelmente insuficientemente fundamentada), confirmei algo mais grave do que "hedge insuficiente": a resposta original da auditoria anterior afirmava que uma diferença de saldo de **R$ 61.487,96** "corresponde a" duas aplicações CDB de **R$ 11.117.500,00 + R$ 145.500,00 = R$ 11.263.000,00** — uma discrepância de **~184 vezes**. Verificação aritmética simples (`node -e`) confirma que os números citados pela própria resposta não fecham.

**Correção aplicada:** nova função `_avaliarConsistenciaAritmetica` em `quality-gate-service.js`. Não bloqueia por palavra isolada — extrai valores monetários (formato brasileiro, com ou sem prefixo `R$`) de frases que afirmam correspondência/soma entre uma diferença e outros valores, e só reprova se a soma divergir da diferença afirmada por mais de 1% (tolerância de arredondamento legítimo).

**Validação:**
- Contra o texto real problemático: dispara corretamente (`ARITHMETIC_CLAIM_DOES_NOT_RECONCILE`).
- Contra 3 casos de controle (conta correta, sem menção numérica, arredondamento legítimo de 3 parcelas): não dispara em nenhum.
- Contra valores sem prefixo `R$` em nenhum número: dispara corretamente (requisito explícito do usuário sobre texto real de usuários).
- Na reexecução completa do caso 035635 pelo fluxo real: a nova resposta gerada pelo LLM não repetiu a mesma formulação numérica incorreta (variabilidade normal entre chamadas) — não disparou, o que é esperado e correto, não uma falha da correção.

---

## 5. Métricas operacionais reais (sem estimativa)

- **Latência por turno completo (10 casos, fluxo real com retry):** 45,4 s a 117,5 s. Mediana em torno de 70-80 s.
- **Causa confirmada da lentidão:** o provedor primário configurado para esta empresa (`openai`) retorna erro imediato de falta de créditos; o segundo da ordem de fallback (`groq`) também está sem crédito (**confirmado pelo usuário durante esta sessão**) e adicionalmente excede o limite de TPM (tokens por minuto) da conta para prompts do tamanho real do sistema. O fallback sempre recai no terceiro provedor (`claude`), que funciona mas elimina toda a redundância pretendida pela arquitetura de 5 providers — qualquer variação de latência do Claude nessa janela afeta 100% dos turnos, sem alternativa mais rápida no meio do caminho.
- **Retry automático do Quality Gate:** ativo e funcionando como desenhado — quando a primeira resposta falha, o sistema reconstrói o contexto, chama a IA novamente com instrução corretiva, e só então decide o status final. Isso soma uma segunda chamada completa de IA (visível nos casos 035398, 036558, 034658, 036166, 033910 desta reexecução — todos com `retryDeQualityGate: true`), o que explica turnos de 80-120 segundos mesmo sem nenhum problema de infraestrutura.

---

## 6. Testes de regressão adicionados

Em `apps/IA Service/tests/etapa1-quadro-investigativo.test.js`:

1. `testarAuditoria2026_PRRCapturaTermoDeAnexoSelecionadoCompleto` — confirma que um termo técnico presente no texto completo de um anexo selecionado entra no PRR como permitido.
2. `testarAuditoria2026_AttachmentNotAnalyzedNaoDisparaSemAnexoDisponivel` — confirma a guarda nova.
3. `testarAuditoria2026_AttachmentNotAnalyzedContinuaValidoComAnexoReal` — confirma que o bloqueio legítimo (há anexo, não foi analisado) continua funcionando.
4. `testarAuditoria2026_CriticalEvidenceOmittedIgnoraMensagemDeHistorico` — confirma a guarda nova.
5. `testarAuditoria2026_CriticalEvidenceOmittedContinuaValidoParaAnexo` — confirma que o bloqueio legítimo (anexo crítico de fato omitido) continua funcionando.
6. `testarAuditoria2026_ArithmeticClaimDoesNotReconcile` — 3 sub-casos: conta errada (deve bloquear), conta correta (não deve bloquear), sem menção numérica (não deve bloquear).

---

## 7. Riscos residuais e limitações desta sessão

- **Causa raiz do travamento HTTP original permanece não confirmada por evidência direta.** A correção de robustez (AbortController, timeout de duração total) é justificada por si mesma, mas não posso afirmar "bug corrigido" no sentido de "causa identificada e eliminada" — apenas "uma classe real de risco foi fechada, e o comportamento problemático não se repetiu nas reexecuções desta sessão".
- **`VISUAL_EVIDENCE_TOO_GENERIC`** bloqueou 2 dos 10 casos nesta reexecução (036166, 033910) — não investiguei se esses são bloqueios legítimos ou um novo padrão de falso positivo, por estar fora do escopo das 4 correções solicitadas. Recomendo auditoria dedicada a esse código se o padrão persistir em amostras maiores.
- **Groq e OpenAI sem crédito** é uma limitação operacional da conta usada nos testes, não um defeito de código — mas explica a maior parte da latência observada e deveria ser resolvido antes de qualquer teste de performance mais rigoroso.
- **Variabilidade do LLM entre chamadas** significa que o mesmo caso pode ou não repetir um padrão problemático específico (visto no caso 035635) — a ausência de disparo de uma checagem numa reexecução não prova que o problema não existe mais, só que não se manifestou naquela chamada específica.

---

## 8. Arquivos alterados

- `apps/IA Service/backend/services/ai-provider-client.js` — `_httpPost`: `Buffer.from()` explícito, `AbortController` com timeout de duração total substituindo `req.setTimeout`.
- `apps/IA Service/backend/services/safe-web-fetch-service.js` — `fetchTextoSeguro` e `resolverRedirectFinal`: mesma troca de `AbortController`.
- `apps/IA Service/backend/services/context-engine.js` — `montarContextoInvestigacao`: passa `evidenciasSelecionadas` (texto completo dos anexos/mensagens no manifesto) para `montarPlano`.
- `apps/IA Service/backend/services/plano-resposta-rastreavel-service.js` — `montarPlano`: novo parâmetro `evidenciasSelecionadas`, varre o texto completo e adiciona termos como `contexto_ou_hipotese` (não `fato_do_chamado` automático — ajuste aplicado a pedido do usuário, para não autorizar automaticamente como verdade técnica tudo que estiver em um anexo).
- `apps/IA Service/backend/services/quality-gate-service.js` — guarda em `pedeAnexo` (exige `anexosDisponiveis > 0`), filtro `tipo !== 'mensagem'` em `evidenciaCriticaOmitida`, nova função `_avaliarConsistenciaAritmetica` + `_extrairValoresMonetarios` + `compactarTrechoAritmetico`.
- `apps/IA Service/tests/etapa1-quadro-investigativo.test.js` — 6 novos testes de regressão.

## 9. Artefatos desta sessão

- Resultados dos 10 casos pós-correção: `C:/tmp/ia-service-auditoria-pos-correcao-resultados/*.json`
- Logs de execução: `C:/tmp/ia-service-validacao-pos-correcao-log1.txt`, `log2.txt`, `log3.txt`
- Log de instrumentação do travamento HTTP: `C:/tmp/ia-service-instrumentacao-log.txt`
- Resultado da suíte completa (2 execuções): confirmado manualmente, arquivo por arquivo, nesta sessão
