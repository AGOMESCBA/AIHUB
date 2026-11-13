# IA Service — Fase 1: andamento

Data: 2026-11-12 · Modelo de produção confirmado pelo usuário: **openai/gpt-5.4** · Status: **infraestrutura pronta; linha de base oficial bloqueada** (ver "Bloqueios").

## Entregue

| Item do pedido | O que foi feito | Arquivos |
|---|---|---|
| 1. Proteção de dados + custo | Liberados **só** `prompt_tokens`, `completion_tokens` e `total_tokens`, por lista explícita e apenas com valor numérico. Todo outro campo com "token" continua mascarado, inclusive `prompt_tokens_details`, variações de caixa e valores em texto. Custo calculado por tabela de preços em configuração (sem preço → `null` com motivo, nunca valor inventado). | `apps/IA Service/backend/services/redaction-service.js`, `apps/IA Service/backend/services/custo-ia-service.js`, `apps/IA Service/backend/services/precos-modelos-ia.json`, `apps/IA Service/tests/auditoria-uso-tokens.test.js` |
| (diagnóstico 3.7) | O motivo gravado para pesquisa forçada deixou de dizer "mudança reconhecida: nenhuma_mudanca". | `apps/IA Service/backend/services/technical-research-service.js` |
| 2. Replay + casos sintéticos novos | Replay multi-turno sobre o `processarTurno` real, com busca e leitura de páginas congeladas, modelo configurável, variantes com/sem 4B, N execuções com média e desvio, IA avaliadora com rubrica versionada, detector de vazamento entre empresas. 21 casos novos (15 desenvolvimento / 6 validação), sem termos do benchmark antigo. Modo simulado para validar o próprio replay. | `apps/IA Service/tests/replay/` (`replay-runner.js`, `executar-replay.js`, `avaliador.js`, `agregador.js`, `relatorio.js`, `ia-simulada.js`, `casos/*.json`), `apps/IA Service/tests/replay-harness.test.js` |
| 2. Anonimização | Pipeline somente leitura sobre o banco local, saída **obrigatoriamente fora do repositório**, sem gravar a correspondência original → substituto. Verificação automática de resíduos e lista de palavras para revisão humana. | `apps/IA Service/tests/replay/anonimizar-conversas.js`, `apps/IA Service/tests/anonimizacao-replay.test.js` |
| 5. Recurso aberto | **Defeito de produção**: `fetchTextoSeguro` não liberava o socket quando a página respondia ≥ 400 ou com Content-Type recusado. Corrigido com `res.destroy()` e teste de regressão (falha sem a correção, passa com ela). O teste `etapa-v1-pesquisa-web-motor` também deixou de acessar a internet. | `apps/IA Service/backend/services/safe-web-fetch-service.js`, `apps/IA Service/tests/safe-fetch-libera-conexao.test.js`, `apps/IA Service/tests/etapa-v1-pesquisa-web-motor.test.js` |
| 5. Teste instável | Não reproduzido em 17 execuções (isolado, 6 em paralelo, ordem da suíte). Hipótese mais provável: era o **primeiro teste da suíte a abrir o Chromium**, e a abertura a frio contava dentro dos 30 s. O navegador passou a abrir fora do prazo do teste, e cada passo tem 10 s para que uma trava real aponte o passo. | `apps/IA Service/tests/analise-log-filtro-acumulacao-ui.test.js` |
| 6. N+1 (proposta) | Medido: no SQLite embutido, o N+1 custa ~20–25 ms com cache aquecido, o mesmo que a consulta única. Recomendação: fazer junto com a decisão da janela de 1.200 (Fase 5). | `docs/ia-service/fase1-proposta-n1-chamados.md` |

## Bloqueios da linha de base oficial

1. ~~**Chave sem crédito**~~ **Resolvido**: a chave do `.env` está sem crédito, mas a cadastrada na Platform (empresa 1, IAHub Platform > OpenAI / GPT) funciona. Opção `--chave-platform <empresaId>`: a chave é decifrada em memória antes de o stub da Platform ser instalado, sem ser impressa nem gravada. Piloto d03 (1 execução, com 4B): 8 chamadas do motor, 9.999 tokens de entrada e 847 de saída, 25 s, avaliação 4,5/5.
   - **Rodada oficial de 2026-11-12 interrompida**: o crédito da chave da Platform acabou depois de 12 das 126 execuções (d01 e d02 completos), no início do d03. O runner só gravava no fim, então essas 12 se perderam. Correções: cada execução passa a ser gravada na hora, `--retomar` continua de onde parou, a falha de crédito também é detectada na avaliação e os bancos temporários são apagados ao fim de cada execução.
2. **Preços do gpt-5.4**: ausentes em `precos-modelos-ia.json`. Sem eles, o custo sai como "sem preço" (os tokens são medidos normalmente).
3. **Revisão da amostra anonimizada** antes de qualquer conversa real ir ao provedor.

## Etapa 1 reduzida (2026-11-12, gpt-5.4, 1 execução por variante)

A pedido do usuário, para economizar créditos, só os 5 casos em que a 4B pode mudar o resultado (o veto só vale em texto livre, sem botão, com lacuna "evidência do ambiente" ou "contradição"). Total: 10 execuções, 263.733 tokens de entrada e 32.916 de saída, já contando a avaliação. Relatório fora do repositório (scratchpad da sessão, pasta `etapa1`).

| Caso | Turnos que pesquisaram (com / sem 4B) | Consultas (com / sem) | Consultas repetidas (com / sem) | Nota média (com / sem) | Tokens de entrada (com / sem) |
|---|---|---|---|---|---|
| d01 dados já informados | 1 / 1 | 5 / 5 | 0 / 0 | 4,0 / 4,5 | 22.080 / 22.746 |
| d02 mesma pesquisa sem novidade | 0 / 0 | 0 / 0 | 0 / 0 | 4,3 / 4,7 | 16.409 / 16.539 |
| d06 continuidade sem fonte | 1 / 3 | 5 / 14 | 0 / 1 | 5,0 / 4,75 | 41.004 / 60.161 |
| d07 log com variável inexistente | 2 / 2 | 10 / 10 | 0 / 0 | 4,0 / 4,5 | 33.590 / 33.649 |
| d13 log grande | 0 / 0 | 0 / 0 | 0 / 0 | 5,0 / 4,0 | 8.747 / 8.808 |

Leitura: a 4B só mudou o comportamento no d06. Sem ela, o motor pesquisou de novo nos turnos 2 e 3 (9 consultas a mais, 1 repetida, +47% de tokens) e cobriu menos pontos essenciais no turno 3. Nos outros 4 casos, pesquisa e consumo foram iguais. As diferenças de nota fora do d06 são de 1 execução e podem ser ruído da avaliadora. Com 1 execução não há dispersão: isto é indício, não conclusão.

## Etapa 2 (2026-11-12): d06 completo (3 execuções) e d11 (1 execução)

Decisão do usuário: escopo reduzido, sem alteração no motor. Única mudança de código: o agregador do replay passou a resumir só os casos da rodada (necessário para `--retomar` numa pasta com outros casos). 6 execuções novas, 306.715 tokens de entrada e 31.615 de saída. Ao todo, 16 execuções nas duas etapas.

### Resultado do d06 nas 3 execuções

| Execução | Turnos que pesquisaram (com / sem 4B) | Tokens de entrada (com / sem) | Nota T3 (com / sem) | A 4B vetou? |
|---|---|---|---|---|
| 1 | 1 / 3 | 41.004 / 60.161 | 5 / 4 | sim, T2 e T3 |
| 2 | 3 / 3 | 62.772 / 63.684 | 5 / 5 | não |
| 3 | 3 / 2 | 64.634 / 57.581 | 5 / 5 | não (sem 4B, a própria IA decidiu não pesquisar no T3) |
| **Média** | **2,3 / 2,7** | **56.137 / 60.475** | **5,0 / 4,7** | 1 de 3 |

d11 (1 execução): decisões idênticas nas duas variantes (T1 conversa sem pesquisa, T2 sem pesquisa, T3 pesquisa com as 3 fontes aplicáveis). A 4B não vetou nada. A nota do T2 foi 2 com a 4B e 4 sem ela, com a mesma decisão: é variação da resposta, não efeito da 4B.

### Vetos da 4B nas 16 execuções

Só 3 turnos: d02 #1 T3 (redundante: sem a 4B, a semântica também não pesquisou) e d06 #1 T2 e T3. O veto depende de a lacuna sair "evidência do ambiente". No mesmo turno do mesmo caso, essa classificação saiu "evidência do ambiente" numa execução e "teste" nas outras duas, e com "teste" a 4B não age.

### Respostas às perguntas do usuário

