# Levantamento Técnico — Mecanismo Atual de Pesquisa de Soluções

**Data**: 2026-10-03 | **Natureza**: Levantamento técnico puro, somente leitura. Nenhum arquivo foi alterado, nenhuma migration executada, nenhum commit feito. Todo o conteúdo abaixo é extraído diretamente do código em `apps/IA Service/backend/`, com citação de arquivo e função. Onde o comportamento não pôde ser confirmado por código, isso é dito explicitamente.

---

## 1. Localização do mecanismo

| Arquivo | Função | Responsabilidade | Quem chama | Recebe | Retorna |
|---|---|---|---|---|---|
| `backend/services/technical-research-service.js` | `detectarDominio(ctx)` | Classifica o domínio técnico (Protheus/SoftExpert/Integração/Genérico) por score de termos | `montarConsultas` | `{chamado, atendimento, mensagens, anexos, texto}` | `{dominio, confianca, scores}` |
| idem | `montarConsultas(ctx)` | Gera até 4 consultas de texto + links de fontes por domínio | `pesquisar` | mesmo `ctx` | `{dominio, confianca, perfil, consultas, links}` |
| idem | `sanitizarConsultaExterna(texto)` | Remove e-mail, CNPJ/CPF, segredos (`token=`, `senha=`, etc.), IPs privados do texto antes de virar consulta externa | `montarConsultas` | string da consulta bruta | string sanitizada |
| idem | `_buscarSerper(consultas, limite)` / `_buscarBing(consultas, limite)` | Executa a busca real via API Serper/Bing, condicionada a chave de ambiente | `pesquisar` | lista de consultas | lista de `{titulo, url, trecho, fonte, oficial}` |
| idem | `_abrirResultados(resultados, limite=4)` | Abre de fato as páginas top (priorizando fontes oficiais) via `safeFetch.fetchTextoSeguro`, extrai texto limpo de HTML | `pesquisar` | resultados brutos da busca | `paginasLidas`: `{titulo, url, status, trecho, oficial, ...}` |
| idem | `pesquisar(ctx, {limitePorConsulta})` | Orquestra: monta consultas → busca → abre páginas → retorna pacote completo | `investigacao-service.processarTurno` | `ctx` completo do turno | `{dominio, confianca, resultados, paginasLidas, links, modo, configurado}` |
| idem | `formatarContextoParaPrompt(pesquisa, relacionados)` | Serializa o pacote de pesquisa + chamados relacionados em texto para o prompt | `investigacao-service.processarTurno` | `pesquisa` + `relacionados` | string formatada |
| idem | `pesquisarParaChamado(empresaId, chamadoId, extras)` | Variante usada fora do fluxo de chat (ex.: botão "Pesquisar Soluções" standalone) — busca o chamado, posicionamentos e roda `pesquisar` | rota dedicada (não o fluxo principal de investigação) | IDs | `{pesquisa, relacionados}` |
| `backend/repositories/chamado-repository.js` | `listarChamadosRelacionados(empresaId, chamadoId, {limite})` | Scoring heurístico de chamados históricos semelhantes | `processarTurno` e `pesquisarParaChamado` | `chamadoId` | lista de `{chamado, score, motivos, posicionamentos}` |
| `backend/services/safe-web-fetch-service.js` | `fetchTextoSeguro(url, opts)` | Busca o conteúdo real de uma URL, com guarda SSRF | `_abrirResultados` (único ponto de uso dentro da pesquisa) | URL | `{url, raw, statusCode, contentType, bytes, redirects}` |
| `backend/services/investigacao-service.js` | `processarTurno(...)` | Orquestra: dispara a pesquisa, monta contexto (Context Engine), chama a IA | rota HTTP `/investigar` | texto + anexos do turno | mensagem do assistente persistida |

---

## 2. Ponto de entrada

A Pesquisa de Soluções é disparada **em todo turno de investigação**, sem exceção condicional no código — `investigacao-service.js:220`, dentro de `processarTurno`:

```js
const pesquisa = await technicalResearchService.pesquisar({
  chamado, atendimento, mensagens: historico, anexos: anexosTextoParaPesquisa, texto,
});
```

Isso roda **tanto no turno manual** (analista digita algo no chat) **quanto no turno automático** (`processarPreAnalise`, disparado pela importação do radar quando o chamado é alocado pela primeira vez) — ambos passam pela mesma função `processarTurno`.

**Não existe condição no código que pule a pesquisa** por tipo de pergunta, tamanho da mensagem, ou qualquer outro critério — ela sempre é tentada. A única coisa condicional é **o resultado**: se não houver chave de busca configurada (`SERPER_API_KEY`/`BING_SEARCH_API_KEY`), a função `pesquisar` ainda roda, mas `_buscarSerper`/`_buscarBing` retornam array vazio sem erro (`technical-research-service.js:250-251, 271-272`), e o `modo` final fica `'links'` em vez de `'web'`.

Se a pesquisa lançar qualquer exceção, o `catch` em `processarTurno` (linhas 229-234) **não interrompe o turno** — substitui o texto de pesquisa por um aviso genérico e segue adiante. A pesquisa nunca bloqueia a resposta ao analista.

---

## 3. Relação com o chat atual

A pesquisa recebe, no momento em que é chamada (`investigacao-service.js:213-226`):
- `chamado`: resolvido via `chamadoRepo.getChamadoPorNumero` **somente se** `atendimento.referenciaExterna` existir (ou seja, só para atendimentos vinculados a um chamado real do SoftExpert — um atendimento manual sem vínculo não tem `chamado`).
- `historico`: todas as mensagens anteriores do atendimento (sem limite aplicado **nesta chamada específica** — o limite de 12 mensagens é aplicado depois, no Context Engine, não na montagem da consulta de pesquisa).
- `anexosTextoParaPesquisa`: **todos** os anexos do atendimento que têm `conteudoExtraido` preenchido (`investigacao-service.js:208`, `todosAnexosDoAtendimento.filter(a => a.conteudoExtraido)`) — isto é, histórico completo de anexos textuais, não só os do turno atual.
- `texto`: a mensagem atual do analista (ou o texto fixo de pré-análise automática).

**Resposta anterior da IA**: entra como parte do `historico` (mensagens com `papel === 'assistant'`), usada por `_textoDoContexto` (linha 57-66) para compor o texto do qual os termos de busca são extraídos — ou seja, a pesquisa é influenciada pelo que a própria IA já respondeu antes, não só pelo que o analista escreveu.

**Imagens, PDFs, logs**: entram através do campo `conteudoExtraido` do anexo (texto já extraído antes — ver seção 4). A pesquisa nunca recebe o binário da imagem nem rasteriza PDF — só o texto que já foi extraído em outro momento do pipeline.

---

## 4. Anexos — o que entra na pesquisa, por tipo

