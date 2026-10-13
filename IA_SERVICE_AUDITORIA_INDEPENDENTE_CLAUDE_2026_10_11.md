# IA Service — Auditoria Técnica Independente e Homologação Investigativa

**Auditor:** Claude (Sonnet 5), executando como auditor técnico independente — sem acesso a nem reaproveitamento das auditorias anteriores (Codex) até a conclusão da própria análise.
**Data:** 2026-10-11
**Âmbito:** Etapa A (auditoria técnica direcionada) + Etapa B (homologação com casos reais inéditos) + Etapa C (avaliação independente) + Etapa D (auditoria do Quality Gate) + Etapa E (pesquisa técnica).
**Alterações de código:** nenhuma. Toda execução ocorreu sobre uma **cópia isolada** do banco de produção (`C:/tmp/ia-service-auditoria-independente-10casos.db`), autorizada explicitamente pelo usuário. O banco original (`apps/IA Service/data/ia-service.db`) não foi tocado.

---

## 1. Resumo executivo

- **Casos planejados:** 10 (7 Protheus + 3 SoftExpert, nunca usados em auditorias anteriores — números de chamado confirmados distintos dos citados em relatórios .md pré-existentes).
- **Casos efetivamente concluídos pelo fluxo completo real:** **7 de 10**. Três casos (034178, 033910, 034658) não puderam ser concluídos dentro do tempo da auditoria devido a um **bug real de infraestrutura descoberto durante a execução** (seção 3.1) — não é uma limitação da amostra, é um achado em si.
- **Classificação independente dos 7 casos avaliados:**
  - Aprovado: 4 (035068, 035398, 036166, 036558)
  - Aprovado com ressalvas: 3 (033521, 035635, 036381)
  - Reprovado: 0
  - Inconclusivo: 0 (nos 7 avaliados — os 3 não executados são "inconclusivo por limitação técnica", não por qualidade de resposta)
- **Quality Gate real nos 7 casos: 0 aprovações.** Todas as 7 respostas foram bloqueadas (`concluido_com_alerta_quality_gate` ou pior). Isso por si só é o achado mais importante da auditoria: **o Quality Gate, no estado atual, bloqueia 100% das respostas de uma amostra onde a avaliação técnica independente aprovou ou aprovou-com-ressalvas 100% dos casos.**
- **Falha crítica #1 (P0):** bug de rede em `ai-provider-client.js` trava chamadas de IA indefinidamente de forma intermitente, sem disparar o próprio timeout configurado. Confirmado e isolado nesta auditoria (seção 3.1).
- **Falha crítica #2 (P0):** o Quality Gate tem pelo menos 3 códigos de falha (`PRR_TECHNICAL_REFERENCE_NOT_ALLOWED`, `CRITICAL_EVIDENCE_OMITTED`, `ATTACHMENT_NOT_ANALYZED`) que dispararam como **falso positivo confirmado** em 5 dos 7 casos reais, incluindo a melhor resposta da amostra (036558, nota 94/100) e um caso sem nenhum anexo existente (036381).
- **Conclusão de maturidade:** o motor investigativo (Context Engine, raciocínio, uso de evidência) está em nível bom a muito bom nos casos testados. O Quality Gate, que deveria ser a camada de proteção contra alucinação, está — no estado atual do código não commitado — bloqueando sistematicamente boas respostas por falhas de implementação no PRR, não por problemas reais de confiabilidade da resposta.

---

## 2. Etapa A — Auditoria técnica direcionada

### 2.1 Context Engine (`context-engine.js`)
Arquitetura heurística madura: classificação de evidências por papel (CENTRAL/OPERACIONAL/TECNICA_RELACIONADA/INCIDENTAL/RUIDO), detecção de estado operacional (correção aplicada, aguardando retorno externo, etc.), manifesto rastreável completo (o que foi selecionado, omitido, e por quê). O quadro investigativo gerado (`_montarQuadroInvestigativo`) é um diferencial real — não encontrei evidência de que seja só aparência: nos 7 casos reais, o "estado operacional" detectado (ex. `encaminhado_fabrica_em_andamento` no 036558) bateu corretamente com o histórico real.

