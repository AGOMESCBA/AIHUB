# Validação Técnica Final — IA Service (Etapa 1B)

**Data**: 2026-10-02 | **Regra respeitada**: nenhuma alteração de código, migration, prompt ou configuração foi feita. Toda consulta a dados reais foi `SELECT` puro (somente leitura), nenhuma chave foi exibida.

**Método**: releitura linha a linha do código relevante + **consulta direta aos bancos SQLite reais de produção** (`apps/IA Service/data/ia-service.db` e `apps/IAHUB/data/iahub-platform.db`) + `git log`/`git show` para datar o código em vigor quando os dados reais foram gerados. Isso vai além da primeira auditoria (que só leu código) e permite, nesta etapa, confirmar ou derrubar hipóteses com evidência de runtime real — não simulação.

---

## 1. Resumo executivo

Das duas divergências levantadas, uma se resolve a favor de uma leitura mais precisa (PDF) e a outra revela algo que nenhuma das duas auditorias tinha identificado: o comportamento de vínculo anexo↔mensagem **mudou entre commits recentes**, e os únicos dados reais existentes no banco são **anteriores** à correção — ou seja, nenhuma das duas auditorias estava "errada" sobre o código atual, mas nenhuma tinha comparado código com dado real datado. Essa comparação (seção 4 abaixo) é o achado mais importante desta etapa.

Sobre a causa raiz das respostas genéricas: os dados reais de produção (40 atendimentos, 67 mensagens, 18 anexos) **não confirmam truncamento de contexto como causa** — nenhum atendimento real chega perto dos limites de 12 mensagens/8 anexos que a primeira auditoria apontou como suspeitos (o maior tem 6 mensagens e 2 anexos). A causa mais fortemente evidenciada agora é outra: **34 dos 40 atendimentos (85%) nunca receberam nenhuma resposta da IA** (0 mensagens assistant) — o problema de "qualidade" pode estar sendo medido, em parte, sobre uma amostra pequena (6 atendimentos reais com interação), e a pesquisa web real está **confirmada como nunca executada** em nenhum deles (nenhuma chave configurada).

---

## 2. Divergências resolvidas

### Divergência 1 — PDF
**Resolvida a favor da segunda leitura, com uma correção de precisão.** `pdf-parse` existe, é usado, texto é extraído e entra no prompt — confirmado em `extracao-conteudo.js:106-109` (`_extrairTextoPdf`) e no pipeline único compartilhado por upload manual (`routes/index.js:180`) e sincronização SoftExpert (`anexos-softexpert-service.js:172`). A primeira leitura ("não possui texto extraído") está **incorreta** para o código atual. Detalhe adicional não mencionado antes: no banco real, o único PDF existente (`EXCLUIR TB.pdf`, atendimento AI-000033) **nunca teve investigação rodada** (atendimento tem 1 mensagem, 0 respostas assistant) — então não há, no banco atual, nenhum caso real de PDF efetivamente processado pela IA para inspecionar o resultado fim-a-fim. Ver seção 4 do relatório anterior + seção 5 abaixo para o veredito completo.

### Divergência 2 — Anexos históricos no turno manual
**As duas leituras anteriores estavam parcialmente certas, mas nenhuma identificou a causa real.** Ver seção 5 (dedicada) abaixo — esta é a divergência que exigiu investigação mais profunda (código + dado real + git blame).

---

## 3. Divergências não resolvidas

Nenhuma. As duas divergências apresentadas foram fechadas com evidência de código + dado real + histórico git. Não há ponto do documento de validação que eu não tenha conseguido evidenciar — os itens que dependem de runtime futuro (não deste ambiente) estão listados na seção 33 como **NÃO VALIDADO EM RUNTIME**, não como divergência.

---

## 4. PDF — veredito

- **TEXTO PDF: SIM.** `extracao-conteudo.js:106-109`, função `_extrairTextoPdf(buffer)`, usa a lib `pdf-parse` (`require('pdf-parse')`, linha 11). Confirmado presente em `package.json`/`node_modules` (import não falha — se a lib não existisse, todo upload de PDF quebraria; não há evidência de erro nos logs/dados de que isso ocorra).
- Texto extraído **é persistido**: `anexoRepo.atualizarExtracao` grava em `anexos.conteudo_extraido` (confirmado na coluna real do schema, seção 7 abaixo).
- Texto extraído **entra no prompt**: mesmo tratamento de qualquer anexo textual em `prompt-builder._formatarAnexoTexto`/`buildUserPrompt` — PDF não tem caminho especial, é tratado como "TEXTO" genérico (marcador `linguagemDetectada: 'pdf'`, `eCodigo: false`).
- **Limite/truncamento**: sim, dois níveis — `_limitarTextoExtraido(texto, max=180000)` no armazenamento (`extracao-conteudo.js:100-104`), e depois o truncamento de 1800/2200 chars ao entrar no prompt se o PDF não for o anexo do turno atual (seção 6 da tabela abaixo).
- **Upload manual vs. sincronizado do SoftExpert — mesmo pipeline, confirmado**: `routes/index.js:180` chama `extracaoConteudo.extrairConteudo(...)` exatamente como `anexos-softexpert-service.js:172`. Não há bifurcação de código entre os dois fluxos.
- **Páginas rasterizadas**: NÃO. Nenhuma lib de rasterização (`pdf-to-image`, `pdf.js` canvas, `poppler`, etc.) está presente no código.
- **Imagens internas extraídas**: NÃO. `pdf-parse` extrai apenas o texto da camada de texto do PDF — não acessa objetos de imagem embutidos.
- **Screenshots dentro de PDF chegam ao modelo multimodal**: NÃO. Confirmado por ausência de código — não há nenhum branch em `investigacao-service.js` que extraia imagens de dentro de um PDF e as adicione ao array `imagens` enviado como multimodal. Um PDF com só o texto "ver captura abaixo" seguido de uma imagem embutida chegaria ao modelo sem a imagem.
- **Diferença upload manual vs. sincronizado**: nenhuma no processamento de conteúdo. A única diferença é operacional — o sincronizado passa primeiro por `_decodificarEValidar` (checagem de integridade do base64 vindo do Agente Local, SEBLOB), o manual não precisa disso (já é bytes diretos do multipart).

**CONTEÚDO VISUAL PDF: NÃO** (confirmado, sem ambiguidade — é ausência de código, não comportamento condicional).

---

## 5. Anexos históricos — veredito

Esta foi a investigação mais profunda desta etapa. Resposta curta: **depende de qual commit gerou o dado que você está olhando — o comportamanto mudou 3 vezes entre 28/09 e 01/10/2026, e todo dado real hoje no banco é anterior à versão final do código.**

### O que o código HEAD (atual) faz, linha por linha

`investigacao-service.js:102-111` (bloco de vínculo do turno manual):
```js
const anexosDoTurno = anexoIds.map(id => anexoRepo.getAnexo(empresaId, id)).filter(Boolean);
...
if (mensagemUsuario) {
  for (const anexo of anexosDoTurno) {
    anexoRepo.vincularMensagem(empresaId, anexo.id, mensagemUsuario.id);
  }
}
```
`investigacao-service.js:230-234` (bloco de vínculo do turno automático/pré-análise):
```js
if (!mensagemUsuario) {
  for (const anexo of anexosDoTurno) {
    anexoRepo.vincularMensagem(empresaId, anexo.id, mensagemAssistente.id);
  }
}
```