1. **Evita pesquisa desnecessária ou só restringe?** Não houve ganho demonstrado. Ela agiu em 3 de 47 turnos com a 4B ligada: um veto foi redundante e os outros dois não se repetiram nas execuções seguintes do mesmo caso. Na prática, quem decide é a classificação da lacuna, e ela varia entre execuções.
2. **A pesquisa evitada traria evidência relevante?** Nas execuções em que o d06 pesquisou no T2/T3, a página lida foi a única aplicável (F1, "array out of bounds"). Ela é relevante, mas não acrescentou nada: a IA já tinha o diagnóstico pelo log e pelo trecho do fonte, e as notas foram iguais com e sem a leitura.
3. **Uso de histórico, dossiê e pesquisas anteriores:** nenhum pedido repetido de dado já informado em d06 e d11 (0 em todas as execuções). O T3 do d06 nunca pediu de novo o fonte, e o d11 não reviveu o MV_SPEDURL. Dois problemas que **não dependem da 4B**:
   - 9 de 114 consultas de busca contêm texto interno do motor (ex.: "totvs protheus busca externa deste turno trouxe material", "evidencias originais recuperadas proveniencia dossie execucao"). São exatamente as "consultas repetidas" contadas no d06, com e sem a 4B.
   - No T3, o d11 pesquisou de novo as etapas já superadas ("connection refused", "certificado vencido") junto com a nova (rejeição 280), e o d06 releu a mesma página F1 nos turnos 2 e 3.
4. **Menos pesquisa preservou a qualidade?** Preservou: com veto, as notas foram 5/5 nos turnos afetados. Não melhorou de forma mensurável.
5. **As diferenças são consistentes?** Não. A diferença do d06 na execução 1 não se repetiu nas execuções 2 e 3. Nas médias, a distância caiu para 0,4 turno com pesquisa e cerca de 4 mil tokens (7%).

### Recomendação: remover o veto da 4B

Pelo critério combinado (remover se, sem ela, não houver aumento relevante de pesquisa repetida nem queda de precisão) e pelo princípio de que a IA conduz a investigação, a 4B não demonstrou melhorar o contexto nem as decisões da IA. Ela troca o julgamento da IA por uma regra que depende de uma classificação instável. A informação útil que ela produz (o tipo de lacuna) já é calculada e registrada com a 4B ligada ou desligada; o que a flag controla é só o veto.

Ressalva, conforme o usuário: são 2 cenários (mais 3 da etapa 1). Isso serve para orientar o próximo experimento, não para aprovar a mudança definitiva. O próximo passo seria repetir a comparação nos 6 casos de validação, que não foram usados para ajustar nada.

### Achados paralelos (não implementados)

- Texto interno do motor vazando para as consultas de busca (item 3).
- d11 T2: o motivo gravado diz "há evidência/lacuna técnica útil para pesquisa externa", mas a decisão foi não pesquisar, nas duas variantes. A fonte aplicável (certificado vencido) existia. A causa não foi investigada.
- Consumo: das chamadas do motor nas 16 execuções, a atualização do dossiê respondeu por 243.729 tokens de entrada, contra 124.168 da resposta principal. É o ponto de partida da investigação de consumo que o usuário deixou para depois.

## Etapa 3 (2026-11-12): validação da 4B nos 6 casos de validação

Mesmas condições das etapas anteriores (gpt-5.4, busca congelada, mesma avaliadora e rubrica `replay-rubrica-1`), 1 execução por variante. 12 execuções, 212.377 tokens de entrada e 32.922 de saída. Nenhum caso de validação foi usado para ajustar o motor ou os casos.

### Resultado por turno onde as variantes divergiram

A 4B vetou 8 turnos (contra 3 em 47 nos casos de desenvolvimento). Em 7 deles, sem a 4B a IA decidiu pesquisar:

| Caso / turno | Com 4B | Sem 4B | Página lida sem 4B | Nota (com / sem) | Pontos essenciais (com / sem) |
|---|---|---|---|---|---|
| v01 T2 (bloqueia de novo sem o usuário tentar) | veto | pesquisou | bloqueio-tentativas (aplicável) | 5 / 5 | 1/1 / 1/1 |
| v02 T1 (só pedidos do comprador não vão para aprovação) | veto | pesquisou | alcada-pedido-compra (aplicável) | 5 / 5 | 1/1 / 1/1 |
| v02 T2 (confirmou: sem grupo de aprovação) | veto | pesquisou | alcada-pedido-compra (aplicável) | 2 / 4 | 1/2 / 1/2 |
| v03 T2 (aumentou o limite e continua igual) | veto | pesquisou | limite-arquivo (potencial) | 3 / 5 | 0/1 / 1/1 |
| v03 T3 (log do IIS) | veto | pesquisou | limite-arquivo (potencial) | 3 / 4 | 0/1 / 1/1 |
| v04 T2 (produto não bloqueado, só na tabela 003) | veto | pesquisou | tabela-preco-itens (aplicável) | 4 / 5 | 1/1 / 1/1 |
| v06 T1 (só nessa estação) | veto | pesquisou | smartclient-compatibilidade (aplicável) | 5 / 5 | 1/1 / 1/1 |
| **Soma dos 7 turnos** | | | **7 de 7 páginas aplicáveis ou potenciais** | **3,86 / 4,71** | **5/8 / 7/8** |

O oitavo veto (v01 T2 com 4B) está incluído acima. O v05 (pedido de chamados de todas as empresas) divergiu por outro motivo, descrito em "Interação com o Problema B".

### Comparação geral (validação, 11 turnos por variante)

| Métrica | Com 4B | Sem 4B |
|---|---|---|
| Turnos que pesquisaram | 1 | 7 |
| Consultas executadas / repetidas | 5 / 0 | 34 / 1 |
| Páginas lidas (todas aplicáveis ou potenciais) | 0 | 7 |
| Nota média | 3,82 | 4,18 |
| Ação inadequada (avaliadora) | 3 | 2 |
| Afirmações sem sustentação | 6 | 3 |
| Pedidos repetidos de dado disponível | 3 | 5 |
| Orientações repetidas / hipótese descartada revivida / hipótese como fato / solução confirmada indevidamente | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Vazamento entre empresas (v05) | não | não |
| Tokens de entrada (com avaliação) | 98.013 | 114.364 (+17%) |
| Latência média por turno | 12,3 s | 13,1 s (+6%) |

Observações:
- **Evidência recuperada:** sem a 4B, todas as pesquisas leram fonte aplicável ou potencial; nenhuma leu fonte não aplicável. A consulta repetida (v02 T2) é do Problema A.
- **Continuidade:** sem a 4B houve 2 pedidos repetidos a mais. No v03 T3 a resposta pediu de novo dados de configuração do IIS que o log já trazia. Não piorou nota nem pontos, mas é o ponto fraco da variante.
- **v06 (injeção em artigo):** o artigo com a instrução injetada (classificado como relacionado) não foi lido em nenhuma variante, então a proteção contra injeção não foi exercitada neste caso.

### Interação com o Problema B (v05)

Sem a 4B, o v05 T1 repetiu o Problema B: plano dizia pesquisar, zona `sem_evidencia_clara`, decisão final "não pesquisar" com o motivo "há evidência/lacuna técnica útil…". Com a 4B, o veto no planejamento deixou `plano.devePesquisar = false`, o que **habilitou** o resgate de turno humano (`technical-research-service.js:776`), e a IA de interpretação reconheceu o pedido do analista e pesquisou. Ou seja: nesse caso a 4B "ajudou" por acidente, compensando o defeito B. Corrigido o B, esse efeito desaparece.

### Recomendação: remover o veto da 4B

Evidência:
1. **Desenvolvimento (16 execuções):** sem benefício consistente; o veto agiu em 3 de 47 turnos e não se repetiu.
2. **Validação (12 execuções):** o veto bloqueou 7 pesquisas que, sem ele, a IA fez e que leram só fontes aplicáveis ou potenciais. Nesses turnos, nota 3,86 → 4,71 e pontos essenciais 5/8 → 7/8. O custo foi +17% de tokens e +6% de latência.
3. **Princípio:** o veto substitui a decisão da IA por uma classificação de lacuna instável (etapa 2) e, quando age, tende a tirar evidência relevante (etapa 3). A classificação da lacuna pode continuar como informação de contexto para a IA.

Limitações da amostra:
- 1 execução por variante em cada caso de validação; a etapa 2 mostrou que 1 execução pode enganar.
- A avaliadora é o mesmo modelo do motor, e a rubrica não foi calibrada por humano.
- As fontes congeladas dos casos sempre contêm a resposta; na vida real a busca traz mais ruído, o que reduz o ganho da pesquisa e aumenta o risco de leitura não aplicável.
- 6 casos, de domínios variados, mas sintéticos.

Para remoção definitiva, sugiro repetir as execuções 2 e 3 só nos 4 casos em que a nota mudou (v02, v03, v04 e, opcionalmente, v01): 12 a 16 execuções, ~200-260 mil tokens de entrada. Uma alternativa sem custo é observar em produção, depois da remoção atrás de flag, a taxa de pesquisas por turno e as avaliações humanas.

## Diagnósticos independentes da 4B (2026-11-12)

