# IA Service — Correções do Motor Investigativo (Estabilização 2026-10)

Base: `IA_SERVICE_AUDITORIA_ESTABILIZACAO_PRODUCAO.md`. Nenhuma das correções abaixo
altera o contrato público das Fases 1/2/3, inicia as Fases 4/5, adiciona provider
novo, ou toca em dados de produção. Todas as mudanças são aditivas (parâmetros
opcionais com default que preserva o comportamento anterior) — nenhuma assinatura
existente foi removida ou se tornou obrigatória.

## Resumo das alterações

| # | Arquivo | Causa-raiz endereçada (auditoria §) | Natureza |
|---|---|---|---|
| 1 | `redaction-service.js` | §3.2.c / §5 (CPF/CNPJ não redigido) | Aditiva, novo regex |
| 2 | `context-engine.js` | §4.2.b (pendência externa não propagada) | Aditiva, parâmetro opcional `chamado` |
| 3 | `investigacao-service.js` | §4.2.b + §2.2.a (propagação de `chamado`/`historicoMensagens`) | Aditiva |
| 4 | `prompt-builder.js` | §3.2.b (ações operacionais não cobertas) | Aditiva, nova seção no system prompt |
| 5 | `context-engine.js` + `investigacao-service.js` | §1.a (erro de infra contamina histórico) | Aditiva, metadado `diagnostico.erroInfraestrutura` |
| 6 | `quality-gate-service.js` | §2.2.a (repetição sem item de dossiê) | Aditiva, novo guard `REGRESSAO_INVESTIGATIVA_RESPOSTA_REPETIDA` |
| 7 | `investigacao-service.js` | bug encontrado pela própria suíte de testes ao integrar #2/#3 | Correção de bug (`ReferenceError`) |

---

## 1. `redaction-service.js` — CPF/CNPJ passam a ser mascarados antes do LLM

**Problema confirmado (auditoria §3.2.c/§5):** o único lugar do código que
mascarava CPF/CNPJ era `technical-research-service.js:sanitizarConsultaExterna`,
aplicado só à query de busca externa. O prompt principal enviado a Groq/OpenAI/
Claude/DeepSeek/Gemini, a memória operacional do dossiê e o prompt do atualizador
de dossiê não tinham essa proteção — qualquer CPF/CNPJ presente no histórico do
atendimento (comum em chamados de criação/alteração de usuário) era enviado em
texto claro a 5 provedores externos.

**Correção:** adicionados 3 padrões a `redigirTexto` (chamada por `redigirValor`,
usada em todos os pontos de redação do pipeline — `context-engine.js`,
`dossie-context-service.js`, `investigacao-dossie-atualizador-service.js`,
`investigative-discipline-service.js`):

```js
.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/g, '[REDACTED:CNPJ]')
.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[REDACTED:CPF]')
.replace(/\bcpf\s*[:=]?\s*\d{11}\b/gi, 'cpf: [REDACTED:CPF]')
```

Mesmo padrão numérico já usado e validado em
`technical-research-service.js:sanitizarConsultaExterna` e no validador de
privacidade dos datasets de benchmark (`tests/benchmark/engine/benchmark-runner.js:
assertPrivacy`) — reaproveitado por consistência, não inventado.

**Por que esta forma e não outra:** optei por manter CPF com pontuação obrigatória
(`\d{3}\.\d{3}\.\d{3}-\d{2}`), mais estrito que o padrão de
`sanitizarConsultaExterna` (que aceita pontuação opcional). Teste manual mostrou
que o padrão permissivo (`\.?`) capturaria sequências de 11 dígitos genéricas
(datas concatenadas, códigos internos) como falso positivo; o padrão de busca
externa aceita esse risco porque lá o pior caso é só remover um termo da query,
mas aqui o pior caso seria mascarar dado legítimo do chamado. Mantive, à parte, o
padrão `cpf\s*[:=]?\s*\d{11}` para cobrir o caso sem pontuação quando precedido do
rótulo "CPF" explícito — reduz falso positivo sem perder o caso real mais comum
(rótulo seguido de dígitos corridos).

