# IA Service — Fase 0: Diagnóstico Arquitetural do Motor de Investigação

Data: 2026-11-12 · Branch: `feature/ia-command-multi-turn` (HEAD `be975d9`) · Escopo: somente leitura. Nenhum código de produção, dado ou configuração foi alterado.

Convenções deste documento:

- **[COMPROVADO]**: verificado no código ou em dados gravados, com referência.
- **[MEDIDO]**: número extraído do banco local `apps/IA Service/data/ia-service.db` (somente leitura). O banco local tem 108 execuções entre 2026-10-06 e 2026-10-22, majoritariamente `openai/gpt-4o` e `gpt-4o-mini`. **Não é produção** (que, segundo registro interno do projeto, usa `openai/gpt-5.4`). Os números servem de ordem de grandeza, não de linha de base.
- **[ESTIMATIVA]** ou **[HIPÓTESE]**: inferência ainda não verificada.

Caminhos relativos a `apps/IA Service/backend/` quando não indicado.

---

## Resposta à pergunta central

**O motor atual segue uma sequência fixa controlada pelo backend.** A IA não escolhe a próxima ação nem usa ferramentas de forma iterativa. [COMPROVADO]

- Cada turno executa um pipeline linear em `services/investigacao-service.js:processarTurno` (linhas 1105–1858): contexto → gate de pendência → leitura de prints → chamados relacionados → pesquisa → montagem do prompt → **uma** chamada principal à IA → validações → gravação → dossiê em segundo plano.
- O cliente de IA (`services/ai-provider-client.js`) não envia `tools`, `functions` nem equivalentes para nenhum provedor. Não existe laço "modelo pede ação → backend executa → modelo reavalia".
- A IA já participa de várias decisões, mas em **chamadas isoladas e de formato fechado** (JSON com enum ou índices), sempre encaixadas em pontos fixos do pipeline. O backend combina essas respostas com heurísticas e regras próprias, e muitas vezes a regra prevalece.
- A decisão "pesquisar ou não" é a mais afetada: passa por ao menos seis camadas determinísticas antes e depois da opinião da IA. Há um veto heurístico (disciplina 4B) que, nos dados gravados, **desligou a pesquisa mesmo quando a própria IA classificou a mensagem como evidência nova de relevância alta** (seção 3.1).

A base, porém, é boa para evoluir sem reescrever: as capacidades já existem como funções isoladas, com isolamento por empresa resolvido no backend, auditoria por execução, progresso em tempo real e um contrato validado de escrita no dossiê. A evolução recomendada (seção 7) é **expor essas funções como ferramentas a um único laço, atrás de flag**, e retirar regras de raciocínio aos poucos, medindo pelo replay.

---

## 1. Mapa da arquitetura e fluxo atual

### 1.1. Entradas

| Entrada | Arquivo | Observação |
|---|---|---|
| Chat interno (analista) | `routes/index.js:386` `POST /api/ia-service/atendimentos/:id/investigar` | Lock por empresa+atendimento (`turno-lock-service`), 409 se já processando |
| Canal externo (login por telefone) | `routes/externo-routes.js:523` | `req.svcEmpresaId` vem da sessão externa (`sessao-externa-middleware.js:17`) |
| Pré-análise automática | `services/radar-service.js:399` → `processarPreAnalise` (`investigacao-service.js:1872`) | Texto fixo `TEXTO_PRE_ANALISE`, `automatico: true` |
| Botão "Pesquisar Soluções" | mesma rota, `forcarPesquisa: true` | |

### 1.2. Pipeline de `processarTurno` (ordem real)

```
 1. Carrega atendimento; recusa se chamado encerrado na origem           (:1112)
 2. Persiste a mensagem do usuário; carrega histórico anterior           (:1127)
 3. Substitui respostas humanizadas pela técnica; oculta respostas
    reprovadas pelo QG; com forcarPesquisa, oculta TODAS as respostas
    anteriores da IA                                                     (:1141–1162)
 4. [IA] Classifica turno: "conversa" × "investigacao"                   (:1192, :886)
      └─ se "conversa": [IA] responde curto e ENCERRA o turno            (:1220–1250)
 5. Garante anexos do SoftExpert (cópia de arquivos)                     (:1204)
 6. Escolhe system prompt (pré-análise / botão / código)                 (:1215)
 7. Aguarda dossiê pendente; monta memória operacional do dossiê         (:1267–1275)
 8. Gate de pendência externa (cliente/fornecedor) — [IA opcional]       (:1287–1327)
      └─ botão sob pendência: mensagem FIXA e ENCERRA                    (:1318)
 9. [IA ×N] Transcreve prints (1ª análise ou imagem nova)                (:1333)
10. Chamados relacionados (léxico, top 5)                                (:1336)
11. Pesquisa técnica (technical-research-service.pesquisar)              (:1340)
      ├─ plano determinístico + disciplina 4B
      ├─ [IA] interpretação semântica (condicional)
      ├─ [IA] escreve consultas
      ├─ busca: Serper → Gemini → OpenAI (fallback) + Central TOTVS
      ├─ ranking determinístico + filtros por módulo/termos
      ├─ [IA] seleciona até 3 artigos (fallback: 2 primeiros do ranking)
      └─ abre e recorta páginas (safe-web-fetch)
12. Injeta orientações fixas (customização, nova investigação)           (:1412–1421)
13. Context Engine monta prompt sob orçamento do modelo                  (:1454)
14. Carrega imagens/PDF visuais; troca para candidato com visão          (:1474–1571)
15. [IA] Geração principal, streaming, maxTokens 6000                    (:1602)
16. Quality Gate léxico (sinaliza, não bloqueia)                         (:1622)
17. Limpeza técnica, observação ao analista, fontes consultadas          (:1694–1715)
18. [IA opcional] Fontes corrigidos + verificação de consistência        (:1730)
19. Grava mensagem e execução (auditoria)                                (:1752–1798)
20. [IA] Atualiza dossiê em segundo plano                                (:1821)
```