| Tipo | Armazenado | Processado | Chega à pesquisa (`anexosTextoParaPesquisa`) | Chega ao modelo (via Context Engine) | Fica só armazenado |
|---|---|---|---|---|---|
| Imagem (PNG/JPEG/GIF/WEBP) | Sim | `extracao-conteudo.js` não extrai texto de imagem (`conteudoExtraido: null`) | **NÃO** — filtro `a.conteudoExtraido` exclui todo anexo de imagem | Sim, mas por um caminho **separado** (array `imagens`, multimodal, decidido pelo Context Engine, não pela pesquisa) | — |
| PDF | Sim | `pdf-parse` extrai texto; se baixa densidade de texto ou pedido explícito, `pdf-visual-service.js` rasteriza páginas via Puppeteer | **SIM**, o texto extraído entra em `_textoDoContexto` | Texto sempre; páginas rasterizadas como imagem só se o Context Engine decidir (`enviarPdfVisual`) | — |
| Log/.txt/.log | Sim | Decodificado como texto (UTF-8/Latin-1), linguagem detectada por conteúdo | **SIM** | Sim, via Context Engine (com janela de linhas ao redor de erro, se grande) | — |
| PRW/TLPP/código fonte | Sim | Mesma extração de texto; `linguagemDetectada` marcada (`advpl`/`tlpp`) | **SIM** | Sim | — |
| Documento (DOCX/XLSX/ZIP) | Sim (só como download, não processado) | **NÃO** — fora de `MIME_PERMITIDOS`/pipeline de extração | **NÃO** | **NÃO** | **Sim — fica só armazenado, nunca chega nem à pesquisa nem ao modelo** |

**ARMAZENADO**: todo anexo aceito pelo upload (`armazenamento-anexos.js`).
**PROCESSADO**: todo anexo cujo tipo está em `extracao-conteudo.MIME_TEXTO`/imagem/PDF — produz `conteudoExtraido`.
**SELECIONADO**: dentro do conjunto processado, o Context Engine decide quais entram no prompt final (score, orçamento de tokens) — isso acontece **depois** da pesquisa, não antes.
**ENVIADO AO MODELO**: subconjunto selecionado, de fato serializado no `userPrompt` ou no array `imagens`.
**REALMENTE UTILIZADO NA PESQUISA**: qualquer anexo com `conteudoExtraido` não vazio, **sem filtro de relevância ou seleção** — `anexosTextoParaPesquisa` em `investigacao-service.js:208` pega todo o conjunto, não um subconjunto priorizado. Isso é uma diferença real importante: a **pesquisa usa o conjunto bruto completo de anexos de texto**, enquanto o **prompt final usa um subconjunto filtrado e orçado em tokens** pelo Context Engine.

---

## 5. Montagem da consulta — como o sistema decide o que pesquisar

Função central: `technical-research-service.montarConsultas(ctx)` (linhas 119-149), chamada por `pesquisar`.

**Passo 1 — detecção de domínio** (`detectarDominio`, linhas 77-94): soma 1 ponto por termo de uma lista fixa que aparece no texto concatenado de chamado+atendimento+mensagens+anexos (`PERFIS.protheus.termos`, `PERFIS.softexpert.termos`, `PERFIS.integracao.termos` — linhas 10-40), mais um bônus de +3 pontos (`PESO_PRODUTO_ESTRUTURADO`, linha 75) se o campo estruturado `chamado.produto` do SoftExpert contiver um desses termos. Limiar: score ≥ 2 classifica como aquele domínio; score ≥ 4 é "confiança alta". Se nenhum domínio bate, cai em `'generico'`.

**Passo 2 — extração de termos relevantes** (`_termosRelevantes`, linhas 96-105): tokeniza todo o texto concatenado (mesma fonte do passo 1), remove stopwords genéricas em português (lista fixa, linha 97 — "para", "com", "erro", "chamado", "problema" etc.), conta frequência, pega os 8 termos mais frequentes com 4+ caracteres.

**Passo 3 — sanitização** (`sanitizarConsultaExterna`, linhas 107-117): remove e-mail, CNPJ/CPF, qualquer padrão `token=`/`senha=`/`bearer ` com 8+ caracteres, URLs/IPs privados — antes de qualquer consulta sair para a internet.

**Passo 4 — montagem literal da consulta** (linhas 127-139): string fixa + termos, por domínio:
```js
if (det.dominio === 'protheus') {
  consultas.push(`site:tdn.totvs.com Protheus ${base}`);
  consultas.push(`TOTVS Protheus ${base}`);
  consultas.push(`ADVPL TLPP ${base}`);
}
```
Não há nenhum modelo de IA envolvido nesta etapa — é 100% heurística determinística (regex + contagem de frequência + templates de string fixos). **A consulta não é gerada por um LLM**, é montada por regras de texto.

---

## 6. Consulta única ou iterativa

**Nem única, nem verdadeiramente iterativa.** `montarConsultas` gera **até 4 consultas por turno** (`.slice(0, 4)`, linha 141), todas calculadas de uma vez, a partir do mesmo snapshot de contexto — não há refinamento baseado em resultado anterior **dentro do mesmo turno** (não existe um loop "pesquisei, não achei nada bom, refino e pesquiso de novo").

Entre turnos, cada novo turno recalcula `montarConsultas` do zero com o contexto então disponível (mais uma mensagem no histórico, talvez mais anexos) — isso produz consultas potencialmente diferentes, mas **não é "refinamento guiado por hipótese"**, é simplesmente "o texto de entrada mudou, logo os termos mais frequentes mudam". Não há hipótese explícita (do dossiê ou de outro lugar) usada como insumo para a consulta.

---

## 7. Fontes externas — lista exata

### TOTVS / Protheus (`PERFIS.protheus.fontes`, linhas 13-19)
- TDN TOTVS (`https://tdn.totvs.com/`)
- Busca restrita `site:tdn.totvs.com` via Google dork
- Busca restrita `site:centraldeatendimento.totvs.com` (Central de Atendimento TOTVS)
- Busca `site:totvs.com Protheus`
- Busca geral Protheus (fallback)

**Não encontrado**: Fórum TOTVS (nenhuma URL/domínio dedicado), GitHub oficial TOTVS (nenhuma menção no código) — só cairiam se aparecessem organicamente num resultado de busca real (Serper/Bing), nunca como fonte dirigida.

### SoftExpert (`PERFIS.softexpert.fontes`, linhas 25-30)
- `site:softexpert.com` (Base oficial)
- `site:help.softexpert.com` (Help/Docs)
- Busca "SoftExpert" geral
- Busca geral (fallback)

**Não encontrado**: nenhuma menção a `developer.softexpert.com` especificamente, nem Customer Center/KB autenticado — só os dois domínios acima.

### Geral (`PERFIS.integracao` e `PERFIS.generico`, linhas 33-48)
- Domínio "integração/API": só busca geral, sem fonte dirigida.
- Domínio "genérico" (fallback quando nada bate): só busca geral.

**Mecanismo de busca real**: `_buscarSerper` (API Serper/Google, linhas 249-267) ou `_buscarBing` (API Bing, linhas 269-286) — tentados nessa ordem, condicionados a `SERPER_API_KEY`/`BING_SEARCH_API_KEY`.

