# IA Service — Consolidação das Correções (Codex + Claude Code)

**Executor:** Claude (Sonnet 5)
**Data:** 2026-10-12
**Âmbito:** Verificação do estado da worktree após trabalho paralelo de duas ferramentas, identificação de conflitos, execução da suíte completa, análise dos 2 bloqueios residuais.
**Commit/push/deploy:** nenhum realizado.

---

## 1. Estado da worktree

A worktree contém trabalho de **duas origens diferentes** sobre os mesmos arquivos centrais do motor investigativo:

- **Claude Code** (sessões anteriores desta conversa): correções P0 de robustez HTTP, extensão do PRR, guardas do Quality Gate, checagem aritmética, mais a bateria completa de homologação.
- **Codex**: ajustado em paralelo, sem meu conhecimento direto — identificado por diffs em arquivos que eu não toquei (`token-budget-service.js`, dois arquivos de teste `fase1-*`, e reduções de escopo em `technical-research-service.js`).

Nenhuma sobrescrita destrutiva foi encontrada: as duas linhas de trabalho tocam partes distintas ou complementares do mesmo arquivo, sem se cancelarem.

### 1.1 Mudanças atribuídas ao Codex (confirmadas por diff, não presentes nas minhas edições anteriores)

| Arquivo | Mudança | Avaliação |
|---|---|---|
| `token-budget-service.js` | Janela de orçamento do Groq reduzida de 32000 para 12000 tokens (comentário cita limite real de TPM observado) | Correção real e coerente com o achado operacional da auditoria (Groq rejeitava por TPM) |
| `technical-research-service.js` | Reduz páginas abertas por pesquisa de 4→2, adiciona limite de tentativas (6), fallback de retry com orçamento maior só para fontes oficiais quando erro é "limite de download" | Reduz latência de pesquisa; coerente com o achado de latência alta (70-120s/turno) |
| `tests/fase1-fase2-pos-auditoria.test.js` | Resposta de teste reescrita para formato sem cabeçalhos de laudo (evita `ROBOTIC_TEMPLATE_RESPONSE`) | Ajuste de teste para acompanhar regra já existente, sem alterar o que está sob teste |
| `tests/fase1-fontes-corrigidos.test.js` | Mesmo ajuste de formato de resposta — **continha código morto** (um `return` antigo nunca alcançado, por função ter dois `return` sequenciais) | **Corrigido nesta sessão** — código morto removido, teste continua passando |

### 1.2 Mudanças atribuídas a esta sessão (Claude Code, incluindo revisão atual)

- `ai-provider-client.js`: `Buffer.from()` explícito + `AbortController` com timeout de duração total em `_httpPost`.
- `safe-web-fetch-service.js`: mesma troca de `AbortController` em `fetchTextoSeguro` e `resolverRedirectFinal`.
- `context-engine.js` + `plano-resposta-rastreavel-service.js`: PRR estendido para varrer texto completo de evidências selecionadas (anexos/histórico), autorizado como `contexto_ou_hipotese` (não `fato_do_chamado` automático — decisão intencional para não validar tecnicamente tudo que está em um anexo).
- `quality-gate-service.js`: guarda `ATTACHMENT_NOT_ANALYZED` (exige `anexosDisponiveis > 0`), guarda `CRITICAL_EVIDENCE_OMITTED` (exclui `tipo === 'mensagem'`), checagem nova `ARITHMETIC_CLAIM_DOES_NOT_RECONCILE`, e (nesta revisão) extensão do vocabulário de `VISUAL_EVIDENCE_TOO_GENERIC` — ver seção 3.
- **Comentário corrigido** em `plano-resposta-rastreavel-service.js`: descrevia `fato_do_chamado`/`causalPermitido: true`, mas o código real usa `contexto_ou_hipotese`/`false` (ajuste feito antes, comentário estava desatualizado — corrigido nesta sessão).

---

## 2. Preservação das melhorias — confirmado item por item

