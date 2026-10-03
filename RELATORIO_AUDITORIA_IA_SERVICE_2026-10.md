# Auditoria do IA Service — Motor de Investigação Técnica

**Data**: 2026-10-02 | **Status**: Somente leitura, conforme solicitado — nenhuma alteração de código feita.
**Método**: leitura direta do código-fonte em `apps/IA Service/backend/`, sem execução (não há acesso a runtime/logs de produção nesta sessão). Tudo abaixo é **CONFIRMADO PELO CÓDIGO** salvo indicação contrária.

---

## 1. Resumo executivo

O IA Service é uma aplicação real e funcional (não um protótipo), com arquitetura limpa (`routes → service → repository → SQLite`), bem documentada por 4 relatórios de etapa próprios (`IA_SERVICE_ETAPA*.md` na raiz do repo). Ela já implementa boa parte do que o prompt pede: multi-turno com histórico persistido, 4 providers de IA com fallback, anexos multimodais, pesquisa técnica externa direcionada (TDN/Central TOTVS/SoftExpert), base histórica de chamados do SoftExpert, versionamento de correções com diff, e uma regra de ouro anti-invenção no system prompt.

**O diagnóstico central da causa das respostas genéricas não é "falta de arquitetura" — é um conjunto específico de 4 pontos de truncamento/perda silenciosa de contexto**, todos identificáveis e com correção pontual (seção 17). Não há evidência de que o problema seja o modelo, o provider, ou a ausência de RAG/embeddings — a base histórica usa scoring heurístico textual, o que é adequado ao volume atual e **não é a causa raiz** das respostas ruins.

---

## 2. Arquitetura atual (confirmado pelo código)

```
apps/IA Service/
├── backend/
│   ├── database/        (SQLite via better-sqlite3, WAL, migrations v1→v16+)
│   ├── repositories/     (único ponto de SQL por tabela)
│   ├── services/         (regra de negócio; SEM SQL direto)
│   └── routes/
├── frontend/             (HTML/JS, sem framework)
└── data/
    ├── ia-service.db
    └── anexos/<empresa_id>/<atendimento_uuid>/<arquivo_uuid>.<ext>
```

Banco próprio, isolado do IA Command (nenhum `require` cruzado). Serviços centrais do fluxo de investigação:

| Arquivo | Papel |
|---|---|
| `investigacao-service.js` | Orquestrador do turno — monta contexto, chama IA, persiste, versiona correção |
| `prompt-builder.js` | System prompt fixo + montagem do prompt de usuário |
| `ai-provider-client.js` | Motor multi-provider com fallback |
| `ai-config-service.js` | Resolve chaves/ordem de fallback por empresa |
| `extracao-conteudo.js` | Extração de texto/linguagem/encoding de anexos |
| `technical-research-service.js` | Pesquisa externa direcionada por domínio (TDN/Central TOTVS/SoftExpert) |
| `chamado-repository.js` | Scoring heurístico de chamados semelhantes na base histórica |
| `versao-fonte-service.js` | Versionamento de correções + diff LCS |

---

## 3. Fluxo real do turno (`investigacao-service.processarTurno`)

```
mensagem do analista + anexoIds
   ↓
persiste mensagem do usuário no histórico (ANTES de chamar a IA)
   ↓
carrega anexos do turno (texto já extraído na gravação) + anexos de imagem (lidos do disco agora)
   ↓
pesquisa técnica (technical-research-service) — best-effort, nunca bloqueia o turno
   ↓
monta userPrompt (prompt-builder.buildUserPrompt): histórico + inventário de anexos + anexos de texto + pesquisa técnica
   ↓
valida integridade de cada imagem lida do disco (tamanho gravado == tamanho lido) — ABORTA o turno se falhar
   ↓
chamarIA(keys, cfg, SYSTEM_PROMPT, userPrompt, imagens, {maxTokens:6000, timeoutMs escalado})
   ↓
detecta resposta truncada por limite de tokens → anexa aviso visível no texto salvo
   ↓
extrai seções estruturadas (regex sobre **Título**) → grava diagnostico_json
   ↓
se houver "Fonte corrigido" + exatamente 1 anexo de código no turno → versiona automaticamente
   ↓
persiste mensagem do assistente
```

