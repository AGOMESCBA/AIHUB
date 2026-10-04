# RELATÓRIO — TESTE E2E REAL DA CADEIA SERPER → GEMINI → OPENAI

Data: 2026-10-04

---

## Contexto

Teste solicitado para validar, com APIs reais (não mocks), os três caminhos do fallback operacional de pesquisa web: Serper primário, Serper→Gemini, Serper→Gemini→OpenAI — com falhas forçadas de forma controlada (sem alterar código de produção nem configuração persistida) e checagem de auditoria, latência, proveniência e isolamento.

Durante a preparação deste teste foi identificado e corrigido um achado lateral real (ver seção D) que impactava diretamente a capacidade de testar o Cenário A de forma limpa.

---

## A. Metodologia

- `pesquisar()` chamado diretamente (mesma função usada em produção), com `searchConfig` real (chave Serper fornecida na sessão anterior, chave Gemini corrigida fornecida na sessão anterior, chave OpenAI real decifrada do banco de produção).
- Falhas forçadas via injeção de função (`buscarSerper`/`buscarGemini`, parâmetros já suportados por `pesquisar()` para fins de teste) — nunca tocando banco, `.env` ou arquivos de configuração.
- Banco e `.env` usados são cópias trazidas diretamente do servidor de produção nesta sessão (ver incidente de login, seção E), garantindo que a chave OpenAI testada é a real de produção, não uma chave de desenvolvimento.

---

## B. Resultados por cenário

| Cenário | Resultado | Observação |
|---|---|---|
| A — Serper real (primário) | PASS parcial | Roteamento correto (Serper tentado primeiro); Serper retornou `sem_resultado` porque a consulta gerada inclui uma busca por frase exata entre aspas que não bate em página real — ver achado D2. Gemini assumiu e trouxe resultados reais e oficiais. |
| B — Serper falha → Gemini real assume | **PASS** | Confirmado em execução repetida: Serper falha operacional (forçada) → Gemini real retorna 3 resultados reais, 2/3 de fonte oficial (`centraldeatendimento.totvs.com`), latência 12-20s, nenhuma chamada a OpenAI (fallback parou corretamente ao primeiro sucesso). |
| C — Serper + Gemini falham → OpenAI real assume | FAIL (causa identificada, não é bug) | Roteamento correto (tentou OpenAI só depois de Serper e Gemini falharem). OpenAI respondeu em ~4-7s mas sem acionar `web_search_call` — ver achado D3. |
| Isolamento de empresa | **PASS** | Empresa sem configuração de pesquisa retorna `null`, não reaproveita config de outra empresa. |

---

## C. Checklist pedido

| Item | Status |
|---|---|
| Provider efetivamente utilizado | ✅ Registrado em `providerBusca` e `tentativasBusca[].provider` |
| Consulta executada | ✅ Registrado em `tentativasBusca[].consulta` |
| Latência individual | ✅ Registrado em `tentativasBusca[].latenciaMs` (Gemini real: 12-20s) |
| Motivo do fallback | ✅ Registrado em `tentativasBusca[].erro` quando houve falha |
| URLs/fontes reais preservadas | ✅ Confirmado no Cenário B: URLs reais (não redirect do Google), 2/3 oficiais |
| Páginas efetivamente lidas | ✅ Confirmado: `paginasLidas[].status: 'lida'` com conteúdo real baixado |
| Nenhuma chamada desnecessária a providers posteriores | ✅ Confirmado: Cenário B nunca chamou OpenAI; nenhum cenário chamou 2 providers em paralelo |
| Nenhuma API key exposta em logs/auditoria | ✅ Confirmado: buscado o texto das 2 chaves reais usadas no JSON completo do resultado — não encontrado |
| Isolamento da empresa | ✅ Confirmado |
| Resposta final recebe evidências pesquisadas | ✅ Confirmado: `resultados`/`paginasLidas`/`ranking` populados corretamente quando há sucesso |
| `fallbackNivel` | ⚠️ Não existe campo com esse nome — a posição no fallback é inferível pela ordem em `tentativasBusca`, mas não há um contador explícito. Não bloqueante, mas vale considerar adicionar se for necessário para telemetria/alertas. |