**Validação:** teste unitário em
`estabilizacao-casos-reais-2026-10.test.js:testarAdversarial_RedacaoNaoGeraFalsoPositivo`
confirma que número de chamado e telefone sem formatação de CPF não são mascarados
(sem falso positivo), e que CPF/CNPJ reais continuam mascarados mesmo combinados
com outras credenciais no mesmo texto. Suíte completa das Fases 1/2/3 (38 arquivos)
roda sem regressão após a mudança.

---

## 2 e 3. Pendência consolidada do chamado propagada ao Context Engine

**Problema confirmado (auditoria §4.2.b):** `chamados.aguardando_consolidado`
(campo já existente desde a migration v39, alimentado pela view consolidada
`ITSM_CHAMADOS.AGUARDANDO`) nunca chegava ao prompt do motor investigativo — era
usado apenas pela fila do Radar (UI de triagem). Isso significa que um chamado com
retorno pendente de terceiro (ex. "RETORNO - FORNECEDOR", caso real do próprio
#036475 documentado na migration v39) não tinha esse sinal destacado para o LLM,
que via apenas o texto corrido do histórico sem indicação estrutural de que a
pendência é externa à equipe.

**Correção:**
- `context-engine.js:montarContextoInvestigacao` ganhou um parâmetro opcional
  `chamado = null`. Quando presente e com `chamado.aguardandoConsolidado`
  preenchido, uma linha é injetada no manifesto do prompt:
  > "Pendencia consolidada do chamado (campo AGUARDANDO, fonte: fila de
  > atendimento, atualizado a cada tramite): RETORNO - FORNECEDOR. Se este valor
  > indicar retorno de terceiro/fornecedor (...), trate como pendencia externa
  > aguardando resposta de fora da equipe — nao reabra a investigacao do zero nem
  > recomende novamente uma acao que depende exclusivamente desse retorno externo."
- `investigacao-service.js`: a variável `chamado` (já carregada via
  `chamadoRepo.getChamadoPorNumero` para resolver chamados relacionados) é
  propagada nas duas chamadas a `montarContextoInvestigacao` (turno normal e retry
  do Quality Gate).

**Por que esta forma e não outra:** considerei fazer essa propagação dentro do
próprio `dossie-context-service.js` (já que ele monta o bloco "Dossie Tecnico"),
mas o dado vem de `chamados`, não de `investigacao_dossies`/`investigacao_itens` —
colocá-lo no Context Engine, que já é o único ponto que recebe tanto o dossiê
quanto dados crus do atendimento/chamado, evita acoplar o dossiê a uma tabela que
não é dele. A condição `if (chamado?.aguardandoConsolidado)` garante que a linha só
aparece quando o dado existe — nenhuma pendência é inventada quando o campo é nulo
(confirmado pelo cenário adversarial do teste de regressão).

**Validação:** `estabilizacao-casos-reais-2026-10.test.js:testarCasoC_...` confirma
(a) a linha aparece com o texto correto quando `chamado.aguardandoConsolidado` é
"RETORNO - FORNECEDOR"; (b) a linha NÃO aparece quando `chamado` não é passado —
nenhuma pendência fantasma.

---

## 4. `prompt-builder.js` — ações operacionais/administrativas já comunicadas

**Problema confirmado (auditoria §3.2.b):** a seção existente "Diagnóstico humano
já fechado no histórico" cobre apenas conclusões de investigação técnica (causa
identificada, chamado aberto na TOTVS). Ela não tem vocabulário para o padrão do
Caso B (criação de usuário, concessão de permissão) — uma tarefa operacional, não
uma investigação de causa.

**Correção:** nova seção "Ações operacionais/administrativas já comunicadas no
histórico", inserida após a seção de diagnóstico técnico existente (que foi
mantida intacta). A seção instrui a: (a) verificar se a ação já foi iniciada ou
comunicada antes de orientar executá-la do zero; (b) quando o histórico mostra a
ação apenas instruída/em andamento (sem confirmação explícita de conclusão — este é
o estado real do #036636, não "já confirmado" como a formulação inicial do briefing
sugeria, ver auditoria §3.1), reconhecer o que já foi comunicado e pedir
confirmação pontual do que falta, em vez de reemitir a instrução completa; (c)
quando há confirmação explícita de conclusão, tratar como fato dado e orientar a
etapa seguinte; (d) nunca reproduzir de volta dados sensíveis (senha, CPF, token)
mesmo ao referenciar que foram informados.