### 1.3. Mapa dos 16 itens pedidos

| # | Item | Onde | Como funciona hoje |
|---|---|---|---|
| 1 | Construção do prompt | `services/prompt-builder.js:64` `selecionarSystemPrompt`; `services/context-engine.js:1079` `montarContextoInvestigacao` | System prompt = base + tamanho (~300 palavras) + diálogo + instrução do turno + regras de fonte. User prompt montado pelo Context Engine: quadro investigativo heurístico, PRR, mensagens/anexos pontuados por termos, pesquisa (teto de 25% da entrada), instruções finais longas (`context-engine.js:1419–1429`). |
| 2 | Recuperação do histórico | `investigacao-service.js:1123–1162`; `context-engine.js:1150–1290` | Todas as mensagens do atendimento entram como candidatas; cada uma é pontuada por termos e entra até o orçamento do modelo (`token-budget-service.criarOrcamento`, janela − 6000 de resposta − 18%). |
| 3 | Uso do dossiê | Leitura: `services/dossie-context-service.js:94` `montarMemoriaOperacional`. Escrita: `services/investigacao-dossie-atualizador-service.js:419` `atualizarAposTurno` | Leitura: até 10 fatos, 10 hipóteses ativas, 6 descartadas, 8+12 testes, 12 resultados, ordenados por termos; evidências originais até 35% da entrada. Escrita: chamada de IA **após** a resposta, que propõe alterações de uma allowlist (`ACOES`, linha 15). O backend valida e persiste. |
| 4 | Decisão de pesquisar | `services/technical-research-service.js:742` `planejarPesquisaComSemantica`, `:844` `planejarPesquisa`; `services/investigative-discipline-service.js:392` | Majoritariamente determinística. Ver seção 3.1. |
| 5 | Planejamento de consultas | `technical-research-service.js:844–960` (sinais, `montarConsultas`, dedup); `:1207` `_gerarConsultasComIA` | Consultas por regex e frequência de termos, deduplicadas contra as execuções anteriores. A IA escreve até 3 consultas + 1 natural, que vão para a frente da lista (máx. 5). |
| 6 | Execução das pesquisas | `technical-research-service.js:1848–1945` | Provedores em ordem configurada (fallback só por erro) + Central TOTVS em paralelo (apenas Protheus). |
| 7 | Seleção de artigos | `technical-research-service.js:1950–1981`, `:1297` `_selecionarArtigosComIA` | Ranking determinístico → filtro por módulo/termos → IA escolhe até 3 por **título e trecho de 300 caracteres** → correspondência literal da mensagem de erro é forçada (até 2). |
| 8 | Leitura de artigos | `technical-research-service.js:1451` `_abrirResultados`, `:1369` `_selecionarTrechoRelevante`; `services/safe-web-fetch-service.js` | Abre e recorta trecho de ~2200 caracteres por termos. Reaproveita URLs já lidas. |
| 9 | Contingência | `ai-provider-client.js:450` `chamarIA` (fallback de provedores e retentativas); `technical-research-service.js:1876` (busca); `:1963` (seleção) | Provedor de IA: ordem cadastrada, com retentativas por erro transitório e pulo por janela. Seleção de artigos: se a IA falha, **abre os 2 primeiros do ranking** (ver 3.4). |
| 10 | Chamados anteriores | `repositories/chamado-repository.js:432` `listarChamadosRelacionados` | Ver seção 3.6 e o item 8 do briefing. |
| 11 | Atualização de hipóteses | `investigacao-dossie-atualizador-service.js:211` `_validarAlteracao` | Só depois da resposta, por IA, em segundo plano. O backend valida status, alvo e campos proibidos. |
| 12 | Geração da resposta | `investigacao-service.js:1602` | Uma chamada, `maxTokens 6000`, streaming para o chat (`progresso-turno-service.registrarRascunho`). |
| 13 | Auditoria e métricas | `repositories/investigacao-execucao-repository.js`, tabela `investigacao_execucoes` | Grava manifesto, contexto, pesquisa completa (plano, consultas, ranking, seleção), QG, tentativas, latências. Ver limitações 3.5. |
| 14 | Segurança e isolamento | `services/empresa-context.js:46`, `services/sessao-externa-middleware.js:17`; repositórios com `empresa_id = ?` | Ver seção 6.3. |
| 15 | Provedor, modelo e ferramentas | `ai-provider-client.js:16–21`; `services/ai-config-service.js:15` | Ver seção 4.1. |
| 16 | Testes | `apps/IA Service/tests/` (135 arquivos) | Ver seção 9. |

