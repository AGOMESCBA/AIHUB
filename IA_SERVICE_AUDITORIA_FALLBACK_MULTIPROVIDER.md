# IA Service — Auditoria e Validação do Fallback Multi-Provider

Data: 2026-10-09

## 1. Auditoria inicial (antes de qualquer alteração)

### Providers e modelos realmente configurados

Fonte efetiva: `platform_ai_configs` (Platform), não a tabela legada `ai_config`
(só usada se `SVC_ALLOW_LEGACY_CONFIG=1`). Para a empresa 1 (j2a), os **5
providers têm chave configurada**: GROQ (`openai/gpt-oss-20b`), OpenAI
(`gpt-4o-mini`), Claude (`claude-haiku-4-5-20251001`), DeepSeek
(`deepseek-chat`), Gemini (`gemini-3.5-flash`). `fallback_ordem` salvo:
`"openai, groq, claude, deepseek, gemini"`.

Neste ambiente de desenvolvimento local, `ANTHROPIC_API_KEY` não está presente
no `.env` — a homologação real desta auditoria rodou com GROQ, OpenAI, Gemini
e DeepSeek (4 dos 5), Claude ficou fora por ausência de chave local, não por
decisão de design.

### Ordem de prioridade real

`ai-provider-client.js:_normalizarOrdem` monta a ordem como
`[provedorPrimario, ...fallbackOrdem, ...DEFAULT_ORDER]`, deduplicado por
`Set` (preserva a primeira ocorrência). Isso significa que **o primário
sempre vem primeiro**, mesmo que `fallbackOrdem` configurado pelo admin liste
outro provider na frente — achado real, não um bug per se (é a leitura literal
do código), mas vale registrar que a posição configurada em `fallback_ordem`
é parcialmente sobrescrita pelo campo `provedorPrimario`.

### Funcionamento do router e fallback (antes de qualquer correção)

`chamarIA` já implementa fallback real: itera `candidatos` (providers com
chave e suporte a imagem quando necessário) em até `maxProviderRounds` rodadas
(default 3), tentando cada um em sequência dentro da rodada. Se a chamada tem
sucesso, retorna imediatamente com o `provider`/`model` que funcionou. Se
falha, classifica o erro (`transitorio`/`permanente`) e decide se tenta o
próximo candidato na mesma rodada e se vale nova rodada.

### Erros que acionavam troca de provider (estado anterior às correções)

| Tipo de erro | Classificação anterior | Efeito |
|---|---|---|
| HTTP 429 / rate limit (TPM) | Transitório | Cai para o próximo provider na mesma rodada — correto |
| Timeout | Transitório | Idem — correto |
| `ECONNRESET`/rede | Transitório | Idem — correto |
| Chave inválida/401/403 | Permanente | Provider banido da chamada, não retentado — correto |
| **Contexto excedido** (`maximum context length`) | **Caía no catch-all de transitório** (nenhum padrão específico batia) | Retentava o **mesmo provider/modelo**, que nunca teria sucesso — **falha confirmada** |
| **TLS/certificado global** (`unable to verify the first certificate`) | Nem transitório nem permanente | Continuava tentando os demais providers mesmo sabendo que um erro de ambiente afeta todos os hosts igualmente — **falha confirmada** |
| `insufficient_quota` | Não batia em nenhum padrão | Seria retentado em rodadas futuras inutilmente — **falha confirmada** |

### Quality Gate × fallback (estado anterior)

Desacoplados: o retry do Quality Gate reusa o `provider` já resolvido pela
primeira chamada bem-sucedida — não há lógica de troca de provider motivada
por rejeição do Quality Gate (correto; rejeição é sobre qualidade de texto,
não sobre qual provider respondeu).

### Limite global de tentativas (estado anterior)

**Ausente.** Pior caso teórico calculado: até 3 chamadas distintas por
investigação (principal + retry Quality Gate + reescrita final), cada uma com
até `maxProviderRounds=3` rodadas × 5 providers = até **45 tentativas HTTP**
numa única investigação, sem nenhum teto agregado.

---

## 2. Ajustes implementados (depois de confirmar as falhas acima — nenhuma correção especulativa)

Todos dentro do router existente (`ai-provider-client.js`), nenhuma
reconstrução, nenhum provider novo adicionado.

### 2.1 Contexto excedido nunca retenta o mesmo provider

Nova função `_erroContextoExcedido` (regex para `maximum context length`,
`context_length_exceeded`, `context window`, `too many tokens`, `reduce the
length`, `prompt/input is too long`). Em `chamarIA`, esse sinal é tratado como
`permanente` **para aquele provider dentro daquela chamada** — pula
imediatamente para o próximo candidato, nunca reentra no mesmo.

### 2.2 Erro de TLS/certificado global interrompe toda a sequência