**Prioridade e confiança**: `_fonteOficial(url)` (linhas 207-214) marca como "oficial" qualquer resultado cujo host termine em `totvs.com`, `tdn.totvs.com`, `softexpert.com` ou `help.softexpert.com`. Essa marcação é usada só para **ordenar** quais páginas são abertas primeiro (`_abrirResultados`, linha 218: `sort` por `_fonteOficial` antes de aplicar o limite de 4) — não há peso numérico de confiança além de "oficial vai primeiro na fila de leitura".

---

## 8. Safe Web Fetch — participação na Pesquisa de Soluções

Único ponto de uso dentro da pesquisa: `_abrirResultados` (`technical-research-service.js:216-247`), que chama `safeFetch.fetchTextoSeguro(r[RAW_URL] || r.url)` para cada um dos até 4 melhores resultados (ordenados por "oficial primeiro").

O que isso garante, sem reauditar a Etapa 2.1 (resumo do papel, não da implementação):
- Valida protocolo (só `http`/`https`).
- Resolve DNS e bloqueia IPs privados/loopback/link-local (SSRF).
- Limita bytes baixados e número de redirects.
- Só aceita `Content-Type` de uma lista permitida (HTML/texto/XML/JSON).

Na pesquisa, o resultado de cada fetch vira um item de `paginasLidas` com `status: 'lida'` (sucesso) ou `status: 'erro_fetch'` (qualquer falha — bloqueio SSRF, timeout, tipo de conteúdo rejeitado, etc.) — a pesquisa **nunca propaga a exceção do fetch**, ela vira um status registrado (`technical-research-service.js:235-244`).

---

## 9. O que acontece com os resultados

- `_buscarSerper`/`_buscarBing` retornam até `limitePorConsulta` (default 3) resultados **por consulta** — com até 4 consultas, até 12 resultados brutos antes de qualquer corte.
- `pesquisar` corta para `resultados.slice(0, 10)` no retorno final (linha 312) — isso é o que aparece no manifesto, mas **não** é o que é de fato lido.
- `_abrirResultados` abre apenas os **4 melhores** (parâmetro fixo `limite = 4`, linha 216, chamado assim em `pesquisar:300`), priorizando fonte oficial.
- Relevância **não é calculada por score numérico** — é só a ordenação binária "oficial vs. não oficial"; não há reranking nem filtro de relevância textual entre os resultados de uma mesma consulta.
- Conteúdo de cada página aberta é limpo de tags HTML (`_limparHtml`, linhas 189-205 — remove `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`, demais tags) e **truncado em 4500 caracteres** (`trecho: ... .slice(0, 4500)`, linha 233) — não é um resumo gerado por IA, é um corte de texto bruto.
- Páginas que falham no fetch (bloqueio SSRF, erro de rede, tipo de conteúdo não permitido) não são descartadas silenciosamente — aparecem no manifesto com `status: 'erro_fetch'` e a mensagem de erro redigida.
- **Todos os resultados e páginas lidas entram diretamente no texto do prompt** via `formatarContextoParaPrompt` (linhas 335-354) — não há um passo intermediário de "selecionar os 2 melhores trechos" feito por IA; tudo que foi aberto com sucesso é serializado.

---

## 10. Pesquisa e modelo — fluxo completo

```
technicalResearchService.pesquisar(ctx)                    [investigacao-service.js:220]
  → montarConsultas → busca (Serper/Bing) → abre até 4 páginas (safeFetch)
  → retorna {resultados, paginasLidas, links, modo, configurado}
       ↓
technicalResearchService.formatarContextoParaPrompt(pesquisa, relacionados)   [linha 228]
  → serializa tudo em texto único: "## Pesquisa técnica assistida\n..."
       ↓
contextEngine.montarContextoInvestigacao({..., pesquisaTecnicaTexto, pesquisa, ...})  [linha 238]
  → esse texto é inserido no prompt final SEM re-selecionar/truncar
    (context-engine.js:357: `if (pesquisaTecnicaTexto) partes.push('\n' + pesquisaTecnicaTexto);`)
  → NÃO conta no orçamento de tokens do loop de seleção de evidências
    (é somado uma única vez em `usados`, linha 269, mas nunca é candidato a ser omitido —
    diferente de mensagens/anexos, que podem ser cortados pelo orçamento)
       ↓
aiProviderClient.chamarIA(keys, cfg, SYSTEM_PROMPT, userPrompt, imagens, ...)  [linha 349]
  → resposta ao consultor
```

Ponto técnico relevante: **o texto de pesquisa entra no prompt final sem passar pelo mecanismo de corte por orçamento que se aplica a mensagens e anexos** — ele é concatenado incondicionalmente (`context-engine.js:357`), apenas contado no total de tokens estimados. Isso significa que, em teoria, uma pesquisa muito extensa (4 páginas de até 4500 caracteres cada, mais resultados brutos) poderia empurrar o prompt além do orçamento calculado sem ser automaticamente reduzida — não há evidência no código de um limite rígido aplicado a esse bloco especificamente.

---

## 11. Context Engine — relação com a pesquisa (pós "Etapa 3C")

Confirmado lendo `context-engine.js` linha a linha:

- A pesquisa **não recebe nada do Context Engine** — `technicalResearchService.pesquisar` é chamada em `investigacao-service.js:220`, **antes** de `contextEngine.montarContextoInvestigacao` ser chamada (linha 238). A ordem no código é: pesquisa primeiro, Context Engine depois.
- O que o Context Engine **entrega** é o prompt final montado, que inclui o texto da pesquisa (recebido como parâmetro `pesquisaTecnicaTexto`) concatenado junto com histórico, anexos selecionados e — isso é a novidade confirmada da "3C" — o bloco de **memória operacional do dossiê** (`dossieContextService.montarMemoriaOperacional`, chamado em `context-engine.js:166-171`).
- **A pesquisa não devolve nada de volta ao Context Engine além do texto já formatado** — é um fluxo de mão única: pesquisa → texto → Context Engine → prompt.
- O dossiê e a pesquisa são **dois blocos de texto paralelos e independentes** dentro do mesmo prompt final (`context-engine.js:341-347` injeta o bloco do dossiê; linha 357 injeta o bloco de pesquisa) — eles não se comunicam entre si dentro dessa função. Nenhum dado do dossiê é passado como argumento para `technicalResearchService.pesquisar` ou `montarConsultas`.

---

## 12. Dossiê Técnico — uso direto pela Pesquisa de Soluções

**Não presumido — verificado diretamente no código de `technical-research-service.js` inteiro: nenhuma função desse arquivo importa, requer ou referencia `investigacao-dossie-service`, `investigacao-dossie-repository` ou `dossie-context-service`.** Não há `require` desses módulos em `technical-research-service.js`. Confirmo isso como fato negativo direto:

```bash
grep -n "dossie" "apps/IA Service/backend/services/technical-research-service.js"
→ (nenhuma ocorrência)
```

