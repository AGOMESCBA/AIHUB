# IA Service — Auditoria Independente das Fases 1 e 2 (Implementação Codex)

Auditor: Claude (arquiteto de software sênior, revisão independente)
Data: 2026-10-08
Branch: `feature/ia-command-multi-turn` — todas as alterações auditadas estão na working tree, **nenhuma foi commitada**.
Metodologia: leitura integral de cada arquivo alterado (não apenas diff), execução dos testes automatizados existentes, e reprodução de 2 hipóteses de defeito com scripts não destrutivos próprios (bancos SQLite temporários isolados, sem tocar dados reais, sem chamada a provider de IA pago).

---

## 1. Resumo executivo

A Fase 1 (correção de fontes customizados) está presente, correta e já havia sido auditada por mim anteriormente nesta mesma working tree — nada mudou nela desde então. A Fase 2 (respostas objetivas e dinâmicas) **está implementada**, via dois componentes novos: `resposta-operacional-service.js` (camada de apresentação que resume a resposta estruturada em uma "ficha operacional" curta) e três regras novas no `quality-gate-service.js`. A Fase 2 não deve ser tratada como "ainda não implementada" — há código funcional, testável e com teste próprio passando.

Dito isso, a auditoria encontrou **um defeito confirmado de alta severidade** (bug de regex que torna uma das três novas regras do quality-gate estruturalmente incapaz de reconhecer a forma mais comum do verbo "corrigir" em português, inflando retries desnecessários) e **uma regressão de médio impacto confirmada por reprodução** (o aviso de ambiguidade/truncamento do fluxo de fonte corrigida desaparece ao recarregar a página, porque não é persistido nem reconstruído pela rota de listagem — quebra parcial, não total, do critério de aceite da própria Fase 1). Não foram encontrados problemas de segurança, vazamento multiempresa, XSS ou corrupção de arquivo corrigido.

O trabalho é sólido na direção certa, mas não está pronto para liberação sem os dois ajustes acima.

---

## 2. Arquivos e componentes auditados

**Lidos por completo (não apenas diff):**
- `apps/IA Service/backend/services/resposta-operacional-service.js` (novo, 131 linhas)
- `apps/IA Service/backend/services/quality-gate-service.js` (328 linhas, versão atual completa)
- `apps/IA Service/backend/services/investigacao-service.js` (trecho de `processarTurno`, linhas ~450-740)
- `apps/IA Service/backend/services/versao-fonte-service.js` (completo)
- `apps/IA Service/backend/repositories/anexo-repository.js` (trecho de `listarVersoes`)
- `apps/IA Service/backend/routes/index.js` e `externo-routes.js` (diffs completos + contexto de middleware)
- `apps/IA Service/frontend/atendimento.html` e `radar.html` (diffs completos)
- `apps/IA Service/tests/fase1-fontes-corrigidos.test.js` e `fase2-respostas-objetivas.test.js` (completos)

**Verificados por grep/busca direcionada:** `atendimento-service.js` (`listarMensagens`), `sessao-externa-middleware.js` (confirmação de isolamento por sessão externa).

**Não alterado nesta auditoria:** nenhum arquivo de produção, prompt, migration ou configuração. Scripts de reprodução ficaram fora do repositório (`scratchpad` de sessão), bancos SQLite temporários próprios, removidos ao final de cada execução.

---

## 3. Achados por severidade

### CRÍTICO
Nenhum achado crítico.

### ALTO