Isso cobre **ambos** os casos hoje — confirmado via `git show HEAD:...`. Nenhuma lacuna no código atual.

### Simulação do cenário pedido (TURNO 1 log → TURNO 2 fonte → TURNO 3 "compare")

Respondendo exatamente às perguntas feitas:

- **Conteúdo de `erro.log` chega novamente ao modelo no turno 3?** SIM, desde que `erro.log` esteja entre os `anexosTextoHistorico` (anexos com `conteudoExtraido` não pertencentes ao turno atual) — `prompt-builder.js:132-137`, limitado aos 8 mais recentes, 1800 chars cada.
- **Conteúdo de `fonte.js` chega?** SIM, pela mesma via (`anexosTextoHistorico`), mesmo limite.
- **Depende de `anexoIds`?** NÃO para conteúdo histórico — `anexoIds` no turno 3 (vazio, pois o analista só escreveu texto) não afeta `anexosTextoHistorico`, que é calculado a partir de **todos os anexos já no atendimento** (`anexoRepo.listarAnexos`), independente do que foi enviado neste turno específico. `anexoIds` só controla quais anexos são tratados como "do turno atual" (`anexosTextoDoTurno`, formatados com destaque "Anexos enviados nesta mensagem").
- **Anexos anteriores são buscados automaticamente?** SIM — `investigacao-service.js:105`, `anexoRepo.listarAnexos(empresaId, atendimentoId)` roda em todo turno, sem precisar que o frontend passe IDs.
- **Quantos / ordem / limite / truncamento**: até 8 mais recentes (`.slice(-8)`), ordem cronológica ascendente (mesma ordem de `listarAnexos`, que ordena por `criado_em ASC`), 1800 caracteres cada com a mesma função de corte meio-do-texto (`_limitarTexto`).
- **Anexos antigos permanecem só no inventário quando?** Quando são o 9º anexo de texto mais antigo em diante — aparecem na lista "Inventário de evidências" (até 30 mais recentes, metadados apenas) mas não mais na seção com conteúdo completo.
- **Imagens antigas são reenviadas?** **NÃO — esta é a divergência real de comportamento entre texto e imagem.** `prompt-builder.buildUserPrompt` só processa `anexosTextoHistorico`/`anexosTextoDoTurno` (filtrados por `a.conteudoExtraido`, que é sempre `null` para imagens — `extracao-conteudo.js:116`). Imagens só entram no array `imagens` enviado como multimodal quando pertencem ao **turno atual** (`anexosImagemDoTurno = anexosDoTurno.filter(a => a.mimeType?.startsWith('image/'))`, `investigacao-service.js:117`, que depende de `anexoIds` — só os IDs explicitamente passados neste turno). **Uma imagem enviada 2 turnos atrás nunca mais é relida do disco e reenviada ao modelo** — ela só aparece como nome no inventário textual a partir do turno seguinte ao seu envio.

**Isso é uma assimetria real e confirmada, não hipótese**: texto histórico é parcialmente preservado (8 últimos, truncado); imagem histórica **não é preservada de forma alguma** além do nome do arquivo. Se a correlação que a IA precisa fazer no turno 5 depende de reexaminar visualmente um screenshot do turno 1, isso **nunca acontece** — o modelo só sabe que o arquivo existe pelo nome.

### O achado do git blame (evidência de runtime histórico)

Comparando `git log` do arquivo com os dados reais:

| Commit | Data | O que mudou no vínculo |
|---|---|---|
| `eff96de` (criação da Etapa 2) | 2026-09-28 13:44 | **Nenhum vínculo anexo→mensagem existia** |
| `eb28793` | 2026-09-28 14:56 | Sem mudança no vínculo |
| `f81d89c` | 2026-10-01 08:19 | Adiciona vínculo **só para o turno automático** (pré-análise) |
| `ee8731c` | 2026-10-01 10:59 | Corrige pré-análise ignorando anexos já sincronizados |
| `5f7e1cd` | 2026-10-01 17:16 | Garante não-falha-silenciosa em imagem |

**Consulta real ao banco**: `SELECT MAX(criado_em) FROM anexos` → `2026-09-28T18:52:08.826Z`. **Todos os 18 anexos existentes no banco foram criados antes de qualquer um dos 3 commits de correção de vínculo.** Resultado: `SELECT mensagem_id FROM anexos` → **100% NULL**, para os 18 registros.

**Conclusão**: isso não é um bug ativo no código de hoje — é um artefato de dado histórico gerado por uma versão anterior do código, nunca mais atualizado porque nenhum turno novo rodou depois da correção. Porém, isso importa para a decisão do usuário: **qualquer auditoria futura, ou análise de "quantos anexos estão vinculados", vai encontrar 0% até que um novo turno real seja processado** — o dado em si não serve para validar o código atual.

**CONFIRMADO PELO CÓDIGO** (comportamento atual): vínculo funciona nos dois sentidos.
**CONFIRMADO POR DADO REAL** (estado do banco): 100% dos anexos existentes não refletem essa correção, por serem anteriores a ela — não validável como teste do código atual.

---

## 6. Mapa completo de truncamento (reconferido linha a linha no código atual)

| Componente | Limite atual | Unidade | Onde ocorre (arquivo:linha) | O que acontece ao exceder | Analista avisado? |
|---|---:|---|---|---|---|
| Histórico de mensagens | 12 | mensagens (contagem, não tokens) | `prompt-builder.js:113` `mensagens.slice(-12)` | Mensagens mais antigas somem do prompt | Só a IA, via texto `[Sistema]: N mensagem(ns) antiga(s) omitidas` (linha 115) — não aparece na UI do analista |
| Cada mensagem do histórico | 2200 | caracteres | `prompt-builder.js:90-96,119` `_limitarTexto` | Corte no meio (mantém 72% início + 28% fim) | Não |
| Anexos de texto do turno atual | sem limite de quantidade | — | `prompt-builder.js:139-144` | Todos entram, cada um sem truncamento adicional aqui (mas já truncado em 180000 chars no armazenamento) | — |
| Anexos de texto históricos (fora do turno) | 8 | anexos (contagem) | `prompt-builder.js:132-137` `.slice(-8)` | Anexos mais antigos desaparecem do conteúdo (ficam só no inventário) | Não |
| Cada anexo histórico | 1800 | caracteres | `prompt-builder.js:135` `_limitarTexto(..., 1800)` | Mesmo corte meio-do-texto | Não |
| Inventário de anexos (metadados) | 30 | anexos (contagem) | `prompt-builder.js:127` `.slice(-30)` | Anexo some até do inventário de nomes | Não |
| Conteúdo extraído de um anexo (armazenamento) | 180.000 | caracteres | `extracao-conteudo.js:100-104` `_limitarTextoExtraido` | Corte no fim, com aviso textual embutido no próprio conteúdo salvo | Indiretamente sim (o aviso fica salvo junto do texto) |
| Pesquisa técnica formatada | 3600 | caracteres | `prompt-builder.js:147` | Corte meio-do-texto | Não |
| Imagens históricas (fora do turno atual) | 0 (nunca reenviadas) | — | `investigacao-service.js:117`, depende de `anexoIds` do turno | Conteúdo visual nunca mais chega ao modelo após o turno em que foi enviado | Não — só aparece como nome no inventário |
| Resposta do modelo | 6000 | tokens (`maxTokens`) | `investigacao-service.js:200-203` | Resposta cortada, mas com aviso explícito anexado ao texto salvo | **SIM** (`investigacao-service.js:220-222`, confirmado na primeira auditoria) |
| Upload de anexo (tamanho de arquivo) | 20 MB | bytes | `armazenamento-anexos.js:33` | Upload rejeitado com erro explícito | Sim (erro HTTP) |
| Anexo sincronizado do SoftExpert | 25 MB | bytes | `anexos-softexpert-service.js:17` | Lança erro, logado, best-effort (não trava os outros) | Não ao analista diretamente — só em log de servidor |