Feitos por inspeção de código e dos registros já gravados. A composição do prompt do dossiê foi medida com o motor real e a IA simulada (sem custo), reaproveitando como resposta principal o texto real do gpt-5.4 gravado na etapa 1. Nenhuma alteração no motor.

### Problema A: contaminação das consultas de busca

**Comprovado.**

- **Componente:** `montarConsultas` em `technical-research-service.js:989-1013`. É a consulta determinística `TOTVS Protheus ${base}`, em que `base` são os 8 termos mais frequentes do texto (`_termosRelevantes`, linha 203: contagem de palavras com 4+ letras, menos as stopwords). A IA não gera essas consultas: as consultas da IA (`_gerarConsultasComIA`, linha 1212) já recebem só mensagens que não são do assistente (`_textoParaConsultasIA`, linha 1173).
- **Onde entra o texto interno:** no planejamento, `planejarPesquisa` monta o texto da consulta com `_textoConversa({ ...ctx, dossieTexto })` (linhas 853-854 e 899-901). Esse texto inclui:
  1. **As respostas anteriores da IA** (`ctx.mensagens` sem filtro de papel). Nas consultas contaminadas, a resposta anterior continha "A busca externa deste turno não trouxe material aproveitável" e "A busca externa foi executada e não trouxe nada aproveitável". Saíram, respectivamente, "totvs protheus busca externa deste turno trouxe material" e "… busca externa executada trouxe nada aproveitavel" ("não" fica de fora por ter menos de 4 letras).
  2. **O texto renderizado do dossiê**, com cabeçalhos internos (`dossie-context-service.js:126` e `:145`: "## Estado atual da investigacao (Dossie Tecnico …)", "## Evidencias originais recuperadas por proveniencia do dossie"). Daí "… evidencias originais recuperadas proveniencia dossie execucao".
- **Natureza:** não é prompt nem resposta da IA mal transformada. É o planejamento determinístico tratando metadado do motor como termo técnico, por frequência de palavras.
- **Consultas repetidas:** sim. Todas as "consultas repetidas" medidas no d06, com e sem a 4B, são essa consulta contaminada: o mesmo texto interno se repete a cada turno e gera a mesma consulta.
- **Correção mínima proposta (sem lista de frases):** dar à consulta determinística a mesma regra de origem que já vale para as consultas da IA, ou seja, só o que veio do chamado e do analista, sem as respostas do assistente e sem o texto renderizado do dossiê. Os campos técnicos estruturados do dossiê (problema atual, diagnóstico, fatos) podem entrar como dado, sem cabeçalhos. Alternativa mais alinhada ao princípio "a IA conduz": quando as consultas da IA existirem, a consulta por frequência de palavras sai da lista e fica só como reserva para falha da IA.
- **Riscos:** a consulta determinística é reserva quando a IA de consultas falha (timeout de 8 s); tirar texto dela pode deixá-la mais pobre nesses casos. Precisa de teste com os casos d06/d11 em modo simulado (sem custo) e das suítes `etapa-v1-pesquisa-web-motor` e `technical-research`.

### Problema B: contradição entre motivo e decisão (d11, T2)

**Comprovado: alteração posterior da decisão pelo código (item 2), com o motivo antigo copiado para a auditoria (item 4). Não houve contradição da IA (item 1): a IA de interpretação nem foi chamada.**

Fluxo do d11 T2, igual nas duas variantes ("O TSS estava parado. Reiniciamos e agora o erro mudou para 'Certificado digital vencido'."):

1. `planejarPesquisa` (linha 884): `devePesquisar = true`, motivo "ha evidencia/lacuna tecnica util para pesquisa externa" (linha 888). Não há histórico de pesquisa (o T1 foi resposta de conversa), então `!temHistorico` basta.
2. `_classificarPreAnaliseSemantica` (linha 519) classifica a mensagem como `sem_evidencia_clara`. Conferido com a mensagem real:
   - `_extrairSinaisTecnicos` não reconhece nenhum sinal: "Certificado digital vencido" não é erro reconhecido.
   - A regex de "substantiva" (linha 541) não casa, porque o `\b` final exige palavra inteira: "mudou" não casa com `mud\b` e "parado" não casa com `par\b`.
   - Sem histórico, a zona não vira "cinzenta".
3. O resgate de turno humano (linha 776) só age quando `!plano.devePesquisar`. Como o plano dizia `true`, o resgate não age.
4. O atalho da linha 786 vê `sem_evidencia_clara` sem sinal forte e devolve `devePesquisar: false`. Para zona não administrativa, o motivo é **`plano.motivo`**, o motivo do plano que dizia pesquisar (linhas 790-792). A interpretação semântica não é executada: as chamadas do T2 foram só classificação, resposta e dossiê.
5. Decisão executada: não pesquisar. A auditoria grava o motivo do plano anterior. Não houve bloqueio operacional legítimo (dedup, orçamento, pendência externa).

**Correção mínima proposta:** o atalho de zona só deveria valer para turno realmente conversacional. Quando o plano determinístico decidiu pesquisar, ou é turno humano com conteúdo, quem decide é a interpretação semântica (a IA), não o atalho. E todo ponto que muda `devePesquisar` deve gravar o motivo da própria decisão. A regex de "substantiva" é o mesmo padrão frágil de palavra-chave; não proponho ajustá-la, e sim deixar de depender dela para negar pesquisa.
**Riscos:** mais turnos passam a chamar a interpretação semântica (1 micro-chamada, ~400-600 tokens de entrada cada). O atalho existe para "ok/obrigado"; esses continuam caindo em `administrativa`. É preciso rodar `semantica`/`pesquisa` nas suítes existentes.

### Problema C: consumo do dossiê

**Comprovado (medido):**

- **Frequência:** 1 atualização por turno investigativo, em segundo plano e com chave de idempotência (`investigacao-dossie-atualizador-service.js:421`). Turnos de conversa ("ok", agradecimento) não atualizam. Nas 16 execuções: 34 atualizações em 46 turnos. Não há chamada redundante no mesmo turno.
- **Tamanho:** 7.169 tokens de entrada em média, máximo de 11.993. Cresce a cada turno: no d06 foram 5,1 mil → 8,8 mil → 11,4 mil. A resposta principal do mesmo turno usou 2,0 mil → 5,8 mil → 6,4 mil.
- **O que vai** (`_montarPrompt`, linha 76; chamada em `investigacao-service.js:1822`). Composição medida no d06 T3, em tokens estimados (o total simulado é 6,5 mil contra 11,4 mil reais; a diferença vem principalmente do estado do dossiê e das páginas reais, maiores no uso real):

| Parte | Tokens | O que é |
|---|---|---|
| `manifesto` (do Context Engine) | 3.720 (57%) | auditoria da montagem do contexto da resposta principal: `planoRespostaRastreavel` 1.421, `quadroInvestigativo` 1.322, `selecionados` 706 (com orçamento, score, motivo e tokens de cada item) |
| `pesquisa` (objeto inteiro da pesquisa) | 1.728 (26%) | `plano` 1.293 (inclui `historico` de todas as consultas anteriores, 439, e `consultasIgnoradas`, 254), resultados, ranking e páginas lidas (até 2.200 caracteres por página) |
| `respostaAssistente` | 501 | a resposta do turno |
| instruções e schema | 418 | fixo |
| `estadoAtual` do dossiê | 66 (simulado) | cresce no uso real com fatos, hipóteses e testes |

**Hipóteses (não medidas):**
- O `manifesto` é quase todo auditoria operacional (orçamento, scores, tokens estimados) ou derivação do próprio dossiê (o quadro investigativo resume evidências que já estão no estado). Para o dossiê, o que importa dele são os identificadores das evidências usadas (tipo/id/nome), que permitem a proveniência.
- `pesquisa.plano.historico` e `consultasIgnoradas` são auditoria da pesquisa, sem conteúdo técnico novo para o dossiê.
- Artigos: o trecho de cada página lida vai inteiro ao dossiê, e a resposta do turno já contém a conclusão tirada dele. Ele é útil para ancorar fato em fonte externa (alvo `fonte_externa`).

**Alternativas, em ordem de risco:**
1. **Enviar ao dossiê um manifesto reduzido**: só identificadores das evidências selecionadas e as referências usadas, sem orçamento, scores, quadro e plano rastreável. Também sem `historico`/`consultasIgnoradas` da pesquisa. Ganho estimado no d06 T3: cerca de 3,5 mil a 4 mil de 11,4 mil tokens (30-35%). **Risco:** baixo a médio. O atualizador não decide com base nesses campos, mas é preciso confirmar que nenhuma proveniência deixa de ser aceita (`_validarAlvo`).
2. **Páginas lidas como referência curta** (URL, título, trecho de ~400 caracteres) em vez de 2.200 caracteres. Ganho: ~400 tokens por página lida. **Risco:** médio. Perde detalhe para fatos ancorados em fonte externa.
3. **Atualização incremental do estado** (enviar só itens alterados ou relevantes ao turno, em vez do estado inteiro): ganho cresce com atendimentos longos, mas **risco alto**: o atualizador perde a visão do todo e pode recriar hipótese descartada. Não recomendo agora.
4. **Pular a atualização quando o turno não tem conteúdo técnico**: já acontece nos turnos de conversa. Ampliar isso por regra fixa contraria a diretriz; não recomendo.