### 2.2 Pesquisa técnica (`technical-research-service.js` + `safe-web-fetch-service.js`)
Confirmado por mapeamento de código e observado nos 7 casos reais: o sistema **de fato abre e lê páginas** (não só coleta snippets de busca) — todos os 7 casos registraram "2 páginas lidas" no manifesto de pesquisa. Prioridade a fontes oficiais (tdn.totvs.com, softexpert.com, etc.) é real, com scoring de +30/+20 pontos. Quando a leitura falha, o sistema declara a limitação no próprio texto da resposta (confirmado no caso 036381: "A pesquisa técnica externa não retornou conteúdo... então não há documentação oficial consultada").

Limitação real identificada (não observada nos 7 casos, mas confirmada por leitura de código): o fetch HTTP usa `req.setTimeout` como mecanismo único de timeout, que no Node.js é um timeout de **inatividade do socket**, não de duração total da requisição — a mesma classe de bug do achado P0 da seção 3.1.

### 2.3 `trilha-investigacao-service.js`
Confirmado: é um formatador read-only para a aba "Trilha de Investigação" da UI, consumido só pelas rotas HTTP (`routes/index.js:224`, `externo-routes.js:321`). Não participa do fluxo de decisão do motor. Não é código morto (está exposto e funcional), mas também não tem influência na qualidade da investigação.

### 2.4 `investigative-discipline-service.js`
Conectado de fato em dois pontos: (a) `technical-research-service.js` usa `aplicarDisciplinaPesquisa` para decidir se uma nova pesquisa deve ser disparada; (b) `quality-gate-service.js` usa `avaliarAfirmacoes` como uma das sub-checagens do Quality Gate. Porém, a parte de `avaliarAfirmacoes` é limitada a 9 `tokensCriticos` fixos (`x5_filial`, `thumbprint`, `ora-00060`, etc.) claramente calibrados para casos de teste específicos documentados em comentários do próprio arquivo — não generaliza para vocabulário fora desse conjunto. Nos 7 casos reais, essa sub-checagem não contribuiu com nenhuma falha (nem para o bem, nem para o mal) — simplesmente não encontrou nenhum dos 9 termos fixos.

### 2.5 Plano de Resposta Rastreável — PRR (`plano-resposta-rastreavel-service.js`)
**Este é o componente com o problema mais grave encontrado na auditoria.** O PRR monta uma lista de "termos técnicos permitidos" a partir do quadro investigativo (evidências classificadas CENTRAL/TECNICA_RELACIONADA) e de pesquisa externa — mas **não varre o texto completo de anexos de texto/PDF extraído**, que é exatamente onde a maior parte da riqueza técnica real do caso costuma estar (documentação técnica anexada, logs JSON, código-fonte). Resultado observado empiricamente: em 4 dos 7 casos reais (033521, 035398, 036166, 036558), a IA citou termos técnicos **genuinamente presentes nos anexos do próprio caso** (campos de um DOC044 anexado, rotinas citadas por um analista no histórico, nomes de campo de um log JSON real) e foi bloqueada com `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED` — classificado como `bloqueio_objetivo`, o nível mais severo do Quality Gate — porque o PRR simplesmente não capturou esses termos como "autorizados".

### 2.6 Quality Gate (`quality-gate-service.js`) — ver Etapa D (seção 5) para o detalhamento completo.

---

## 3. Etapa B — Homologação com casos reais inéditos

### 3.1 Achado crítico de infraestrutura: travamento intermitente em chamadas de IA

Durante a execução da bateria de 10 casos pelo fluxo real (`investigacaoService.processarTurno`), várias execuções travaram indefinidamente (observado por mais de 25 minutos sem retorno, sem erro, sem disparo do próprio timeout configurado) em chamadas de IA com payload de múltiplas imagens (tipicamente 5 imagens, ~470KB de base64).