| Melhoria | Verificação | Resultado |
|---|---|---|
| PRR cobre anexos/histórico selecionados | `grep` confirma `evidenciasSelecionadas` conectado em `context-engine.js:821` e consumido em `plano-resposta-rastreavel-service.js:153` | Presente e intacto |
| Context Engine (quadro investigativo, manifesto) | Nenhuma mudança de Codex nesse arquivo conflita com a extensão do PRR — é aditiva | Presente e intacto |
| Quality Gate — 3 guardas (PRR/ATTACHMENT/CRITICAL_EVIDENCE) | `grep` confirma as 3 condições exatamente como implementadas | Presentes e intactas |
| Fail-closed (`revisaoNecessariaQualityGate`, `_calcularRevisaoNecessariaQualityGate`) | Presente em `investigacao-service.js:878-880`, lógica de retry+bloqueio não foi tocada por nenhuma das duas linhas de trabalho | Presente e intacto |
| Timeout HTTP (`AbortController`) | Presente em `ai-provider-client.js` e `safe-web-fetch-service.js`, validado por execução real contra API nesta e em sessões anteriores | Presente e intacto |
| Validação aritmética | `_avaliarConsistenciaAritmetica` presente e conectada em `avaliarResposta` | Presente e intacta |

---

## 3. VISUAL_EVIDENCE_TOO_GENERIC — análise dos dois bloqueios, com evidência completa preservada

### 3.1 Caso 036166 — falso positivo confirmado e corrigido

**Resposta rejeitada pelo Quality Gate (preservada integralmente):**

> *"Os prints confirmam isso: a tela de 'Contas a Pagar' mostra o título 53 com DT Baixa vazia (/ /), e o Monitor de Pagamentos (V260416) exibe o status 'BLOQUEADO / REJEITADO' com a mensagem de erro do banco. [...] Os prints mostram que o título permanece sem data de baixa, e o Monitor exibe status 'BLOQUEADO / REJEITADO'."*

**Verificação contra o histórico real do caso** (mensagem de abertura do chamado, preservada): o cliente menciona apenas a mensagem de erro bancário ("Débito na conta do pagador não efetivado..."). **Não menciona** em nenhum momento "DT Baixa vazia", "título 53", "Monitor de Pagamentos (V260416)" ou "status BLOQUEADO/REJEITADO" — esses detalhes só poderiam ter vindo da leitura real das 2 imagens selecionadas no manifesto (`imagensSelecionadas: 5`, confirmadas no turno).

**Causa técnica do falso positivo:** o regex `temSinalVisualConcreto` em `quality-gate-service.js` exigia um de ~10 padrões muito específicos (`fwwhen`, `% rateio`, `100,00`, `\b[a-z]{3,}\d{2,}` etc.), todos calibrados para um cenário de customização de tela/rateio de NF. O código de tela citado (`V260416`) tem só 1 letra antes dos dígitos — não bate `{3,}`. Nenhum outro padrão cobria "status em caixa alta citado como valor lido" nem "campo de data vazio".

**Correção aplicada:** 3 novos sub-padrões adicionados a `temSinalVisualConcreto`:
1. Código de tela/rotina curto (1+ letra + 3+ dígitos) — `V260416`, `SX2010`, etc.
2. Status operacional em caixa alta citado próximo da palavra status/situação/estado (`BLOQUEADO`, `REJEITADO`, `PENDENTE` etc.).
3. Campo de data/valor explicitamente vazio (`vazia (/ /)`), restrito a contexto de data/campo/baixa/vencimento — para não capturar parênteses vazios de chamada de função em código-fonte (ver 3.3).

**Validação:** resposta real do 036166 → deixa de disparar `VISUAL_EVIDENCE_TOO_GENERIC`. Suíte completa (40 arquivos) + 1 novo teste de regressão (3 sub-casos: positivo real, controle vago, controle código-fonte) — todos passando.

### 3.2 Caso 033910 — bloqueio mantido, não corrigido

**Resposta rejeitada (preservada integralmente, trecho relevante):**

> *"[...] O fonte WSAPISC.prw [...] é exatamente a rotina que deveria popular essa grid via integração com o SoftExpert. [...] A grid vazia no print sugere que ou a consulta SQL não está retornando dados, ou a chamada ao webservice está falhando silenciosamente."*

**Avaliação:** a resposta é tecnicamente rica (deriva hipóteses do código-fonte real, cita o número de pedido `065232`), mas a menção ao print é qualitativa e genérica ("a grid vazia no print sugere") — não transcreve nenhum texto, rótulo, campo ou valor que só pudesse ter vindo da leitura da imagem em si. O número do pedido já constava no histórico textual (campo "Nº do Pedido de Compra"), não foi atribuído explicitamente à leitura da imagem.

**Decisão:** não alterado. O bloqueio é defensável — a regra pede especificamente citação de conteúdo concreto da imagem, e esse padrão não está presente aqui de forma inequívoca.