**A1 — Bug de regex torna `EVIDENCE_WITHOUT_NEXT_ACTION` incapaz de reconhecer "corrigir" na forma mais comum em português, inflando retries em respostas corretas.**
- Arquivo/função: `apps/IA Service/backend/services/quality-gate-service.js`, `avaliarResposta`, linha 242.
- Trecho: `/\b(aplique|aplicar|execute|valid|envie|anexe|corrij|teste|compare|verifique)\b/i`
- Problema: o termo `corrij` foi escrito como prefixo truncado na intenção de casar "corrija/corrigir/corrigido/corrige" via `\w*` implícito, mas está entre dois delimitadores `\b`. Como não há fronteira de palavra entre `corrij` e a letra seguinte (`a`, `i`, `o`, `e`), **o padrão `\bcorrij\b` nunca casa com nenhuma conjugação real do verbo**.
- Evidência (reproduzido com script próprio, não destrutivo):
  ```
  'corrija'   -> /\bcorrij\b/i  = false
  'corrigir'  -> /\bcorrij\b/i  = false
  'corrigido' -> /\bcorrij\b/i  = false
  'corrige'   -> /\bcorrij\b/i  = false
  ```
  Uma resposta desenhada para satisfazer *exatamente* todos os critérios que o próprio `montarInstrucaoRetry` pede — cita log, propõe correção com "Corrija a validação de índice", pede compilação e reprodução em homologação — ainda assim recebe a falha `EVIDENCE_WITHOUT_NEXT_ACTION`, porque a regex não reconhece "Corrija" como ação válida.
- Impacto real: toda resposta que usa "corrija"/"corrigido"/"corrige" (formas usuais do português, mais comuns que o infinitivo "corrigir") sem também usar um dos outros verbos da lista (`aplique, execute, valid*, envie, anexe, teste, compare, verifique`) dispara falha de severidade `media`, o que aciona `deveRetry = true` em `investigacao-service.js` (linha 278 do quality-gate) — **uma segunda chamada completa ao provider de IA**, dobrando tokens e latência, para uma resposta que já estava correta. Isso não quebra a funcionalidade (há limite de 1 retry, não há loop infinito, e a resposta final é aceita mesmo se a 2ª tentativa repetir a falha), mas é desperdício sistemático de custo/latência exatamente no cenário mais comum.
- Correção recomendada: trocar `corrij` por `corrig` sem o `\b` de fechamento nessa alternativa específica, ou usar `corrig\w*` isolado do grupo com `\b` nas demais palavras. Validar com os testes de regressão de vocabulário antes de reativar a regra.
- Risco da alteração: baixo — é um ajuste cirúrgico de uma regex isolada, sem relação com schema, prompt ou fluxo de dados.
- Verdict: **CONFIRMED** (reproduzido experimentalmente, três variações de teste independentes confirmaram o mesmo padrão).

### MÉDIO

**M1 — Aviso de ambiguidade/truncamento do fluxo de fonte corrigida não sobrevive ao recarregamento da página (regressão parcial do critério de aceite da Fase 1).**
- Arquivos/funções: `apps/IA Service/backend/services/investigacao-service.js` (`processarTurno`, linhas 701-729, onde `mensagemAssistente.avisosFonteCorrigido` é criado só em memória) e `apps/IA Service/backend/services/resposta-operacional-service.js` (`anexarFichaOperacional`, linha 112-124, chamado por `routes/index.js` e `externo-routes.js` na listagem de mensagens).
- Problema: `avisosFonteCorrigido` (e `fontesCorrigidos` quando o aviso impede a criação de versão) é um campo calculado e anexado ao objeto de mensagem **somente dentro da resposta imediata de `processarTurno`**. Nenhum repositório (`mensagem-repository.js`, `anexo-repository.js`) persiste esse campo, e a rota de listagem (`GET /mensagens`), usada toda vez que o atendimento é reaberto ou a página recarregada, não o reconstrói — ela só reconstrói `fontesCorrigidos` no frontend via `montarFontesCorrigidosPorMensagem(anexos)` (que funciona, porque anexos de versão corrigida são de fato persistidos), mas não há equivalente para os **avisos de bloqueio** (ambiguidade de múltiplos anexos, conteúdo truncado/vazio) — esses só existiam como texto efêmero no payload da requisição original.
- Evidência (reproduzido com script próprio, banco temporário isolado):
  ```
  Payload imediato (envio):        avisosFonteCorrigido: ["Ha mais de um anexo de codigo no turno; ..."]
  Payload após reload (GET /mensagens): avisosFonteCorrigido: undefined
  ```