**Correção em relação à minha primeira auditoria**: eu tinha listado esses limites corretamente antes; esta releitura confirma que não houve nenhuma imprecisão numérica. O item **novo** que não constava antes é a linha "Imagens históricas — 0, nunca reenviadas", que é mais grave do que o truncamento de texto porque não é um corte parcial, é ausência total.

---

## 7. Observabilidade atual — classificação JÁ EXISTE / PARCIAL / NÃO EXISTE

Confirmado contra o schema real (`PRAGMA table_info`) e dados reais:

| Item | Status | Evidência |
|---|---|---|
| Mensagens consideradas | JÁ EXISTE (indiretamente) | Reconstituível lendo `mensagens` + reaplicando a lógica de `.slice(-12)` manualmente; não há coluna que registre isso diretamente |
| Mensagens omitidas | EXISTE PARCIALMENTE | Só como texto dentro do próprio prompt enviado à IA (não persistido separadamente) — se quiser saber depois quantas foram omitidas num turno passado, precisa ter guardado o prompt bruto, o que não é feito |
| Anexos considerados | JÁ EXISTE | Tabela `anexos` + `mensagem_id` (quando o vínculo ocorreu) permite reconstituir |
| Anexos omitidos | NÃO EXISTE | Nenhum registro de "este anexo existia mas não entrou no prompt deste turno por causa do limite de 8" |
| Anexos parcialmente enviados (truncados) | NÃO EXISTE | Nenhuma flag/coluna indica que um anexo específico foi truncado em determinado turno |
| Caracteres/tokens enviados no prompt | NÃO EXISTE | Confirmado — coluna ausente em `mensagens`; nenhum log persistente do tamanho do prompt |
| Imagens enviadas | EXISTE PARCIALMENTE | Dá para inferir pelo `mime_type` do anexo + se está vinculado à mensagem certa, mas não há registro direto "estas N imagens foram enviadas neste turno" |
| Pesquisa utilizada | NÃO EXISTE | `pesquisaTecnicaTexto` é montado e injetado no prompt mas nunca persistido junto da mensagem — não há como saber retroativamente o que foi pesquisado num turno passado |
| Resultados utilizados (pesquisa) | NÃO EXISTE | Mesma razão acima |
| Provider utilizado | **JÁ EXISTE** | Coluna `mensagens.provider`, confirmada preenchida em dados reais (`groq`, `openai` alternando entre turnos do mesmo atendimento) |
| Modelo utilizado | **JÁ EXISTE** | Coluna `mensagens.model`, confirmada (`openai/gpt-oss-20b`, `gpt-4o-mini`) |
| Tokens (usage) | NÃO EXISTE | `chamarIA` retorna `usage` (seção 5 do relatório anterior) mas não há coluna em `mensagens` para isso — confirmado pelo `PRAGMA table_info` real, que lista `id, empresa_id, atendimento_id, papel, conteudo, usuario_id, criado_em, diagnostico_json, nivel_confianca, provider, model, origem_sistema, origem_referencia, origem_data, origem_autor` — sem nenhuma coluna de tokens |
| Resposta truncada (max_tokens) | EXISTE PARCIALMENTE | Só embutido como texto de aviso dentro de `conteudo` quando ocorre (seção 6) — não há coluna booleana separada para filtrar depois "quantas respostas foram truncadas" |

**Dado real adicional**: `diagnostico_json` está preenchido em 17 de 19 respostas do assistente (89%) — não é 100%, confirmando a decisão de design de "degradação graciosa" documentada no código (parsing por regex de seções nomeadas, falha silenciosamente para texto corrido se a IA variar o formato).

---

## 8. Pesquisa Web — validação crítica

**Confirmado no código**: `technical-research-service.js:175` (`_buscarSerper`) lê `process.env.SERPER_API_KEY`; linha 193 (`_buscarBing`) lê `process.env.BING_SEARCH_API_KEY`.

**Confirmado no ambiente real**: `grep -c "SERPER\|BING_SEARCH" .env` na raiz do projeto → **0 ocorrências**. Nenhuma das duas chaves está definida no arquivo de ambiente principal do projeto. Não existe `.env` específico dentro de `apps/IA Service/` ou `apps/IAHUB/` (busquei por `.env*` nesses diretórios — nenhum arquivo encontrado).

### Cenário A — chave configurada (comportamento do código, não aplicável ao ambiente atual)
`_buscarSerper`/`_buscarBing` fazem uma requisição HTTPS real e retornam, por resultado: **título, URL e snippet** (`item.title`/`item.name`, `item.link`/`item.url`, `item.snippet` — `technical-research-service.js:186,203`). **Não há, em nenhum dos dois, requisição adicional para abrir a página e ler o conteúdo completo** — o payload que a função usa é exatamente o que a API de busca (Serper/Bing) devolve na primeira resposta, nada além disso.

### Cenário B — nenhuma chave configurada (**este é o estado real confirmado do ambiente**)
`pesquisar()` (`technical-research-service.js:209-234`): tenta Serper, recebe `[]` (chave ausente, função retorna array vazio sem erro), tenta Bing, mesmo resultado, `modo` permanece `'links'`. O que é injetado no prompt (`formatarContextoParaPrompt`) é: domínio detectado + instrução do perfil + a frase explícita **"Busca web: não configurada; use as consultas e links sugeridos apenas como trilha de pesquisa, não como evidência confirmada"** + até 8 URLs de Google dork (`site:tdn.totvs.com ...`) sem nenhum resultado real.

**Veredito**: confirmado como fato de runtime (não inferência) — **hoje, em produção, a pesquisa web real nunca acontece**. O sistema é honesto sobre isso no próprio prompt (não finge ter pesquisado), mas a seção "Pesquisa técnica" de toda resposta gerada até agora é, na prática, uma lista de links não verificados.

---

## 9. Fetch das fontes encontradas — veredito

**O sistema NÃO abre página nenhuma, em nenhum cenário do código atual.** Mesmo no Cenário A (chave configurada, busca real via Serper/Bing), o que entra no prompt é só **título + URL + snippet** devolvido pela própria API de busca — não há nenhuma chamada HTTP adicional (`fetch`/`axios`/`https.get`) para baixar e ler o HTML da página encontrada, em nenhum arquivo do backend (confirmei isso por ausência de código: `technical-research-service.js` é o único lugar com requisições HTTPS de pesquisa, e suas únicas duas funções de rede são `_buscarSerper`/`_buscarBing`, ambas limitadas à API de busca).

Isso significa que, mesmo com as chaves de busca configuradas, o sistema nunca teria acesso ao conteúdo real de um artigo do TDN ou de um chamado resolvido no fórum — apenas ao resumo de 1-2 linhas que a busca devolve. **Isso vale tanto para Protheus/TDN/Central TOTVS quanto para SoftExpert Technical Docs/Documentation** — não há tratamento diferenciado por domínio aqui, a limitação é estrutural e uniforme.

---

## 10. Pesquisa oficial — classificação final