---

## 2. Decisões da IA × decisões do backend

### 2.1. O que a IA já decide

| Decisão | Onde | Forma | O backend pode sobrepor? |
|---|---|---|---|
| Se o turno é conversa ou investigação | `investigacao-service.js:886` | JSON `{tipo}`, `maxTokens 30` | Só roda sem anexo, sem botão e com mensagem humana |
| Se houve mudança investigativa e se o analista pediu nova pesquisa | `technical-research-service.js:601` | JSON com enum de 13 tipos | **Sim**: a 4B veta antes (`:705–718`); só roda em certas "zonas" decididas por regex (`:519`) |
| Texto das consultas de busca | `technical-research-service.js:1207` | JSON, até 3 + 1 natural | Consultas de regex continuam na lista; erro principal é forçado na frente (`:1835`) |
| Quais artigos abrir | `technical-research-service.js:1297` | Índices, até 3 | Correspondência literal é forçada; filtro por módulo antes |
| Conteúdo da resposta (diagnóstico, hipóteses, perguntas, próximo passo) | `investigacao-service.js:1602` | Texto livre | Não altera o texto, salvo limpezas e anexos ao final |
| Mudanças no dossiê | `investigacao-dossie-atualizador-service.js:448` | JSON de alterações da allowlist | Valida contrato (correto, é infraestrutura) |
| Se pendência externa permite pesquisa pedida no chat | `pendencia-externa-gate.js:105` | JSON | Regras do usuário para botão e pré-análise |
| Texto de prints (OCR) | `investigacao-service.js:1003` | Texto | — |

### 2.2. O que o backend decide hoje e, pelo princípio do briefing, é interpretação técnica

| Decisão no código | Onde | Problema |
|---|---|---|
| Classificar a mensagem em "zonas" (administrativa, cinzenta, determinística forte…) por regex e comprimento | `technical-research-service.js:519` | Decide se a IA sequer é consultada sobre a pesquisa |
| Suficiência da evidência e tipo de lacuna (4B) | `investigative-discipline-service.js:42–202` | Regex escrita para os casos sintéticos do benchmark (seção 3.1) |
| Se a pesquisa é necessária (`devePesquisar`) | `technical-research-service.js:879–933`, `:961`, `:705–738` | Combinação de regras que pode contrariar a IA |
| Detecção de domínio e sinais técnicos | `technical-research-service.js:163`, `:235` | Aceitável como pista, mas hoje vira decisão |
| Quadro investigativo, estado operacional, "ações candidatas" | `context-engine.js:221–664` | Heurística que escreve conclusões no prompt ("Vínculo causal não demonstrado", ações sugeridas) |
| "Soluções que falharam" do dossiê por regex `NEGATIVO|RECORRENCIA` | `dossie-context-service.js:194` | Deveria vir do status do item |
| Orientações fixas por palavra do cabeçalho ("customiza") | `investigacao-service.js:1412` | Pequena, mas é raciocínio por condicional |
| Tamanho da resposta "até ~300 palavras" | `prompt-builder.js:57` | Contraria a seção 5.4 do briefing (sem limite de palavras) |
| Ocultar todas as respostas anteriores com `forcarPesquisa` | `investigacao-service.js:1159` | Correção pontual de cópia, mas remove continuidade |

### 2.3. O que o backend decide e deve continuar decidindo

Isolamento por empresa, autenticação, lock por atendimento, chamado encerrado, política de pendência externa para botão e pré-análise (decisão de negócio do usuário), orçamento de contexto por modelo, fallback de provedores, validação do contrato do dossiê, validação de fontes corrigidos, redação de dados sensíveis, timeouts, filtro de URLs (safe-web-fetch), rejeição de imagem ilegível. Todos estão no lugar certo.

---

## 3. Limitações comprovadas no código

### 3.1. A disciplina 4B veta pesquisa por regex escrita para o benchmark [COMPROVADO + MEDIDO]