- Impacto real: um analista que recebe o aviso "há mais de um anexo de código no turno; nenhuma versão corrigida foi gerada automaticamente" na hora, mas sai do atendimento e volta depois (ou atualiza a página), **não vê mais esse aviso** — a mensagem da IA aparece sem nenhuma indicação de que uma correção foi *pedida* e *bloqueada*. Isso pode levar o analista a presumir que não havia ambiguidade, ou a esquecer que uma ação estava pendente (escolher o arquivo-alvo manualmente). É uma quebra parcial do próprio critério de aceite do cenário "Multiplos fontes" descrito na auditoria funcional anterior (`IA_SERVICE_AUDITORIA_FUNCIONAL_EVOLUCAO.md`, seção 15, teste de aceitação #2).
- Correção recomendada: persistir `avisosFonteCorrigido` (ex.: coluna JSON em `mensagens`, ou reconstrução determinística na listagem a partir de `fonteCorrigidoTexto` presente no texto da própria mensagem — já que a mensagem guarda o texto completo da IA, o aviso poderia ser recalculado a partir dele e dos anexos do turno, sem precisar de nova coluna). Qualquer uma das duas abordagens é aceitável; a arquitetural (reconstrução determinística) evita migration.
- Risco da alteração: baixo a médio — se for coluna nova, é aditiva (sem quebra de compatibilidade); se for reconstrução determinística, precisa garantir que os mesmos anexos do turno original ainda estejam identificáveis (o campo `mensagemOrigemId` em anexos de versão corrigida ajuda nisso, mas o caso de "zero versões criadas" não deixa rastro em `anexos` — precisaria derivar do texto da própria mensagem).
- Verdict: **CONFIRMED** (reproduzido experimentalmente).

**M2 — `GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE` dispara em paralelo às novas regras em todos os 4 cenários de teste, sugerindo sobreposição de critérios não avaliada em conjunto.**
- Arquivo/função: `quality-gate-service.js`, `_temRespostaGenerica` (linha 5) interagindo com as novas regras (linhas 226-249).
- Problema: em todos os 4 textos de teste que usei (incluindo o "caso ideal" desenhado para satisfazer todas as regras), `_temRespostaGenerica` também disparou, porque o limiar de 450 caracteres (`if (s.length < 450) return true`) é facilmente atingido por respostas curtas e objetivas — exatamente o tipo de resposta que a própria Fase 2 (ficha operacional curta, "sem textos excessivos") está tentando produzir. Isso não foi testado em conjunto com as 3 novas regras: o risco é que uma resposta **bem-sucedida em ser objetiva** (curta, direta) tenha mais chance de ser penalizada por `GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE`, criando uma tensão não resolvida entre "seja objetivo" (meta da Fase 2) e "respostas curtas são suspeitas de serem genéricas" (critério pré-existente do quality-gate).
- Impacto real: possível aumento de taxa de retry para respostas que a própria Fase 2 está pedindo (curtas e diretas) — não confirmei magnitude real sem dados de produção, mas o mecanismo está demonstrado nos testes.
- Correção recomendada: medir, com amostra real pós-deploy (ou no mínimo com o benchmark offline já existente em `apps/IA Service/tests/benchmark/`), se a taxa de retry subiu depois da Fase 2 e se `GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE` é a causa predominante. Considerar recalibrar o limiar de 450 caracteres à luz da ficha operacional curta.
- Verdict: **PLAUSIBLE** (mecanismo demonstrado, magnitude real não medida — ver seção 9).

### BAIXO

**B1 — `resposta-operacional-service._tipoDiagnostico` e `quality-gate-service` usam listas de regex independentes para os mesmos conceitos ("causa confirmada", "hipótese", "evidência insuficiente"), com risco de desalinhamento futuro.**
- Arquivos: `resposta-operacional-service.js` linhas 21-33 vs. `quality-gate-service.js` linha 226 (`causa confirmada|diagn[oó]stico confirmado|com certeza|definitivamente`).
- Observação: não é um defeito funcional hoje (os testes passam), mas os dois serviços classificam o mesmo tipo de linguagem ("causa confirmada") com vocabulários ligeiramente diferentes e sem uma fonte única de verdade. Se um dos dois evoluir sem o outro, a ficha operacional pode dizer "Diagnóstico" (confirmado) enquanto o quality-gate simultaneamente marca `CERTAINTY_WITHOUT_EVIDENCE`.
- Sugestão (não é defeito, é melhoria): extrair o vocabulário de "nível de certeza" para um módulo compartilhado. Não bloqueia liberação.

**B2 — `numeroVersao` no frontend (`numeroVersao`/`numeroVersaoFonte`) recalcula o índice a partir do array `historico` já ordenado, mas cai em fallback `item?.numeroVersao || '?'` se o item não for encontrado — esse fallback só é correto porque `routes/index.js` já envia `numeroVersao` pré-calculado na rota de listagem; se algum card usar um array de histórico que não inclua a rota padrão, pode exibir `'?'`.**
- Não reproduzi um cenário real onde isso ocorra (os caminhos testados sempre têm o `historico` completo). Classificado como melhoria de robustez, não defeito confirmado.

---

## 4. Problemas específicos da Fase 1

Nenhum problema novo. A Fase 1 (fluxo de fonte corrigida: validação de conteúdo truncado, bloqueio de ambiguidade com múltiplos anexos, nomenclatura de arquivo corrigido, rotas de diff/download com validação de relação original↔versão e proteção de path traversal) permanece correta — confirmei isso em auditoria anterior nesta mesma working tree e revalidei agora que nada regrediu: `fase1-fontes-corrigidos.test.js` e `etapa2-extracao-e-versionamento.test.js` passam integralmente.

O único problema que toca a Fase 1 é o **M1** (seção 3), que é tecnicamente uma lacuna de integração entre Fase 1 e Fase 2 — ver seção 5.

## 5. Problemas específicos da Fase 2

- **A1** (bug de regex `\bcorrij\b`) é o achado central da Fase 2.
- **M2** (tensão entre objetividade e `GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE`) é um risco de design não resolvido, não um bug confirmado.
- A camada de apresentação (`resposta-operacional-service.js`) em si é bem desenhada: não chama LLM, não altera o texto original persistido, é determinística a partir de `diagnostico_json` já existente, e tem fallback explícito para mensagens antigas sem seções estruturadas (`tipo: 'sem_estrutura'`, testado em `fase2-respostas-objetivas.test.js` linha 88-92) e para mensagens que não são do assistente (`anexarFichaOperacional` retorna a mensagem inalterada se `papel !== 'assistant'`, linha 113). Isso é compatibilidade correta com histórico antigo.
- O teste novo (`fase2-respostas-objetivas.test.js`) cobre bem o serviço de ficha operacional e as 3 regras novas do quality-gate **isoladamente**, mas não cobre o ciclo completo via rota HTTP nem o cenário de recarregamento de página — por isso não capturou o achado M1.

## 6. Problemas de integração entre fases

- **M1** é essencialmente uma lacuna de integração: a Fase 1 criou `avisosFonteCorrigido` como sinal efêmero pensando apenas no payload de resposta imediata; a Fase 2 adicionou uma segunda via de apresentação (`anexarFichaOperacional`, usada na *listagem*) sem repassar esse sinal. Nenhuma das duas fases, isoladamente, "errou" — o problema surgiu porque a composição das duas não foi testada ponta a ponta (envio → reload).
- `respostaOperacionalService.construirFichaOperacional` é chamado duas vezes para a mesma mensagem em caminhos diferentes: uma vez em `investigacao-service.processarTurno` (linha 731, usando os campos em memória, incluindo fontes/avisos do turno) e outra vez em `anexarFichaOperacional` sempre que a lista é relida (usando apenas o que está persistido). Isso é redundante mas não incorreto — é, na prática, a causa-raiz de M1: a primeira chamada "vê" o aviso, a segunda não.

## 7. Segurança e isolamento multiempresa

Nenhum problema encontrado.
- `_validarRelacaoVersao` (routes/index.js, linha 54) valida `empresaId`, `atendimentoId` e `anexoOriginalId` antes de liberar qualquer diff — já existia e não foi alterado nesta leva de mudanças, permanece correto.
- `_resolverCaminhoAnexoSeguro` (routes/index.js, linha 61) bloqueia path traversal no download — confirmado, sem alteração.
- A nova chamada em `externo-routes.js` (`respostaOperacionalService.anexarFichaOperacional`, linha 235) opera sobre o resultado de `atendimentoService.listarMensagens(req.svcEmpresaId, ...)`, que já é filtrado por empresa antes de chegar à função — a camada de apresentação não introduz nenhum parâmetro de escopo novo, não há superfície de vazamento cross-empresa aqui.
- `requireSessaoExterna` (confirmado via grep em `externo-routes.js` linha 46) continua sendo aplicado via `app.use` a todas as rotas do canal externo — nenhuma rota nova ficou fora desse middleware.
- Nenhuma das novas regex do quality-gate processa ou expõe dados de outra empresa — operam apenas sobre o texto da própria resposta.

## 8. Performance e consumo

- **Custo de `anexarFichaOperacional` em listagem**: medido experimentalmente — 200 mensagens processadas em ~3,2ms (0,016ms/mensagem). Desprezível; não é um gargalo mesmo em atendimentos longos.
- **Custo de tokens/latência via retry (A1 e M2)**: este é o achado real de consumo. Cada falha de severidade `media`/`alta` do quality-gate aciona uma segunda chamada completa ao provider de IA (linha 476 de `investigacao-service.js`, `qualityGate.deveRetry`). As 3 regras novas são todas severidade `media`. Confirmei por reprodução que pelo menos uma delas (`EVIDENCE_WITHOUT_NEXT_ACTION`, via bug A1) dispara em respostas corretas e até na resposta "ideal" desenhada para satisfazer o gate. Isso significa **retries adicionais sistemáticos que não existiam antes da Fase 2**, sem medição de taxa real em produção/staging até o momento desta auditoria.
- Não foi possível medir o impacto real em volume de produção porque isso exigiria chamadas reais ao provider de IA (fora do escopo autorizado: "não consumir APIs pagas sem autorização"). A estimativa qualitativa acima é baseada em análise estática + testes determinísticos do próprio quality-gate (sem LLM).

## 9. Testes executados e resultados

| Teste | Resultado |
|---|---|
| `node tests/fase1-fontes-corrigidos.test.js` | ✅ Passou (todos os asserts) |
| `node tests/fase2-respostas-objetivas.test.js` | ✅ Passou (todos os asserts) |
| `node tests/etapa2-extracao-e-versionamento.test.js` | ✅ Passou (todos os asserts) — confirma ausência de regressão na Fase 1 |
| Script próprio: reload de `avisosFonteCorrigido` após `GET /mensagens` | ❌ Falhou como esperado — confirma **M1** |
| Script próprio: 4 cenários de resposta "boa" contra `quality-gate-service.avaliarResposta` | ❌ 3 dos 4 cenários (incluindo o "ideal") dispararam falha indevida — confirma **A1** |
| Medição de performance de `anexarFichaOperacional` (200 mensagens sintéticas) | ✅ 3,2ms total — sem achado |

Todos os scripts de reprodução usaram bancos SQLite temporários próprios (criados e destruídos dentro do próprio script, fora do banco real), sem chamadas a provider de IA pago, sem alteração de nenhum arquivo do repositório.

Não executei: testes end-to-end autenticados via navegador real (fora do escopo de ferramentas desta sessão), nem testes de carga/volume real de produção.

## 10. Riscos não comprovados

- **M2** (tensão objetividade vs. `GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE`): mecanismo demonstrado, magnitude real em produção não medida.
- Risco de regressão no Motor Investigativo V1.0 mais amplo (fora do quality-gate): não encontrei evidência de alteração em `context-engine.js`, `investigative-discipline-service.js`, `prompt-builder.js`, `dossie-context-service.js` ou `technical-research-service.js` nesta leva — nenhum desses arquivos aparece no `git diff --stat`. Risco de regressão nessas camadas é, portanto, **não aplicável** a esta auditoria (não foram tocadas).
- Não testei o comportamento real de `_descartaCustomizacaoSemBase`, `_acaoIgnoraErroMaisEspecifico` e demais regras pré-existentes do quality-gate em combinação com as 3 novas regras em um corpus maior de respostas reais variadas — os 4 cenários que testei foram desenhados para expor especificamente as regras novas, não é uma amostra estatisticamente representativa de todo o espectro de respostas possíveis.

## 11. Correções recomendadas, por prioridade

1. **[ALTO — A1]** Corrigir a regex `\bcorrij\b` em `quality-gate-service.js` linha 242, trocando para uma forma que efetivamente reconheça "corrija/corrigir/corrigido/corrige" (ex.: `corrig\w*` fora do padrão de `\b` fechado, ou enumerar as formas completas). Reexecutar os 4 cenários de teste manual usados nesta auditoria para confirmar correção antes de reativar a regra em produção.
2. **[MÉDIO — M1]** Persistir ou reconstruir deterministicamente `avisosFonteCorrigido` para que sobreviva ao recarregamento de página — decisão de design entre nova coluna persistida vs. recomputação a partir do texto da mensagem + anexos do turno.
3. **[MÉDIO — M2]** Antes de liberar a Fase 2 para uso real, medir (via benchmark offline existente ou amostra controlada) se a taxa de retry do quality-gate aumentou de forma not trivial após a introdução das 3 regras novas, especialmente em respostas curtas/objetivas.
4. **[BAIXO — B1/B2]** Não bloqueiam liberação; considerar para um ciclo de melhoria posterior.

## 12. Parecer final

A Fase 1 permanece sólida e sem achados novos. A Fase 2 está implementada, bem estruturada conceitualmente (camada de apresentação determinística, compatível com histórico antigo, sem chamada extra a LLM), mas contém um bug de regex confirmado que subverte um dos próprios objetivos da fase (reduzir retries desnecessários e respostas excessivas) e uma regressão de integração confirmada que compromete parcialmente um critério de aceite já validado da Fase 1 (aviso de ambiguidade/truncamento não sobrevive a reload).

Nenhum dos dois achados é de segurança, perda de dados ou vazamento multiempresa — ambos são corrigíveis com alterações pontuais e de baixo risco, sem necessidade de redesenho.

**Classificação: B — Aprovado com ressalvas.**

Não há problema crítico ou de alta severidade que comprometa segurança/integridade de dados (A1, apesar de classificado ALTO, é um desperdício de custo/latência, não uma falha de corretude ou segurança). Recomendo aplicar as correções 1 e 2 da seção 11 antes de considerar a Fase 2 pronta para uso real por analistas, e medir o item 3 com dados reais/staging antes de declarar homologação completa. Testes visuais autenticados em navegador real (Atendimento V1 e Radar) **não foram executados nesta auditoria** — a renderização foi validada por leitura de código e verificação de escaping, não por teste de UI real; portanto não declaro homologação visual completa.