Este fluxo é mais disciplinado do que a média de sistemas desse tipo: mensagem do usuário é persistida **antes** da chamada à IA (não se perde o texto do analista se a IA falhar), e há dois **fail-closed explícitos e documentados no próprio código** (não fail-open silencioso):

1. **Imagem corrompida/ilegível interrompe o turno** (`investigacao-service.js:153-184`) — comentário no código cita bug real de 2026-10 (chamado com 7 fotos de WhatsApp recebeu diagnóstico genérico porque uma falha de leitura só gerava `console.warn`).
2. **Resposta truncada por `max_tokens` é sinalizada no próprio texto da resposta** (`investigacao-service.js:213-222`), não só logada.

Essas duas correções já foram feitas pelo usuário/time antes desta auditoria — não são achados novos, mas confirmam que a causa de "respostas genéricas" já vinha sendo investigada e corrigida nesse sentido. O que segue abaixo são os pontos que **ainda não foram cobertos** por essas correções.

---

## 4. Anexos: armazenado vs. realmente analisado

| Tipo | Armazenado | Extraído | Enviado ao modelo | Observação |
|---|---|---|---|---|
| Texto/código/log/SQL/JSON/XML | Sim | Sim (string completa, decodificada UTF-8/Latin-1) | Sim, inline no prompt | Limite de 180.000 caracteres no armazenamento (`_limitarTextoExtraido`), truncamento adicional de 2200/1800 chars ao montar o prompt (ver seção 6) |
| Imagem (PNG/JPEG/GIF/WEBP) | Sim | N/A | Sim, base64 inline multimodal (`image_url`/`image`/`inline_data` conforme provider) | **Não há OCR separado** — a leitura é inteiramente delegada à visão do modelo. Groq nunca recebe imagem (não suporta) |
| PDF | Sim | Texto via `pdf-parse` | Sim, como texto (mesmo pipeline de anexo textual) | **Gráficos, diagramas e screenshots embutidos no PDF são perdidos** — `pdf-parse` extrai só texto, nenhuma rasterização de página nem extração de imagem interna é feita |
| CSV/planilha | Tratado como texto puro | Sim | Sim, como texto bruto | Sem parsing estruturado (não normaliza para tabela) |

**Diferenciação armazenado vs. analisado, pedida na seção 9 do prompt**: confirmado que todo anexo de texto que teve `conteudoExtraido` preenchido é, de fato, incluído no prompt — não há casos de anexo "catalogado mas nunca lido". A exceção real é o PDF com conteúdo visual (ver seção 6 abaixo), que é "lido" só parcialmente.

---

## 5. Payload real enviado ao provider (rastreado até a chamada HTTPS)

Confirmado em `ai-provider-client.js`, funções `_chamarOpenAICompat`/`_chamarAnthropic`/`_chamarGemini`:

- **Texto**: string bruta (prompt completo montado por `prompt-builder.js`), sem resumo nem reescrita — o que está no prompt é literalmente o que chega ao modelo.
- **Imagem**: base64 inline, formato correto por provider (`image_url` OpenAI-compat, `image` Anthropic, `inline_data` Gemini). Nenhuma URL, nenhum ID de arquivo — sempre bytes.
- **Nenhum uso de File API / Files endpoint** de nenhum provider — tudo é payload síncrono por requisição.
- **Não há tool calling / function calling configurado** em nenhuma chamada — `chamarIA` é uma chamada única de texto+imagem, sem ferramentas. Pesquisa web e busca na base histórica acontecem **antes** da chamada ao modelo, no backend, e são injetadas como texto no prompt — o modelo nunca decide buscar algo, apenas recebe o que o backend já pesquisou.

**Resposta à seção 10 do prompt** ("o que efetivamente chega ao modelo"): texto bruto + base64 de imagem. Nunca nome de arquivo sozinho, nunca resumo pré-modelo, nunca ID/URL.

---

## 6. Pontos de perda/truncamento de contexto (CONFIRMADO PELO CÓDIGO)

Esta é a seção mais relevante para a causa raiz das respostas genéricas. Quatro truncamentos distintos, todos silenciosos (não avisam a IA nem o analista de que houve corte):