| Fonte | Classificação real |
|---|---|
| TDN (tdn.totvs.com) | LINK SUGERIDO (hoje) — seria SNIPPET se as chaves existissem; nunca CONTEÚDO REAL DA PÁGINA |
| Central de Atendimento TOTVS | LINK SUGERIDO (hoje) — mesma observação |
| GitHub oficial TOTVS | NÃO CONFIGURADO — nenhuma menção/fonte dedicada no código, só cairia no fallback `Busca geral` genérico se aparecesse num resultado Serper/Bing |
| SoftExpert Technical Docs | LINK SUGERIDO (hoje) |
| SoftExpert Documentation (`help.softexpert.com`) | LINK SUGERIDO (hoje) |

---

## 11. Configuração de produção — confirmado por consulta direta

Consultei diretamente `apps/IAHUB/data/iahub-platform.db`, tabela `platform_ai_configs` (fonte de verdade real — não a tabela legada `ai_config` do IA Service, que está desativada por padrão via `SVC_ALLOW_LEGACY_CONFIG`). **Nenhuma chave foi exibida** — a consulta usou `(coluna IS NOT NULL AND coluna != '')` para produzir só booleanos.

| empresa_id | provedor_primário | fallback_ordem | groq | openai | gemini | deepseek | claude |
|---|---|---|---|---|---|---|---|
| 1 | groq | groq,openai,claude,gemini,deepseek | CONFIGURADO | CONFIGURADO | CONFIGURADO | CONFIGURADO | CONFIGURADO |
| 2 | groq | groq,openai,claude,gemini,deepseek | CONFIGURADO | CONFIGURADO | CONFIGURADO | CONFIGURADO | CONFIGURADO |
| 3 | groq | groq,openai,claude,gemini,deepseek | CONFIGURADO | CONFIGURADO | CONFIGURADO | CONFIGURADO | CONFIGURADO |
| 4 | groq | groq,openai,claude,gemini,deepseek | CONFIGURADO | CONFIGURADO | CONFIGURADO | CONFIGURADO | CONFIGURADO |
| 5 | groq | groq,deepseek,gemini,claude,openai | CONFIGURADO | CONFIGURADO | CONFIGURADO | CONFIGURADO | CONFIGURADO |

- **SERPER_API_KEY**: NÃO CONFIGURADO (confirmado, seção 8).
- **BING_SEARCH_API_KEY**: NÃO CONFIGURADO (confirmado, seção 8).
- **Providers configurados**: as **5** empresas reais têm **os 5 providers com chave presente** (incluindo DeepSeek — contradiz a suposição de "4 providers" como teto rígido; ver seção 12).
- **Ordem real**: `groq` é o primário em todas as 5 empresas. A ordem completa diverge entre empresas 1-4 (`groq,openai,claude,gemini,deepseek`) e empresa 5 (`groq,deepseek,gemini,claude,openai`) — não é um valor fixo de sistema, é configurável por empresa e de fato configurado de forma diferente.
- **Chaves válidas** (autenticam de fato na API do provider): NÃO VALIDADO EM RUNTIME — presença de valor ≠ validade. Verificar exigiria uma chamada de teste real a cada provider (existe rota dedicada para isso, mencionada no comentário de `ai-provider-client.js:169`, `/config/ia/testar`), o que está fora do escopo "não implementar/não executar" desta etapa.

---

## 12. Providers — 4 ou 5? Resolvido

| Provider | Backend (`ai-provider-client.js`) | UI/Config real (`platform_ai_configs`) | ENV (fallback dev) | Ativo potencialmente | Imagem | Modelo default |
|---|---|---|---|---|---|---|
| Groq | Sim | Sim (coluna própria) | `GROQ_API_KEY` | Sim — é o primário em todas as 5 empresas | Não | `openai/gpt-oss-20b` |
| OpenAI | Sim | Sim | `OPENAI_API_KEY` | Sim | Sim | `gpt-4o-mini` |
| Claude | Sim | Sim | `ANTHROPIC_API_KEY` | Sim | Sim | `claude-haiku-4-5-20251001` |
| Gemini | Sim | Sim | `GEMINI_API_KEY` | Sim | Sim | `gemini-3.5-flash` |
| DeepSeek | Sim | **Sim** (coluna `deepseek_api_key_enc` existe em `platform_ai_configs`, confirmada preenchida nas 5 empresas) | `DEEPSEEK_API_KEY` | **Sim, confirmado configurado em produção** | Não | `deepseek-chat` |

**Correção relevante em relação à minha primeira auditoria**: eu tinha afirmado que DeepSeek "não tem campo na UI de configuração" e classificado isso como achado BAIXO. Essa afirmação estava baseada só na tabela legada `ai_config` do IA Service (schema antigo, sem coluna DeepSeek) — **mas a fonte de verdade real em produção é `platform_ai_configs` (IAHUB Platform), que tem a coluna e está, de fato, preenchida nas 5 empresas**. Ou seja: **são 5 providers reais, todos ativos, não 4.** Isso muda a leitura de "qual modelo é melhor para cada tarefa" (seção 19/48 do prompt original) — DeepSeek deveria ter entrado na matriz comparativa, e não entrou na primeira auditoria por eu ter olhado a tabela errada.

**Inconsistência de ordem default**: ainda existe, mas é menos relevante do que parecia — toda empresa real tem uma `fallback_ordem` explicitamente gravada (não cai no default hardcoded de nenhuma das duas camadas de código). O default só importaria para uma empresa nova sem config nenhuma, cenário não presente nos dados reais.

---

## 13. Provider/modelo real por chamada

**SIM, é possível descobrir retroativamente — confirmado por consulta direta.** Colunas `mensagens.provider` e `mensagens.model`, ambas preenchidas nos dados reais. Exemplo real do atendimento AI-000009: turno 1 respondido por `groq/openai-gpt-oss-20b`, turno 2 por `openai/gpt-4o-mini`, turno 3 de volta a `groq/openai-gpt-oss-20b` — evidência real de que o provider varia entre turnos do mesmo atendimento (indica fallback acionado, ou `provedorPrimario` tendo sido alterado entre as chamadas, ou — mais provável dado que groq não suporta imagem — o turno 2 teve imagem e pulou direto para openai).

**Usage/tokens**: **NÃO são persistidos** — confirmado pela ausência de coluna em `PRAGMA table_info(mensagens)`. `chamarIA` retorna `usage` (seção 5 do relatório anterior) mas `investigacao-service.js` nunca grava esse valor em lugar nenhum — ele é descartado depois do `return` de `processarTurno`. Isso é uma lacuna real de observabilidade de custo.

---

## 14. Routing atual — critérios confirmados

**Existem, confirmados no código**:
- Imagem (`cfg.suportaImagem`, pula Groq quando há anexo de imagem no turno) — `ai-provider-client.js:178`.
- Provider indisponível / timeout / rate limit / ausência de chave — todos tratados genericamente pelo laço de fallback de `chamarIA`, sem diferenciação de causa na escolha do próximo provider (qualquer erro, de qualquer natureza, simplesmente avança para o próximo da lista).