**Por que esta forma e não outra:** optei por não reescrever a seção existente
("Diagnóstico humano já fechado") para forçá-la a cobrir os dois casos, porque os
vocabulários são genuinamente diferentes (causa/hipótese/evidência vs.
ação/execução/confirmação) — misturar os dois numa única seção arriscava diluir a
instrução já validada de diagnóstico técnico. Uma seção nova e específica é mais
fácil de testar/validar isoladamente e de remover/ajustar depois sem afetar a
seção original.

**Validação:** `estabilizacao-casos-reais-2026-10.test.js:testarCasoB_...` verifica
por asserção textual que a seção existe no `SYSTEM_PROMPT` ativo (propriedade
estática do prompt, não depende de chamada de LLM real).

---

## 5. Erro de infraestrutura não contamina o histórico como resposta da IA

**Problema confirmado (auditoria §1.a):** quando todos os providers de IA falham
(ex. erro de certificado TLS observado na única execução real do #035988), a
mensagem de erro é persistida com `papel: 'assistant'` (decisão correta de UX — o
analista precisa ver que algo falhou). O problema é que, ao montar o histórico para
o próximo turno, `context-engine.js:_formatarMensagem` rotulava qualquer
`papel === 'assistant'` como "IA anterior", sem distinguir uma tentativa real de
diagnóstico de uma falha técnica sem conteúdo analítico.

**Correção:**
- `mensagem-repository.js` já suportava um campo `diagnostico` (objeto serializado
  em `diagnostico_json`, com precedente de metadado interno
  `__avisosFonteCorrigido`) — nenhuma migration nova foi necessária.
- `investigacao-service.js`: as 3 chamadas a `mensagemRepo.salvarMensagem` que
  registram mensagens de erro (erro de provider, erro de imagem/anexo visual, erro
  de PDF visual) passam agora `diagnostico: { erroInfraestrutura: true }`.
- `context-engine.js:_formatarMensagem`: quando `m.papel === 'assistant' &&
  m.diagnostico?.erroInfraestrutura`, o rótulo passa a ser
  `[Sistema | ... | falha tecnica de infraestrutura, NAO foi uma tentativa de
  diagnostico]` em vez de `[IA anterior | ...]`.

**Por que esta forma e não outra:** considerei usar o campo `origem_sistema`
(já existente na tabela), mas ele já tem semântica estabelecida de "proveniência de
importação de dado histórico" (`'softexpert'`) em outros 6 arquivos do código-base
— reutilizá-lo para "natureza/qualidade do conteúdo da mensagem" misturaria dois
conceitos ortogonais. O campo `diagnostico` é mais apropriado porque semanticamente
já serve para metadado interno sobre a mensagem do assistente, não sobre sua
proveniência externa.

**Risco avaliado e aceito:** esta correção não altera o score de relevância dessa
mensagem no Context Engine (`_scoreTexto(...) + (papel === 'assistant' ? 2 : 4)`)
— uma mensagem de erro de infraestrutura ainda pode ser selecionada/omitida pelo
mesmo critério de qualquer outra mensagem de baixa relevância textual. Avaliei
alterar o score também, mas isso teria efeito sobre a seleção/orçamento de tokens
de forma não diretamente relacionada ao problema relatado (rótulo incorreto) — manter
o score como está reduz a superfície de mudança ao estritamente necessário.

**Validação:**
`estabilizacao-casos-reais-2026-10.test.js:testarAdversarial_ErroDeInfraestruturaNaoContaminaHistorico`
confirma que o prompt final não contém `[IA anterior` para essa mensagem e contém o
novo rótulo explícito.

---

## 6. Quality Gate — novo guard de repetição textual sem depender de item de dossiê

**Problema confirmado, o mais estrutural dos encontrados (auditoria §2.2.a):** a
checagem de regressão existente (`_avaliarRegressaoInvestigativa`) só reconhece
"hipótese já descartada" ou "teste já executado" comparando a resposta atual contra
`manifesto.dossie.regressaoGuard`, que só é populado a partir de **itens
estruturados do dossiê com `codigo`** (`investigacao_itens`). Quando não há item de
dossiê — primeiro turno de um atendimento, execução anterior que falhou antes de
estruturar a hipótese, ou LLM que nunca chegou a transformar a hipótese em item —
não existe absolutamente nenhuma memória contra a qual comparar, e uma resposta que
repete a mesma hipótese em linguagem natural (mesmo parafraseada) passa pelo gate
sem nenhuma checagem.

**Correção:** nova função `_avaliarRepeticaoDeRespostaAnterior`, que:
1. Recebe o histórico de mensagens (`historicoMensagens`, novo parâmetro opcional
   de `avaliarResposta`) e filtra respostas `assistant` reais (excluindo as
   marcadas com `diagnostico.erroInfraestrutura`, correção #5 acima) com mais de
   150 caracteres.
2. Calcula similaridade por **shingles de 3 palavras** (sequências de 3 palavras
   normalizadas) entre a resposta atual e cada resposta anterior — tolerante a
   paráfrase (troca de sinônimos, reordenação parcial), ao contrário de uma
   comparação de igualdade exata ou de shingles muito longos.
3. Se a similaridade for ≥ 50% E a resposta atual não contiver nenhum marcador de
   justificativa de evidência nova (`_temJustificativa`, função já existente e
   usada pelas 4 checagens de regressão anteriores — "porque", "nova evidencia",
   "novo log", "mudou", etc.), sinaliza `REGRESSAO_INVESTIGATIVA_RESPOSTA_REPETIDA`
   (severidade `media`, mesmo padrão das 4 checagens de regressão já existentes).

**Por que este método e não outro:** considerei (a) comparar against embeddings
semânticos — rejeitado por adicionar uma chamada de IA nova, explicitamente
proibido pelo escopo ("não criar chamadas adicionais de IA indiscriminadamente");
(b) comparar por overlap de palavras-chave simples (bag-of-words) — rejeitado
porque geraria falso positivo alto em qualquer par de respostas sobre o mesmo
domínio técnico (duas respostas diferentes sobre o mesmo chamado Protheus
compartilham naturalmente muitos termos). Shingles de 3 palavras com limiar 50%
foi calibrado empiricamente: testei com uma paráfrase real (reescrita manual da
hipótese do Caso A trocando conectores e verbos, preservando o conteúdo) — produziu
59% de similaridade; testei com uma resposta genuinamente nova sobre o mesmo
domínio (menciona rotina/campo diferente) — produziu similaridade baixa o
suficiente para não disparar.

**Guarda-corpo contra falso positivo (cenário adversarial exigido pelo briefing):**
o piso de 150 caracteres nos dois lados evita disparo em respostas curtas e
genéricas ("pode enviar o log?"), e a checagem de `_temJustificativa` garante que
uma resposta que de fato avança a investigação com evidência nova — mesmo que
reafirme/confirme uma hipótese anterior — não é bloqueada. Isso cobre
explicitamente o requisito do briefing de "evitar bloqueios indevidos... incluindo
situações em que uma ação realmente precisa ser refeita por falha comprovada" (o
termo "refeita" nesse guard equivale a "reafirmada com evidência nova").

**Validação:** `estabilizacao-casos-reais-2026-10.test.js:testarCasoA_...` cobre os
3 sub-cenários: (1) dossiê vazio → checagem antiga não pega nada (confirma o gap
original); (2) resposta parafraseada sem evidência nova → novo guard pega; (3)
resposta com evidência nova explícita → novo guard NÃO bloqueia.

**Severidade mantida em `media` (não `alta`):** mesma classificação das 4
checagens de regressão já existentes — dispara retry automático (1 tentativa,
comportamento já existente do Quality Gate), não bloqueia a resposta
definitivamente.

---

## 7. Correção de bug — `ReferenceError: chamado is not defined`

Durante a integração das correções #2/#3, a suíte completa de testes
(`etapa-v1-paralelismo-atendimentos.test.js`) expôs um bug real introduzido pela
própria correção: a variável `chamado` era declarada com `const` **dentro** do
bloco `try` de pesquisa técnica (`investigacao-service.js`, escopo de bloco) e eu
a referenciei fora desse bloco (nas chamadas a `montarContextoInvestigacao`). Em
qualquer cenário onde o bloco de pesquisa cai no `catch` (erro de provider de
pesquisa, timeout, etc. — exatamente o que esse teste de paralelismo simula), a
variável nunca é declarada no escopo externo, e a chamada subsequente lança
`ReferenceError`, quebrando o turno inteiro.

**Correção:** `chamado` passou a ser declarado com `let chamado = null;` no escopo
externo (junto das outras variáveis de resultado do bloco de pesquisa:
`pesquisaTecnicaTexto`, `relacionados`, `dossieOperacionalTurno`), e atribuído
dentro do `try` sem `const`.

Esse bug nunca teria sido pego sem rodar a suíte completa de regressão —
reforça a decisão de rodar as Fases 1/2/3 por completo após qualquer alteração no
orquestrador principal, mesmo para mudanças que pareçam estritamente aditivas.

---

## Riscos residuais (não corrigidos nesta rodada, documentados por decisão explícita de escopo)

1. **Correspondência produto/módulo/operação de fonte externa (auditoria §2.2.b):**
   o ranking de `technical-research-service.js:_scoreResultado` continua sem
   verificar se uma página oficial corresponde ao módulo/operação específicos do
   chamado — só pontua por domínio oficial + termos genéricos. Não implementei
   correção aqui porque qualquer heurística determinística testada (ex. exigir
   termo de módulo específico no título/trecho) teria alto risco de rejeitar
   páginas genuinamente relevantes que usam vocabulário levemente diferente do
   chamado (ex. "devolução de mercadoria" vs. "devolução de compra") — isso
   precisaria de validação com mais exemplos reais antes de arriscar falso
   negativo (deixar de usar uma fonte boa) em produção. Fica como candidato a
   trabalho futuro com mais dados.
2. **Causalidade cruzada entre dois problemas no mesmo atendimento (auditoria
   §4.2.c):** nenhuma regra determinística nova foi adicionada para detectar
   "recomendação financeira sem relação demonstrada com o problema de status"
   (padrão do Caso C). O teste de regressão
   (`testarCasoC_PendenciaExternaEDistincaoDeSintomas`, terceiro bloco) documenta
   esse gap como baseline intencional — qualquer implementação futura deve
   atualizar esse teste, não apenas adicioná-lo silenciosamente. Motivo de não
   implementar agora: distinguir "correlação textual" (dois termos técnicos no
   mesmo parágrafo) de "causalidade inventada" por regex é propenso a falso
   positivo alto (bloquear uma resposta que de fato correlaciona corretamente
   dois sintomas da mesma causa) — o risco de um guard mal calibrado aqui é maior
   que o benefício sem mais exemplos reais para calibrar.
3. **Alucinação de nome de fonte/rotina inexistente (auditoria §2.3, hipótese não
   verificável):** nenhum mecanismo determinístico verifica se um nome de
   rotina/fonte ADVPL citado pela resposta existe de fato nos anexos/pesquisa
   selecionados. Isso exigiria extrair todos os identificadores técnicos
   (nomes de função, rotina) de cada evidência selecionada e comparar contra o
   texto da resposta — viável, mas não implementado nesta rodada por não haver
   evidência confirmada (apenas hipótese) de que isso ocorreu nos 3 casos reais.
4. **Score de relevância de mensagem de erro de infraestrutura:** mantido
   inalterado (ver justificativa na seção 5), pode continuar sendo selecionada
   pelo Context Engine mesmo marcada como erro — apenas não é mais mal rotulada.

## Impacto no consumo de tokens e chamadas externas

- Nenhuma correção acima adiciona chamada de IA nova. O guard de repetição (#6) é
  puro cálculo de string (shingles), sem custo de tokens.
- A linha de pendência externa (#2) e a nova seção do system prompt (#4) aumentam
  marginalmente o tamanho do prompt quando aplicáveis — poucas linhas de texto,
  desprezível frente ao orçamento de tokens já gerenciado por `token-budget-service.js`.
- A mudança em `redaction-service.js` (#1) não afeta tamanho de forma relevante
  (substituição de mesmo comprimento aproximado: CPF formatado → `[REDACTED:CPF]`).
