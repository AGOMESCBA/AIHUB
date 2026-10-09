# IA Service — Auditoria de Estabilização do Motor Investigativo em Produção

Data: 2026-10-08
Escopo: Casos A (#035988 COABRA), B (#036636 Novapec), C (#036475 FUNDAÇÃO MT)

## 0. Limitação metodológica (leia antes do restante)

O banco local (`apps/IA Service/data/ia-service.db`) é o único banco disponível nesta
investigação. Ele contém o histórico real importado do SoftExpert para os 3
atendimentos, mas **não contém nenhuma execução de IA bem-sucedida** para eles:

| Chamado | Execuções de IA registradas | Dossiê registrado |
|---|---|---|
| #035988 COABRA | 1, status `erro_provider` (ver §1) | 1, vazio (sem itens) |
| #036636 Novapec | 0 | 0 |
| #036475 FUNDAÇÃO MT | 0 | 0 |

Ou seja: **não existe, neste ambiente, um registro da resposta real e problemática
que o usuário observou em produção** para nenhum dos 3 casos. As respostas descritas
no briefing foram vistas em outro ambiente (produção real hospedada), ao qual esta
investigação não teve acesso.

Em vez de inventar uma reprodução especulativa, esta auditoria:
1. Documenta o único dado objetivo e verificável que o banco local contém (um erro de
   infraestrutura real, não relacionado ao conteúdo dos 3 casos — ver §1).
2. Reproduz o comportamento **atual e real** do motor rodando o Context Engine e o
   Dossiê reais (código de produção, sem mock) contra o histórico genuíno dos 3
   atendimentos, para inspecionar exatamente o prompt e o manifesto que o motor
   produziria hoje se fosse executado.
3. A partir dessa reprodução, identifica gaps estruturais do código que **são
   capazes de produzir** os comportamentos descritos no briefing — e os classifica
   como causa-raiz **confirmada por leitura de código** (não apenas hipótese), já
   que a lógica é determinística e foi lida linha a linha, mesmo sem uma chamada de
   LLM real para fechar o ciclo ponta a ponta.

Qualquer afirmação abaixo que dependa de como um LLM teria respondido (e não da
lógica determinística do código) está marcada explicitamente como **hipótese**, não
como fato confirmado.

---

## 1. Achado de infraestrutura (não é causa-raiz dos 3 casos, mas é crítico)

**Confirmado.** A única execução de IA registrada no banco para os 3 casos (#035988,
`investigacao_execucoes.id = d71ba5f6-...`, 2026-10-07 12:58) falhou nos 5 providers
configurados (groq/openai/claude/deepseek/gemini) com o mesmo erro:

```
unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca
```

Causa: a máquina usa o Avast Antivirus com interceptação TLS, que injeta seu próprio
certificado root via `NODE_EXTRA_CA_CERTS` (`C:\ProgramData\Avast Software\Avast\wscert.pem`).
No momento dessa execução, a cadeia de certificado não foi validada com sucesso pelo
runtime Node do processo. Reconectei manualmente após a investigação e a mesma
chamada HTTPS funcionou normalmente — o problema parece transitório/de ambiente, não
um bug permanente.

**Dois efeitos colaterais reais, independentes da causa raiz do erro:**

- **(a) Mensagem de erro de infraestrutura entra no histórico como se fosse conteúdo
  de domínio.** A mensagem "Não foi possível concluir a análise... unable to verify
  the first certificate..." foi persistida com `papel: 'assistant'` em
  `mensagens`, e por isso é formatada por `context-engine.js:_formatarMensagem` como
  **"[IA anterior | ...]"** e injetada no próximo prompt como se fosse uma tentativa de
  diagnóstico legítima. Confirmado na reprodução real do Caso A (§4.1): o prompt que
  o motor montaria hoje para o próximo turno do #035988 inclui literalmente esse
  texto de erro de certificado rotulado como resposta anterior da IA. Isso não causa
  o comportamento específico descrito no Caso A (repetir hipótese, inventar fonte),
  mas é ruído real que pode confundir decisões de "o que já foi tentado".
- **(b) Esse erro específico (certificado/CA) não aciona nenhum fallback
  degradado "amigável"** — o `ai-provider-client.js` tentou os 5 providers em
  sequência e todos falharam pelo mesmo motivo (é um problema de ambiente, não de
  provider individual), então o usuário viu a mensagem de erro bruta concatenada dos
  5 erros. Não há correção de código recomendada aqui (o comportamento de "tentar
  todos e reportar todos os erros" é razoável); registro como achado de operação, não
  como bug a corrigir no motor investigativo.

Não houve nenhuma correção de `rejectUnauthorized`/bypass de TLS considerada — o
código do `ai-provider-client.js` já mantém a validação de certificado padrão
deliberadamente (comentário do próprio arquivo, linha 9-11, contrastando com um bug
equivalente já corrigido no IA Command). Enfraquecer essa validação seria regressão
de segurança e está fora do escopo autorizado.

---

## 2. Caso A — #035988 COABRA — Saldo de contratos agrícolas

### 2.1 O que o histórico real contém

Resumo cronológico (textos completos em `tmp/auditoria/035988.json`, não comitado):
cliente pede regra de saldo de contrato agrícola (03/08) → analista pede abertura de
fábrica (mesmo dia) → "kanban vai ser aberto, retornamos com os fontes" (05/08) →
pedido de alinhamento com Dev para teste (14/08) → **cliente relata, por conta
própria, um sintoma adicional**: devoluções de compra sempre pedem inclusão manual
de saldo, porque "uma devolução volta o saldo e não diminui como as notas de
entrada" (20/08) → pedido de reunião de teste, troca de contato (20/08) → "aguardando
confirmação do teste já solicitado" (06/10) → erro de infraestrutura (07/10, ver §1).

**Fato confirmado por leitura direta do histórico**: a frase "uma devolução volta o
saldo e não diminui como as notas de entrada" é uma **observação do próprio cliente**
(`Andre Luiz A.Correa`, papel `customer`), não uma hipótese ou conclusão da IA. Não
há, em nenhum ponto do histórico real, uma mensagem da IA afirmando essa regra como
fato confirmado — porque a IA nunca respondeu de fato (§1).

### 2.2 Causa-raiz estrutural identificada (código, não execução observada)

Como a única execução real falhou antes de gerar texto, **não há evidência direta
de que o motor tenha, de fato, repetido a hipótese ou inventado uma referência
TOTVS neste atendimento específico**. O que a auditoria confirma, por leitura de
código, é que a arquitetura atual **tem três gaps estruturais que tornam esse
comportamento possível e provável** em qualquer atendimento com características
semelhantes (pergunta de regra de negócio, zero itens estruturados no dossiê,
histórico com observação não confirmada do cliente):

**(2.2.a) — CONFIRMADO: a checagem de regressão do Quality Gate não tem como pegar
repetição de hipótese quando não há item de dossiê com código.**
`quality-gate-service.js:_avaliarRegressaoInvestigativa` (linhas 113-174) só
consegue detectar "hipótese já descartada repetida" ou "teste já executado repetido"
comparando o texto da resposta contra `guard.hipotesesDescartadas`/`testesExecutados`,
que vêm de `manifesto.dossie.regressaoGuard` — por sua vez populado em
`dossie-context-service.js:montarMemoriaOperacional` (linhas 190-197) a partir de
**itens estruturados do dossiê** (`investigacao_itens` com `tipo='HIPOTESE'`,
`status='DESCARTADA'`, etc.).

Confirmado na reprodução real (§4.1): o dossiê do #035988 existe (foi criado
automaticamente por `investigacao-service.js:_garantirDossieSeguro` na única
tentativa de execução) mas está **vazio — zero itens** (`investigacao_itens` para
esse atendimento: 0 linhas). Isso significa que, mesmo que uma IA real tivesse
respondido e levantado a hipótese "devolução deveria subtrair do saldo" como
hipótese nessa primeira resposta falha, **essa hipótese nunca foi persistida como
item do dossiê** (porque a execução falhou antes de chegar ao
`investigacao-dossie-atualizador-service`, que só roda após uma resposta bem-sucedida
do LLM principal). Então, na *próxima* tentativa de investigação, o motor não tem
absolutamente nenhum registro estruturado de que essa hipótese já foi levantada — só
o texto cru do histórico de mensagens (que também não contém a hipótese, porque ela
nunca foi de fato gerada e persistida).

**Isto é o mecanismo estrutural real do "repetiu a mesma hipótese"**: não é que o
motor "lembra errado" — é que, sem um item de dossiê persistido com código
rastreável, não existe absolutamente nenhuma memória estruturada de hipóteses já
levantadas em respostas anteriores. A única memória é o texto livre do histórico, e
o quality gate **só sabe comparar contra itens com `codigo`** (ex. "H02"), nunca
contra texto livre de uma resposta anterior da IA. Uma IA que gera a mesma hipótese
em linguagem natural duas vezes, sem nunca ter essa hipótese virando item do dossiê
entre as duas respostas, passa pelo quality gate sem nenhuma checagem de repetição.

**(2.2.b) — CONFIRMADO: nenhuma validação verifica se uma referência técnica citada
(ex. "documentação TOTVS sobre devolução de venda") de fato corresponde à operação
do chamado.** Mapeado em `technical-research-service.js`: o ranking de resultados de
pesquisa (`_scoreResultado`, linha 937) pontua por domínio oficial + termos
genéricos batendo (produto, palavras do texto), mas **não verifica módulo/operação**.
Um artigo oficial do TDN sobre "devolução de venda" pontuaria alto só por ser
`tdn.totvs.com` e conter os termos "devolução"/"saldo"/"contrato" — nada no código
impede ele de ser citado como evidência para um caso de **devolução de compra**
customizada (módulo e operação diferentes). Esse é exatamente o padrão de erro
descrito no Caso A ("referência TOTVS sobre devolução de venda sem demonstrar
aplicabilidade a uma customização agrícola de devolução de compras").

**(2.2.c) — CONFIRMADO: o Quality Gate não verifica se a resposta distingue
hipótese de fato quando a afirmação de causalidade usa linguagem hedgeada.**
`quality-gate-service.js:CERTAINTY_WITHOUT_EVIDENCE` (linha 238) só dispara com
padrão lexical de certeza explícita ("causa confirmada", "com certeza"). Uma resposta
do tipo "a regra provavelmente é que devolução deveria subtrair, não somar" passa
ilesa — é sintaticamente uma hipótese, mas nunca foi de fato testada/confirmada pelo
cliente, e nada no gate verifica se uma "hipótese" apresentada tecnicamente como tal
foi de fato **recém-gerada** ou é uma **repetição não identificada** da mesma
hipótese de uma resposta anterior perdida (por conta do gap em 2.2.a).

### 2.3 Classificação

- Causa confirmada por código: **(2.2.a)** gap de memória de hipótese sem item de
  dossiê persistido quando a execução anterior falha ou quando o LLM não estrutura a
  hipótese como item rastreável.
- Causa confirmada por código: **(2.2.b)** ausência de verificação de
  correspondência produto/módulo/operação antes de citar fonte externa como
  evidência.
- Hipótese (não observável neste ambiente): se a resposta real do usuário em
  produção de fato inventou o **nome** de uma fonte ADVPL (não apenas citou uma URL
  real fora de contexto), isso é alucinação de conteúdo do LLM em si — nenhum
  mecanismo determinístico do pipeline hoje verifica se um nome de fonte/rotina
  citado existe de fato nos anexos/pesquisa selecionados. Ver correção 3.3 proposta.

---

## 3. Caso B — #036636 Novapec — Criação de usuário

### 3.1 O que o histórico real contém

Texto completo em `tmp/auditoria/036636.json` (não comitado — contém CPF e senha
reais, ver §5). Cronologia real: abertura pede criação de usuário "igual ao Ageu"
(29/09) → chamado transferido para analista especializado (29/09) → analista pergunta
se é Protheus ou portal, pede CPF (29/09) → **outro analista informa usuário e senha
provisória, com instrução de troca no primeiro login** (30/09) → CPF é enviado
(30/09) → **"Favor criar o usuário no Protheus copiando os mesmos acessos do Ageu
que já deve existir o login. Dúvida falar com Edson."** (30/09, última mensagem).

**Fato confirmado por leitura direta do histórico**: diferente da премissa do
briefing, **a última mensagem real do histórico não confirma que a criação foi
concluída** — é uma instrução ("favor criar"), não uma confirmação de execução
("usuário criado"). O usuário/senha informados em 30/09 foram comunicados **antes**
da instrução final de cópia de acessos, na mesma janela de tempo, pelo mesmo grupo de
analistas, mas isso é compatível tanto com "a senha foi definida e agora falta
replicar os acessos específicos do Ageu" quanto com "já está tudo pronto e só falta
confirmar". **O histórico real deste atendimento específico é ambíguo sobre a
conclusão — não resolve essa ambiguidade a favor de nenhuma leitura.**

Isso muda a formulação do problema: o risco real não é necessariamente "a IA ignora
uma confirmação explícita de conclusão" (ela não existe neste texto) — é "a IA não
tem nenhum mecanismo para **marcar e perguntar** sobre o status real de uma ação
operacional (criação de usuário) que está em um estado intermediário/ambíguo no
histórico", e por isso tende a tratar o pedido original como ainda 100% aberto,
reemitindo a instrução completa do zero.

### 3.2 Causa-raiz estrutural identificada

**(3.2.a) — CONFIRMADO: o Context Engine não tem nenhuma noção estrutural de
"ação operacional com status" fora do mecanismo de dossiê, e o dossiê está vazio
(nunca houve execução para este atendimento).** `dossie-context-service.js:96-102`:
sem dossiê, retorna `status: 'SEM_DOSSIE'`, texto vazio. Isso significa que, hoje, o
reconhecimento de "usuário/senha já foram informados, falta só confirmar
permissões/replicação de acesso" depende **inteiramente** da capacidade do LLM de
ler o texto cru do histórico (rotulado por `_formatarMensagem` como "Analista" para
todos os 4 analistas envolvidos, sem nenhuma distinção estrutural de papel
operacional — "quem criou", "quem aprovou", "quem só está acompanhando").

**(3.2.b) — CONFIRMADO: o `SYSTEM_PROMPT` (`prompt-builder.js:37-44`, seção
"Diagnóstico humano já fechado no histórico") cobre apenas *conclusões de
diagnóstico técnico* ("causa identificada", "chamado aberto na TOTVS"), não
*ações operacionais concluídas ou em andamento* como criação de usuário,
redefinição de senha, concessão de permissão.** A instrução não menciona em nenhum
momento o padrão "ação administrativa/operacional já comunicada como feita ou em
andamento" — é escrita no vocabulário de investigação técnica (bug, causa, hipótese),
não no vocabulário de execução de tarefa administrativa (criar, conceder, ativar).
Isso é coerente com o propósito original do motor (investigação técnica), mas o
Caso B é fundamentalmente uma tarefa operacional, não uma investigação de causa — e
o motor hoje não distingue os dois modos.

**(3.2.c) — CONFIRMADO, achado de proteção de dados**: na reprodução real (§4.2), o
prompt que seria enviado ao LLM e a qualquer provider externo (Groq/OpenAI/
Claude/DeepSeek/Gemini) **contém o CPF do solicitante em texto claro**
(formato `CPF XXX.XXX.XXX-XX`, valor real omitido deste documento por precaução),
enquanto a senha informada é corretamente mascarada
(`senha: [REDACTED]`). Verificado em `redaction-service.js`: há regex para
`token|senha|password|secret|session|sid` mas **nenhum padrão de CPF/CNPJ**. O único
lugar do código-base que mascara CPF/CNPJ é
`technical-research-service.js:sanitizarConsultaExterna` (linha 828), e essa máscara
se aplica **apenas à string da query de busca externa**, nunca ao prompt enviado ao
LLM principal nem ao texto persistido/exibido ao analista. Este é o achado de maior
severidade desta auditoria — câmera de dados pessoais sendo enviada a provedores de
IA externos sem necessidade, e exatamente o tipo de vazamento que o briefing pede
para evitar ("Não enviar credenciais para mecanismos externos de pesquisa" — aqui o
problema é mais amplo: nem precisa ser pesquisa, é o próprio prompt principal).

### 3.3 Classificação

- Causa confirmada por código: **(3.2.a)** ausência de reconhecimento estrutural de
  ação operacional com status (distinto de diagnóstico técnico).
- Causa confirmada por código: **(3.2.b)** instrução de "diagnóstico já fechado" no
  system prompt não cobre o vocabulário de ações operacionais/administrativas.
- Causa confirmada por código, **severidade alta, risco de exposição de dado
  pessoal real em produção**: **(3.2.c)** CPF não é redigido em nenhum estágio do
  pipeline antes de ir para o LLM.
- Hipótese sobre o comportamento observado em produção (não verificável neste
  ambiente): se a resposta real recomendou "criar o usuário" do zero, isso é
  consistente com (3.2.a)+(3.2.b) — o motor não tinha, nem tem hoje, um sinal
  estrutural para tratar a ação como "em andamento/possivelmente concluída".

---

## 4. Caso C — #036475 FUNDAÇÃO MT — Aprovação de pedido de compra

### 4.1 O que o histórico real contém

Texto completo em `tmp/auditoria/036475.json`. Cronologia real: cliente relata que
pedido de compra aprovado via workflow continua com status "em aprovação" no
cadastro, mesmo após aprovação confirmada na tela de aprovações (15/09) → pedido de
abertura de fábrica (16/09, dois analistas) → **mensagem única de 18/09 (João
Damaceno) que mistura três informações**: (1) diagnóstico de que o problema é uma
"rotina padrão do Protheus" relacionada ao **envio automático de e-mail** de
aprovação (não ao status em si), (2) uma solução de contorno (reenvio manual de
e-mail via "Outras Ações"), (3) pedido para abrir chamado à TOTVS sobre a falha de
e-mail → mensagem seguinte, mesmo dia, da Maria Eduarda: "o chamado **de cotação de
compras** foi encaminhado para a TOTVS... ticket: 30475983" (nota: o texto real diz
"cotação de compras", não "pedido de compras" — possível erro de digitação do
analista humano original, não do motor).

Há 3 anexos de imagem (screenshots de WhatsApp, sem OCR/texto extraído, sem citação
pelo nome em nenhuma mensagem) associados a este atendimento.

**Fato confirmado por leitura direta do histórico**: o texto original já mistura, em
um único posicionamento humano, o problema original (status não muda) com um sintoma
relacionado mas distinto (e-mail de aprovação não é enviado automaticamente) e com um
encaminhamento externo (ticket TOTVS). O histórico **não confirma textualmente** se o
problema original (status) foi de fato causado pela mesma rotina do e-mail, ou se são
dois problemas correlacionados no mesmo fluxo mas não necessariamente a mesma causa —
essa é uma lacuna real do caso, não uma invenção do motor.

### 4.2 Causa-raiz estrutural identificada

**(4.2.a) — CONFIRMADO: o Context Engine injeta o posicionamento de 18/09 como um
único bloco de texto, sem nenhuma estrutura que force a separação entre "problema
original", "sintoma relacionado" e "encaminhamento/pendência externa".**
Confirmado na reprodução real (§4.3 abaixo): o prompt montado hoje para este
atendimento contém o texto corrido do posicionamento de João Damaceno exatamente como
está no SoftExpert, sem nenhuma anotação ou destaque estrutural diferenciando as três
informações. A única defesa é a instrução textual genérica do system prompt
("trate conclusão humana como fato dado... não reabra sem evidência nova"), que foi
escrita para o padrão "causa confirmada + resolvida", não para o padrão "causa
investigada só parcialmente + 2 sintomas distintos + encaminhamento pendente de
retorno externo". Não há, em código determinístico algum do pipeline, uma etapa que
separe "isso é o problema que o cliente relatou originalmente" de "isso é um sintoma
que apareceu depois" — essa distinção, hoje, depende inteiramente da leitura do LLM.

**(4.2.b) — CONFIRMADO: não há nenhum mecanismo que marque "ticket TOTVS aberto,
aguardando retorno externo" como um tipo de pendência reconhecível
estruturalmente.** O dossiê (`STATUS_DOSSIE` em `investigacao-dossie-service.js`)
tem estados como `AGUARDANDO_TESTE`/`AGUARDANDO_VALIDACAO`, mas nenhum estado
`AGUARDANDO_RETORNO_FORNECEDOR`/`AGUARDANDO_TOTVS`. Isso é coerente com um achado já
documentado no próprio código-base (migration v39,
`backend/database/migrations.js`): a view consolidada `ITSM_CHAMADOS.AGUARDANDO` já
sinaliza exatamente esse estado ("RETORNO - FORNECEDOR") para este mesmo chamado
#036475, e esse campo (`chamados.aguardando_consolidado`) **existe no banco desde
a migration v39, mas não é injetado em nenhum lugar no prompt do Context Engine nem
no dossiê** — é usado hoje apenas pela fila do Radar (UI de triagem), não pelo motor
investigativo. Isso é um gap de integração real e de baixo custo para corrigir: o
dado que resolveria a ambiguidade "isso está pendente de terceiro, não do
analista" já existe na base, mas não chega ao LLM.

**(4.2.c) — CONFIRMADO: nenhuma validação do Quality Gate verifica se uma
recomendação financeira/de outra natureza é justificada por uma cadeia causal
explícita ligada ao problema original.** Mapeado em §5 do relatório de arquitetura:
`CERTAINTY_WITHOUT_EVIDENCE` e `UNSUPPORTED_FACT_OR_DIAGNOSIS` cobrem "afirmação sem
evidência" em geral, mas nenhuma regra verifica especificamente **causalidade
cruzada entre dois problemas relatados no mesmo atendimento** (ex.: usar a stack de
chamada de uma rotina de e-mail como evidência para recomendar ajuste em
contabilização financeira, sem demonstrar que as duas rotinas são a mesma ou têm
relação direta). Esse é exatamente o padrão "transformar correlação em causalidade"
citado no Caso C.

### 4.3 Reprodução real do prompt (confirmado, não hipotético)

Rodando `context-engine.js:montarContextoInvestigacao` com os dados reais deste
atendimento (sem chamada de LLM), o prompt resultante hoje:
- Inclui o texto corrido do posicionamento de 18/09 sem qualquer separação
  estrutural entre problema original / sintoma / encaminhamento.
- **Descarta corretamente** os 3 anexos de imagem por "baixa relevância" (nenhum é
  citado por nome na pergunta simulada, e nenhum tem OCR) — este é comportamento
  correto e esperado, não um defeito; não há indício de que o motor estaria usando
  esses anexos sem relação demonstrada neste caso específico.
- Não menciona em nenhum lugar o campo `aguardando_consolidado`/ticket TOTVS como
  "pendência estruturada" — aparece apenas como texto corrido dentro do
  posicionamento histórico, com o mesmo peso visual de qualquer outra frase.

### 4.4 Classificação

- Causa confirmada por código: **(4.2.a)** ausência de separação estrutural entre
  problema original / sintoma / encaminhamento dentro de um único posicionamento
  histórico.
- Causa confirmada por código, **de baixo custo de correção**: **(4.2.b)** o dado
  que já existe na base (`chamados.aguardando_consolidado`) não é propagado ao
  Context Engine/prompt.
- Causa confirmada por código: **(4.2.c)** Quality Gate não verifica causalidade
  cruzada entre dois problemas relatados no mesmo atendimento.
- Observação, não é causa-raiz: o texto "cotação de compras" em vez de "pedido de
  compras" na mensagem de 18/09 é uma imprecisão do analista humano original, visível
  no SoftExpert — não foi introduzida pelo motor. Qualquer resposta da IA que
  reproduza essa mesma imprecisão está apenas citando a fonte corretamente, não
  inventando.

---

## 5. Proteção de dados — achado transversal (severidade alta)

Achado confirmado nos §3.2.c, generalizável a qualquer atendimento com CPF/CNPJ no
texto: `redaction-service.js` cobre credenciais (senha/token/secret) mas **não cobre
CPF nem CNPJ** em nenhum dos pontos de aplicação (prompt principal, prompt do
atualizador de dossiê, memória operacional do dossiê). O único lugar que mascara
CPF/CNPJ hoje é a sanitização de query de pesquisa externa, que é uma superfície bem
menor e não resolve o problema do prompt principal.

Avaliação de impacto: qualquer atendimento real cujo histórico contenha CPF/CNPJ do
solicitante (comum em chamados de criação/alteração de usuário, como o próprio Caso
B) tem esse dado enviado, hoje, para os 5 providers de IA externos configurados
(Groq, OpenAI, Anthropic, DeepSeek, Google), sem necessidade operacional — a IA não
precisa do CPF para orientar a criação de um usuário Protheus.

Este achado é tratado como prioridade de correção técnica nesta auditoria (ver
`IA_SERVICE_CORRECOES_MOTOR_INVESTIGATIVO.md`), mesmo não constando explicitamente
como código já identificado no briefing original — é uma causa-raiz direta do
comportamento "reproduzir dados pessoais desnecessários" citado no Caso B.

---

## 6. Resumo de causas-raiz confirmadas vs. hipóteses

### Confirmadas por leitura de código determinístico (não dependem de uma chamada LLM real)

| # | Causa-raiz | Caso(s) afetado(s) | Arquivo |
|---|---|---|---|
| 1 | Guard de regressão do Quality Gate só reconhece repetição via código de item do dossiê; sem item estruturado, não há memória de hipótese/teste já apresentado | A (e qualquer 1º turno sem dossiê) | `quality-gate-service.js`, `dossie-context-service.js` |
| 2 | Nenhuma verificação de correspondência produto/módulo/operação antes de citar fonte externa como evidência | A | `technical-research-service.js` |
| 3 | System prompt cobre apenas "diagnóstico técnico já fechado", não "ação operacional/administrativa já comunicada ou em andamento" | B | `prompt-builder.js` |
| 4 | CPF/CNPJ não é redigido em nenhum estágio do pipeline antes de ir ao LLM (só é redigido na query de pesquisa externa) | B (generalizável) | `redaction-service.js` |
| 5 | Posicionamento histórico com múltiplas informações (problema/sintoma/encaminhamento) entra como bloco único, sem separação estrutural | C | `context-engine.js` |
| 6 | `chamados.aguardando_consolidado` (pendência de retorno de terceiro, já existente na base desde migration v39) não é propagado ao prompt do motor investigativo | C | `context-engine.js`, `dossie-context-service.js` |
| 7 | Quality Gate não verifica causalidade cruzada entre dois problemas relatados no mesmo atendimento | C | `quality-gate-service.js`, `investigative-discipline-service.js` |
| 8 | Mensagem de erro de infraestrutura (falha de todos os providers) é persistida com papel "assistant" e reaparece no histórico como se fosse uma tentativa de diagnóstico | A | `investigacao-service.js` (tratamento de erro) |

### Hipóteses não verificáveis neste ambiente (dependeriam de uma execução real de LLM)

- Se a resposta real em produção, de fato, inventou o **nome** de uma fonte ADVPL
  inexistente (alucinação de conteúdo, não apenas citação de fonte real fora de
  contexto).
- Se a resposta real recomendou ajuste financeiro no Caso C usando, de fato, uma
  stack de chamada específica sem relação demonstrada (o mecanismo que permitiria
  isso — gap #7 — está confirmado; o evento específico relatado não está, porque não
  há registro de execução).
- Qualquer avaliação de "quantas vezes" ou "com que severidade" esses comportamentos
  já ocorreram em produção fora dos 3 casos — este ambiente não tem acesso a esse
  volume de dados.

---

## 7. Dados sensíveis manuseados nesta auditoria

Os arquivos `tmp/auditoria/*.json` (dump bruto dos 3 atendimentos, incluindo CPF e
senha provisória reais do Caso B) foram gerados **apenas para esta investigação
local**, nunca comitados, e não devem ser commitados. Recomenda-se removê-los ao
final do trabalho (`tmp/` já está fora do controle de versão por convenção deste
projeto — confirmar antes de qualquer commit).