### 6.1 Histórico de mensagens — últimas 12, sem medir tokens
`prompt-builder.js:113` — `mensagens.slice(-12)`. Corte por **contagem de mensagens**, não por tamanho real. Um atendimento com 12 mensagens curtas cabe folgado; um atendimento com 12 mensagens longas (logs colados no corpo do texto, por exemplo) pode estourar o limite do provider antes mesmo de chegar aos anexos. Há um aviso textual inserido no prompt quando corta (`[Sistema]: N mensagens antigas foram omitidas`), mas é aviso **para a IA**, não para o analista — o analista não sabe que parte do histórico sumiu.

### 6.2 Cada mensagem do histórico é truncada em 2200 caracteres
`prompt-builder.js:90-96,119` — `_limitarTexto(m.conteudo)`, default `max=2200`. Se um analista colar um log de 5000 caracteres **dentro do texto de uma mensagem** (não como anexo), apenas ~2200 caracteres sobrevivem quando essa mensagem deixar de ser a mais recente — com omissão no **meio** do texto (mantém 72% do início + 28% do fim). Isso é razoável para preservar início/fim de um stack trace, mas **qualquer coisa relevante que estava no meio do log é perdida sem aviso**.

### 6.3 Anexos de texto do histórico (não do turno atual) — só os 8 mais recentes, 1800 chars cada
`prompt-builder.js:132-137` — `anexosTextoHistorico.slice(-8)`, cada um truncado a 1800 caracteres via `_limitarTexto`. Em uma investigação longa (o cenário multi-turno que o prompt do usuário pede explicitamente como requisito central, seções 51-54), um 9º anexo de texto enviado cedo na conversa **deixa de ser reenviado ao modelo** nos turnos seguintes — ele só aparece no "inventário" (nome + metadados, seção 6.4), não mais com conteúdo. Se a correlação que a IA precisa fazer depende desse anexo antigo, a informação já não está mais no prompt.

### 6.4 Inventário de anexos — só os 30 mais recentes
`prompt-builder.js:127` — `todosAnexos.slice(-30)`. Em atendimentos muito longos, anexos mais antigos desaparecem até do inventário (lista de nomes), não só do conteúdo.

### 6.5 Pesquisa técnica — truncada em 3600 caracteres
`prompt-builder.js:147` — resultado de `technical-research-service` cortado a 3600 chars antes de entrar no prompt.

**Conclusão da seção 6**: nenhum desses limites é absurdo isoladamente, mas **nenhum deles é medido em tokens reais nem comunicado ao analista**. A combinação de (a) histórico de 12 mensagens, (b) 2200 chars por mensagem, (c) 8 anexos históricos de 1800 chars, (d) 3600 chars de pesquisa, com `maxTokens: 6000` de resposta, é plausivelmente a causa mais direta de "respostas genéricas" em investigações **longas e multi-turno** — exatamente o cenário que o documento do usuário mais valoriza (seção 51: "investigação multi-turno é obrigatória"). Em turnos curtos (1-2 mensagens, poucos anexos), esse truncamento não é um fator.

Isso é **inferência correlacionando os limites do código com o sintoma relatado**, não uma medição direta de produção — para confirmar definitivamente, seria necessário instrumentar `investigacao-service.js` para logar o tamanho real do prompt montado e comparar com casos relatados como "resposta genérica" (ver seção 9, Observabilidade, abaixo).

---

## 7. Prompts (auditoria de conteúdo)

`prompt-builder.js` — um único `SYSTEM_PROMPT` fixo (não há prompt por domínio/produto nem prompt separado para "análise de código" vs "diagnóstico"). Pontos fortes confirmados:

- Regra de ouro anti-invenção explícita e bem redigida (não inventar quando faltar evidência).
- Diferenciação de 4 níveis de confiança exigida (fato / hipótese / causa provável / conclusão confirmada), sem percentuais artificiais.
- Instrução explícita de correlacionar evidências entre si, não analisar cada anexo isoladamente.
- Tratamento de "diagnóstico humano já fechado" — evita reabrir investigação que o analista já encerrou (boa prática, evita resposta redundante/genérica em perguntas pontuais).
- Guarda contra prompt injection via conteúdo de anexo (seção dedicada, trata conteúdo de arquivo como dado, nunca instrução).
- Formato de resposta estruturado em 9 seções nomeadas, usado depois por `_extrairSecoes` via regex — **acoplamento direto entre o texto do system prompt e o parser**: se a IA variar a grafia dos títulos das seções (ex.: "Diagnostico" sem acento, ou título fora do negrito `**...**`), o parsing falha silenciosamente e cai no fallback "tudo em texto corrido", perdendo a estrutura (mas não o conteúdo — o comentário em `investigacao-service.js:26` confirma essa decisão consciente de degradação graciosa).