- `investigacao-service.js:1375`: `disciplina4B: process.env.IA_SERVICE_DISCIPLINA_4B !== '0'`, ou seja, **ligada por padrão em produção**.
- `investigative-discipline-service.js:62–128` reconhece evidências por regex literais como `mata460`, `x5_filial`, `customerstimeoutms`, `withtimeout\(5000\)`, `desabilitamos.*continuou`, `filial 02`. Esses termos são exatamente os dos casos sintéticos `tests/benchmark/cases/development/*.json` (`simple-protheus-field-missing`, `intermediate-api-http-401-cert`, `adversarial-obvious-customization-wrong` etc.). É sobreajuste ao conjunto de teste.
- Para qualquer texto que não case com essas regex, o padrão é `suficiencia = 'INSUFICIENTE'` e `lacunaTipo = 'EVIDENCIA_AMBIENTE'` (`:137–138`).
- Com 4B ligada, `aplicarDisciplinaPesquisa` (`:426`) e `_aplicarInterpretacaoSemantica` (`technical-research-service.js:712`) desligam a pesquisa quando a lacuna é `EVIDENCIA_AMBIENTE`. Este segundo veto roda **antes** de considerar o resultado da IA semântica, então a opinião da IA é ignorada. (Ele testa `plano.pesquisa?.necessaria`, campo que o plano não tem: a disciplina grava em `disciplinaInvestigativa.pesquisa`. Isso não muda o resultado hoje, porque `EVIDENCIA_AMBIENTE` já implica `necessaria = false`, mas indica que a regra não foi testada como se pretendia.)
- **Nos dados gravados** (99 execuções com 4B): 25 tiveram a pesquisa desligada por "lacuna depende de evidência/teste do ambiente". Em 19 delas a mensagem atual tinha **sinal técnico forte** (zona `deterministica_forte`), e a interpretação semântica nem foi chamada. Em 2, a IA semântica respondeu `nova_ocorrencia`, `haEvidenciaNova=true`, relevância `alta`, e a pesquisa **mesmo assim** não rodou.
- `analisarMaterialComSemantica` (`:367`), a variante com IA, não é chamada em nenhum lugar do backend.

Impacto: é o oposto do princípio "a inteligência pertence à IA". É o primeiro candidato a remover (Fase 2), atrás de flag. A flag já existe: `IA_SERVICE_DISCIPLINA_4B=0`.

### 3.2. Uma única geração por turno; sem laço de ferramentas [COMPROVADO]

- `ai-provider-client.js` não tem suporte a `tools` em nenhum dos três formatos (OpenAI-compat, Anthropic, Gemini). `_mensagensConversa` (`:251`) aceita só papéis `user`/`assistant` com texto.
- A pesquisa acontece **antes** da IA principal ver o caso. A IA que escreve a resposta não pode pedir outra consulta, abrir outro artigo, ler outro trecho do log nem consultar um chamado citado. Se a pesquisa veio errada, o turno termina com ela.
- Os artigos são escolhidos por título e trecho de 300 caracteres (`:1304`). A IA principal recebe o recorte, mas não participa da escolha.

### 3.3. Classificação de aplicabilidade das evidências não existe [COMPROVADO]

- Não há registro de EVIDÊNCIA APLICÁVEL / POTENCIALMENTE / RELACIONADO / NÃO APLICÁVEL. A seleção grava só `indices` e um `motivo` de uma frase (`:1327–1328`).
- O histórico de pesquisa usado para deduplicar vem de `investigacao_execucoes` (`technical-research-service.js:336`, últimas 12 execuções), não do dossiê. Um artigo descartado num turno pode voltar em outro sem memória de por que foi descartado.
- O dossiê já prevê o alvo `fonte_externa` nas relações (`investigacao-dossie-atualizador-service.js:39`). Pode ser o caminho para registrar a classificação **sem migration** (a confirmar na Fase 4).

### 3.4. Contingência transforma ranking em evidência [COMPROVADO]

`technical-research-service.js:1963`: `paraAbrir = resultados.filter(_erroCompativel); limiteAbrir = 2`. Se a seleção por IA falhar ou expirar (timeout de 8 s), os 2 primeiros do ranking são abertos e entram no prompt como páginas lidas, que é o que o item 7.4 do briefing pede para evitar. Nos dados locais a seleção nunca falhou (59/59), então o risco é latente.

### 3.5. Auditoria perde o uso real de tokens [COMPROVADO]

`redaction-service.js:58` redige toda chave cujo nome contenha `token`. O repositório aplica isso ao gravar (`investigacao-execucao-repository.js:5`). Resultado no banco: `usage_json` = `{"prompt_tokens":"[REDACTED]",…}`. O mesmo acontece com `contexto.tokensEstimadosPrompt` e `pesquisa.tokensPesquisa`. Sobrevivem só as colunas `tokens_estimados_prompt/resposta` (estimativa por caracteres).

Também não há preço por modelo nem custo estimado em nenhum lugar (`token-budget-service.js` só calcula janela). As micro-chamadas (classificação, semântica, consultas, seleção, dossiê) não gravam `usage`.

Consequência: hoje não é possível medir custo real por atendimento. **Isso bloqueia a Fase 1** e precisa ser corrigido primeiro (correção pequena, de infraestrutura).

### 3.6. Chamados anteriores: janela, léxico e N+1 [COMPROVADO + MEDIDO]

`chamado-repository.js:432–474`:

- `ORDER BY data_abertura DESC LIMIT 1200`: no banco local há 1.673 chamados da empresa 1 (jan–out/2026). **473 (28%) nunca são considerados**, por mais parecidos que sejam.
- Correspondência por substring de tokens com 4+ letras, sem sinônimos nem peso por raridade (`:413–418`). Até 12 tokens do contexto **na ordem em que aparecem** (`:448`), não por importância. O contexto começa pelo texto dos prints (`investigacao-service.js:1338`), então eles dominam.
- Atributos usados: módulo, serviço, produto, família, tipo (até 25 pontos) e solução aplicada = 'Sim'. Não usa rotina, mensagem de erro nem tabela/campo como atributo próprio.
- **N+1**: `listarPosicionamentosDoChamado` é chamado para cada um dos até 1.200 candidatos, a cada turno (`:455`).
- Isolamento correto: `WHERE empresa_id = ?`.