Portanto, especificamente dentro do mecanismo de Pesquisa de Soluções (`detectarDominio`, `montarConsultas`, `pesquisar`), o sistema **não usa diretamente** fatos, hipóteses, hipóteses descartadas, testes, resultados, diagnóstico, solução ou pendências do dossiê. Essas informações só influenciam o **prompt geral de investigação** (via `context-engine.js` → `dossie-context-service.js`, que é um caminho paralelo e separado da pesquisa) e o **Quality Gate** (via `manifesto.dossie.regressaoGuard`, usado em `quality-gate-service._avaliarRegressaoInvestigativa` — seção 18/19 abaixo).

---

## 13. Efeito da "Etapa 3C" sobre a Pesquisa de Soluções

**Resposta direta: SIM altera indiretamente o resultado final entregue ao analista, mas NÃO altera a geração das consultas de pesquisa em si.**

**Onde SIM altera, indiretamente**:
- O bloco de memória operacional do dossiê (`dossieContextService.montarMemoriaOperacional`) é injetado no mesmo prompt final onde o texto da pesquisa também está (`context-engine.js`, linhas 341-347 vs. 357) — então o modelo de IA que gera a resposta final **vê os dois ao mesmo tempo** e pode, por sua própria interpretação, cruzar informações (ex.: "a pesquisa encontrou um artigo sobre X, mas o dossiê diz que a hipótese X já foi descartada") — mas isso é inferência do modelo lendo dois blocos de texto adjacentes, não um mecanismo determinístico de cruzamento.
- O Quality Gate (`quality-gate-service.avaliarResposta`) usa `manifesto.dossie.regressaoGuard` (populado pelo dossiê) para detectar se a resposta final repete um teste já executado ou reapresenta uma hipótese descartada — isso pode disparar um **retry da chamada de IA completa** (incluindo reenvio do mesmo texto de pesquisa já obtido, sem pesquisar de novo).

**Onde NÃO altera**: `detectarDominio`, `montarConsultas` e `pesquisar` não leem nenhum dado do dossiê. O domínio detectado, os termos extraídos e as consultas geradas são exatamente os mesmos, com ou sem dossiê. **A 3C não mudou uma linha do mecanismo de pesquisa propriamente dito.**

---

## 14. Histórico da conversa usado pela pesquisa

Na chamada à pesquisa (`investigacao-service.js:220-226`), `mensagens: historico` é passado **sem nenhum corte** — é o resultado de `mensagemRepo.listarMensagens(empresaId, atendimentoId)` filtrado só para excluir a mensagem do turno atual (linha 181-182), ou seja, **histórico completo do atendimento**, não as últimas N mensagens.

Isso é diferente do que acontece no Context Engine (`context-engine.js`), onde o histórico passa por scoring e orçamento de tokens antes de entrar no prompt final. **A pesquisa usa o histórico cru e completo apenas para extrair termos de busca** (via `_textoDoContexto` → `_termosRelevantes`) — não há token budget, truncamento ou priorização aplicados especificamente à etapa de montagem de consulta.

---

## 15. Pesquisas anteriores — o sistema sabe o que já pesquisou?

**Não existe persistência dedicada de consultas/termos/URLs pesquisados como entidade própria e consultável antes de pesquisar de novo.** O que existe:

- `investigacao_execucoes.pesquisa_json` (`investigacao-execucao-repository.js`) guarda, por execução/turno, o pacote `pesquisa` inteiro retornado por `technicalResearchService.pesquisar` — incluindo consultas, resultados e páginas lidas daquele turno específico. Isso é **auditoria histórica passiva** (dá para consultar depois, turno por turno), não um mecanismo que a própria pesquisa consulta **antes de rodar de novo**.
- `technical-research-service.pesquisar` **não lê `investigacao_execucoes` nem nenhuma outra tabela de pesquisas anteriores antes de montar uma nova consulta**. Cada chamada começa do zero.

---

## 16. Repetição de pesquisa — existe deduplicação?

**Não existe mecanismo de deduplicação no código.** Se o contexto (mensagens + anexos) de dois turnos diferentes gerar os mesmos termos mais frequentes, `montarConsultas` vai gerar exatamente as mesmas consultas, e `pesquisar` vai rodar a busca de novo, incluindo nova(s) chamada(s) HTTP de fetch das mesmas páginas — não há cache de URL, nem hash de consulta, nem checagem contra `investigacao_execucoes.pesquisa_json` anteriores. Confirmado por ausência de qualquer lógica desse tipo em `technical-research-service.js`.

---

## 17. Evolução da pesquisa diante de nova evidência

Com base exclusivamente no código: a resposta é **(A) — a pesquisa é recalculada do zero a cada turno**, não (B) complementar nem (C) refinamento de consultas anteriores. `montarConsultas` não recebe nem lê nenhum estado de pesquisas passadas — simplesmente roda a mesma lógica de extração de termos sobre o contexto atualizado (que agora inclui a nova evidência, se ela já estiver persistida como mensagem/anexo antes da chamada). Não existe (D) "pesquisar novas hipóteses" como conceito dentro do mecanismo de pesquisa — hipóteses do dossiê não são lidas por essa função (seção 12).

---

## 18. Hipóteses influenciam a geração de consultas?

**Não, confirmado por ausência de código.** `montarConsultas`/`detectarDominio` não importam o dossiê (seção 12). Hipóteses (ativas, confirmadas ou descartadas) não aparecem em nenhum lugar da lógica de montagem de consulta de pesquisa, mesmo após 3A/3B/3C.

---

## 19. Hipótese descartada impede pesquisa repetida sobre o mesmo caminho?

**Não, no mecanismo de pesquisa.** Uma hipótese descartada não impede nem reduz a geração de consultas pela pesquisa técnica — ela não é lida por esse mecanismo.

**Mas há um efeito parcial em outro lugar do pipeline, não na pesquisa**: `quality-gate-service._avaliarRegressaoInvestigativa` (linhas 26-87, arquivo `quality-gate-service.js`) lê `manifesto.dossie.regressaoGuard.hipotesesDescartadas` (vindo do Context Engine/dossiê, não da pesquisa) e, se a **resposta final da IA** reapresenta o código de uma hipótese descartada como causa provável sem justificativa de evidência nova, isso gera uma falha `REGRESSAO_INVESTIGATIVA_HIPOTESE_DESCARTADA`, que pode acionar um **retry da chamada de IA** (não da pesquisa) com uma instrução explícita para não repetir a hipótese sem justificar. Isso é um controle sobre a **resposta final**, não sobre a **pesquisa**.

---

## 20. Teste com resultado negativo influencia a próxima Pesquisa de Soluções?

**Não, diretamente na pesquisa — confirmado por ausência de leitura do dossiê em `technical-research-service.js`.**