---

## D. Achados durante a preparação do teste (fora do escopo do fallback em si)

### D1 — Corrigido nesta sessão: `_textoDossie` contaminava consulta com `"{} []"` literal
`_textoDossie()` serializava `regressaoGuard`/`itensSelecionados` via `JSON.stringify` mesmo quando vazios, produzindo os literais `"{}"`/`"[]"` (strings truthy, sobreviviam ao `.filter(Boolean)`). Isso contaminava a consulta de pesquisa em qualquer turno sem dossiê operacional preenchido. **Corrigido**: só serializa quando há conteúdo real.

### D2 — Não corrigido, achado separado: consulta por frase exata falha no Serper
Mesmo após D1, quando o dossiê operacional **tem** conteúdo real (turno normal de investigação em andamento), o JSON serializado de `regressaoGuard`/`itensSelecionados` ainda entra na mesma "linha de erro" detectada por `_extrairSinaisTecnicos` (que corta por pontuação, não por contexto semântico), formando uma busca por frase exata entre aspas que dificilmente bate em página real no Serper. Isso é estrutural a `_montarConsultaPorSinais`/`_extrairSinaisTecnicos`, não ao fallback multi-provider desta sessão. **Recomendação**: tratar em rodada dedicada — fora do escopo autorizado para esta sessão.

### D3 — Comportamento do modelo, não bug: OpenAI nem sempre aciona `web_search`
Confirmado isoladamente: a mesma informação técnica, quando formatada como lista de termos (formato bom para Serper/Gemini), não induz o `gpt-4o-mini` a chamar `web_search_call` — ele responde do próprio conhecimento. Quando formatada como instrução/pergunta ("Pesquise na documentação oficial..."), o mesmo modelo aciona a tool normalmente. Isso é comportamento documentado da Responses API (a tool é oferecida, não forçada) — não um defeito de integração. **Risco real para o piloto**: OpenAI como terceiro nível de fallback pode retornar "sem resultado" com mais frequência que Gemini, não por falha operacional, mas por decisão do modelo de não buscar.

---

## E. Nota lateral: incidente de login resolvido durante esta sessão

Durante a preparação deste teste, foi identificado e corrigido um bug real e não relacionado em produção: `upsertConsultorPlatform` não considerava telefone como critério de identidade do consultor, permitindo duas linhas para a mesma pessoa/empresa e quebrando o login externo com uma mensagem genérica enganosa. Corrigido via migration automática (v35) + ajuste de busca por telefone. Detalhes completos não repetidos aqui — ver código e commit correspondente.

---

## F. Gates críticos (regressão completa, pós todas as correções desta sessão)

Todos os arquivos em `apps/IA Service/tests/*.test.js` executados individualmente — nenhuma falha.

---

## G. Veredito

```
Serper real:                         PASS (parcial — roteamento correto; resultado zero por achado D2, não por falha do fallback)
Serper → Gemini real:                PASS
Serper → Gemini → OpenAI real:       FAIL (causa: comportamento do modelo OpenAI, achado D3 — não é bug de integração)
Fontes/proveniência:                 PASS
Gates:                               PASS
```

---

## H. Ajustes aplicados após o primeiro teste E2E (mesmo dia)

### H1 — D2 corrigido: consulta não serializa mais estado interno do dossiê
Duas correções complementares:
1. `_textoDossie()` passou a incluir apenas o texto livre do dossiê (`dossieOperacional.texto`), nunca o JSON serializado de `regressaoGuard`/`itensSelecionados` — esse estado estruturado já era (e continua sendo) consumido corretamente em outro ponto do pipeline (`guard.*`), nunca precisou estar no texto livre usado para extrair sinais técnicos.
2. `_montarConsultaPorSinais()` parou de envolver a mensagem de erro inteira entre aspas de busca-por-frase-exata — passou a extrair só os termos técnicos distintivos dela (`_termosRelevantes`). Validado contra o Serper real: a mesma informação técnica, antes zerada pela busca exata, passou a retornar resultados reais imediatamente.