### 3.7. Métrica de motivo enganosa [MEDIDO]

Em 33 execuções o motivo gravado foi "mudança investigativa reconhecida semanticamente: **nenhuma_mudanca**" com `devePesquisar = true`. Eram pedidos explícitos (`pedido_explicito_pesquisa`). O texto vem de `technical-research-service.js:722`, que usa o mesmo rótulo para forçado e para relevante. Atrapalha qualquer análise de decisões.

### 3.8. Outras limitações observadas

- **Contexto principal sem dossiê na decisão de pesquisa**: a decisão de pesquisar vê o dossiê só como texto para regex (`_textoDossie`), não como estado estruturado avaliado pela IA. [COMPROVADO]
- **Atualização do dossiê depois da resposta**: a resposta do turno N nunca enxerga o que o próprio turno N concluiu. O turno N+1 espera até 60 s pelo dossiê pendente (`investigacao-service.js:49`). [COMPROVADO]
- **Progresso em memória do processo** (`progresso-turno-service.js`, `Map` local): funciona com um processo só. Com mais de um processo, o progresso pode não aparecer. [COMPROVADO no código; impacto depende da implantação]
- **Instrução de tamanho** (`prompt-builder.js:57`) e o volume de instruções finais do Context Engine (`context-engine.js:1419–1429`) somam muitas regras de estilo. Cada uma limita o raciocínio (mesmo princípio do "Spec vs Inteligência" do IA Command). [COMPROVADO; efeito na qualidade é HIPÓTESE a medir]

---

## 4. Catálogo de ferramentas proposto

### 4.1. Viabilidade: provedor, modelo e chamada nativa de ferramentas

| Provedor | Formato no cliente | Modelo padrão no código | Visão | Ferramentas no cliente |
|---|---|---|---|---|
| openai | openai_compat | `gpt-4o-mini` (produção: `gpt-5.4`, `reasoning_effort: 'none'`, `:286`) | sim | **não implementado** |
| claude | anthropic | `claude-haiku-4-5-20251001` | sim | não implementado |
| gemini | gemini | `gemini-3.5-flash` | sim | não implementado |
| groq | openai_compat | `openai/gpt-oss-20b` | não | não implementado |
| deepseek | openai_compat | `deepseek-chat` | não | não implementado |

As APIs desses provedores oferecem chamada de ferramentas, mas com contratos diferentes:

- OpenAI-compat: `tools` + `tool_calls` + mensagens `role: tool` com `tool_call_id`.
- Anthropic: blocos `tool_use` / `tool_result` dentro de `content`.
- Gemini: `functionDeclarations` + `functionCall` / `functionResponse`.

O que afeta a viabilidade:

1. **Fallback entre provedores no meio do laço.** O laço guarda a conversa no formato do provedor. Se o primário cair no passo 3, o fallback precisa receber o histórico de ferramentas convertido. Proposta: manter o histórico em formato neutro interno e converter por provedor, o mesmo papel que `_mensagensConversa` cumpre hoje.
2. **Streaming + ferramentas.** O streaming atual (`_httpPostStream`) lê só texto. Com ferramentas, os argumentos chegam em pedaços. Proposta: streaming só no passo final (resposta), passos intermediários sem streaming, com progresso por etapa (já existe).
3. **Groq e DeepSeek sem visão** já são tratados pela troca de candidato. Nada muda.
4. **Qualidade de uso de ferramentas varia por modelo** [HIPÓTESE]. Precisa ser medida no replay da Fase 1 com o modelo de produção. Plano B que não depende de ferramentas nativas: o modelo responde um JSON `{acao, parametros}` por passo, e o backend executa. Funciona em qualquer provedor (já é o padrão das micro-chamadas), com mais tokens e menos robustez.

### 4.2. Ferramentas

Todas recebem `empresaId`, `atendimentoId` e o usuário **somente** do contexto do turno, injetados pelo backend. Nenhum parâmetro de ferramenta aceita esses campos. Toda saída é tratada como dado não confiável.