**Não encontrado**: prompt diferente por domínio (Protheus vs SoftExpert vs genérico) — o prompt é o mesmo sempre, a diferenciação de domínio acontece só na pesquisa técnica (`technical-research-service.detectarDominio`), não no system prompt da IA principal. Isso é uma simplificação deliberada razoável (evita inchar o prompt, indo contra a seção 17 do CLAUDE.md do projeto sobre "menos é mais" em specs) — não é um problema por si só.

---

## 8. Os 4 providers/IAs (matriz real)

Confirmado em `ai-provider-client.js` + `migrations.js` (schema `ai_config` v7, estendido v9/v10):

| Provider | Modelo atual (default) | Suporta imagem | Tipo de API |
|---|---|---|---|
| Groq | `openai/gpt-oss-20b` | **Não** | OpenAI-compatível |
| OpenAI | `gpt-4o-mini` | Sim | OpenAI-compatível |
| Claude | `claude-haiku-4-5-20251001` | Sim | Anthropic nativa |
| Gemini | `gemini-3.5-flash` | Sim | Gemini nativa |

**Nuance real encontrada**: o motor (`PROVIDER_CONFIGS` em `ai-provider-client.js`) suporta um 5º provider, **DeepSeek**, mas a tabela `ai_config` (o que a empresa de fato configura na UI) **não tem colunas para DeepSeek** — só groq/openai/claude/gemini. DeepSeek só entraria em jogo se alguém configurasse via variável de ambiente (`ai-config-service.js`, cascata de resolução), não pela tela de configuração. Isso bate com "4 IAs configuradas" do prompt do usuário, mas é importante que o time saiba que o código já tem o 5º plugado e pronto, caso decidam habilitá-lo na UI.

**Ordem de fallback default diverge entre duas camadas**: `ai-config-repository.js` usa `'groq,openai,claude,gemini'` como default no INSERT; `ai-config-service.js` usa `'groq,deepseek,openai,claude,gemini'` como fallback hardcoded quando não há config nenhuma. Não é um bug ativo (a segunda só é usada se a primeira não existir), mas é uma inconsistência que vale alinhar.

**Modelo Haiku 4.5 e Gemini 3.5**: os nomes de modelo configurados (`claude-haiku-4-5-20251001`, `gemini-3.5-flash`) já são versões atuais — não há evidência de modelo desatualizado/descontinuado no código.

**Routing por capacidade**: existe, mas é bem simples — a única capacidade roteada é "suporta imagem" (`chamarIA` pula provider sem `suportaImagem` quando há imagens no turno). Não há routing por tipo de linguagem de código, por complexidade da pergunta, nem por tamanho de contexto necessário.

**Segunda opinião / validação cruzada (seção 23/24 do prompt)**: **não encontrado**. Não há nenhum mecanismo que chame uma segunda IA para revisar criticamente a resposta da primeira. Fallback existe apenas para **falha técnica** (erro/timeout/falta de chave/cota esgotada), nunca por **qualidade da resposta** — uma resposta tecnicamente bem-formada, mas genérica/rasa, nunca aciona fallback, porque não há nenhum critério de qualidade avaliado no código.

---

## 9. Observabilidade — o que existe e o que falta

**Existe**: `resultado.provider`, `resultado.model`, `resultado.truncado` e `usage` (tokens) são retornados por `chamarIA` e gravados na mensagem (`mensagemRepo.salvarMensagem`, campos `provider`/`model`). Erros de providers (`erros` array em `chamarIA`) são capturados com motivo por provider.