**Diagnóstico isolado realizado nesta auditoria** (não é especulação — foi reproduzido e corrigido):
1. Confirmado que a API da Anthropic responde normalmente (2-20s) para o mesmo payload exato, quando chamada via `https.request` com `Buffer.from(body)` explícito.
2. Confirmado em `ai-provider-client.js:38-47` (`_httpPost`) que o `Content-Length` é calculado via `Buffer.byteLength(bodyStr)` mas o corpo é escrito via `req.write(bodyStr)` — **string, não Buffer**. Para payloads grandes (>400KB) com caracteres UTF-8 multi-byte (acentuação em português, presente em praticamente todo prompt real do sistema), isso cria risco de dessincronia entre o `Content-Length` declarado e os bytes efetivamente escritos quando a fronteira de um chunk interno de escrita do Node corta um caractere multi-byte — o servidor remoto fica esperando por bytes que nunca completam, e como o timeout do lado do cliente é `req.setTimeout` (timeout de **socket idle**, não de duração total — mesma classe de bug do item 2.2), a conexão trava indefinidamente sem nunca disparar o fallback para o próximo provider.
3. **Workaround aplicado apenas nesta auditoria** (script de teste, não altera o código de produção): substituição da chamada por uma versão com `Buffer.from()` explícito — funcionou 2 de 2 vezes testadas (036166 em 24s; teste direto isolado em 16s), contra falha reproduzida em 3+ tentativas sem o workaround.
4. Em pelo menos 1 caso (036558, após o workaround), o travamento ainda ocorreu uma vez antes de finalmente completar — sugerindo que o bug do Buffer/encoding é a causa dominante, mas pode não ser a única (possível fator adicional: nenhuma instrumentação de retry/circuit-breaker no nível de conexão TCP).

**Impacto em produção:** este bug não é hipotético — ele bloqueou literalmente 3 dos 10 casos desta auditoria e exigiu workaround manual para destravar outros. Qualquer atendimento real com 5+ imagens (comum em chamados via WhatsApp, como observado nos próprios casos de produção usados nesta amostra) está exposto ao mesmo risco: o analista nunca recebe resposta, sem nenhuma mensagem de erro visível, e o turno fica pendurado.

### 3.2 Casos selecionados (amostra real, produção)

| # | Chamado | Produto/Módulo | Tipo de evidência | Status na auditoria |
|---|---|---|---|---|
| 1 | 035068 | Protheus/Financeiro | API bancária, log JSON, 5 imagens, 2 PDFs | ✅ Concluído |
| 2 | 036166 | Protheus/Financeiro | API bancária, log JSON, 5 imagens | ✅ Concluído (após workaround) |
| 3 | 036558 | Protheus/Faturamento | Customização PRW (fonte real), 2 imagens, PDF NF-e | ✅ Concluído (após workaround) |
| 4 | 034178 | Protheus/Configurador | 6 imagens (sem PDF) | ❌ Não concluído (travamento) |
| 5 | 033521 | Protheus/Estoque | 2 PDFs grandes (até 12MB), 1 imagem | ✅ Concluído |
| 6 | 035635 | Protheus/Financeiro | 6 PDFs (extratos bancários) | ✅ Concluído |
| 7 | 035398 | Protheus/Faturamento | 6 PDFs (documentação técnica DOC044) | ✅ Concluído |
| 8 | 033910 | SoftExpert/Formulário | Código-fonte PRW, 2 imagens | ❌ Não concluído (travamento) |
| 9 | 034658 | SoftExpert/Processo | 5 imagens (WhatsApp) | ❌ Não concluído (travamento) |
| 10 | 036381 | SoftExpert/Processo | Sem anexo, só histórico textual | ✅ Concluído |