| Ferramenta | Propósito (para a IA) | Entrada (validada) | Saída | Reaproveita | Latência/custo típico | Erros |
|---|---|---|---|---|---|---|
| `pesquisar_documentacao_oficial` | Buscar na TDN/Central TOTVS ou documentação SoftExpert quando a dúvida é de comportamento padrão, parâmetro, erro conhecido ou versão | `consultas[1..3]` (4–12 termos, sem PII; passa por `sanitizarConsultaExterna`), `produto` (enum) | Lista `{ref, titulo, url, trecho≤300, oficial}` | `_buscarCentralTotvs`, `_buscarSerper` com `site:` | Central: grátis; Serper: por consulta. [MEDIDO] pesquisa inteira p50 13,8 s / p90 20,6 s (antes da paralelização de 2026-11-02) | `sem_resultado`, `provedor_indisponivel`, `orcamento_esgotado` |
| `pesquisar_internet` | Fontes complementares (fóruns, blogs) quando a oficial não cobre | `consulta` natural | Igual | `_buscarSerper` → Gemini → OpenAI (ordem da Platform) | Serper rápido; Gemini/OpenAI com grounding podem levar minutos (comentário `:1900`) | idem |
| `ler_artigo` | Ler o conteúdo de um resultado antes de usá-lo como base | `ref` de um resultado deste atendimento (nunca URL livre) | Trecho relevante ≤ ~2.200 caracteres + `url` + `oficial` | `_abrirResultados`, `_selecionarTrechoRelevante`, `safe-web-fetch` | 1–12 s por página | `bloqueado`, `timeout`, `nao_encontrado` |
| `buscar_chamados_anteriores` | Casos históricos parecidos (evidência histórica, não prova) | `termos[]`, `modulo?`, `rotina?`, `limite≤5` | `{numero, titulo, score, motivos, solucaoAplicada, resumoPosicionamentos}` | `listarChamadosRelacionados` (após corrigir N+1) | ms, sem custo de IA | — |
| `ler_anexo` | Ler trecho de log, fonte ou documento do atendimento além do que entrou no contexto | `anexoId` **deste atendimento**, `busca?` ou `linhas?` | Trecho com marcação de truncamento | `_janelaLinhasRelevantes`, `_selecionarTrechosCodigo`, `_selecionarTrechosDocumento` do Context Engine | ms | `anexo_de_outro_atendimento`, `sem_texto_extraido` |
| `consultar_dossie` | Ver fatos, hipóteses (ativas/descartadas), testes, resultados, pendências | `filtro?` (tipo/status) | Itens compactos com código (F01, H02…) | `montarMemoriaOperacional` / `obterEstadoCompleto` | ms | `sem_dossie` |
| `atualizar_dossie` | Registrar fato, hipótese, teste, resultado, classificação de evidência | Proposta no contrato atual (`ACOES`, alvo por código) | `{aceitas, rejeitadas:[{motivo}]}` | `_validarAlteracao`, `_aplicarAlteracao` | ms | Rejeição por contrato |
| `ler_chamado_citado` *(opcional, Fase 3)* | Ler o resumo de um chamado citado no histórico | `numero` citado no histórico | Título, situação, últimos posicionamentos | `_extrairChamadosCitados` + `getChamadoPorNumero` | ms | `nao_citado`, `nao_encontrado` |

Permanecem **fora** do laço (infraestrutura, executadas sempre pelo backend): OCR de prints (pré-processamento), garantia de anexos do SoftExpert, gate de pendência externa, validação de fontes corrigidos, Quality Gate (como sinalizador e métrica), gravação da auditoria.

Proposta de orçamento por turno (calibrar na Fase 1): até 6 chamadas de ferramenta, até 4 passos de IA, 90 s de relógio, teto de tokens de entrada por turno = 3× o prompt atual. O orçamento restante vai no retorno de cada ferramenta (`orcamento: {passos, ferramentas, segundos}`).

---

## 5. Impacto estimado em custo e latência

### 5.1. Linha atual [MEDIDO, banco local, gpt-4o/4o-mini]

| Métrica | p50 | p90 | máx |
|---|---|---|---|
| Prompt principal (tokens estimados) | 6.351 | 11.951 | 17.279 |
| Geração principal (ms) | 4.129 | 8.843 | 15.738 |
| Pesquisa inteira (ms) | 13.778 | 20.553 | 26.043 |
| Páginas lidas por turno | 1 | 3 | 4 |

- 62 de 93 execuções concluídas pesquisaram; a semântica rodou em 65, consultas por IA em 59, seleção por IA em 59.
- Chamadas de IA por turno de investigação hoje: classificação (0–1) + OCR (0–N) + semântica (0–1) + consultas (0–1) + seleção (0–1) + principal (1) + dossiê (1, em segundo plano). **Típico: 4–6 chamadas**, apenas 1 com o contexto grande.
- Dossiê em segundo plano: 14–24 s (registro de 2026-11-02, `investigacao-service.js:1815`).
- Não há medição de custo real (seção 3.5).

### 5.2. Ciclo autônomo [ESTIMATIVA]

O laço substitui a semântica, as consultas e a seleção (a própria IA principal decide), mas cada passo reenvia o contexto grande.

| Cenário | Passos de IA com contexto grande | Tokens de entrada vs. hoje | Latência total vs. hoje |
|---|---|---|---|
| Resposta direta (sem pesquisa) | 1 | ≈ igual (menos as micro-chamadas) | ≈ igual ou menor (sem as micro-chamadas em série) |
| Uma pesquisa + leitura | 2–3 | 2–3× | ≈ igual a +30% (as micro-chamadas de 8 s saem; entram 1–2 passos de 3–8 s) |
| Investigação com aprofundamento | 4 | 3–5× | +50% a +100% (limitado pelo teto de 90 s) |

Mitigações que reduzem esses fatores:

- Prompt caching: a OpenAI faz cache automático de prefixos estáveis acima de ~1.024 tokens. Exige ordem fixa (system → dossiê → histórico → turno → passos). O prompt atual coloca conteúdo variável cedo, então precisa reordenar.
- Resultados de ferramenta curtos, com `ref`.
- Dossiê como resumo, em vez de reenviar o histórico inteiro a cada passo.