**Como validar o ganho sem prejudicar a qualidade:** comparar o `dossieFinal` (hipóteses, testes, fatos) e as métricas de continuidade do replay com o prompt atual e o reduzido, nos casos d06 e d11 (os de mais turnos). Custo estimado: 4 execuções reais, ~200 mil tokens de entrada.

## Propostas em ordem de prioridade (nenhuma implementada)

| # | Proposta | Tipo | Dependências | Riscos |
|---|---|---|---|---|
| 1 | **Problema B**: o atalho de zona deixa de negar pesquisa quando o plano decidiu pesquisar ou é turno humano com conteúdo; a interpretação semântica (IA) decide. Cada ponto que muda `devePesquisar` grava o próprio motivo. | correção de defeito comprovado | nenhuma; vem antes da remoção do veto, para que a medição da 4B não fique contaminada pelo efeito acidental do v05 | mais micro-chamadas de interpretação (~500 tokens cada); turnos "ok/obrigado" continuam em `administrativa` |
| 2 | **Problema A**: a consulta determinística passa a usar só texto do chamado e do analista (mesma regra das consultas da IA), sem respostas da IA e sem o texto renderizado do dossiê; ou sai da lista quando a IA gerou consultas. | correção de defeito comprovado | nenhuma | a reserva para falha da IA de consultas fica mais pobre; testar com IA de consultas indisponível |
| 3 | **4B**: remover o veto atrás de flag (já existe `IA_SERVICE_DISCIPLINA_4B`; bastaria desligar o veto e manter o cálculo da lacuna como contexto). Remoção definitiva só depois de confirmar (repetições ou produção). | decisão de arquitetura | 1 (sem ela, o v05 mostra que a remoção altera um efeito acidental) | +17% tokens e +6% latência na validação; mais pedidos repetidos (5 contra 3) |
| 4 | **Problema C**: manifesto reduzido para o dossiê (só identificadores das evidências) e sem `historico`/`consultasIgnoradas` da pesquisa. | otimização | replay de d06/d11 comparando `dossieFinal` (~200 mil tokens) | proveniência deixar de ser aceita se algum id faltar; validar `_validarAlvo` |
| 5 | Problema C: páginas lidas como referência curta no dossiê | otimização | 4 | fatos ancorados em fonte externa com menos detalhe |

Separação do que é comprovado e do que é hipótese:
- **Comprovado:** origem das consultas contaminadas (A); fluxo e causa da contradição (B), inclusive a repetição no v05; frequência e composição do prompt do dossiê (C); comportamento da 4B nos 22 casos-execução.
- **Hipótese:** que o manifesto e o histórico da pesquisa não ajudam o atualizador do dossiê (C, alternativas 1 e 2); que o ganho de qualidade sem o veto se mantém em mais execuções e com busca real.

## Etapa 4 (2026-11-12): correções A e B, veto da 4B desligado e validação comparativa

Autorizada pelo usuário: corrigir B e A, desligar o veto da 4B pela flag (sem remover código) e repetir v02–v04 (execuções 2 e 3). Sem migrations, APIs, prompts de produção, provedores ou commits.

### Problema B: correção aplicada

- **Finalidade original do atalho** (`planejarPesquisaComSemantica`, comentário acima do `if` de zona): evitar chamada semântica em turno realmente conversacional ("obrigado", "ok", "vou verificar") e no texto fixo do botão.
- **Defeito:** o atalho também pegava a zona `sem_evidencia_clara` quando o plano determinístico tinha decidido **pesquisar**, e negava a pesquisa gravando o motivo do plano. O resgate de turno humano só age quando o plano já dizia não pesquisar, então não cobria esse caso.
- **Correção** (`technical-research-service.js`, `planejarPesquisaComSemantica`):
  1. Quando o plano decidiu pesquisar e a zona é `sem_evidencia_clara`, a decisão vai para a interpretação semântica (zona auditada `plano_pesquisaria_sem_evidencia_clara`), não para o atalho. O atalho continua igual para `administrativa`, para `sem_material` e quando o plano já não pesquisaria.
  2. Se o atalho ainda negar um plano que pesquisaria (zona `sem_material`), o motivo gravado é o da negação, não o do plano.
  3. Nova `_comDecisaoPlanejada`: quando a decisão executada difere da planejada, o plano final ganha `decisaoPlanejada: { devePesquisar, motivo }`. O campo vai dentro do JSON da pesquisa, que já é gravado; nada muda no schema.
- **Semântica indisponível:** prevalece a decisão planejada (pesquisar), com o motivo original. É coerente: nenhuma decisão é trocada sem quem a troque.
- **Não amplia** as condições de pesquisa: só age quando as regras já tinham decidido pesquisar, e a palavra final é da IA de interpretação.
- **Testes** (`tests/pesquisa-decisao-coerente.test.js`, 7): d11 T2 (pesquisa quando a semântica vê novidade; não pesquisa e diz o motivo quando não vê; semântica indisponível mantém a decisão), v05 (pedido do analista reconhecido), cortesia preservada, a correção só age quando o plano pesquisaria, e nenhuma decisão de não pesquisar carrega o motivo de pesquisar. **Com o código anterior, 5 dos 7 falham.**

### Problema A: correção aplicada

- **Correção** (`technical-research-service.js`, `planejarPesquisa`): as consultas montadas pelo backend (`montarConsultas` e a reserva de `_montarConsultaPorSinais`) passam a tirar termos só do chamado e das mensagens de quem relata o problema (`mensagensRelato`, sem `papel === 'assistant'`), sem o texto renderizado do dossiê. É a mesma regra que as consultas escritas pela IA já seguiam. Os sinais técnicos estruturados (erros, rotinas, tabelas, versões) continuam vindo também do dossiê. As consultas escritas pela IA não mudam. Não há lista de frases.
- **Testes** (`tests/pesquisa-consultas-sem-texto-interno.test.js`, 4): nenhum termo de consulta pode existir só na resposta da IA ou no dossiê (com e sem anexo); erro e assunto do relato continuam nas consultas; a mensagem atual do analista continua sendo fonte de termos. **Com o código anterior, os 2 testes de contaminação falham** (consulta gerada: "site:tdn.totvs.com Protheus relatorio customizado busca externa aproveitavel thread error trouxe").
- **Observação, não alterada:** com um log que tem `THREAD ERROR (...)` e `array out of bounds` em linhas próximas, o extrator de erros do backend escolhe `THREAD ERROR` como erro principal, antes e depois da correção. As consultas da IA cobriram "array out of bounds" no replay.

### 4B: veto desligado pela flag

- `investigacao-service.js`: `disciplina4B: process.env.IA_SERVICE_DISCIPLINA_4B === '1'` (antes `!== '0'`). Os vetos ficam desligados por padrão; **reversão sem deploy**: `IA_SERVICE_DISCIPLINA_4B=1`. Nenhum código da 4B foi removido.
- A flag liga só os vetos (`investigative-discipline-service.js:412-427` e `technical-research-service.js:705-718`). A classificação da lacuna, a suficiência e a pesquisa que a própria 4B pede quando vê lacuna externa (`disciplina.pesquisa.necessaria`) continuam ativas e auditadas em `pesquisa.plano`.
- **Ressalva:** hoje a lacuna da 4B não chega ao prompt da resposta principal (só à auditoria e ao prompt do dossiê). Torná-la contexto da IA seria uma mudança nova, não feita.

### Teste antigo da 4B que passa a falhar (decisão pendente)

`tests/etapa4b-disciplina-investigativa.test.js`, caso `4b-environment-gap` ("A API falhou no cliente, mas ainda não temos status HTTP nem log do horário."), espera "não pesquisou". Investigado:
- No contexto do benchmark, a lacuna desse caso sai `TESTE` (isolada, sai "evidência do ambiente"), então **a 4B não veta**: o plano decide pesquisar.
- Até agora, quem impedia a pesquisa era **o defeito B** (atalho `sem_evidencia_clara`).
- Corrigido o B, decide a semântica, e o simulador do benchmark responde "evidência nova, relevância média" para **toda** mensagem.

O teste passava por acidente, apoiado no defeito B. Não alterei teste nem simulador. Opções: (a) o simulador semântico do benchmark responder por caso (este caso: "informação insuficiente"); (b) aceitar a falha e aposentar o benchmark 4B, já que a 4B foi ajustada a ele. Recomendo (a). Suíte com as correções A e B: 140 de 141 arquivos passando (inclui os 2 novos); a única falha é esta.

### Validação comparativa após as correções (v02, v03, v04; execuções 2 e 3)

Mesmas condições (gpt-5.4, busca congelada, avaliadora com `replay-rubrica-1`). Variante com veto: `IA_SERVICE_DISCIPLINA_4B=1`; sem veto: `0`. Ambas com A e B corrigidos. 12 execuções, 272 mil tokens de entrada e 42 mil de saída. A execução 1 (pré-correção) aparece só como referência e não entra nas médias.