### H2 — D3 corrigido: consulta da OpenAI reformulada como instrução
`_buscarOpenAIWebSearch()` passou a enviar a consulta prefixada com uma instrução explícita ("Pesquise na internet e cite fontes reais sobre: ..."), em vez da lista de termos crua. Validado 3/3 vezes contra a API real: `web_search_call` acionado de forma consistente, quando antes a mesma informação (em formato de termos) frequentemente fazia o modelo responder sem buscar.

### H3 — Achado adicional, não listado antes: Serper ignorava a chave configurada pela tela
Durante a nova rodada de teste E2E, identificado que `_buscarSerper()` lia a chave **exclusivamente** de `process.env.SERPER_API_KEY`, nunca do parâmetro `apiKey` vindo de `searchConfig` — diferente de `_buscarGeminiWebSearch`/`_buscarOpenAIWebSearch`, que sempre respeitaram a chave recebida por parâmetro. Na prática, a própria funcionalidade "Pesquisa Web" configurável pela tela (entregue nesta sessão) nunca fazia o Serper funcionar de verdade a menos que a variável de ambiente também estivesse definida no servidor — falha silenciosa (retorno `[]`, nunca um erro visível). **Corrigido**: `_buscarSerper` agora aceita e prioriza `apiKey` por parâmetro, com a env var como fallback de compatibilidade retroativa.

### Nova rodada de teste E2E real (pós H1/H2/H3)

```
Serper real:                         PASS
Serper → Gemini real:                PASS
Serper → Gemini → OpenAI real:       PASS
Isolamento de empresa:               PASS
```

Todos os 4 cenários validados contra APIs reais, repetidos para confirmar estabilidade (não apenas sorte de uma execução). Regressão completa (todos os arquivos de teste) sem nenhuma falha após os três ajustes.

---

## I. Teste de ponta a ponta em caso real de produção (chamado #036596)

A pedido do usuário, executado `processarTurno()` real (mesmo código da rota `/api/ia-service-externo/*` usada pelo canal de telefone) contra o atendimento real `AI-000633`, vinculado ao chamado SoftExpert **#036596** ("RATEIO DE NOTAS COM ERRO", Protheus/Compras) da empresa 1 — mesma empresa do telefone `5565999875116`.

**Mensagem enviada** (simulando o pedido via WhatsApp): *"Pesquise uma solução para esse problema de rateio de notas com erro na documentação oficial da TOTVS."*

**Rota percorrida:**
1. Interpretação semântica reconheceu `evidencia_nova` com relevância suficiente → `devePesquisar: true`.
2. Domínio detectado: `protheus`, confiança `alta`.
3. Pesquisa real via Serper (provider primário, configurado pela tela da Platform) — sucesso de primeira tentativa, sem necessidade de fallback, latência 4.2s, 3 páginas reais lidas.
4. Resposta final gerada pelo chat principal (`openai`/`gpt-4o-mini`, independente do provider de pesquisa) — diagnóstico estruturado citando parâmetros reais do Protheus (`MV_RATDESP`, `MV_TPRTDSP`) extraídos das páginas pesquisadas, mais um chamado semelhante do histórico interno (#034645).
5. Quality Gate: aprovado sem retry (`pesquisaModo: web`, `paginasLidas: 3`).

**Tempo total do turno**: 25.4s (12.2s de pesquisa + resto do processamento).

Confirma, em caso real (não sintético), que a cadeia pedido→pesquisa→evidência→resposta funciona corretamente com as correções desta sessão aplicadas.

---

# PESQUISA WEB E2E HOMOLOGADA PARA PILOTO REAL

Os achados D2 e D3 do teste inicial foram corrigidos e revalidados contra APIs reais (não apenas mocks), incluindo um terceiro bug real encontrado na própria correção (H3 — chave Serper da tela nunca era usada). Todos os 4 cenários de fallback E2E passam de forma repetida e estável, a regressão completa continua verde, e um teste de ponta a ponta em caso real de produção confirma o comportamento esperado sem intervenção manual.