**Os números acima são estimativa.** Só valem depois do replay da Fase 1 com o modelo de produção e a medição real de `usage`.

---

## 6. Riscos

### 6.1. Custo e latência

O laço multiplica tokens de entrada (5.2). Sem `usage` real gravado (3.5), um aumento de custo passaria despercebido. Mitigações: orçamento por turno e por atendimento aplicado no backend, corrigir a auditoria antes, cache de prefixo.

### 6.2. Regressão e variabilidade

- Muitas regras atuais nasceram de bugs reais (comentários citam #036580, #036727, #036566). Removê-las em bloco pode trazer de volta esses erros. Mitigação: cada remoção atrás de flag, comparada no replay com casos tirados desses chamados.
- Resultados por execução variam. Mitigação: 3 execuções por caso (briefing 12.2).
- Fallback de provedor no meio do laço muda o modelo no passo N. Mitigação: formato neutro de conversa e auditoria por passo.

### 6.3. Segurança

Situação atual verificada:

- `empresaId` sempre da sessão (`empresa-context.js:46`, `sessao-externa-middleware.js:17`); nenhum parâmetro do corpo define empresa.
- Repositórios filtram por `empresa_id` (ex.: `chamado-repository.js:442`, `anexo-repository.js:151`).
- `anexoIds` do corpo: lidos por empresa; o contexto só usa `listarAnexos(empresa, atendimento)` (`context-engine.js:1106`), e o vínculo à mensagem exige o mesmo atendimento (`anexo-repository.js:160–169`). Verificado: um ID de anexo de outro atendimento **não** entra no prompt.
- Consultas externas passam por `sanitizarConsultaExterna` (e-mail, CNPJ, CPF). Micro-chamadas aplicam `redigirTexto` e declaram o conteúdo como não confiável.

Riscos novos com ferramentas:

- **Injeção indireta** (artigo/anexo instrui a IA a chamar ferramenta). Mitigação: ferramentas só de leitura e de escopo fechado, nunca URL livre em `ler_artigo` (só `ref` de resultado), nenhuma ferramenta escreve fora do dossiê. O dossiê continua validado por contrato.
- **Exfiltração por consulta de busca** (IA coloca dado do cliente na consulta). Mitigação: `sanitizarConsultaExterna` obrigatório na ferramenta e limite de termos.
- **Isolamento**: ferramentas recebem empresa e atendimento por closure do turno. Teste obrigatório na Fase 2: parâmetro extra `empresaId` é rejeitado.

---

## 7. Alternativas de evolução e recomendação

| Alternativa | O que é | Vantagem | Limitação |
|---|---|---|---|
| **A. Ajuste do pipeline atual** | Manter a sequência; remover vetos heurísticos (4B), mover a decisão de pesquisa para uma única chamada de IA com dossiê; classificação de evidência na geração | Menor risco e custo; entrega rápida | A IA continua sem poder aprofundar dentro do turno |
| **B. Laço de agente único com ferramentas (recomendada)** | A IA principal recebe contexto + ferramentas e decide os passos sob orçamento; backend executa e audita cada passo | Atende o briefing; reaproveita todas as funções; um agente só | Implementar tool calling em 3 formatos; custo maior; precisa de replay |
| C. Planejador + executor (2 agentes) | Um modelo planeja, outro responde | Separação clara | Mais chamadas, mais custo; sem necessidade demonstrada (briefing 2.3) |
| D. Reescrita em framework de agentes | SDK/orquestrador externo | Recursos prontos | Nova dependência, substitui código maduro, contraria a seção 13 |

**Recomendação: B, construída incrementalmente sobre A, tudo atrás de flag.**

1. Primeiro, as correções de A que são infraestrutura e não mudam comportamento visível: auditoria de `usage`/custo e rótulo do motivo (3.5, 3.7).
2. O laço B entra como **modo alternativo** (`IA_SERVICE_MODO_INVESTIGACAO=agente`), começando só com ferramentas de leitura (pesquisar, ler artigo, ler anexo, consultar dossiê, chamados). O pipeline atual continua sendo o padrão e o fallback.
3. Com o laço ligado, a decisão de pesquisa sai das regras e vai para a IA. A 4B fica desligada nesse modo. A semântica, as consultas e a seleção deixam de rodar como micro-chamadas, porque a própria IA faz isso.
4. `atualizar_dossie` dentro do laço só na Fase 3, depois de medir o laço de leitura.

É a opção mais simples que atende o objetivo: um agente, as mesmas funções, sem tabela nova, reversível por variável de ambiente.

---

## 8. Plano de implementação por fases

| Fase | Entregas | Arquivos principais | Depende de aprovação adicional? |
|---|---|---|---|
| **1 — Linha de base** | (a) Correção da auditoria: gravar `usage` real (exceção na redação para chaves de contagem como `prompt_tokens`, `completion_tokens`, `input_tokens`, `output_tokens`, `tokensEstimados*`) e `usage` das micro-chamadas. (b) Tabela de preço por modelo para custo estimado (arquivo de config, não banco). (c) Motivo distinto para pesquisa forçada. (d) Replay multi-turno executando `processarTurno` real com provedores de **busca** congelados e provedor de IA real. (e) 20–40 casos anonimizados (70/30). Os 14 sintéticos atuais entram só como parte do conjunto, não como referência principal, por causa do sobreajuste da 4B. | `redaction-service.js`, `investigacao-execucao-repository.js`, `technical-research-service.js:722`, `tests/benchmark/` | **Sim**: (a) mexe em redação (segurança). Uso de conversas reais anonimizadas e envio a provedor externo nos testes exige autorização específica (briefing seção 9). |
| **2 — Orquestração** | Tool calling no `ai-provider-client` (3 formatos, histórico neutro); laço com orçamento; auditoria por passo (ação, motivo de 1 linha, ferramenta, latência, tokens) em `pesquisa_json`/`contexto_json` existentes; ferramentas de leitura; modo `agente` atrás de flag; 4B desligada nesse modo | `ai-provider-client.js`, novo módulo do laço dentro de `services/`, `investigacao-service.js` (desvio por flag) | Sim, se a auditoria por passo não couber nas colunas JSON atuais (a avaliar; a intenção é caber) |
| **3 — Continuidade e dossiê** | `consultar_dossie`/`atualizar_dossie` no laço; dossiê como fonte compacta; revisar ocultação de respostas no `forcarPesquisa`; retirar regras de estilo redundantes do prompt (por flag/versão) | `dossie-context-service.js`, `investigacao-dossie-atualizador-service.js`, `prompt-builder.js`, `context-engine.js` | Não, se usar o contrato atual |
| **4 — Aplicabilidade e contingência** | Classificação nas 4 categorias registrada no dossiê (alvo `fonte_externa`); remover a abertura automática por ranking quando a seleção falha | `technical-research-service.js:1963`, atualizador do dossiê | **Sim**, se a classificação não couber no contrato atual do dossiê (precisaria de campo/migration) |
| **5 — Chamados anteriores** | Relatório comparando ampliar janela, corrigir N+1, ponderar termos (TF-IDF/BM25 em SQLite FTS5), atributos técnicos (rotina, erro), busca semântica/híbrida | `chamado-repository.js` | Embeddings ou FTS5 (tabela virtual) dependem de aprovação |
| **6 — Validação final** | Regressão, custo, latência, precisão, segurança | — | Ida para produção |

---

## 9. Testes existentes

- 135 arquivos `*.test.js` em `apps/IA Service/tests/`, cada um executável isoladamente: `node "apps/IA Service/tests/<arquivo>.test.js"`. Não há script agregador no `package.json`.
- Isolamento: os testes de persistência usam banco temporário (`database.inicializarDB(<tmp>)`), e os de rota liberam permissões via `tests/helpers/rotinas-svc-liberadas.js`. Provedores de IA e de busca são injetados como mocks (`interpretarSemantico`, `gerarConsultasIA`, `selecionarArtigosIA`, `buscarSerper` etc.).
- Benchmark existente: `tests/benchmark/` com 14 + casos 4B sintéticos e `run-benchmark-offline.js`. O "investigador" é determinístico (`engine/benchmark-runner.js:145`, `_offlineInvestigator`), **sem modelo real**. Mede o planejamento, não a qualidade da resposta. Serve como esqueleto para o replay da Fase 1, que precisa executar o motor real.

**Execução em 2026-11-12** (cada arquivo isolado, limite de 240 s, ~8 min no total): **133 de 135 passaram.**

| Arquivo | Resultado | Diagnóstico |
|---|---|---|
| `analise-log-filtro-acumulacao-ui.test.js` | Estourou o limite interno de 30 s | **Instável**: rodado isolado logo depois, passou em 2,3 s. Fora do motor de investigação. |
| `etapa-v1-pesquisa-web-motor.test.js` | Derrubado pelo limite de 240 s | Imprime `ok (fallback multi-provider, provenancia, degradacao segura)`, mas o processo não encerra: algum recurso fica aberto (timer, socket ou banco). As asserções passam. Vale corrigir antes do replay, para não travar execuções em lote. |

Nenhuma falha de asserção no motor de investigação. A suíte cobre bem contratos e regressões pontuais, mas toda ela usa IA simulada: **nenhum teste mede a qualidade do raciocínio do modelo real**, que é a lacuna que a Fase 1 precisa cobrir.

---

## 10. Pendências e pedidos de decisão

1. **Aprovar a Fase 1**, incluindo a correção de auditoria (toca em `redaction-service`, área de segurança).
2. **Dados reais nos casos de referência**: autorizar o uso de conversas de produção anonimizadas e o envio delas ao provedor de IA durante o replay. A alternativa é usar só casos sintéticos, que medem menos.
3. **Modelo de referência do replay**: confirmar `openai/gpt-5.4` como modelo de produção, já que o banco local registra gpt-4o.
4. **Desligar a 4B antes da Fase 2?** Ela já tem flag (`IA_SERVICE_DISCIPLINA_4B=0`). Recomendo **não** mudar produção agora: medir na linha de base com e sem ela, e decidir com números.