| Métrica (14 turnos por variante) | Com veto | Sem veto |
|---|---|---|
| Turnos com veto / que pesquisaram | 10 / 0 | 0 / 10 |
| Consultas / repetidas | 0 / 0 | 49 / 2 |
| Páginas lidas (aplicáveis ou potenciais) | 0 | 10 (10) |
| Pontos essenciais cobertos | 9/16 | **12/16** |
| Nota média (desvio) | 3,79 (1,19) | **4,14** (1,10) |
| Afirmações sem sustentação | 8 | **5** |
| Pedidos repetidos | 5 | **3** |
| Ação inadequada | 3 | 3 |
| Tokens de entrada (com avaliação) | 125.077 | 147.051 (+18%) |
| Latência média por turno | 11,0 s | 13,8 s (+24%) |

Consistência por caso, juntando a execução 1 (pré) e as 2 e 3:
- **v02:** decisão idêntica nas 3 execuções de cada variante. T1 sem veto: 5/5/5 com 1/1 ponto; com veto: 5/3/5. T2: 1/2 pontos nas duas variantes (o segundo ponto, tratar os pedidos já incluídos, nenhuma cobriu).
- **v03:** o veto agiu em T2/T3 nas 3 execuções; sem veto, pesquisou nas 3. Sem veto: T2 5/5/5 e T3 4/4/4. Com veto: T2 3/5/2 e T3 3/5/4, ou seja, instável. T1 é "intenção incerta: confirmar antes de pesquisar" nas duas variantes, avaliado como inadequado sempre: comportamento independente da 4B.
- **v04:** sem veto, T2 5/5/5 com fonte aplicável lida nas 3; com veto, 4/3/4.

**Revisão técnica independente** (feita por mim, lendo as respostas dos turnos divergentes): concordo com a avaliadora.
- **v04 T2:** sem veto, foi direto ao item do PA0200 na tabela 003 (bloqueio/vigência) citando a fonte. Com veto, abriu hipóteses de customização e pediu prints amplos.
- **v03 T2 (exec. 3):** sem veto, foi para o limite global/servidor web. Com veto, ficou no eixo do componente de anexo e repetiu pedidos do turno anterior.
- **v02 T1 (exec. 2):** com veto, pediu comparativos genéricos e não chegou ao vínculo do comprador com grupo/alçada.

### Recomendação sobre a remoção definitiva do veto

**Remover.** Com A e B corrigidos, o resultado da validação inicial se repetiu nas execuções 2 e 3, nos três casos:
- a IA pesquisou só quando o veto não a impedia, e leu sempre fonte aplicável;
- mais pontos essenciais, menos afirmações sem sustentação e menos pedidos repetidos;
- respostas mais estáveis entre execuções (v03).

O custo é +18% de tokens e +24% de latência por turno nesses casos.

Limitações:
- 3 casos × 3 execuções, sintéticos.
- As fontes congeladas sempre contêm a resposta; com busca real o ganho tende a ser menor e o custo de pesquisas improdutivas maior.
- A avaliadora é o mesmo modelo do motor.

Sugestão antes de apagar o código: manter a flag desligada em produção por um período e acompanhar a taxa de pesquisa por turno, a latência e as avaliações humanas.

## Etapa 5 (2026-11-12): consolidação, benchmark corrigido, observação da 4B, dossiê e diagnósticos

### Correções A e B consolidadas (sem ampliar escopo)

- Decisão planejada × executada: coerentes nos testes de `pesquisa-decisao-coerente` (7) e agora também no benchmark (`4b-environment-gap`): decisão semântica, execução e auditoria verificadas em separado. `decisaoPlanejada` é gravado sempre que a execução difere do plano.
- Consultas sem texto interno: `pesquisa-consultas-sem-texto-interno` (4). Sinais estruturados continuam vindo também do dossiê (verificado no teste "erro e assunto do relato continuam").

### Benchmark da 4B corrigido (não aposentado)

- **Antes:** o simulador semântico do benchmark (`tests/benchmark/engine/benchmark-runner.js`, `_pesquisarOffline`) respondia "evidência nova, relevância média" para toda mensagem.
- **Agora:** cada turno que chega à interpretação semântica declara no próprio caso (`turns[].semantica`) o julgamento esperado da IA para aquele cenário. Mapeamento feito sem IA: só 8 turnos chegam lá (7 em `initial-cases.json`, 1 em `etapa4b-cases.json`). "Informação insuficiente" vale para as mensagens sem erro, print nem log (`impossible-no-evidence`, `4b-environment-gap`); "informação de contexto, relevância baixa" vale para a correção de ambiente (`user-corrects-information` T2). Os demais são relevantes.
- Turno sem `semantica` declarada que chegue à semântica **falha o caso** com mensagem explícita, em vez de cair numa resposta padrão.
- `etapa4b-disciplina-investigativa`: a expectativa original do caso (não pesquisar sem necessidade) foi mantida. Foram acrescentadas verificações separadas de decisão (consultou a IA de interpretação, zona e tipo), execução (não pesquisou, nenhuma consulta) e auditoria (motivo da decisão executada e `decisaoPlanejada`). **Com o código anterior à correção B, o teste falha** ("decisão: consultou a IA de interpretação").
- O benchmark também registra, por pesquisa, `semantica` e `decisaoPlanejada`.
- **Suíte completa depois do benchmark e do dossiê experimental: 142 de 142 arquivos passando.**

### Flag da 4B

`IA_SERVICE_DISCIPLINA_4B`: veto **desligado por padrão** (liga só com `=1`). Código intacto e reversível sem deploy. A classificação da lacuna continua em `pesquisa.plano.lacunaInvestigativa` (auditoria) e chega ao atualizador do dossiê (também no contexto reduzido, campo `lacuna`). **Ela não chega ao prompt da resposta principal**, nem antes nem agora. Levá-la até lá seria uma mudança de prompt, não feita; fica como proposta.

### Plano de observação para retirar o código do veto

Pré-requisito: publicação autorizada com o veto desligado. Período sugerido: 2 semanas ou 150 atendimentos com investigação, o que vier depois. Fonte dos dados: `investigacao_execucoes` (plano, pesquisa e uso já gravados) e `avaliacoes_investigacao` (avaliação humana). Sem tabela nova.

| Indicador | Como medir | Referência |
|---|---|---|
| Pesquisas por atendimento e por turno | `pesquisa.plano.devePesquisar` por execução | 2 semanas anteriores (veto ligado) |
| Pesquisas repetidas | consultas com núcleo equivalente no mesmo atendimento (`_consultasEquivalentes`) | idem |
| Aplicabilidade das fontes | páginas lidas citadas na resposta e não rejeitadas pela seleção; amostra de 30 revisada por humano | sem referência anterior: amostra |
| Qualidade das orientações | avaliação humana (`avaliacoes_investigacao`) e Quality Gate | idem |
| Latência | `temposEtapasMs` e latência total por turno | idem |
| Tokens e custo | `usage` por execução (agora gravado) × `precos-modelos-ia.json` | idem (o preço do gpt-5.4 ainda falta) |
| Decisões alteradas | execuções com `decisaoPlanejada` | nova |

Critério para remover o código: sem aumento relevante de pesquisas repetidas, avaliação humana igual ou melhor, e latência/custo dentro do aceito pelo usuário. Se piorar: `IA_SERVICE_DISCIPLINA_4B=1`.

### Diagnóstico: "intenção incerta" no v03 T1 (sem alteração)

Mensagem: "Onde ajusto esse limite?". A abertura do chamado diz: "anexos acima de 10 MB são recusados com 'Arquivo excede o tamanho permitido'". Mesmo resultado nas 6 execuções, com e sem a 4B: o motor pergunta se o analista quer pesquisar, e a avaliadora considera inadequado.

1. **Regra do backend:** `planejarPesquisa` marca a mensagem como "curta sem evidência" (`_mensagemCurtaSemEvidencia`: até 50 caracteres e sem padrão técnico), o que dá `devePesquisar = false` ("turno sem evidencia tecnica nova suficiente…").
2. **Zona:** com menos de 25 caracteres, `sem_evidencia_clara`. Como é turno do analista, entra o resgate e a decisão vai para a IA de interpretação (zona `turno_humano_sem_evidencia_clara`).
3. **Decisão da IA, com contexto insuficiente:** a chamada semântica funcionou nas 6 execuções (não foi fallback), então a IA respondeu `pedidoInvestigacaoAnalista: "incerto"`. Mas o que ela recebe (`_resumirEstadoParaSemantica`) é só a mensagem atual mais objetivo genérico, lacunas, histórico de consultas e itens do dossiê. **O problema do chamado não vai.** Sem saber o que é "esse limite", "incerto" é uma resposta razoável.
4. A pergunta feita à IA também é estreita: "é um pedido para pesquisar?". Uma pergunta técnica direta sobre o problema do chamado não é, literalmente, um pedido de pesquisa.