### 3.3 Risco de regressão identificado e corrigido durante a validação

A primeira versão do padrão de "campo vazio" (`\(\s*\/?\s*\/?\s*\)`) capturou incorretamente a chamada de função `SendSoapMsg()` no texto do caso 033910 (parênteses vazios de código, não campo de tela vazio), fazendo o caso parar de bloquear indevidamente. Corrigido antes de finalizar: o padrão agora exige barra dentro dos parênteses (`/ /`) e contexto de data/campo/baixa/vencimento nas proximidades — ambos os casos reais foram revalidados após o ajuste e o comportamento correto foi confirmado (036166 passa, 033910 continua bloqueado).

---

## 4. Suíte completa de testes

Executada **integralmente, arquivo por arquivo** (não em lote silencioso), duas vezes nesta sessão:

- 1ª execução: antes da correção de `VISUAL_EVIDENCE_TOO_GENERIC` — 40/40 passando.
- 2ª execução: depois da correção, incluindo o novo teste de regressão — 40/40 passando.

Nenhuma falha, nenhum teste pulado, nenhum timeout.

---

## 5. Divergências e conflitos — resumo

| Tipo | Encontrado? | Detalhe |
|---|---|---|
| Sobrescrita destrutiva de código | Não | Nenhuma correção de uma ferramenta anulou a da outra |
| Conflito funcional (comportamento contraditório) | Não | PRR, Quality Gate, timeout HTTP, Context Engine coexistem sem contradição |
| Comentário desatualizado | Sim (1) | `plano-resposta-rastreavel-service.js` — corrigido nesta sessão |
| Código morto | Sim (1) | `return` inalcançável em `fase1-fontes-corrigidos.test.js` — corrigido nesta sessão |
| Falso positivo confirmado e corrigido | Sim (1) | `VISUAL_EVIDENCE_TOO_GENERIC` no caso 036166 — corrigido com evidência direta, nesta sessão |
| Bloqueio legítimo preservado | Sim (1) | `VISUAL_EVIDENCE_TOO_GENERIC` no caso 033910 — mantido sem alteração |

---

## 6. Estado consolidado — resposta objetiva

- **As 6 melhorias centrais** (PRR, Context Engine, Quality Gate, fail-closed, timeout HTTP, validação aritmética) estão **presentes, intactas e sem conflito** entre o trabalho das duas ferramentas.
- **Dois achados de limpeza** foram corrigidos (comentário desatualizado, código morto) sem impacto funcional.
- **Um falso positivo foi corrigido com evidência direta e demonstrada** (036166) — o outro bloqueio similar (033910) foi mantido porque não há evidência equivalente de falso positivo.
- **Suíte de 40 testes: 100% passando**, duas execuções completas, zero regressão introduzida pela consolidação.
- **Nenhuma nova capacidade de raciocínio foi adicionada ao motor** — o trabalho desta sessão foi estritamente de consolidação, correção pontual com prova, e verificação. Consistente com a diretriz do usuário de não acrescentar inteligência nova neste momento.

---

## 7. Arquivos alterados nesta sessão de consolidação

- `apps/IA Service/backend/services/plano-resposta-rastreavel-service.js` — comentário corrigido para refletir o comportamento real do código.
- `apps/IA Service/backend/services/quality-gate-service.js` — `VISUAL_EVIDENCE_TOO_GENERIC`: 3 novos sub-padrões de detecção, validados contra os dois casos reais e contra regressão (parênteses de código-fonte).
- `apps/IA Service/tests/fase1-fontes-corrigidos.test.js` — remoção de código morto (bloco `return` inalcançável).
- `apps/IA Service/tests/etapa1-quadro-investigativo.test.js` — novo teste de regressão `testarAuditoria2026_VisualEvidenceConcretaForaDoVocabularioDeRateio` (3 sub-casos).

## 8. Próximos passos recomendados (não executados nesta sessão)

- Nenhum ajuste adicional de código é recomendado neste momento — o objetivo de estabilização foi atingido.
- Se uma amostra maior (homologação humana futura) revelar novos padrões de `VISUAL_EVIDENCE_TOO_GENERIC` com evidência de falso positivo equivalente à do caso 036166, a mesma metodologia (resposta completa + confronto contra histórico real + regex isolado) deve ser repetida — sem generalizar o vocabulário preventivamente sem caso real na mão.