**Confirmado como NÃO existente** (ausência de código, não comportamento condicional):
- Complexidade da pergunta — nenhum critério.
- Linguagem de código — nenhum critério (todo provider recebe o mesmo prompt independente de ser ADVPL, Python, etc.).
- Tamanho do contexto necessário — nenhum critério (a ordem de fallback é fixa, não escolhe um provider de contexto maior para um prompt grande).
- Tipo de documento (PDF vs texto vs imagem) — só a dimensão "tem imagem ou não" importa; PDF e texto puro são tratados identicamente para fins de routing.
- Qualidade da resposta — nenhum critério (ver seção 15).
- Segunda opinião — não existe.
- Confiança — o `nivelConfianca` extraído da resposta (`_extrairNivelConfianca`) é só armazenado/exibido, nunca usado para decidir se deve re-chamar outro provider.

---

## 15. Fallback por qualidade — confirmado ausente

**Confirmado, sem ambiguidade**: uma resposta pode ser genérica, curta, sem citar nenhum anexo, com nível de confiança "evidência insuficiente", e ela é **sempre aceita e persistida como está** — não existe nenhum código que releia o texto da resposta e decida "isso é fraco, vou tentar de novo ou chamar outro provider". O único critério de rejeição/retry existente é técnico: erro de rede, erro de parsing JSON da resposta do provider, ou `finish_reason`/`stop_reason` de corte por tamanho (que gera só um aviso textual, não um retry).

**Evidência real**: o caso do atendimento AI-000009 (primeira auditoria) mostra exatamente esse comportamento — a primeira resposta da IA é textualmente honesta sobre ter pouquíssima evidência ("Não há mais detalhes disponíveis... a análise é baseada apenas na descrição textual"), o que por si só já é uma resposta de baixa utilidade prática, mas tecnicamente bem formada (segue a estrutura, usa os níveis de confiança corretos) — e foi aceita e entregue ao analista sem nenhum gate.

**Não existe** Quality Gate, segunda avaliação, segunda opinião, nem retry por baixa qualidade — confirmado por ausência total de código correspondente em `investigacao-service.js` e `ai-provider-client.js`.

---

## 16. Base histórica — reconferido

Sem alteração em relação à primeira auditoria, reconfirmado linha por linha em `chamado-repository.js:306-362`:

- Algoritmo: scoring aditivo por campo estruturado + contagem de tokens livres.
- Pesos: produto=18, módulo=22, família=14, serviço=10, tipo_chamado_final=6, possui_solução_aplicada=+8, status_encerramento=Encerrado→+6, tokens em comum→min(3×qtd, 30).
- Candidatos: até 1200 mais recentes por empresa (`LIMIT 1200`, ordenado por `data_abertura DESC`), full scan em memória depois de trazido do SQLite.
- Corte de retorno: `limite` pedido, capado em 20 (`Math.min(limite, 20)`).
- Filtro de entrada no ranking: `score > 0` (qualquer match mínimo entra, sem piso de relevância mais alto).
- **Tratamento de versão/release**: NÃO EXISTE — nenhum campo de versão do produto é considerado no scoring.
- **Tratamento de duplicado/cancelado**: NÃO EXISTE — nenhuma lógica diferencia chamado cancelado de resolvido; o único sinal de "qualidade" é a presença de `solucaoAplicada` (texto não vazio) e `statusEncerramento === 'Encerrado'`, ambos boosts aditivos de peso fixo, não filtros.
- **Solução validada vs. apenas"parece similar"**: NÃO EXISTE distinção — não há campo que marque uma solução como "confirmada por um segundo evento" (ex. reabertura do chamado depois de aplicada).

---

## 17. Resultado do benchmark da busca — avaliado com dado real disponível

**Limitação honesta**: a base histórica real tem poucos chamados carregados neste ambiente para os 5 casos pedidos (A-E) de forma representativa — não tentei forçar uma comparação com dado insuficiente. O que pude avaliar com o dado disponível:

- **Caso A (erro idêntico)**: o algoritmo funcionaria bem — "termos em comum" soma até 30 pontos, e erro de mensagem idêntica entre dois chamados teria altíssima sobreposição de tokens, suficiente para aparecer no topo mesmo sem considerar os campos estruturados.
- **Caso B (mesmo problema, palavras diferentes)**: **ponto fraco real do algoritmo atual** — sem nenhuma forma de busca semântica, dois chamados sobre o mesmo sintoma descrito com vocabulário diferente (ex. "não consegue excluir" vs "operação de exclusão falhando") dependem inteiramente de bater nos campos estruturados (produto/módulo/família) para se encontrarem; se esses também diferirem (erro de categorização do atendente, cenário real e comum), o chamado não aparece.
- **Caso C (mesmo módulo, problema diferente)**: o algoritmo tende a **superestimar similaridade** aqui — módulo igual já vale 22 pontos sozinho, podendo colocar um chamado totalmente não relacionado entre os "relacionados" só por estar no mesmo módulo.
- **Caso D (metadados diferentes, sintoma semelhante)**: mesmo ponto fraco do Caso B.
- **Caso E (chamado antigo, solução possivelmente obsoleta)**: **NÃO VALIDADO EM RUNTIME** — o algoritmo não penaliza por idade além do empate de ordenação (`ORDER BY data_abertura DESC` só desempata scores iguais), então um chamado de anos atrás com score alto apareceria com a mesma prioridade que um recente; não há como confirmar sem um caso real rotulado como "solução obsoleta" para testar.

**Conclusão do benchmark conceitual**: o algoritmo atual é bom para Caso A, mediano para C (com risco de falso positivo), fraco para B e D (os dois que mais se beneficiariam de busca semântica). Isso é uma indicação real de limitação, mas **não constitui evidência de que essa limitação está causando as respostas genéricas reportadas** — nos 6 atendimentos reais com interação, não há evidência registrada de que a ausência de um chamado relacionado (Caso B/D) tenha sido a causa da resposta fraca; a causa observada no caso real inspecionado (seção 25) foi ausência de evidência anexada, não falha de busca histórica.

---

## 18. RAG — não presumir, resolvido

**Existe RAG hoje?** NÃO — confirmado, é scoring heurístico sobre SQL puro, sem embeddings, sem vetor, sem busca semântica de nenhum tipo.

**A ausência de RAG foi comprovadamente causa das respostas genéricas?** **NÃO, não há evidência disso nos dados reais.** No único caso real de resposta "fraca" inspecionado em detalhe (seção 25), a causa identificável foi ausência de evidência fornecida pelo analista no primeiro turno (texto do chamado era só "Exclusão de lançamento", sem log/print) — um RAG mais sofisticado não teria produzido uma resposta melhor nesse turno específico, porque não havia nada de mais específico na base para encontrar que resolvesse a falta de evidência primária. A melhoria pela busca (seção 17) é real mas endereça um problema diferente (recall de chamados com vocabulário diferente), não comprovadamente o problema relatado pelo usuário.

---

## 19. Código e linguagens — reconfirmado

Sem mudança em relação à primeira auditoria. Linguagens detectadas por extensão (`LINGUAGEM_POR_EXTENSAO`, `extracao-conteudo.js:25-33`): advpl (.prw), tlpp, advpl-header (.ch), sql, json, xml, log, javascript, typescript, python, java, csharp, php, html, css, shell, powershell, yaml, ini, config, csv. `.txt` é deliberadamente ambíguo (`null` no mapa), resolvido por `_detectarLinguagemPorConteudo` (regex para SQL/JSON/XML/ADVPL/log, heurística simples, amostra de 2000 chars). Arquivos sem extensão: mesmo caminho de `.txt` (extensão vazia cai em `LINGUAGEM_POR_EXTENSAO[''] === undefined`, segue para detecção por conteúdo). Limite: a detecção por conteúdo só usa os primeiros 2000 caracteres (`extracao-conteudo.js:84`) — um arquivo onde a assinatura de linguagem só aparece depois disso não seria detectado.