Existe, de novo, um efeito indireto via Quality Gate: `regressaoGuard.testesExecutados` (populado por `dossie-context-service.js:191`, incluindo testes com status `EXECUTADO`/`INCONCLUSIVO`/`CANCELADO`) é usado por `_avaliarRegressaoInvestigativa` para detectar se a **resposta da IA** sugere repetir um teste já encerrado como "próximo passo" sem justificativa — gera falha `REGRESSAO_INVESTIGATIVA_TESTE_REPETIDO` e pode disparar retry da resposta. Mas isso não impede nem reduz a **pesquisa técnica externa** sobre o mesmo tema — a pesquisa pode (e vai) continuar buscando os mesmos termos técnicos relacionados àquela customização, mesmo que um teste já tenha mostrado que ela não é a causa, porque a pesquisa nunca sabe que esse teste existiu.

---

## 21. Novas evidências e a estratégia de pesquisa

Quando chega novo log/print/mensagem/fonte/versão/erro, o que acontece de fato:
- O novo conteúdo entra no `historico`/`anexosTextoParaPesquisa` do próximo turno (se já persistido antes da chamada à pesquisa, o que é o caso — upload acontece antes do turno de investigação).
- Isso muda os **termos mais frequentes** calculados por `_termosRelevantes`, que por sua vez muda a consulta gerada.
- **Não existe nenhuma lógica explícita de "evento dispara nova estratégia de pesquisa"** — é um efeito indireto e não-dirigido de "o texto de entrada mudou, então a extração de frequência de palavras produz termos diferentes". Não há detecção de "isto é uma versão nova" ou "isto é uma mensagem de erro diferente da anterior" que altere deliberadamente a lógica de busca (ex.: não há um branch "se mudou o número da versão, inclua a versão na consulta").

---

## 22. Identificação de produto/domínio

Feita inteiramente por `detectarDominio` (seção 5) — score de termos fixos mais peso extra se `chamado.produto` (campo estruturado do SoftExpert) bater. **Não identifica** SQL Server, REST/API além do perfil genérico "integracao" (termos: `api, rest, soap, json, xml, http, token, timeout, payload, webservice`), Windows, IIS — nenhum desses tem perfil dedicado; cairiam no domínio `'integracao'` (se os termos batessem) ou `'generico'`.

**O que muda com o domínio detectado**: fontes pesquisadas (seção 7), texto das consultas geradas (seção 5), e a `instrucao` textual incluída no prompt (`PERFIS[dominio].instrucao`, ex. "Priorize documentação oficial TOTVS/TDN..."). **Não muda** o system prompt principal do modelo (que é fixo, `prompt-builder.SYSTEM_PROMPT`, sem variação por domínio) nem a prioridade de providers de IA.

---

## 23. Protheus — quais informações influenciam a pesquisa hoje

Confirmado por leitura de `PERFIS.protheus.termos` e `_termosRelevantes`: o mecanismo não distingue campos estruturados de Protheus (rotina, módulo, ponto de entrada, função, tabela, campo, build, release) de texto livre — ele trata **tudo como texto corrido** e extrai os termos mais frequentes por contagem simples. Se o nome de uma rotina (ex. "MATA410") ou uma mensagem de erro específica aparecer no texto da mensagem/log/anexo, ela **pode** entrar nos 8 termos mais frequentes (sujeito a ter 4+ caracteres e não ser stopword) — mas isso é um efeito estatístico de frequência de palavra, não uma extração estruturada dirigida a "isto é um nome de rotina, use-o na consulta".

**Stack trace/mensagem de erro**: só influencia na medida em que suas palavras aparecem com frequência suficiente no texto consolidado — não há parsing de stack trace para extrair nome de função/linha especificamente para a pesquisa (esse tipo de parsing existe no Context Engine, para seleção de evidências no prompt, não na pesquisa).

**Resumo**: nenhuma dessas informações (rotina, módulo, ponto de entrada, função, tabela, campo, build, release, stack) tem tratamento estruturado dedicado na pesquisa — tudo passa pelo mesmo funil de "termos mais frequentes no texto bruto".

---

## 24. SoftExpert — quais informações influenciam a pesquisa hoje

Mesma resposta estrutural da seção 23: `chamado.modulo`, `chamado.servico` etc. **entram no texto concatenado** (`_textoDoContexto`, linha 57-66, já inclui `chamado?.modulo`, `chamado?.servico`) e portanto podem influenciar a detecção de domínio e a frequência de termos — mas não há tratamento dedicado de endpoint, status HTTP, payload, versão de integração como campos estruturados de busca (ex. não existe um branch "se há código HTTP 500 na mensagem, inclua isso explicitamente na consulta").

---

## 25. Base histórica interna — entrada na Pesquisa de Soluções

- **Quando consultada**: todo turno, em paralelo à pesquisa web (`investigacao-service.js:213-219`), via `chamadoRepo.listarChamadosRelacionados(empresaId, chamado.id, {limite: 5})` — **somente se** o atendimento tiver `chamado` resolvido (vínculo com SoftExpert via `referenciaExterna`).
- **Candidatos**: até 1200 chamados mais recentes da mesma empresa (`chamado-repository.js`, já documentado em auditorias anteriores — não há alteração nesse mecanismo).
- **Classificação**: scoring heurístico por campo estruturado (produto/módulo/família/serviço) + contagem de tokens em comum — sem mudança desde a versão já auditada.
- **Quantos entram**: até 5 relacionados por padrão (`limite: 5`, linha 218), formatados em `_formatarChamadosRelacionados` e inseridos no texto final de pesquisa (`formatarContextoParaPrompt`, linha 350-351).
- **Isolamento multiempresa**: sim, `listarChamadosRelacionados` filtra por `empresa_id` (confirmado em auditorias anteriores do mesmo repository, não alterado aqui).
- **Solução validada vs. apenas semelhante**: não há tratamento diferenciado — o scoring dá +8 pontos se o campo `solucaoAplicada` estiver preenchido (texto não vazio) e +6 se `statusEncerramento === 'Encerrado'`, mas isso é peso aditivo, não um filtro/flag de "validado" vs. "apenas parecido" (mesmo comportamento já documentado antes, confirmado sem mudança nesta leitura).

---

## 26. RAG / Embeddings / FTS / BM25

**Confirmado: nenhum dos quatro existe.** A pesquisa web é busca por API de terceiros (Serper/Bing) + fetch de página + corte de texto bruto, sem embeddings. A base histórica é scoring heurístico por SQL puro (`SELECT ... WHERE`, sem FTS5 virtual table, sem índice vetorial). Nenhum `require` de biblioteca de embeddings, vetor ou full-text search foi encontrado no código de pesquisa.

---

## 27. Custo — chamadas de IA por Pesquisa de Soluções completa

Separando por etapa, com base no fluxo confirmado em `investigacao-service.processarTurno`:

| Etapa | Chamada de IA? | Provider/model |
|---|---|---|
| Pesquisa técnica em si (`technicalResearchService.pesquisar`) | **Não** — é busca determinística (API de busca + regex), zero chamadas de IA | — |
| Análise principal (resposta ao consultor) | 1 chamada | `aiProviderClient.chamarIA` com o `cfg` da empresa (ordem de fallback definida em `platform_ai_configs`; provider primário observado em dados reais: `groq`) |
| Quality Gate (avaliação) | **Não** — `avaliarResposta`/`_avaliarRegressaoInvestigativa` são heurísticas de texto/regex, sem chamada de IA | — |
| Retry por Quality Gate | +1 chamada, **condicional** (só se `deveRetry === true`) | mesmo provider/model do `cfg` |
| Atualização do dossiê (3B) | +1 chamada, **sempre que não houver `opcoes.proposta` de teste** — roda após CADA turno (`investigacao-dossie-atualizador-service.atualizarAposTurno`, chamado em `investigacao-service.js:491`) | mesmo `cfg` da empresa; `maxTokens: 1600`, `json: true`, `timeoutMs: 30000` |

**Total por turno completo, caso mais comum (sem retry de Quality Gate)**: **2 chamadas de IA** (análise principal + atualização 3B). **Caso com retry de Quality Gate**: **3 chamadas de IA** (análise + retry + atualização 3B). Não há "planejamento de pesquisa" feito por IA — a montagem de consulta é 100% heurística (seção 5), zero custo de IA nessa etapa.

---

## 28. Latência — principais pontos

- **Chamada de IA principal**: maior fator isolado, variável por provider/modelo e por volume de imagens (`timeoutMs = 45000 + imagens.length * 15000`, `investigacao-service.js:340`).
- **Pesquisa web**: até 4 consultas sequenciais ao Serper/Bing (`for (const q of consultas)` em `_buscarSerper`/`_buscarBing` — chamadas **sequenciais**, não paralelas), cada uma com timeout de 8s (`_postJson`/`_getJson`, `timeoutMs: 8000` default).
- **Fetch de páginas**: até 4 páginas abertas sequencialmente em `_abrirResultados` (`for (const r of ordenados.slice(0, limite))` — também sequencial, não `Promise.all`), cada uma com timeout de 8s default do Safe Web Fetch.
- **PDF rasterizado**: Puppeteer/Chromium, custo de inicialização de browser + render por página — significativo quando acionado (`pdf-visual-service.rasterizarPdfPaginas`), mas só ocorre condicionalmente.
- **Retry de Quality Gate**: dobra o tempo da chamada de IA principal quando acionado.
- **Atualização 3B**: +1 chamada de IA após a resposta já ter sido entregue ao usuário (ver seção 31) — **não adiciona latência percebida pelo analista**, porque roda depois do `mensagemRepo.salvarMensagem` da resposta principal, dentro do mesmo request HTTP, mas após a resposta já estar logicamente "pronta" (ainda bloqueia o retorno HTTP da rota, já que é `await`ada antes do `return mensagemAssistente` — **não é fire-and-forget**, é síncrono dentro do mesmo request).

Nenhum benchmark real foi executado nesta etapa (fora do escopo de levantamento); os pontos acima são identificados por leitura de código, não medidos.

---

## 29. Auditoria — o que é provável hoje

Persistido em `investigacao_execucoes` (uma linha por turno) e recuperável via `execucaoRepo.getExecucao`/`listarPorAtendimento`:
- `pesquisa_json`: pacote completo retornado por `pesquisar` — consultas, resultados brutos, páginas lidas (URL, status, trecho usado), domínio detectado.
- `manifesto_json`: manifesto do Context Engine, incluindo evidências selecionadas/omitidas e o bloco `dossie` (status, stale, itens selecionados).
- `quality_gate_json`: falhas detectadas, se houve retry.
- `provider`/`model`: persistidos como colunas próprias.
- `usage_json`: tokens reportados pelo provider (quando disponível).
- `latencia_ms`: tempo da chamada de IA principal.
- `tokens_estimados_prompt`/`tokens_estimados_resposta`: estimativa própria (não é o `usage` real do provider).

**Provável com confiança**: qual consulta foi executada, quais URLs foram encontradas, quais foram de fato abertas (lidas) vs. que falharam no fetch, qual trecho de cada página entrou no prompt (via `trecho` truncado em 4500 chars), provider/modelo usado, tokens estimados e reais (quando o provider devolve `usage`), latência da chamada de IA.

**Não provável diretamente**: tempo gasto especificamente na etapa de pesquisa (fetch + busca) separado do tempo da chamada de IA — `latencia_ms` mede só a chamada de IA principal (`Date.now() - inicioIa`, medido a partir de depois da pesquisa já ter rodado), não há medição isolada do tempo de `technicalResearchService.pesquisar`.

---

## 30. Exemplo real do fluxo — turno 1

**Entrada**: `"Após a atualização do Protheus o pedido não integra mais ao SoftExpert. Segue o log."` + anexo de log.

**O que o sistema faz hoje, passo a passo**:

1. `processarTurno` persiste a mensagem do usuário (`mensagemRepo.salvarMensagem`).
2. `_garantirDossieSeguro` cria o dossiê do atendimento se ainda não existir (silencioso, não bloqueia nada em caso de falha).
3. Anexo de log é vinculado à mensagem (`anexoRepo.vincularMensagem`).
4. `anexosTextoParaPesquisa` pega **todo** anexo com texto extraído do atendimento (inclui o log recém-enviado, já que o upload acontece antes do turno de investigação ser chamado).
5. **Pesquisa dispara**: `detectarDominio` roda sobre o texto concatenado (mensagem + log). Termos como "protheus" pontuam para o perfil Protheus; se o texto também contiver "softexpert"/"workflow", ambos os perfis podem pontuar, mas o código testa Protheus primeiro (`if (scores.protheus >= 2) return ...`, linha 90) — **Protheus vence o empate se os dois baterem o limiar de 2**, por ordem de verificação no `if/else if`, não por quem tem score maior.
6. `_termosRelevantes` extrai os 8 termos mais frequentes do texto (provavelmente incluindo palavras do log, como nomes de função/erro, se tiverem frequência e tamanho suficientes).
7. `montarConsultas` gera até 3 consultas (domínio Protheus): `site:tdn.totvs.com Protheus <termos>`, `TOTVS Protheus <termos>`, `ADVPL TLPP <termos>`.
8. Se `SERPER_API_KEY`/`BING_SEARCH_API_KEY` estiverem configuradas: busca real roda, até 4 melhores resultados são abertos via Safe Web Fetch, texto limpo e truncado a 4500 chars cada.
9. Em paralelo, `chamadoRepo.listarChamadosRelacionados` roda **somente se** o atendimento tiver `chamado` vinculado (via `atendimento.referenciaExterna`) — se for um atendimento manual sem vínculo, essa parte é pulada (`chamado = null`, `relacionados = []`).
10. `formatarContextoParaPrompt` serializa tudo isso em texto.
11. `contextEngine.montarContextoInvestigacao` monta o prompt final: histórico (vazio neste primeiro turno, exceto a mensagem atual), anexo de log selecionado (score alto por conter termos como "error"/"exception" — `_scoreTexto`, +14 pontos), bloco de pesquisa concatenado sem corte, bloco de dossiê (vazio/mínimo, pois é o primeiro turno).
12. `aiProviderClient.chamarIA` chama o provider primário (ex. `groq`).
13. `qualityGateService.avaliarResposta` roda sobre a resposta — se a pergunta "pede anexo" (sim, menciona "log") e nenhum anexo foi marcado como "ANALISADA" no manifesto, ou se a resposta for genérica, pode disparar retry.
14. Resposta final é persistida; `investigacao_execucoes` grava tudo (pesquisa, manifesto, quality gate, usage).
15. **Depois** da resposta já estar pronta e persistida: `investigacaoDossieAtualizador.atualizarAposTurno` roda uma chamada de IA adicional para propor mudanças de estado do dossiê (ex. criar um FATO "pedido não integra após atualização do Protheus", talvez uma HIPOTESE inicial) — isso acontece **de forma síncrona dentro do mesmo request HTTP**, mas depois da resposta ao usuário já ter sido montada (não influencia o texto que o analista vê neste turno).