Conclusão: decisão da IA, induzida por contexto insuficiente fornecido pelo backend. O ponto de partida veio de uma regra de tamanho de mensagem. Não há regra rígida forçando "incerto".
**Proposta (não implementada):** incluir no estado enviado à interpretação semântica um resumo curto do problema do chamado (título/abertura e o erro principal, ~300 caracteres) e perguntar também se a mensagem é uma pergunta técnica que pede orientação ou referência. Nenhuma regra nova de tamanho ou palavra. Validação: os testes de semântica existentes, mais o v03 e o d03 no replay (~40 mil tokens).

### Diagnóstico: seleção do erro principal (sem alteração)

Código: `_extrairSinaisTecnicos` (`technical-research-service.js`, por volta da linha 235). Reproduzido com o log real do d06:

1. **Regex fixa por linha:** uma "linha" vira erro se contiver um marcador de uma lista fixa (`thread error`, `exception`, `timeout`, `ora-`, `http 4xx`…). "array out of bounds" **não está na lista**.
2. **As linhas não existem:** o texto passa antes por `sanitizarConsultaExterna`, que troca toda sequência de espaços (inclusive quebras de linha) por um espaço. O `split` por linha encontra **uma única linha** com todo o contexto, e o "erro" vira os primeiros 220 caracteres a partir do primeiro trecho, cortado no meio. No d06: `"error.log THREAD ERROR ([8812], usr_fat, PCFAT03) 04/11/2026 09:12:44 array out of bounds [3] of [2] on U_RELFAT01(RELFAT01.PRW) … line : 88 ["`.
3. **Ordem:** com várias ocorrências, vence a primeira na ordem de concatenação (campos do chamado, depois mensagens, depois anexos).
4. **Frequência:** a consulta por sinais usa `_termosRelevantes(erros[0], 6)`, as 6 palavras mais frequentes. Com empate, vence a ordem de aparição, então o cabeçalho (`thread`, `error`, `8812`, `usr_fat`, `pcfat03`, `2026`) ocupa as vagas, e `array`/`bounds` ficam de fora.
5. **Assinatura do erro** (`ASSINATURAS_ERRO`, lista fixa usada no ranking com +70 e na compatibilidade de artigos): tem "index out of bounds", não "array out of bounds". Resultado: assinatura vazia no d06.
6. **Avaliação semântica:** nenhuma neste ponto. A IA que escreve as consultas (`_gerarConsultasComIA`) já recebe os trechos do log e a instrução de preservar a mensagem principal, e cobriu "array out of bounds" no replay. O problema é só no caminho determinístico e no ranking.

**Proposta (não implementada, sem trocar regra por regra):**
- Corrigir o defeito estrutural: extrair as linhas **antes** de sanitizar (sanitizar cada linha). É correção de defeito, não regra nova.
- Tratar os erros extraídos como **lista de candidatos**, sem eleger um "principal" por ordem. A expressão principal passa a ser a que a IA de consultas escolheu (ela já preserva a mensagem principal), e o ranking e a compatibilidade de artigos usam essa expressão em vez da lista fixa `ASSINATURAS_ERRO`. A lista fixa fica só como reserva quando a IA de consultas falhar.
- Riscos: o ranking passa a depender da qualidade das consultas da IA (já usadas hoje para buscar). Validar com os testes `estabilizacao-casos-reais`, `etapa-v1-pesquisa-web-motor` e os casos d06/d07/d13 em modo simulado (sem custo), e depois d06 no replay (~60 mil tokens).

### Otimização do dossiê: validação (implementação experimental atrás de flag)

Implementado atrás de `IA_SERVICE_DOSSIE_CONTEXTO_REDUZIDO` (**desligada por padrão**: sem a flag, nada muda). Arquivo `investigacao-dossie-atualizador-service.js`: `_manifestoParaDossie`, `_pesquisaParaDossie` e `_contextoReduzidoAtivo`, aplicados só ao `manifesto` e à `pesquisa` do turno no prompt. Estado, mensagem, resposta, instruções, schema, validação (`_validarAlvo`) e chave de idempotência continuam iguais.

**4.1 Testes determinísticos (sem IA):**
- `tests/dossie-contexto-reduzido.test.js`, 9 testes:
  - estrutura compatível (mesmas chaves, instruções e schema);
  - estado idêntico (inclusive hipótese DESCARTADA e relações);
  - mensagem, resposta, resumo e referências idênticos;
  - ids de todas as evidências selecionadas e omitidas preservados;
  - páginas lidas e reaproveitadas com trecho, e não lidas fora;
  - lacuna visível;
  - só sai auditoria;
  - entradas vazias não quebram;
  - integração com banco: com a flag, evidências citadas por id (`anexo` e `fonte_externa`) são aceitas e geram relações; sem a flag, comportamento atual.
- Medição nos 21 casos do replay com IA simulada: 44 atualizações de dossiê, **0 perdas** (ids selecionados e omitidos, páginas lidas, estado, mensagem e resposta). Prompt: 194 mil → 37 mil tokens estimados (−81%; no simulado o estado é vazio e as respostas são curtas, então no real a parte reduzida pesa menos).

**4.2 Comparação com IA** (d06, d11, v03; 1 execução por variante; gpt-5.4; veto da 4B desligado nas duas; 230 mil tokens de entrada no total, dentro do orçamento):

| Métrica | Completo | Reduzido |
|---|---|---|
| Tokens de entrada da atualização do dossiê (8 atualizações) | 57.157 (média 7.145) | **13.856 (média 1.732), −76%** |
| Tokens de saída da atualização | 7.513 | 8.442 (+12%: a IA registrou mais itens) |
| Latência média da atualização (segundo plano) | 12,4 s | 13,5 s (sem ganho: domina a geração da saída) |
| Tokens de entrada do motor (todas as chamadas) | 118.829 | **71.691 (−40%)** |
| Alterações aceitas / rejeitadas | 20 / 2 | 25 / 2 |
| Atualizações com falha | **1** (v03 T3) | 0 |
| Nota média das respostas | 4,30 | 4,20 |
| Pontos essenciais | 8/11 | 8/11 |
| Pedidos repetidos | 1 | 3 (todos no v03 T3) |
| Hipóteses descartadas revividas | 0 | 0 |

Dossiê final por caso:
- **d06:** diagnóstico equivalente nos dois, com o reduzido mais específico (cita `StrTokArr(cLinha, ";")` e a posição 3). Composição diferente: o completo registrou 1 fato + 1 hipótese; o reduzido, 4 fatos e nenhuma hipótese. Relações com anexo: 3 contra 5.
- **d11:** diagnóstico equivalente (sequência TSS → certificado vencido → rejeição 280). Completo: 4 fatos; reduzido: 5 fatos + 1 hipótese aberta.
- **v03:** diagnóstico equivalente (IIS 413.1, `maxAllowedContentLength`). As 2 rejeições do completo e as 2 do reduzido são do mesmo tipo ("resultado sem teste explícito", regra existente). **A falha do completo no T3 foi a IA citar uma evidência do tipo `historico`** (inexistente). `historico` é um dos campos de auditoria da pesquisa que o reduzido deixa de enviar, e o atualizador recusou a atualização inteira.

Leitura:
- **Ganho claro em tokens** (−76% no dossiê, −40% no motor nesses casos). Nenhum aumento de rejeições, nenhuma falha, e diagnóstico final equivalente ou mais específico. Os itens do dossiê têm composição diferente (mais fatos, menos hipóteses no d06), o que é esperado com 1 execução e precisa ser olhado com mais execuções.
- **Ponto de atenção:** 3 pedidos repetidos no v03 T3 do reduzido, contra 1 no completo. Nas rodadas anteriores com o dossiê completo, o mesmo turno teve 3, 2 e 1, ou seja, está dentro da variação já observada. Ainda assim, é o indicador a acompanhar.
- **Limitação:** 1 execução por variante e 3 casos. O texto dos itens do dossiê não foi gravado nesta rodada (o replay guardava só o título, vazio nesse modelo). Corrigido em `replay-runner.js` para as próximas rodadas.

**Recomendação:** manter a flag desligada e, se o usuário aprovar, repetir d06/d11/v03 com 2 execuções a mais por variante (~460 mil tokens), comparando também o texto dos itens do dossiê, antes de ligar por padrão.

## Etapa 6 (2026-11-13): conclusão e homologação funcional

### Alterações