---

## 20. Correção e versionamento — reconfirmado

Sem mudanças relevantes. `versao-fonte-service.js` confirmado: nunca sobrescreve original, cria nova linha em `anexos` com `anexo_original_id`, diff por LCS linha a linha (`calcularDiff`). Não há rótulo literal "REV01"/"REV02" no código — o versionamento é por ordem cronológica (`criado_em ASC`) dentro do mesmo `anexo_original_id`, a numeração é implícita pela posição na lista, não um campo gravado. **Resultado do teste associado à versão**: NÃO EXISTE um campo estruturado — fica implícito no texto da próxima mensagem do analista (seção 23 abaixo detalha isso).

---

## 21. Múltiplos arquivos — validado

Cenário pedido: `service.js` + `repository.js`, pedido "corrija os dois" no mesmo turno.

- **Ambos chegam ao modelo?** SIM — todo anexo com `conteudoExtraido` do turno entra em `anexosTextoDoTurno`, sem limite de quantidade nessa lista (diferente da histórica, que tem limite de 8).
- **Ambos podem ser analisados/corrigidos?** SIM, pela capacidade do modelo — nada no backend limita a IA a corrigir só 1 arquivo por resposta; o prompt pede "Fonte corrigido" no singular, mas isso é uma instrução de formato, não uma trava técnica.
- **Ambos são versionados?** **NÃO — confirmado como limitação real.** `investigacao-service.js:246`: `if (fonteCorrigidoTexto && anexosCodigoDoTurno.length === 1)`. Com 2 anexos de código no turno, essa condição é `false` — **nenhum dos dois é versionado automaticamente**, mesmo que a IA tenha corrigido ambos corretamente no texto da resposta.
- **Como o parser identifica qual bloco corrigido pertence a qual arquivo?** Ele **não identifica** — `_extrairFonteCorrigido` (`investigacao-service.js:50-54`) pega só **o primeiro** bloco de código dentro da seção "Fonte corrigido" via regex `` ```[a-zA-Z]*\n([\s\S]*?)``` ``. Se a IA devolver dois blocos de código na mesma seção (um para cada arquivo), só o primeiro é capturado — e mesmo esse não seria versionado, pela trava de `length === 1` anterior.

---

## 22. Dependências de código — reconfirmado

**NÃO EXISTE** nenhum mecanismo backend de parsing de imports/requires/includes. Confirmado por ausência total de código correspondente em `extracao-conteudo.js` (que só detecta linguagem, não estrutura interna) e em qualquer outro service. Depende inteiramente da interpretação do modelo de IA perceber, pelo texto do código, que uma dependência está ausente e pedir isso na resposta (texto livre, não estruturado).

---

## 23. Multi-turno de correção — simulado e validado

Simulação pedida (problema → IA pede fonte → fonte enviado → REV01 → novo erro reportado):