---

## 31. Segundo turno — "Fiz T01 e continua"

Continuação do exemplo, considerando 3A/3B/3C já ativos:

1. Novo turno chama `processarTurno` de novo. `_garantirDossieSeguro` não cria nada novo (dossiê já existe).
2. **A pesquisa roda de novo, do zero** (seção 17) — `montarConsultas` recalcula termos a partir do histórico completo + texto atual ("Fiz e continua"). Como essa frase curta tem pouco conteúdo técnico, os termos mais frequentes provavelmente vêm do **histórico anterior** (que entra sem corte na extração de termos da pesquisa, seção 14) — então as consultas geradas tendem a ser **parecidas ou idênticas** às do turno 1, porque o texto de origem (mensagem+log do turno 1, ainda presente no histórico) continua dominando a contagem de frequência. **Não há deduplicação** (seção 16): se as consultas forem idênticas, a busca e o fetch rodam de novo, incluindo nova(s) chamada(s) de rede às mesmas URLs.
3. `contextEngine.montarContextoInvestigacao` agora inclui o **bloco de memória operacional do dossiê**, que traz: o T01 com status (presumivelmente `EXECUTADO`, se o 3B do turno anterior já tiver processado isso — mas **atenção**: o 3B do turno 1 só rodaria depois da resposta do turno 1, então T01 só existiria se a resposta do turno 1 tiver proposto um teste e o 3B tiver criado o item `TESTE`), a hipótese associada, e o `regressaoGuard` com `testesExecutados` incluindo T01 **se e somente se** seu status já tiver sido atualizado para `EXECUTADO`/`INCONCLUSIVO`/`CANCELADO` por uma chamada anterior do 3B.
4. Se o dossiê já registra T01 como pendente (`SOLICITADO`/`AGUARDANDO_EXECUCAO`) e o texto "Fiz e continua" chega, **a pesquisa técnica externa não sabe nada disso** — ela segue gerando consultas pelos mesmos termos de sempre, sem saber que há um teste em aberto esperando confirmação.
5. A resposta da IA principal, vendo o bloco de dossiê no prompt (que inclui `testesPendentes`/`testesExecutados`), pode (por sua própria interpretação de texto, não por lógica determinística) reconhecer que T01 foi mencionado e que o problema persiste, e sugerir avançar para outra hipótese.
6. **Depois** dessa resposta, `investigacaoDossieAtualizador.atualizarAposTurno` roda de novo — é essa chamada de IA (3B) que interpretaria "Fiz e continua" como `ATUALIZAR_TESTE` (status `EXECUTADO`) + `CRIAR_RESULTADO` (classificação `NEGATIVO`, já que "continua" indica que o problema não foi resolvido) **se o modelo da 3B interpretar corretamente** — isso é uma proposta estruturada gerada por IA, validada por `_validarAlteracao` antes de persistir (ex.: linha 241, `ATUALIZAR_TESTE` com `status === 'EXECUTADO'` exige indicação real de execução no evento interpretado).
7. Esse resultado só fica disponível para influenciar a **pesquisa técnica** (não influencia, de qualquer forma, por ausência de leitura do dossiê — seção 12) nem o **Quality Gate do turno seguinte** (`regressaoGuard` seria atualizado, usado no turno 3, não no turno 2 em andamento).

**Resumo direto da seção**: a pesquisa técnica do turno 2 roda de forma praticamente idêntica à do turno 1 (mesma lógica, histórico cumulativo), sem nenhuma consciência de que T01 foi executado ou que seu resultado foi negativo. O controle de "não insista no mesmo caminho" existe **só na camada de geração/validação da resposta de texto** (Quality Gate + prompt do dossiê), nunca na camada de pesquisa externa.

---

## 32. Pontos fortes atuais (comprovados pelo código)

- Sanitização real de dados sensíveis antes de qualquer consulta sair para a internet (`sanitizarConsultaExterna`).
- Abertura real de páginas (não só snippet) com guarda SSRF completa (Safe Web Fetch), incluindo tratamento de redirect malicioso.
- Priorização determinística de fontes oficiais (TDN/Central TOTVS/SoftExpert) na ordem de leitura.
- Falha de pesquisa nunca bloqueia o turno (degradação graciosa, com aviso textual honesto ao modelo sobre a limitação).
- Auditoria completa e persistida por turno (consulta, resultado, página lida, provider, tokens).
- Isolamento multiempresa mantido na base histórica interna (herdado, não específico desta etapa).
- Quality Gate com guarda de regressão investigativa (não repetir teste/hipótese encerrados) — ainda que atue sobre a resposta, não sobre a pesquisa.

---

## 33. Limitações atuais (comprovadas pelo código)

- A pesquisa técnica externa **não lê o dossiê em nenhum momento** — nem para gerar consultas, nem para evitar repetir pesquisas sobre uma hipótese já descartada ou um teste já concluído.
- **Não existe deduplicação de pesquisa** entre turnos — mesmas consultas, mesmas URLs, podem ser buscadas e baixadas de novo repetidamente.
- A consulta é gerada por heurística de frequência de palavras, não por entendimento de domínio estruturado (rotina/função/tabela/versão não são tratadas como campos distintos, só como texto que pode ou não entrar nos termos mais frequentes).
- Chamadas de busca e de fetch de página são sequenciais, não paralelas — custo de latência acumulado linear com o número de consultas/páginas.
- O bloco de texto de pesquisa entra no prompt final sem participar do mecanismo de corte por orçamento de tokens que governa mensagens/anexos.
- Não há medição de latência isolada da etapa de pesquisa em si (só da chamada de IA).
- Resultado de teste negativo (ex. "customização X não é a causa") não impede a pesquisa de continuar gerando consultas relacionadas a essa mesma customização, porque a pesquisa não sabe que esse teste existiu.

---

## 34. Pontos exatos de extensão — onde o dossiê poderia entrar na pesquisa (sem implementar)