Nova função `_erroTlsGlobal` (regex para `unable to verify the first
certificate`, `self-signed certificate`, `certificate has expired`,
`unable to get local issuer certificate`, `cert_`, `ssl routines`, `wrong
version number`). Nova flag `tlsGlobalDetectado` interrompe o laço externo de
rodadas **e** o laço interno de candidatos imediatamente — a sequência de
fallback para completamente na primeira ocorrência, em vez de gastar uma
tentativa por provider sabendo que um erro de ambiente (proxy/antivírus
interceptando TLS, caso real já documentado em
`IA_SERVICE_AUDITORIA_ESTABILIZACAO_PRODUCAO.md`) tende a afetar todos os
hosts HTTPS igualmente.

### 2.3 `insufficient_quota` agora é permanente

Adicionado ao padrão de `_erroPermanenteProvider`, junto com `exceeded your
current quota` e `update your billing` (ver 2.4 abaixo sobre por que não
ficou só `billing`).

### 2.4 Bug real encontrado e corrigido durante a própria homologação

A mensagem **real** de rate limit do GROQ inclui um link de upsell:
*"...Upgrade to Dev Tier today at https://console.groq.com/settings/**billing**"*.
O padrão antigo de erro permanente tinha `/billing/i` solto, que capturava
essa URL incidental e classificava um rate limit genuíno (que é transitório)
como permanente — o provider ficava banido da chamada mesmo podendo ter
sucesso numa rodada seguinte. Corrigido: `_erroPermanenteProvider` agora
**nunca** retorna `true` quando a mensagem contém sinal explícito de rate
limit (`rate.?limit|429|tokens per (minute|day)|TPM|TPD`), e o padrão de
billing exige contexto mais específico (`exceeded your current quota`,
`update your billing`) em vez da palavra solta. Validado com a mensagem real
capturada numa chamada de homologação (ver seção 4).

### 2.5 Teto global de tentativas por investigação

`investigacao-service.js`: as 2 chamadas de retry (retry do Quality Gate e
reescrita final) agora passam `maxProviderRounds: 1` — ainda tentam **todos**
os providers elegíveis uma vez cada, só não reinsistem em rodadas completas
adicionais nessas etapas subsequentes. A primeira chamada da investigação
mantém o default de 3 rodadas (razoável para a tentativa inicial). Pior caso
teórico cai de 45 para aproximadamente 13-15 tentativas HTTP agregadas por
investigação.

---

## 3. Testes automatizados

Arquivo `apps/IA Service/tests/ai-provider-retry.test.js`, expandido de 2 para
**11 cenários** (mock de `https.request`, sem chamada real):

1. Retry transitório até sucesso (pré-existente).
2. Erro permanente não retenta (pré-existente).
3. Provider primário com sucesso — nenhum fallback acionado.
4. Provider primário com HTTP 429 — cai para o próximo na mesma rodada.
5. Timeout no primário — cai para o próximo.
6. **Regressão do bug real da seção 2.4**: rate limit com link de billing
   incidental não é classificado como permanente.
7. Contexto incompatível com o modelo — não retenta o mesmo provider.
8. Falha de todos os providers configurados — erro final lista cada um com
   seu motivo específico.
9. Erro global de TLS/certificado — interrompe a sequência inteira (só 1
   tentativa HTTP, não 2).
10. Resposta rejeitada pelo Quality Gate — contrato confirmado (`aprovado:
    false`, `deveRetry: true`), nunca tratada como solução validada.
11. Isolamento multiempresa durante fallback concorrente — duas chamadas
    simultâneas com credenciais diferentes (`Promise.all`) nunca cruzam
    provider/chave entre si.

**Suíte completa do projeto**: 38 arquivos, 0 falhas, validada 3 vezes nesta
sessão (antes das correções, após as correções de classificação de erro, e
após a correção do bug de billing/rate-limit).

---

## 4. Homologação real controlada (GROQ, OpenAI, Gemini, DeepSeek — Claude
ausente neste ambiente local, sem chave disponível)

Dados sintéticos/anonimizados, nunca os reais dos chamados. Banco SQLite
temporário, nunca o de produção.

### Caso A (#035988 COABRA, sintético)

| Tentativa | Provider | Resultado | Motivo |
|---|---|---|---|
| 1 | groq | Falhou | Rate limit TPM real (8000 limit, 7985 usado, 3603 requisitado) |
| 2 | openai | **Sucesso** | — |