- **REV01 permanece identificável?** SIM — como uma nova linha em `anexos` com `anexo_original_id` apontando para o original; `anexoRepo.listarVersoes` reconstrói a cadeia completa a qualquer momento.
- **Novo log entra?** SIM, como anexo novo do turno seguinte (`anexosTextoDoTurno`) ou colado como texto na mensagem (sujeito ao limite de 2200 chars quando deixar de ser a mensagem mais recente).
- **Log anterior continua disponível?** SIM, mas sujeito ao limite de 8 anexos históricos / 1800 chars — não é garantido além desse teto.
- **Fonte original continua disponível?** SIM, mesma regra do log anterior — e adicionalmente sempre recuperável via `listarVersoes` (não depende do prompt para existir, só para ser automaticamente *mencionado*).
- **Conteúdo da REV01 volta ao modelo automaticamente no próximo turno?** **NÃO AUTOMATICAMENTE PELO SISTEMA DE VERSIONAMENTO** — a REV01 é um anexo novo (`eCodigo: true` herdado? **não verificado explicitamente no código de `criarVersaoCorrigida`**, mas mesmo que seja true, ela entraria no prompt pela mesma via genérica de "anexo histórico", sujeita ao limite de 8/1800 chars, não por um tratamento especial de "isto é uma correção anterior, priorize-a".
- **Resultado do teste é estruturado?** **NÃO** — "Compilei/testei e apareceu este erro" é só texto livre na próxima mensagem do analista, processado como qualquer outra mensagem do histórico. Não há um campo/tabela "resultado_teste" vinculando REV01 a sucesso/falha.
- **Hipótese anterior é persistida?** Só implicitamente dentro do texto de `diagnostico_json` da resposta anterior (quando o parsing funcionou, 89% dos casos) — não existe um registro estruturado de "hipótese X, status: ainda aberta/descartada".
- **Existe vínculo formal TESTE → REV01 → RESULTADO?** **NÃO.** Confirmado por ausência de schema — nenhuma tabela ou coluna relaciona um resultado de teste a uma versão específica de anexo.

**Diferenciação pedida, respondida diretamente**: **FUNCIONA PELO HISTÓRICO TEXTUAL.** Não existe estrutura específica de rastreamento teste→versão→resultado — tudo que "funciona" nesse fluxo multi-turno de correção funciona porque o modelo de IA lê o histórico de mensagens (texto corrido) e infere a relação, não porque o backend mantém uma estrutura de dados dedicada a isso.

---

## 24. Dossiê Técnico — necessidade real avaliada

**O que `diagnostico_json` cobre hoje, exatamente**: as 7 seções nomeadas extraídas por regex do texto da resposta (`_extrairSecoes`, `investigacao-service.js:28-42`) — Diagnóstico, Causa provável, Evidências, Correção proposta, Fonte corrigido, Alterações realizadas, Validação. É um **snapshot de uma única resposta**, não uma estrutura acumulativa — cada mensagem do assistente tem seu próprio `diagnostico_json` independente; não há merge/consolidação entre turnos (ex.: "hipótese do turno 2 foi descartada no turno 4" não é um dado, é algo que só existiria textualmente dentro da resposta do turno 4, se a IA decidir mencionar).

**Não cobre**: fatos confirmados vs. hipóteses como estado persistente e consultável (só como texto dentro de uma resposta específica); testes e resultados estruturados (seção 23); versões com vínculo formal a resultado; pendências como lista editável; fontes consultadas persistidas (seção 7 — pesquisa não é salva).

**O Dossiê Técnico resolveria uma deficiência real, ou seria complexidade desnecessária agora?**

Minha avaliação, com base no código e dado real: é uma **melhoria real, mas não é causa raiz de nada hoje** — nenhum dos problemas reais encontrados (resposta genérica do caso inspecionado, anexos de imagem não revisitados, ausência de busca web) seria resolvido por um Dossiê Técnico estruturado; o Dossiê ajudaria a **apresentar** melhor o que já existe disperso no histórico de texto, e ajudaria a persistir dado que hoje se perde entre turnos (pesquisa realizada, tokens, decisões). Isso o torna um candidato de **melhoria de observabilidade/estrutura**, não de correção de causa — classificado em P2 (seção 30), não P0/P1.

---

## 25. Casos reais de resposta genérica — identificados e rastreados

Consultei o banco real e identifiquei que, dos 40 atendimentos, **apenas 6 tiveram interação de chat real com resposta de IA** (os outros 34 têm 1 mensagem e 0 respostas — provavelmente chamados importados que nunca passaram por pré-análise ou nunca foram abertos pelo analista no chat). Selecionei o caso mais claro e completo para rastreamento linha a linha, conforme pedido ("não escolher arbitrariamente e tratar como fato" — este é o único dos 6 com um padrão de degradação de qualidade claro e evidência suficiente para rastrear com segurança).

### Caso: Atendimento AI-000009 (empresa 1, origem softexpert/radar, chamado SoftExpert #036593)

```
CHAMADO
↓ Texto original: "Chamado SoftExpert #036593 / Assunto: Exclusão de lançamento /
  Descrição: Exclusão de lançamento / Status: Andamento / Posicionamentos:
  Edson Assis: Segue para atendimento"
  (pré-análise automática, zero anexos no momento da abertura)
↓
MENSAGENS DISPONÍVEIS NO TURNO 1
↓ Só o texto acima — nenhum log, print ou código
↓
CONTEÚDO QUE ENTROU
↓ Texto do chamado inteiro (86 chars) — nada mais
↓
CONTEÚDO CORTADO
↓ Nada cortado (muito abaixo de qualquer limite da seção 6)
↓
PESQUISA REALIZADA
↓ Só links Google dork sugeridos (SERPER/BING ausentes, seção 8/11) — zero resultado real
↓
PROVIDER/MODELO
↓ groq / openai/gpt-oss-20b
↓
RESPOSTA (turno 1)
↓ Honesta e tecnicamente correta: declara explicitamente "não há mais detalhes
  disponíveis", lista 5 hipóteses genéricas de causa, pede 6 itens específicos de
  evidência adicional (mensagem de erro, logs, contexto do registro, permissões,
  versão, regra de negócio).
```

**Onde a qualidade foi perdida — turno 2** (este é o ponto real do problema, não o truncamento):

```
TURNO 2: analista envia imagem "WhatsApp Image...17.03.20.jpeg" + texto "Segue para analise"
↓
A IMAGEM CHEGA AO MODELO (confirmado: resposta cita o texto exato de um erro de tela —
  "Não existem registros no arquivo em pauta. Ou o(s) registro(s) se encontra(m)
  conciliado(s)." — frase que só pode ter vindo da leitura multimodal da imagem)
↓
PROVIDER/MODELO deste turno: openai / gpt-4o-mini (mudou de groq — compatível com
  "groq não suporta imagem, pula para o próximo da fila")
↓
RESPOSTA (turno 2): tecnicamente correta e ESPECÍFICA — cita a mensagem de erro
  real, dá causa provável plausível (registro conciliado), propõe passos de
  verificação concretos.
```

**Avaliação honesta**: ao contrário do que a hipótese de "truncamento causa resposta genérica" sugeriria, **este caso mostra o sistema funcionando bem** — turno 1 é honestamente limitado porque a evidência real era mínima (texto puro, sem imagem ainda), e turno 2 melhora substancialmente assim que a imagem chega, porque o modelo multimodal (GPT-4o-mini) de fato leu o conteúdo da tela. **Isso não é um caso de "resposta genérica por falha do sistema" — é um caso de "resposta limitada pela evidência disponível no momento", que é exatamente o comportamento correto segundo a regra de ouro anti-invenção do próprio system prompt.**

Se o usuário tem outros exemplos específicos (atendimento + mensagem) que considera "genérica demais" além deste padrão, recomendo fortemente que sejam apontados por ID — com apenas 6 atendimentos reais de amostra e este único padrão claro encontrado, **não é possível generalizar uma causa raiz sistêmica a partir do dado disponível neste banco**. Ver declaração formal abaixo.

**NÃO FOI POSSÍVEL VALIDAR, PARA OS OUTROS 5 CASOS COM INTERAÇÃO, SEM INDICAÇÃO EXPLÍCITA DE QUAIS RESPOSTAS O USUÁRIO CONSIDEROU RUINS** — inspecionei os metadados de todos os 6, mas "genérico" é um julgamento de qualidade que só o usuário pode confirmar; o padrão encontrado no AI-000009 é o único onde o próprio texto da resposta se autoqualifica como limitado por evidência insuficiente, o que o torna o candidato mais objetivamente identificável sem uma indicação externa.

---

## 26. Causas raiz — classificação final

| Hipótese | Classificação | Evidência |
|---|---|---|
| Truncamento de histórico/anexos (12 msgs, 8 anexos, 2200/1800 chars) | **DESCARTADA como causa observada até hoje** — ainda é um risco real para o futuro | Nenhum dos 40 atendimentos reais chega perto desses limites (máximo real: 6 mensagens, 2 anexos) |
| Imagens históricas nunca revisitadas (achado novo desta etapa) | **FORTEMENTE INDICADA como limitação real, não confirmada como causa de um caso observado** | Confirmado por código (seção 5); nenhum dos 6 atendimentos reais teve um turno tardio que dependesse de reler uma imagem antiga — mas o padrão de uso real (imagens de WhatsApp enviadas cedo, investigação continuando por texto depois) é exatamente o cenário onde isso morderia |
| PDF perde conteúdo visual | **POSSÍVEL, NÃO VALIDÁVEL COM DADO REAL** — único PDF do banco nunca foi processado por um turno de IA |
| Ausência de pesquisa web real (chaves não configuradas) | **CONFIRMADA** | `.env` sem as chaves, comportamento `modo:'links'` confirmado no código para esse estado |
| Ausência de fetch de conteúdo de página mesmo com busca ativa | **CONFIRMADA** (como limitação estrutural do código, independente de configuração) | Ausência de código, seção 9 |
| Modelo/provider fraco | **DESCARTADA como causa isolada** | O caso real inspecionado mostra o GPT-4o-mini produzindo resposta específica e correta quando tinha evidência suficiente (imagem) — o modelo não é o fator limitante quando a evidência existe |
| Busca histórica heurística (não semântica) | **POSSÍVEL para casos de vocabulário divergente, não confirmada no caso real inspecionado** | Seção 17 — ponto fraco teórico real, mas o caso inspecionado não dependia de similaridade textual com outro chamado |
| Falta de Quality Gate / segunda opinião | **AMPLIFICADOR confirmado, não causa raiz** — ver seção 27 |
| Falta de Dossiê Técnico | **NÃO CONFIRMADA COMO CAUSA** — ver seção 24 |
| Ausência de RAG | **DESCARTADA como causa do caso real observado** — seção 18 |
| Ausência de Model Router sofisticado | **NÃO CONFIRMADA COMO CAUSA** — o routing simples atual (por imagem) já produziu o comportamento correto no caso real (trocou para GPT-4o-mini quando havia imagem) |
| **Evidência insuficiente fornecida pelo analista no primeiro contato** | **CONFIRMADA como causa real no único caso rastreado em detalhe** — não é um problema de arquitetura do IA Service, é uma característica do fluxo de abertura de chamado (pré-análise automática roda sobre o texto mínimo que o chamado tem no momento da alocação, antes de qualquer anexo) |

---

## 27. Causa vs. Amplificador vs. Limitação vs. Melhoria futura

### CAUSA RAIZ (confirmada no caso real)
- Pré-análise automática roda sobre evidência mínima (texto puro do chamado, sem anexos ainda) — produz, corretamente, uma resposta honesta mas pouco acionável. Isso é esperado dado o design (regra de ouro anti-invenção), não um bug — mas pode ser a origem da percepção de "resposta genérica" se o analista avalia a qualidade pela primeira resposta (pré-análise) em vez do fluxo completo.

### AMPLIFICADORES (permitem que uma resposta fraca chegue ao analista sem ser filtrada)
- Ausência de Quality Gate / fallback por qualidade (seção 15) — uma resposta pobre nunca é re-tentada ou sinalizada automaticamente.
- Ausência de persistência de pesquisa/tokens (seção 7) — dificulta auditar depois *por que* uma resposta específica foi fraca.

### LIMITAÇÕES (reduzem capacidade em cenários específicos, não causam o problema observado hoje)
- Truncamento por contagem fixa em vez de tokens (seção 6) — risco real só em investigações longas, que ainda não ocorreram nos dados reais.
- Imagens históricas nunca revisitadas (seção 5) — risco real em investigações longas com evidência visual cedo na conversa.
- PDF sem extração de conteúdo visual (seção 4).
- Busca histórica heurística fraca para vocabulário divergente (seção 17).
- Ausência de fetch de conteúdo de página (seção 9) — limita a profundidade da pesquisa mesmo se ativada.
- Múltiplos arquivos de código no mesmo turno não são versionados automaticamente (seção 21).

### MELHORIAS FUTURAS (úteis, não explicam o problema atual)
- Dossiê Técnico estruturado (seção 24).
- Vínculo formal teste→versão→resultado (seção 23).
- Model Router por complexidade/linguagem (seção 14).
- RAG/busca semântica para a base histórica (seção 18).

---

## 28-31. Prioridades

### P0 — Validar/corrigir imediatamente
1. **Confirmar com o usuário/time se há outros exemplos concretos de "resposta genérica"** além do padrão identificado aqui — sem isso, qualquer correção adicional estaria endereçando uma hipótese, não um fato observado (dado real disponível é pequeno: só 6 atendimentos com interação).
2. **Decidir se as chaves de busca web (SERPER/BING) devem ser configuradas** — é a única causa 100% confirmada e é a correção de menor custo (configuração, não código).
3. **Persistir `usage`/tokens por mensagem** — pequena mudança de schema+código, necessária para instrumentar qualquer decisão futura sobre truncamento com dado real (hoje não dá para medir).

### P1 — Alto impacto
4. Reenviar/permitir referenciar imagens de turnos anteriores quando relevante ao turno atual (resolve a limitação real da seção 5).
5. Orçamento de truncamento por tokens reais em vez de contagem/caracteres fixos (seção 6) — mas só depois do item 3 (instrumentação) confirmar que isso é necessário com volume real de uso maior.
6. Versionar corretamente quando há múltiplos arquivos de código no mesmo turno (seção 21).

### P2 — Evolução
7. Dossiê Técnico estruturado (persistir fatos/hipóteses/pendências entre turnos, não só por resposta).
8. Vínculo formal teste→versão→resultado.
9. Extração de imagens internas de PDF para análise multimodal.
10. Fetch de conteúdo real de páginas encontradas na pesquisa (não só snippet) — só relevante depois do item 2 (P0) ser resolvido.

### P3 — Somente se benchmark justificar
11. Busca semântica/embeddings para a base histórica — justificada teoricamente (seção 17, Casos B/D) mas sem caso real que comprove necessidade ainda; volume de dados atual (~dezenas de chamados neste ambiente) não justifica a complexidade de um vector DB.
12. Model Router sofisticado por linguagem/complexidade.
13. Multiagente / segunda opinião automática.
14. RAG formal.

---

## 32. Componentes que devem ser preservados

- Toda a arquitetura `routes → service → repository → SQLite`, sem exceção.
- `prompt-builder.js` — regra de ouro anti-invenção, diferenciação de níveis de confiança, tratamento de diagnóstico humano já fechado.
- Versionamento com preservação do original (`versao-fonte-service.js`) — funciona corretamente para o caso de 1 arquivo.
- As duas correções de fail-closed já aplicadas (imagem corrompida interrompe o turno; resposta truncada avisa visivelmente) — confirmadas corretas e já em produção (código HEAD).
- O vínculo anexo→mensagem em ambos os sentidos (manual e automático) — confirmado correto no HEAD, só o dado histórico é anterior a ele.
- O scoring heurístico da base histórica para o volume atual — não há evidência de que precise ser substituído agora.
- A honestidade do sistema sobre pesquisa não configurada (nunca finge ter pesquisado) — comportamento correto, só precisa que a config seja ativada.

---

## 33. O que precisa de runtime (não validável nesta etapa)

- **NÃO VALIDADO EM RUNTIME**: se as chaves de IA (groq/openai/claude/gemini/deepseek) presentes em `platform_ai_configs` são de fato válidas (autenticam com sucesso). Como verificar: usar a rota de teste já existente (mencionada em `ai-provider-client.js:169`, algo como `/api/ia-service/config/ia/testar`) para cada provider, sem precisar gerar uma investigação real. Resultado a coletar: sucesso/erro por provider, por empresa.
- **NÃO VALIDADO EM RUNTIME**: comportamento real de um turno com histórico de 13+ mensagens ou 9+ anexos — não existe caso real no banco atual. Como verificar: ou aguardar uso orgânico acumular esse volume, ou gerar um teste controlado em ambiente de homologação (não produção) com um atendimento sintético, medindo o prompt final gerado.
- **NÃO VALIDADO EM RUNTIME**: resultado de um PDF com conteúdo visual relevante sendo de fato perdido numa resposta real — nenhum PDF do banco atual passou por uma investigação completa. Como verificar: rodar um turno real com um PDF que contenha um screenshot de erro embutido e conferir se a resposta da IA menciona esse conteúdo visual ou não.
- **NÃO VALIDADO EM RUNTIME**: impacto real de ativar SERPER_API_KEY ou BING_SEARCH_API_KEY na qualidade percebida das respostas — requer configurar a chave (ação de infraestrutura, fora do escopo desta etapa) e comparar respostas antes/depois para o mesmo tipo de chamado.
- **NÃO VALIDADO EM RUNTIME**: se os outros 5 atendimentos reais com interação (além do AI-000009 detalhado) contêm casos que o usuário consideraria "genéricos" — depende de indicação humana de quais respostas foram avaliadas como ruins.

---

## 34. Recomendação final

Não constatei, nesta validação baseada em evidência de runtime real, uma causa estrutural única e sistêmica para "respostas genéricas" — o volume de uso real até agora (6 atendimentos com interação) é pequeno demais para generalizar, e o único caso rastreável em detalhe mostra o sistema se comportando corretamente (honesto quando faltava evidência, específico assim que a evidência — uma imagem — chegou). 

A ação de maior valor imediato não é arquitetural: é **(1) o usuário apontar exemplos concretos de atendimentos/respostas que considera genéricas**, para que a próxima etapa de investigação (ou já a implementação) mire em causas confirmadas por caso real, e **(2) ativar a busca web real** (única causa 100% confirmada como ausente hoje), que é configuração, não código. Instrumentar `usage`/tokens (P0, item 3) é o pré-requisito técnico para que qualquer decisão futura sobre truncamento deixe de ser inferência e vire medição.

Não recomendo iniciar RAG, Model Router complexo, multiagente ou Dossiê Técnico nesta fase — nenhum tem evidência de resolver um problema hoje confirmado; são corretos como evolução (P2/P3), não como resposta à pergunta "por que as respostas estão genéricas".

---

**Fim da validação técnica. Nenhum código foi alterado. Aguardando comparação com a validação independente antes de qualquer decisão de implementação.**