| Onde | Arquivo/Função | Entrada hoje | Mudança possível (sem implementar) | Impacto provável |
|---|---|---|---|---|
| Geração de consultas | `technical-research-service.js`, `montarConsultas(ctx)` | `ctx = {chamado, atendimento, mensagens, anexos, texto}` | Adicionar `ctx.dossie` (hipóteses ativas, testes pendentes/executados, hipóteses descartadas) como fonte adicional de termos/exclusões | Consultas mais dirigidas a hipóteses em aberto; possibilidade de excluir termos de hipóteses já descartadas da lista de termos relevantes |
| Chamada da pesquisa | `investigacao-service.js:220`, chamada a `technicalResearchService.pesquisar` | Não recebe dossiê | Buscar `investigacaoDossieService.obterEstadoCompleto` (já disponível, usado logo depois pelo Context Engine) e passar como parâmetro extra antes de chamar `pesquisar` | Pequena mudança de assinatura; dossiê já é buscado nesse mesmo turno para outro fim (Context Engine), então o custo de "buscar de novo" é baixo — poderia até reaproveitar a mesma leitura |
| Deduplicação | `technical-research-service.pesquisar` | Nenhuma consulta a pesquisas anteriores | Consultar `investigacao_execucoes.pesquisa_json` dos turnos anteriores do mesmo atendimento antes de rodar nova busca | Evitaria refazer fetch de URLs já lidas; exigiria decidir política de "cache válido por quanto tempo" |
| Quality Gate → Pesquisa | `quality-gate-service.js` já lê `regressaoGuard` para a resposta | Pesquisa não é avaliada pelo Quality Gate | Poderia-se (não implementado) adicionar uma falha tipo "pesquisa repetiu consulta já feita sem necessidade" | Exigiria que a pesquisa primeiro ficasse ciente de histórico (item anterior) |
| Hipóteses descartadas → termos excluídos | `technical-research-service._termosRelevantes` | Stopword list fixa, sem conhecimento de hipótese | Poderia remover da lista de termos frequentes palavras associadas só a hipóteses já descartadas | Mudaria o texto da consulta gerada; risco de remover termo ainda relevante por coincidência lexical |

**Pendências/fontes externas já usadas anteriormente**: hoje não há registro per-turno de "esta fonte/URL já foi oferecida ao analista" fora do `investigacao_execucoes.pesquisa_json` — qualquer extensão que queira evitar repetir uma fonte precisaria ler esse histórico por turno (não existe uma tabela agregada "fontes já usadas no atendimento").

---

## 35. Risco de duplicação — o que já existe e não deveria ser reconstruído

- **Detecção de domínio técnico** (`detectarDominio`) — já existe, cobre Protheus/SoftExpert/Integração/Genérico com heurística testada e ajustada (há um bug real documentado e corrigido no próprio código, comentário da linha 68-74, sobre peso de campo estruturado).
- **Sanitização de dado sensível antes de sair para a web** (`sanitizarConsultaExterna`) — já existe e é específica para esse propósito; não deveria ser reimplementada em paralelo em qualquer nova camada que toque pesquisa.
- **Guarda SSRF/fetch seguro** (`safe-web-fetch-service.js`) — componente dedicado, já reutilizado por `_abrirResultados`; qualquer nova funcionalidade que precise baixar conteúdo de URL deveria reusar esse serviço, não criar um novo fetch.
- **Scoring de chamados históricos relacionados** (`chamado-repository.listarChamadosRelacionados`) — já existe e está integrado ao fluxo de pesquisa via `pesquisarParaChamado`/`processarTurno`.
- **Estimativa de tokens** (`token-budget-service.estimarTokens`) — já existe e é usada tanto pelo Context Engine quanto pelo dossiê; uma extensão de pesquisa que precisar medir tamanho de texto deveria reusar essa função.
- **Redação de segredos na saída** (`redaction-service.redigirValor`/`redigirTexto`/`redigirUrl`) — já aplicada em `_abrirResultados` e em toda a cadeia de persistência; não deveria ser duplicada.

---

## 36. Conclusão

### A. Como funciona hoje a Pesquisa de Soluções?
Um mecanismo determinístico (sem IA) que, a cada turno, classifica o domínio técnico por contagem de termos fixos, extrai as 8 palavras mais frequentes do texto do turno + histórico completo + anexos textuais, monta até 4 consultas por templates fixos por domínio, busca via Serper/Bing (se configurado), abre de forma segura (SSRF-guard) até 4 das melhores páginas (priorizando fonte oficial), e injeta tudo — resultados brutos e texto das páginas lidas — como um bloco de texto no prompt final, sem resumo por IA e sem corte por orçamento de tokens.

### B. O que ela já recebe das Etapas 3A/3B/3C?
**Nada, diretamente.** A pesquisa técnica em si (`technical-research-service.js`) não importa nem lê nenhum dado do dossiê. O que as Etapas 3A/3B/3C entregam é um bloco de texto **paralelo** no mesmo prompt final (via Context Engine) e um sinal de controle de qualidade sobre a **resposta** (via Quality Gate), não sobre a pesquisa.

### C. O que ela ainda NÃO recebe?
Hipóteses ativas/descartadas, testes pendentes/executados, resultados, diagnóstico atual, pendências, proveniência, e qualquer histórico de pesquisas já realizadas em turnos anteriores do mesmo atendimento.

### D. Ela sabe onde a investigação parou?
Não, a pesquisa em si não — isso só está disponível no dossiê, que é lido pelo Context Engine e pelo Quality Gate, não pela pesquisa.

### E. Ela sabe o que já pesquisou?
Não. Não há deduplicação nem consulta a pesquisas anteriores antes de rodar uma nova.

### F. Ela sabe quais hipóteses/testes falharam?
Não, diretamente. Esse conhecimento existe no dossiê e influencia a resposta final via Quality Gate (regra de não repetir teste/hipótese sem justificativa), mas nunca chega à função de pesquisa.

### G. Uma nova evidência muda a estratégia de pesquisa?
Só indiretamente e de forma não-dirigida: o texto de entrada muda, a contagem de frequência de palavras muda, logo os termos da consulta podem mudar — mas não há reconhecimento deliberado de "isto é uma nova evidência relevante, ajuste a pesquisa assim".

### H. Onde exatamente devemos evoluir o mecanismo existente sem criar outro motor?
O ponto de menor custo e maior alavancagem é `investigacao-service.js:213-226` (o bloco que já busca `chamado`/`relacionados` antes de chamar `technicalResearchService.pesquisar`) — o estado do dossiê já é buscado alguns milissegundos depois, para o Context Engine (`investigacaoDossieService`/`dossieContextService`, chamados dentro de `contextEngine.montarContextoInvestigacao`, linha 238). Levar essa mesma leitura (ou parte dela — hipóteses ativas e descartadas, testes pendentes) para **antes** da chamada à pesquisa, e passá-la como parâmetro adicional de `ctx` para `montarConsultas`, é a extensão mais direta: reaproveita infraestrutura já existente (repositórios, scoring, redaction), não exige novo motor de busca, novo provider de IA, nem nova tabela.

---

**Fim do levantamento técnico. Nenhum arquivo foi alterado, nenhuma migration executada, nenhum commit realizado.**