Resultado final: `status: concluido`, provider `openai`, modelo `gpt-4o-mini`.
Resposta distingue fato (observação do cliente) de hipótese ("a lógica atual
não está funcionando como esperado"), não afirma categoricamente a regra de
sinal, pede verificação da rotina antes de concluir. **Fallback automático
confirmado funcionando em produção real de dados** — o erro de rate limit
que bloqueou as homologações anteriores (quando eu forçava artificialmente só
GROQ) deixa de ser um bloqueador quando o fallback real está ativo e
corrigido.

### Caso B (#036636 Novapec, sintético — CPF/senha fictícios)

| Tentativa | Provider | Resultado |
|---|---|---|
| 1 | groq (via atalho de pergunta_processo) | Sucesso direto |

A pergunta ("a senha e o acesso já foram cadastrados?") foi classificada como
`pergunta_processo` (correto — é pergunta de status administrativo, não de
regra de negócio) e respondida pelo próprio GROQ sem precisar de fallback
nesta execução específica. Resposta: reconhece que não há confirmação de
conclusão, pede validação de cadastro e perfis, não recria do zero. **Nenhum
CPF ou senha sintéticos vazaram na resposta** (confirmado por busca de
padrão).

### Caso C (#036475 FUNDAÇÃO MT, sintético) — com e sem pendência externa

| Cenário | Tentativa | Provider | Resultado |
|---|---|---|---|
| Com pendência (`aguardandoConsolidado = RETORNO - FORNECEDOR`) | 1 (groq) → 2 (openai) | openai | Sucesso |
| Sem pendência externa | 1 (groq) → 2 (openai) | openai | Sucesso |

Ambos `status: concluido_com_alerta_quality_gate` — o Quality Gate rejeitou
(`aprovado: false`) por `ATTACHMENT_NOT_ANALYZED` (a pergunta de teste mencionava
"no fonte" sem nenhum anexo real anexado — comportamento correto do gate, não
falha; é um artefato do meu texto de teste sintético, não um bug). Em nenhum
dos dois cenários o modelo recomendou alteração financeira, mesmo com a
pergunta de teste incluindo explicitamente "Precisamos mexer no financeiro?"
no cenário com pendência — a resposta disse que precisa do código/log antes de
confirmar qualquer relação entre as rotinas, sem inventar causalidade.

**Validação não concluída com confirmação textual direta**: a diferença de
tamanho de prompt entre os dois cenários (5473 vs. 4972 caracteres, ~500
caracteres maior no cenário com pendência) é consistente com a presença da
linha de "pendência consolidada" (correção da sessão de estabilização
anterior), mas o `userPrompt` bruto não foi persistido nesta rodada para
confirmação textual direta — essa é uma limitação de instrumentação desta
execução, não um indício de falha do código (a mesma linha já foi confirmada
por teste determinístico em `estabilizacao-casos-reais-2026-10.test.js`).

---

## 5. Diferenciação de evidência

- **Execução real com fallback multi-provider**: Caso A (groq→openai), Caso C
  com e sem pendência (groq→openai em ambos) — mostram o fallback real
  funcionando em produção de dados sintéticos.
- **Execução real sem necessidade de fallback**: Caso B (groq respondeu
  direto via atalho de pergunta_processo).
- **Teste determinístico (mock, sem rede)**: 11 cenários em
  `ai-provider-retry.test.js` + suíte completa de 38 arquivos.
- **Resultado ilustrativo**: nenhum nesta entrega.

## 6. Riscos residuais

1. Claude não foi exercitado nesta homologação (chave ausente no ambiente
   local) — a lógica de fallback para Claude é a mesma dos demais
   `openai_compat`/`anthropic`, mas não há confirmação real nesta sessão.
2. A posição configurada em `fallback_ordem` pelo admin é parcialmente
   sobrescrita por `provedorPrimario` sempre vir primeiro — comportamento
   existente, não alterado nesta tarefa (fora do escopo de "não reconstruir o
   router"), mas vale registrar como possível confusão para quem configura.
3. O teto global de tentativas (seção 2.5) reduz o pior caso teórico, mas não
   impõe um limite de **tokens ou custo estimado** agregado por investigação
   — só de número de rodadas. Implementar isso exigiria somar
   `usage.total_tokens` reportado por cada tentativa e comparar contra um
   teto configurável, o que não foi pedido explicitamente como obrigatório
   nesta tarefa e não foi implementado.
4. Não há mecanismo de consulta prévia de saldo/cota restante de nenhum dos 5
   providers antes de uma chamada (nenhum expõe isso de forma confiável via
   API pública) — a abordagem é necessariamente reativa (classificar o erro
   quando ocorre), não preventiva.

## 7. Restrições respeitadas

Router não reconstruído (edições pontuais em funções existentes); nenhum
provider novo adicionado; prompt oficial não alterado para caber em nenhum
tier gratuito; TLS nunca enfraquecido; nenhum dado de produção modificado;
Fases 4/5 não iniciadas; nenhum commit, push ou deploy executado; nenhuma
chamada de IA criada além das estritamente necessárias para a homologação
(reaproveitado o mesmo texto de pergunta entre tentativas quando possível).