**Não encontrado**: nenhum log estruturado do **tamanho real do prompt montado** (chars/tokens) por turno, nem registro de "quantos anexos/mensagens foram cortados neste turno específico" fora do aviso textual embutido no próprio prompt (seção 6.1). Isso significa que, hoje, **não há como medir retroativamente** quantas respostas "genéricas" relatadas pelo usuário coincidem com truncamento de histórico/anexos — essa correlação (seção 6) é plausível mas **ainda não validada em runtime**, por falta exatamente desse dado.

---

## 10. Base histórica de chamados

Tabelas `chamados`/`posicionamentos` (migrations v15), alimentadas por importação do SoftExpert via SQL Server (`historical-import-service.js`, Agente Local). Busca em `chamado-repository.listarChamadosRelacionados`:

- **Não é RAG, não é embeddings, não é FTS5.** É scoring heurístico: pesos fixos por campo estruturado batendo (produto=18, módulo=22, família=14, serviço=10, tipo=6, solução aplicada=8, encerrado=6) + contagem de tokens de texto livre em comum (até 30 pontos). Limite de 1200 candidatos mais recentes por empresa antes de pontuar (full scan em memória, não índice).
- Documento próprio do projeto (`IA_SERVICE_ETAPA2_BASE_HISTORICA_RAG.md`) já registra isso como decisão consciente, com FTS5/embeddings/vetorial como checkpoints futuros **ainda não implementados**.
- Qualidade da base (seção 29 do prompt): **não encontrado** nenhum filtro que distinga chamado "resolvido com solução validada" de "encerrado administrativamente" além do campo `solucaoAplicada` presente/ausente (+8 pontos) e `statusEncerramento === 'Encerrado'` (+6 pontos). Não há tratamento de chamado duplicado, cancelado, ou com diagnóstico incorreto confirmado posteriormente — a base trata todo chamado histórico com peso igual, exceto esses dois sinais binários.

**Minha avaliação técnica**: para o volume atual (milhares de chamados, não milhões), esse scoring heurístico é adequado e não deveria ser trocado por embeddings só por tendência — a pontuação por campo estruturado (produto/módulo/família) é, na prática, mais confiável que similaridade semântica pura para esse domínio, porque os campos estruturados do SoftExpert já carregam o sinal mais forte. O ganho de uma busca híbrida (lexical + semântica) viria principalmente para capturar chamados com **descrição textual parecida mas metadados diferentes** (ex.: mesmo sintoma relatado em módulos diferentes por erro de categorização do atendente) — é uma melhoria real, mas não é a causa das respostas genéricas hoje (a IA já recebe os relacionados formatados corretamente, seção 6 do prompt técnico, quando o scoring encontra algum).

---

## 11. Pesquisa externa (TDN, Central TOTVS, SoftExpert docs)

Confirmado, `technical-research-service.js`:

- Detecção de domínio por score de termos + peso extra (3 pontos) se `chamado.produto` bater exatamente — correção documentada no próprio código para um bug real (chamado #036612 caía em "genérico" por falta desse peso).
- Fontes: TDN (`tdn.totvs.com`), Central TOTVS (`centraldeatendimento.totvs.com`), SoftExpert (`softexpert.com`, `help.softexpert.com`) — via Google dork (`site:...`) como link sugerido, **e também** via busca real (Serper ou Bing) se `SERPER_API_KEY`/`BING_SEARCH_API_KEY` estiverem configuradas no ambiente.
- **Ponto crítico**: se nenhuma chave de busca estiver configurada (`pesquisa.configurado === false`), o sistema **nunca faz uma pesquisa real** — apenas gera links `site:...` formatados e os injeta no prompt como "trilha de pesquisa sugerida", deixando explícito no texto que não é resultado confirmado. Isso é honesto (não finge ter pesquisado), mas significa que, **sem essas chaves configuradas**, a seção "Pesquisa técnica" do prompt descrito no documento do usuário (TDN, Central TOTVS, SoftExpert docs) está sempre vazia de conteúdo real — só links clicáveis que a IA não pode seguir. **Verificar se `SERPER_API_KEY` ou `BING_SEARCH_API_KEY` estão de fato configuradas em produção é o primeiro item a confirmar** — se não estiverem, isso sozinho explica por que "pesquisa técnica" nas respostas parece superficial/genérica: o sistema está literalmente sem acesso à internet, apesar do código estar pronto para isso.
- GitHub oficial TOTVS, fóruns, Stack Overflow (seções 42/47 do prompt): **não encontrado** nenhuma integração — só Google dork genérico (`https://www.google.com/search?q={query}`) como fallback final.

---

## 12. Multi-turno e novos anexos durante a conversa

Confirmado como funcional: `atendimento-service`/`mensagem-repository` persistem histórico completo; `investigacao-service.processarTurno` sempre recupera o histórico antes de montar o prompt; novos anexos em qualquer turno são vinculados à mensagem e entram em `anexosTextoDoTurno` (conteúdo completo) ou `anexosTextoHistorico` (conteúdo, até o limite da seção 6.3). O requisito central do documento do usuário (seções 51-54: investigação contínua, não reiniciar a cada mensagem) **está implementado corretamente na estrutura** — a limitação real não é arquitetural, é o truncamento numérico (seção 6).

**Correlação log-antes/depois de correção (seção 54 do prompt)**: não há lógica especial para isso — é tratado implicitamente pelo histórico de mensagens normal (a IA vê o log anterior e o novo, se ambos couberem nos limites da seção 6, e o system prompt instrui genericamente a "continuar a mesma linha de raciocínio"). Não há comparação estruturada automática (ex.: diff entre logs, tabela antes/depois). Funciona por capacidade do modelo de ler o histórico, não por um mecanismo determinístico do backend.

---

## 13. Análise universal de código e correção multilinguagem

`extracao-conteudo.js` detecta linguagem por extensão + fallback por conteúdo (regex heurística: SQL, JSON, XML, ADVPL, log) para um conjunto real de linguagens (advpl, tlpp, sql, json, xml, javascript, typescript, python, java, csharp, php, shell, powershell, html, css, yaml). A análise semântica do código em si (bugs, dependências, segurança) é **inteiramente delegada ao modelo de IA** — não há parser/AST/linter embutido no backend, o que é a decisão correta (documentado explicitamente no comentário do arquivo: "a IA, não este módulo, faz a análise semântica").

**Detecção de dependências ausentes (seção 60 do prompt)**: **não encontrado** nenhum mecanismo automático — depende inteiramente do modelo perceber, pelo texto do código, que falta uma função/include referenciada e pedir isso na resposta. Não há parsing de imports/requires para sugerir automaticamente "este arquivo depende de X, que não foi anexado".

**Versionamento e diff**: confirmado e bem implementado (`versao-fonte-service.js`) — nunca sobrescreve original, cria nova linha em `anexos` com `anexo_original_id` apontando para a v1, diff por LCS linha a linha, acionado automaticamente quando a IA retorna seção "Fonte corrigido" e há exatamente 1 anexo de código no turno. **Limitação real**: só versiona automaticamente quando há **exatamente 1** anexo de código no turno (`investigacao-service.js:246`) — se o analista enviar 2 arquivos de código no mesmo turno e pedir correção de ambos, nenhum é versionado automaticamente (a correção ainda aparece no texto da resposta, só não vira uma nova versão de anexo rastreável).

---

## 14. Problemas encontrados, classificados

**CRÍTICO**
- Nenhum. Não há vazamento de dados entre empresas, não há prompt injection funcional (guarda explícita no system prompt), não há perda de anexo "silenciosa e não documentada" — os dois casos que existiam (imagem corrompida, resposta truncada) já foram corrigidos antes desta auditoria.

**ALTO**
- Truncamento de histórico/anexos por contagem fixa, não por tokens reais, sem instrumentação para medir impacto real (seção 6 + 9). Principal suspeito técnico das respostas genéricas em investigações longas.
- Pesquisa web real condicionada a `SERPER_API_KEY`/`BING_SEARCH_API_KEY` — se ausentes em produção, a seção "pesquisa técnica" do prompt é sempre vazia de conteúdo real (seção 11). **Precisa ser confirmado em runtime** (ver seção 16).
- PDF com conteúdo visual (gráficos, screenshots embutidos) perde essa informação — só texto é extraído (seção 4/6.1 do prompt original do usuário).

**MÉDIO**
- Ausência de "segunda opinião"/fallback por qualidade — só há fallback técnico (seção 8). Resposta tecnicamente formatada mas rasa nunca é reavaliada.
- Inconsistência de ordem de fallback default entre `ai-config-repository.js` e `ai-config-service.js` (seção 8).
- Versionamento automático de correção só cobre o caso de exatamente 1 anexo de código por turno (seção 13).

**BAIXO**
- DeepSeek pronto no motor mas sem campo na UI de configuração (seção 8).
- System prompt único, sem variação por domínio (aceitável, mas vale observar se crescer).

---

## 15. Causas prováveis das respostas genéricas — ranking por confiança

1. **Truncamento de contexto em investigações longas/multi-turno** (seção 6) — INFERIDO com alta plausibilidade, mas não confirmado em runtime por falta de instrumentação (ver recomendação na seção 16). É a explicação mais compatível com o padrão descrito pelo usuário ("pouco relacionadas às evidências específicas", "sem demonstrar que todos os anexos foram analisados") quando o atendimento tem muitas mensagens/anexos acumulados.
2. **Ausência de pesquisa web real por falta de chave configurada** (seção 11) — fácil de confirmar (checar variável de ambiente em produção), potencialmente a explicação mais simples e mais rápida de corrigir se for o caso.
3. **Ausência de fallback por qualidade** (seção 8) — não causa a resposta genérica, mas explica por que ela **chega ao analista sem ser filtrada**: mesmo que a primeira IA responda mal, nada no sistema reavalia ou tenta de novo.

Não encontrei evidência de que o modelo escolhido (Haiku 4.5, GPT-4o-mini, Gemini 3.5 Flash) seja inadequado para a tarefa — são modelos atuais e capazes; não há indício de que trocar de modelo, sozinho, resolva o problema sem antes tratar os pontos acima.

---

## 16. O que ainda precisa ser validado em runtime (não posso confirmar por leitura de código)

- Se `SERPER_API_KEY` ou `BING_SEARCH_API_KEY` estão de fato setadas no ambiente de produção.
- Tamanho real (em tokens, não caracteres) dos prompts montados em casos reais relatados como "resposta genérica" — recomendo adicionar um log temporário em `investigacao-service.js` medindo `userPrompt.length` e quantos itens foram cortados em cada um dos 4 pontos da seção 6, correlacionando com os atendimentos que o usuário já identificou como exemplos de resposta ruim.
- Se os 4 providers configurados em produção têm chave válida e qual é usado na prática como primário (a ordem default é `groq` primeiro — Groq não suporta imagem e usa um modelo menor, `gpt-oss-20b`; se a maioria dos chamados tem imagem, o sistema pula direto para o segundo da fila, mas vale confirmar essa é realmente a config ativa).

---

## 17. Recomendação — próximos passos (sem implementar ainda, conforme pedido)

Nenhuma mudança de arquitetura é necessária agora. Recomendo, em ordem de custo/benefício:

1. **Confirmar as chaves de busca web em produção** (5 minutos, zero código) — se ausentes, configurá-las resolve a causa #2 da seção 15 imediatamente.
2. **Instrumentar temporariamente o tamanho do prompt e os pontos de corte** (pequeno, não-invasivo) para confirmar ou descartar a causa #1 com dados reais antes de tocar nos limites de truncamento — evita ajustar um número "no escuro".
3. **Substituir os limites por caracteres por um orçamento de tokens real por seção** (histórico, anexos, pesquisa) somente depois de confirmado pelo passo 2 — e avisar o analista explicitamente no chat (não só a IA) quando algo for cortado.
4. Considerar fallback por qualidade (seção 24 do documento original) como melhoria de médio prazo, não urgente — exigiria definir um critério objetivo de "resposta fraca" (ex.: ausência de seção "Evidências", nível de confiança "evidência insuficiente" combinado com resposta curta) antes de acionar uma segunda IA.

Não recomendo, pelo menos nesta fase: RAG/embeddings/busca vetorial para a base histórica (ganho marginal frente ao scoring atual, dado o volume), multiagente, ou Model Router sofisticado — a complexidade adicional não ataca nenhuma das causas identificadas.

---

**Fim da auditoria. Aguardando aprovação antes de qualquer implementação.**