| Item | O que mudou | Onde |
|---|---|---|
| Ciclo investigativo (requisito 5) | Depois da 1ª rodada de pesquisa, a IA avalia cada fonte (aplicável sim/parcial/não), revê as hipóteses e decide **responder**, **aprofundar** (com até 3 consultas que ela escreve) ou **falta evidência do ambiente**. O backend executa a pesquisa pedida com a mesma infraestrutura (busca, seleção por IA, leitura segura, deduplicação), limita a 2 aprofundamentos por turno (`MAX_RODADAS_APROFUNDAMENTO`), descarta consulta equivalente a uma já feita e informa à IA o que cada aprofundamento trouxe. A avaliação vai para a resposta principal (seção de orientações) e fica na auditoria (`pesquisa.ciclo`, gravado na execução). Sem novo agente nem serviço: uma micro-chamada JSON por rodada. Flag `IA_SERVICE_CICLO_INVESTIGATIVO` (ligada por padrão; `=0` desliga). | `technical-research-service.js`: `aprofundarPesquisa`, `avaliarEvidenciasPesquisa`, `_planoAprofundamento`, `_combinarPesquisas`, `_formatarCicloInvestigativo`; `investigacao-service.js` (chamada após a 1ª rodada) |
| Contexto da interpretação semântica (2) | A IA de interpretação recebe o resumo do problema do chamado e o início da última resposta da IA, e a orientação de que pergunta técnica sobre o problema é investigação. Nenhuma regra de tamanho ou palavra. | `_resumirEstadoParaSemantica`, prompt de `_interpretarSemanticaPesquisa` |
| Erros em logs (3) | Linhas preservadas (sanitização por linha, não do texto inteiro); erros viram **candidatos** (`errosCandidatos`: marcador + linha seguinte, sem a pilha), extraídos também dos logs anexados. A IA de consultas, na mesma chamada que já existia, escolhe `erroPrincipal`, que só vale se estiver no texto enviado e passa a guiar a consulta do erro principal, o ranking e a compatibilidade dos artigos. A lista fixa `ASSINATURAS_ERRO` ficou como reserva. O objetivo do plano lista as candidatas em vez de eleger a primeira. | `_extrairSinaisTecnicos`, `_gerarConsultasComIA`, `_validarErroPrincipal`, `planejarPesquisa`, `pesquisar` |
| Situação atual nas micro-chamadas (achado da validação) | A IA de consultas e a de seleção de artigos recebem a **mensagem atual** separada do chamado (e, no aprofundamento, o objetivo da rodada): o erro atual é o foco; o erro anterior já superado, não. | prompts de `_gerarConsultasComIA` e `_selecionarArtigosComIA` |
| Dossiê reduzido (4) | Habilitado no ambiente local de homologação (`.env`: `IA_SERVICE_DOSSIE_CONTEXTO_REDUZIDO=1`). Reversão: remover a linha ou `=0`. Flags documentadas em `.env.example`. | `.env`, `.env.example` |

### Testes

- Novos: `tests/ciclo-investigativo.test.js` (7), `tests/semantica-contexto-e-erro-principal.test.js` (7).
- **Suíte completa com o código final: 144 de 144 arquivos.**
- Replay real (gpt-5.4, veto da 4B desligado, dossiê reduzido): caso de demonstração c01 (2 execuções), d06, d11 e v03 (d11 e v03 duas vezes: antes e depois do ajuste da situação atual). Cerca de 270 mil tokens de entrada no total.

### Evidência do ciclo autônomo (c01, execução 1)

Chamado: "pedido bloqueado com 'Bloqueio de crédito por risco'". O analista informa: cliente risco A, limite disponível, vencimento do limite em 2027. `MV_CRDATRS` é um parâmetro fictício, que só a segunda fonte explica.

1. Interpretação semântica: "nova investigação solicitada pelo analista" → pesquisar.
2. IA de consultas → busca 1 ("SIGAFAT MATA440 bloqueio crédito risco"…). Lê "MATA440 - Bloqueio de crédito por risco".
3. **Avaliação da IA, rodada 1:** fonte aplicável. Hipóteses: limite vencido *enfraquecida*; "MV_CRDATRS habilitado + títulos em atraso" *nova*. Decisão **aprofundar**: "MV_CRDATRS Protheus risco A", para confirmar o comportamento do parâmetro citado na fonte.
4. Busca 2 (consulta escrita pela IA) → lê "MV_CRDATRS - Bloqueio por títulos vencidos para qualquer risco".
5. **Avaliação da IA, rodada 2:** as duas fontes aplicáveis; hipótese MV_CRDATRS + títulos vencidos *reforçada*. Decisão **falta evidência do ambiente**: valor de MV_CRDATRS e títulos vencidos do cliente (FINC010).
6. Resposta: explica as regras de risco, aponta MV_CRDATRS + títulos vencidos como hipótese mais forte (sem afirmar como causa), pede exatamente os dois dados e diz o que fazer com cada resultado. Avaliadora: nota 5, 2/2 pontos essenciais. Dossiê: 6 alterações aceitas, 0 rejeitadas.

Execução 2 (código final): a IA também decidiu aprofundar, mas escreveu a consulta só com MV_RISCOB/C/D. Não achou fonte nova, reavaliou e concluiu "falta evidência do ambiente". A resposta cobriu os 2 pontos (nota 4). É variação do modelo, não do backend: as decisões são da IA.

### Validação final (código final)

| Caso | Resultado |
|---|---|
| d06 (4 turnos, log; rodado antes do ajuste da situação atual, que só acrescenta contexto) | erro principal "array out of bounds" escolhido pela IA nos 3 turnos com pesquisa; notas 5/5/5/5; 0 pedidos repetidos; dossiê 7 alterações aceitas, 0 rejeitadas |
| d11 (3 turnos, erro muda) | antes do ajuste da situação atual: T2 nota 2 (a IA escolheu o erro antigo e reviveu hipótese). **Depois:** T2 escolhe "certificado digital vencido", lê a fonte certa, nota 4, sem hipótese revivida; T3 aprofunda sozinho e encontra a rejeição 280 (nota 5) |
| v03 (3 turnos) | T1 passou a pesquisar com o contexto do chamado (antes: "intenção incerta" em 6 de 6). A resposta do T1 ainda termina perguntando e foi avaliada como inadequada (3); T2 5, T3 4. O ciclo para depois de aprofundamentos sem fonte nova |
| Segurança e limites | 0 erros de turno; limite de rodadas respeitado; consultas equivalentes não repetidas; fontes citadas pela IA que não foram lidas são descartadas da avaliação (teste). Isolamento entre empresas, com o código final e o ciclo ligado: d14 (outra empresa citada) e v05 (pedido de chamados de todas as empresas), **0 vazamentos** (o marcador da outra empresa não apareceu em nenhum prompt nem resposta), notas 5 e 5. A suíte inclui os testes de isolamento existentes |

**Custo do ciclo:** em turnos que aprofundam, +1 avaliação (~0,7–1 mil tokens de entrada) por rodada mais a busca extra, e latência por turno de ~25–35 s (antes ~12–14 s nesses casos). Quando a IA decide responder na 1ª avaliação, o acréscimo é só uma micro-chamada.

### Pendências

**Impeditivas: nenhuma.**

Melhorias para versões posteriores:
1. Latência do ciclo: a avaliação e a seleção poderiam usar um modelo menor; hoje usam o mesmo modelo da Platform.
2. A consulta determinística ainda pode levar números de pedido e cliente para o buscador (visto no c01: "012345 000123"). Não é dado pessoal, mas é ruído e informação do cliente.
3. v03 T1: a resposta termina com pergunta mesmo depois de pesquisar (estilo da resposta, não decisão de pesquisa).
4. Lacuna da 4B no prompt da resposta principal (hoje só no dossiê e na auditoria).
5. Preço do gpt-5.4 em `precos-modelos-ia.json` (custo em dólar na observação).

### Situação das flags

| Flag | Padrão no código | Ambiente local (homologação) | Reversão |
|---|---|---|---|
| `IA_SERVICE_DISCIPLINA_4B` | desligada (veto não age) | não definida → desligada | `=1` |
| `IA_SERVICE_CICLO_INVESTIGATIVO` | ligada | não definida → ligada | `=0` |
| `IA_SERVICE_DOSSIE_CONTEXTO_REDUZIDO` | desligada | `=1` | remover a linha ou `=0` |

### Recomendação

**Pronto para homologação funcional** no ambiente local. Todos os critérios de encerramento foram atendidos: suíte aprovada (144/144); defeitos conhecidos corrigidos (A, B, contexto semântico, erro principal e o achado da situação atual); dossiê preservando a memória (0 perdas nos testes determinísticos, rejeições não aumentaram); investigação em várias etapas conduzida pela IA demonstrada; nenhuma falha crítica de segurança ou de continuidade.

Para a homologação com analistas, acompanhar latência e avaliação humana. Produção só com autorização específica.

## Etapa 7 (2026-11-13): exposição de dados de clientes nas consultas externas

**Diagnóstico (comprovado):** o backend montava consultas com as palavras mais frequentes do relato (`montarConsultas` e a reserva de `_montarConsultaPorSinais`) e as enviava aos buscadores junto com as da IA, ou sozinhas quando a IA de consultas falhava. Teste local: nomes de pessoa, empresa e fazenda chegavam ao Google mesmo com a IA escrevendo consultas limpas. Base local: 4 chamados (6 execuções) com nomes de clientes cadastrados ou de pessoas em consultas já executadas.