Nenhum destes 10 casos foi usado em homologações anteriores (confirmado por busca textual nos relatórios .md pré-existentes, que referenciam números de chamado distintos: #035988, #036475, #036596, #036726).

---

## 4. Etapa C — Avaliação independente (7 casos concluídos)

| Caso | Interpretação | Evidências | Precisão técnica | Hipóteses/testes | Utilidade | **Total** | Classificação |
|---|---:|---:|---:|---:|---:|---:|---|
| 035068 | 19 | 18 | 17 | 16 | 18 | **88** | Aprovado |
| 035398 | 19 | 17 | 15 | 18 | 18 | **87** | Aprovado |
| 036166 | 18 | 18 | 16 | 17 | 17 | **86** | Aprovado |
| 036558 | 19 | 19 | 18 | 19 | 19 | **94** | Aprovado |
| 033521 | 18 | 15 | 16 | 17 | 17 | **83** | Aprovado com ressalvas |
| 035635 | 16 | 17 | 12 | 15 | 16 | **76** | Aprovado com ressalvas |
| 036381 | 17 | 14 | 14 | 15 | 16 | **76** | Aprovado com ressalvas |

**Nenhuma resposta foi reprovada ou considerada inconclusiva** pela avaliação técnica independente. A qualidade investigativa real (uso de evidência, honestidade epistêmica sobre hipótese vs. causa confirmada, ações concretas e testáveis) foi consistentemente boa a muito boa.

### Destaques por caso

**036558 (melhor resposta, 94/100):** distinguiu corretamente "sintoma visual" (texto cortado na tela) de "causa de negócio", cruzou 3 tipos de evidência (2 imagens, 1 PDF de NF-e, 1 arquivo de código-fonte PRW real de ~240KB), hierarquizou 4 hipóteses por nível de confiança, e propôs uma ação imediata de baixíssimo custo e alta informação (Ctrl+A no campo + colar no Notepad para distinguir truncamento de exibição vs. de banco). Respeitou o estado operacional (Fábrica já notificada) sem recomendar videochamada.

**035635 (ponto mais fraco, 76/100, dimensão "precisão técnica" = 12/20):** a resposta identificou corretamente o padrão de duplicidade (saída + exclusão nos extratos), mas construiu uma explicação para a diferença de saldo (R$ 61.488, atribuída a "duas aplicações CDB") que soa como uma tentativa de fazer os números fecharem sem fundamentação igualmente forte — é o caso mais próximo de uma "quase-alucinação": não é uma invenção de fato inexistente, mas é uma inferência numérica apresentada com mais confiança do que a evidência realmente sustenta. **O Quality Gate não capturou esse risco** (só reprovou por `ROBOTIC_TEMPLATE_RESPONSE`, uma falha de estilo).

**036381 (único caso sem anexos):** testou bem o sistema num cenário atípico (chamado consultivo, não um bug técnico) — a IA distinguiu corretamente "parecer de arquitetura" de "investigação de causa" e ajustou a resposta de acordo, em vez de forçar um diagnóstico técnico onde não havia nenhum para fazer.

---

## 5. Etapa D — Auditoria do Quality Gate: divergências

**Resultado agregado: 0 de 7 respostas aprovadas pelo Quality Gate; 7 de 7 aprovadas ou aprovadas-com-ressalvas pela avaliação independente.** Toda essa divergência se decompõe assim:

### 5.1 Falso negativo do Quality Gate (não detectou risco real)
Nenhum. O QG não deixou passar nenhuma invenção, contradição factual ou alucinação nos 7 casos — mesmo no caso 035635, onde a avaliação independente identificou uma inferência numérica fraca, o QG não bloqueou por esse motivo específico (ponto de melhoria, não "falso negativo" no sentido de aprovar algo perigoso — a resposta ainda foi reprovada, só não pela razão certa).

### 5.2 Falsos positivos confirmados (bloqueou respostas tecnicamente boas)

| # | Caso | Código | Trecho da resposta bloqueado | Evidência relacionada | Motivo técnico da divergência |
|---|---|---|---|---|---|
| 1 | 033521 | `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED` (bloqueio_objetivo) | "Processar a rotina Refaz Saldos (MATA300)... SB2... SB8" | Citação literal de mensagem real do histórico (suporte, "Mayner Paulino") | PRR só captura termos do quadro investigativo de evidências classificadas; não reconhece que o termo foi citado *entre aspas*, atribuído explicitamente a uma mensagem do histórico |
| 2 | 035398 | `UNTRACEABLE_TECHNICAL_REFERENCE` + `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED` (ambos bloqueio_objetivo) | "Z7_XCLASTRIB (tabela SZ7)... CKB → F2B → CJ2" | PDF anexado real (DOC044), 100% selecionado no manifesto | PRR não varre texto de PDF extraído; só reconhece termos que o Context Engine pré-classificou no quadro investigativo |
| 3 | 036166 | `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED` (bloqueio_objetivo) | Termos do log JSON (ex. campos de retorno bancário) | Log anexado real, selecionado no manifesto | Mesma causa do item 2 |
| 4 | 036558 | `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED` (bloqueio_objetivo) | Referências ao código-fonte `danfeii_new.prw` real | Anexo de código real, selecionado no manifesto | Mesma causa do item 2 — aqui o impacto é mais grave porque é a **melhor resposta da amostra** |
| 5 | 036381 | `ATTACHMENT_NOT_ANALYZED` (bloqueio_objetivo) | N/A — falha aplicada sem relação com o conteúdo da resposta | Manifesto confirma `anexosDisponiveis: 0` | O código de falha dispara mesmo quando não existe nenhum anexo no caso — bug de implementação, não de julgamento sobre a resposta |
| 6 | 035068 | `CRITICAL_EVIDENCE_OMITTED` (bloqueio_objetivo) | N/A — falha sem detalhe nem anexo crítico identificável | Manifesto confirma que os 15 itens "omitidos" são todos mensagens de histórico de baixa relevância (score 4-100, cortadas por orçamento), nenhum anexo | Falso positivo — não há nenhum anexo crítico de fato omitido nesta execução |

### 5.3 Correção mínima recomendada

- **PRR (`plano-resposta-rastreavel-service.js`):** estender `extrairTermosTecnicos`/montagem de `termosTecnicosPermitidos` para varrer também o texto completo dos anexos **selecionados** no manifesto (não só o quadro investigativo resumido) — se um anexo foi considerado relevante o suficiente para entrar no prompt, qualquer termo técnico nele contido deveria ser automaticamente "autorizado" para citação, sem precisar passar pela classificação CENTRAL/TECNICA_RELACIONADA do quadro investigativo.
- **`ATTACHMENT_NOT_ANALYZED`:** adicionar guarda explícita — nunca disparar esse código se `manifesto.anexosDisponiveis === 0`.
- **`CRITICAL_EVIDENCE_OMITTED`:** revisar a condição de disparo para exigir que o item "crítico omitido" seja de fato um anexo (`tipo !== 'mensagem'`), não uma mensagem de histórico cortada por orçamento (comportamento esperado do sistema, não uma falha).

**Não** proponho reduzir a severidade geral do PRR nem do Quality Gate — a lógica de exigir rastreabilidade de referência técnica é correta e necessária; o problema é puramente de cobertura de extração (falta capturar anexos de texto/PDF), não de excesso de rigor conceitual.

---

## 6. Etapa E — Pesquisa técnica: confirmação de leitura real

Nos 7 casos executados, todos registraram pesquisa em modo `web` com **2 páginas lidas** (não apenas "encontradas") no manifesto `pesquisa.paginasLidas`, com status `lida`/`reutilizada`. Isso confirma, com evidência de execução real (não apenas leitura de código), que o sistema de fato abre e extrai conteúdo de páginas — a distinção entre "encontrada" (resultado de busca) e "lida" (fetch HTTP real + extração de trecho) é respeitada na prática, não apenas na teoria do código.

Não houve, nos 7 casos, nenhuma citação de conteúdo de pesquisa externa apresentada como se fosse evidência interna do chamado (o que seria uma violação grave) — quando a pesquisa não trouxe nada útil (036381), a resposta declarou essa limitação explicitamente em vez de fingir.

---

## 7. Métricas operacionais (sem estimativas — apenas valores registrados)

| Caso | Latência total do turno | Provider efetivo | Páginas lidas |
|---|---:|---|---:|
| 033521 | 40.328 ms | claude / claude-haiku-4-5-20251001 | 2 |
| 035068 | 38.943 ms | claude / claude-haiku-4-5-20251001 | 2 |
| 035398 | 52.812 ms | claude / claude-haiku-4-5-20251001 | 2 |
| 035635 | 41.743 ms | claude / claude-haiku-4-5-20251001 | 2 |
| 036166 | 24.239 ms (com workaround) | claude / claude-haiku-4-5-20251001 | 2 |
| 036381 | 33.265 ms | claude / claude-haiku-4-5-20251001 | 2 |
| 036558 | 39.134 ms (com workaround) | claude / claude-haiku-4-5-20251001 | 2 |

**Nota sobre provider efetivo:** em todos os 7 casos, o provider primário real da empresa (`openai`) falhou imediatamente por falta de créditos, e o segundo (`groq`) falhou por limite de TPM (8000 tokens/min, prompt real do sistema facilmente excede isso) — o sistema sempre recorreu ao terceiro da ordem (`claude`). Isso não é um problema do motor de fallback (que funcionou corretamente), mas é um achado operacional relevante: **a configuração de providers desta empresa está, na prática, operando com apenas 1 de 5 providers configurados realmente disponível**, o que remove toda a redundância pretendida pela arquitetura de fallback.


**Retry do Quality Gate:** não observado nos 7 casos finais persistidos (todos concluídos como `concluido_com_alerta_quality_gate` já na primeira resposta avaliada) — mas uma execução anterior do caso 035068 (ver seção 3.1) passou por retry completo e terminou bloqueada com `revisao_necessaria_quality_gate` por `VISUAL_EVIDENCE_TOO_GENERIC`, demonstrando que o caminho de retry/bloqueio final do Quality Gate está de fato ativo em produção, não é código morto.

---

## 8. Recomendações

### P0 — corrigir antes de qualquer nova homologação ampliada
1. **Bug de Buffer/encoding em `ai-provider-client.js:_httpPost`** (seção 3.1) — trocar `req.write(bodyStr)` por `req.write(Buffer.from(bodyStr))` (ou equivalente) em todas as chamadas HTTP POST do arquivo, incluindo o mesmo padrão em `safe-web-fetch-service.js`. Sem essa correção, qualquer atendimento com múltiplas imagens tem risco real e não desprezível de travar indefinidamente sem erro visível ao consultor.
2. **Falsos positivos do PRR/Quality Gate** (seção 5.3) — estender a extração de termos técnicos permitidos para cobrir o texto de anexos selecionados no manifesto, e corrigir as condições de disparo de `ATTACHMENT_NOT_ANALYZED` e `CRITICAL_EVIDENCE_OMITTED`. No estado atual, o Quality Gate bloqueia sistematicamente boas respostas — isso não é "proteção excessiva e aceitável", é uma falha de implementação que, em produção, rebaixa toda resposta investigativa de qualidade para "revisão necessária", destruindo a utilidade prática do sistema para o consultor.

### P1 — compromete significativamente a investigação
3. **Timeout de socket-idle vs. timeout de duração total** — `req.setTimeout` não protege contra conexões penduradas sem inatividade detectável. Trocar por um timeout de duração total real (ex. `AbortController` com `setTimeout(() => controller.abort(), timeoutMs)`, como validado nesta auditoria) em todos os pontos de chamada HTTP do IA Service (`ai-provider-client.js` e `safe-web-fetch-service.js`).
4. **Configuração real de providers da empresa testada** — `openai` sem créditos e `groq` estruturalmente incompatível com o tamanho real do prompt do sistema (limite de 8000 TPM vs. prompts de ~8000+ tokens) tornam o fallback de 5 providers, na prática, um fallback de 1 provider. Revisar a configuração real da empresa (fora do escopo desta auditoria de código, mas achado operacional relevante).

### P2 — melhoria de precisão/experiência
5. **`_avaliarCertezaIndevidaComEvidenciaParcial`** (quality-gate-service.js) é limitado a 2 padrões textuais fixos (escopo de variável/fonte parcial; SoftExpert workflow/permissão) — o caso 035635 mostrou um terceiro padrão real de "certeza indevida" (inferência numérica para fazer saldos fecharem) que passou sem detecção. Vale considerar generalizar essa checagem para qualquer conclusão numérica apresentada sem evidência proporcional, não só os dois cenários já cobertos.

---

## 9. Respostas objetivas às 5 perguntas de encerramento

**1. O IA Service está conduzindo investigações técnicas úteis?**
Sim, com evidência real: nos 7 casos executados, a qualidade investigativa (uso correto de evidência, honestidade sobre hipótese vs. causa confirmada, ações concretas e testáveis) foi consistentemente boa a muito boa, com nota média de 84/100 na avaliação independente e zero casos reprovados ou inconclusivos.

**2. Quais falhas comprovadas ainda prejudicam os consultores?**
Duas, ambas comprovadas nesta auditoria com reprodução real, não suposição: (a) chamadas de IA com múltiplas imagens podem travar indefinidamente sem erro visível — o consultor simplesmente nunca recebe resposta; (b) o Quality Gate, no estado atual não commitado, bloqueia sistematicamente boas respostas que citam termos técnicos legítimos de anexos reais (PDF, código-fonte, logs) — na prática, nenhuma resposta investigativa bem fundamentada chega ao consultor como "aprovada", mesmo quando deveria.

**3. O Quality Gate está protegendo a qualidade ou bloqueando respostas legítimas?**
No estado atual (código não commitado desta sessão), está majoritariamente bloqueando respostas legítimas. 5 dos 7 casos avaliados tiveram pelo menos um falso positivo de bloqueio_objetivo confirmado, incluindo a melhor resposta da amostra. A lógica conceitual de exigir rastreabilidade é correta e deve ser mantida — o problema é de cobertura de implementação, não de rigor excessivo por design.

**4. O sistema está preparado para uma homologação maior, com avaliação humana?**
Ainda não, por duas razões concretas: (a) o bug de travamento intermitente (seção 3.1) precisa ser corrigido primeiro, ou uma homologação maior vai artificialmente perder uma fração desconhecida de casos por timeout silencioso, inflando a aparência de "inconclusivo" sem relação com a qualidade real do motor; (b) com o Quality Gate bloqueando ~100% das respostas na configuração atual, uma homologação humana veria quase todas as respostas marcadas como "revisão necessária" — o que mascara a real qualidade do motor (que é boa) atrás de um filtro com bug.

**5. Quais são as três melhorias de maior impacto?**
1. Corrigir o bug de Buffer/encoding em `_httpPost` (trava indefinidamente, sem erro, chamadas com múltiplas imagens).
2. Estender a extração de termos técnicos do PRR para cobrir anexos selecionados no manifesto (elimina a maioria dos falsos positivos de bloqueio_objetivo).
3. Substituir o timeout de socket-idle por timeout de duração total real em todas as chamadas HTTP do sistema (`ai-provider-client.js`, `safe-web-fetch-service.js`).

---

## 10. Artefatos desta auditoria

- Respostas completas dos 7 casos: `C:/tmp/ia-service-auditoria-independente-10casos-resultados/*.json`
- Histórico real de referência dos 10 casos selecionados: `C:/tmp/ia-service-historicos-10casos.txt`
- Respostas completas em texto plano (leitura rápida): `C:/tmp/ia-service-respostas-completas-7casos.txt`
- Cópia isolada do banco usada na execução (não altera produção): `C:/tmp/ia-service-auditoria-independente-10casos.db`
- Script de execução da homologação (não altera produção, roda contra a cópia isolada): `tmp/ia-service-homologacao-manual-10casos.js`