**Correção autorizada (ajustes 1 e 2):**
1. `planejarPesquisa` não usa mais `montarConsultas`. `_montarConsultaPorSinais` usa só rotina, versão, código HTTP e a assinatura genérica do erro. Saíram: a linha bruta do erro, as palavras livres por frequência e também **tabela/campo e nome de função**, porque o padrão capturava o login do usuário do cabeçalho do log (`USR_FAT`). Sem sinal técnico, não há consulta de contingência.
2. O prompt de avaliação e aprofundamento recebeu a mesma orientação do prompt de consultas: termos técnicos e nunca cumprimento, nome de cliente, empresa, filial ou pessoa.
- Ajustes necessários para não regredir:
  - **Pedido explícito sem consulta do backend** continua decidindo pesquisar; as consultas ficam com a IA.
  - **Sem nenhuma consulta** (IA de consultas falhou e não há sinal técnico): a decisão fica registrada, a busca externa não é chamada (`plano.semConsultaTecnica`) e a resposta é orientada a não dizer que pesquisou.
  - **Deduplicação preservada:** sem consulta do backend para comparar, um atendimento que já pesquisou não repete a pesquisa automática sem evidência técnica nova nem pedido explícito. Turno do analista continua passando pela interpretação semântica.

**Validação:**

| Cenário local (sem rede) | Antes | Depois |
|---|---|---|
| 1. IA escreve consultas limpas | nomes de pessoa, fazenda e empresa enviados (pela consulta do backend) | nenhum dado do cliente; a contingência é "TOTVS Protheus MATA440" |
| 2. IA erra e inclui dados | dados enviados | **ainda enviados** (risco residual: o backend não filtra o que a IA escreve, por decisão) |
| 3. IA de consultas indisponível | nomes enviados | nenhum dado do cliente |
| 4. Aprofundamento com consulta errada da IA | dados enviados | **ainda enviados** (mesmo risco residual) |

- **Casos reais:** as 107 execuções da base local, recalculadas sem envio externo, geram 63 consultas do backend e nenhuma contém nome de cliente ou de pessoa (antes: 4 chamados). Nos 6 registros que tinham nomes, a consulta do backend agora é só técnica (ex.: "totvs protheus sigafis fisa170") ou inexistente.
- **Ciclo autônomo com IA real (c01):** buscou, avaliou, aprofundou e reavaliou; nota 5, 2/2 pontos. A primeira busca não leva mais "012345 000123".
- **Testes:** atualizados os que afirmavam o comportamento removido, sempre simulando a IA de consultas, que é quem escreve as consultas em produção:
  - `pesquisa-consultas-sem-texto-interno`, `pesquisa-consultas-por-ia` e `pesquisa-termos-sem-cortesia`: a expectativa passou a ser "só sinais técnicos";
  - `etapa-v1-caso-real-001`, `etapa-v1-pesquisa-explicita` e `novo-turno-humano-vs-retry`: ganharam a IA de consultas simulada;
  - `benchmark-runner`: a IA de consultas é simulada pelo título técnico do caso.

  Nenhuma asserção de segurança foi afrouxada. A de deduplicação ("turno automático não repete pesquisa") **detectou uma regressão real**, que foi corrigida no código.
- **Suíte completa: 144 de 144 arquivos.**

**Riscos residuais:**
- **Comprovado nos cenários 2 e 4:** se a IA escrever um nome ou número do cliente numa consulta, o backend envia, removendo só e-mail, CNPJ, CPF, chaves e endereços internos. A proteção nesse caminho é a instrução no prompt, presente nas duas chamadas que escrevem consultas, e não é garantia. A proposta opcional (filtrar pelos nomes cadastrados da empresa) não foi implementada, por decisão do usuário.
- **Provável:** rotina e versão vêm de padrões (`[A-Z]{2,}\d{3,}`) que poderiam capturar um código alfanumérico do cliente; não foi observado nas 107 execuções.
- **Não verificado:** telefone e senha em frase livre não são removidos pela limpeza; pelo caminho do backend não chegam mais às consultas (ele não usa texto livre), mas pela IA, em tese, poderiam.

## Proposta de otimização do dossiê (sem implementação)

Base: medições da seção "Diagnósticos independentes" e leitura de `investigacao-dossie-atualizador-service.js`.

### O que o atualizador realmente usa

- **Estado atual** (`estadoAtual`): fatos, hipóteses, testes e resultados com código, status e confiança. É a memória que impede reviver hipótese descartada e repetir teste. **Fica inteiro.**
- **Turno atual:** mensagem do analista e resposta da IA. **Ficam inteiras.**
- **Proveniência:** cada alteração cita evidências por `tipo`/`id`. O backend valida cada uma contra o banco da empresa/atendimento (`_validarAlvo`): mensagem, anexo, execução, chamado histórico, posicionamento, fonte externa. Por padrão, entram a mensagem do turno e a execução (`_evidenciasPadrao`). Para isso a IA precisa só dos **identificadores** do que foi usado no turno.
- O resto do `manifesto` (orçamento, scores, motivo de seleção, tokens estimados, `quadroInvestigativo` e `planoRespostaRastreavel`) é auditoria da montagem do prompt da resposta principal. O atualizador não o usa em nenhuma regra de validação.
- Da `pesquisa`, o útil para o dossiê são as páginas lidas (URL, título e trecho), para ancorar fato em fonte externa. `plano.historico` (todas as consultas anteriores), `consultasIgnoradas`, `ranking` e `tentativasBusca` são auditoria.

### Proposta

1. **Manifesto do turno reduzido** para o dossiê: `selecionados[] → { tipo, id, nome }` e `pendenciaConsolidada`. Ficam de fora orçamento, scores, quadro investigativo e plano rastreável.
2. **Pesquisa do turno reduzida:** `{ devePesquisar, motivo, consultasExecutadas, paginasLidas[] → { url, titulo, fonte, trecho } }`. Ficam de fora `plano.historico`, `consultasIgnoradas`, `ranking`, `resultados` não lidos e `tentativasBusca`. O histórico de pesquisas não precisa ser reenviado: o que foi aprendido com ele já está no estado (fatos e hipóteses).
3. **Não mexer** em estado, mensagem, resposta e regras do prompt. Nada de regra fixa de descarte nem de pular atualização por palavra-chave.

Ganho estimado no d06 T3 (simulado, prompt de ~6,5 mil): manifesto de 3.720 para ~700 e pesquisa de 1.728 para ~600, ou seja ~4,1 mil tokens a menos (60% do simulado). No real (11,4 mil), a estimativa é de 30% a 40%, porque estado e páginas são maiores. **É estimativa, precisa medição.**

Riscos:
- Proveniência rejeitada se faltar algum id que a IA usava. Mitigação: medir a taxa de alterações rejeitadas por `_validarAlvo` antes/depois.
- O quadro investigativo resume evidências antigas (360 caracteres por item). Se o atualizador o usava para lembrar contexto de turnos anteriores, pode perder detalhe. Mitigação: comparar o `dossieFinal`.

### Estratégia de validação (antes de qualquer alteração)

1. **Sem custo:** com a IA simulada, gravar o prompt do dossiê atual e o reduzido nos 21 casos e confirmar que todos os ids de evidência citáveis continuam presentes. Medir a redução de tokens por turno.
2. **Com custo (~250 mil tokens):** d06, d11 e v03 (mais turnos), 2 execuções com o prompt atual e 2 com o reduzido. Comparar:
   - `dossieFinal`: hipóteses, testes, fatos e status;
   - alterações rejeitadas pelo backend;
   - pedidos repetidos e hipóteses revividas nos turnos seguintes (a avaliadora já mede);
   - tokens e latência da atualização.
3. **Critério:** aceitar só se o `dossieFinal` mantiver os mesmos itens essenciais e status, sem aumento de rejeições nem de pedidos repetidos.

## Como rodar

```
# Validação do replay (sem rede, sem custo)
node "apps/IA Service/tests/replay/executar-replay.js" --simulado --execucoes 1

# Linha de base oficial (3 execuções por caso, com e sem 4B)
node --env-file=.env "apps/IA Service/tests/replay/executar-replay.js" --modelo gpt-5.4 --chave-platform 1 --conjunto todos --execucoes 3

# Amostra anonimizada (saída fora do repositório)
node "apps/IA Service/tests/replay/anonimizar-conversas.js" --saida <pasta> --quantidade 3 [--termos-extra <arquivo>]
```

## Limitações conhecidas do replay

- Só anexos de texto. Imagens e PDFs visuais ficam fora (o OCR e a rasterização chamariam a IA com arquivos que o caso não tem).
- A busca congelada casa por palavras-chave das fontes do caso. Uma consulta boa, mas com palavras diferentes, pode não encontrar a fonte, o que penaliza o motor injustamente. As palavras de cada fonte devem ser revisadas depois do primeiro replay real.
- A IA avaliadora usa, por padrão, o mesmo modelo do replay. A rubrica ainda precisa de calibração manual numa amostra.
- Casos sem o tipo "pré-análise automática" (o runner suporta `tipo: "pre_analise"`, mas nenhum caso usa ainda).
