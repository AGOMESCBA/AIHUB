# Auditoria Independente e Adversarial — Etapa 3A (Dossiê Técnico Persistente Mínimo)

**Data**: 2026-10-02 | **Papel**: Revisor técnico independente e adversarial. Nenhum código de produção foi alterado. Testes adversariais temporários foram criados, executados e removidos ao final (confirmado por `git status` — zero resíduo). Processos `chrome.exe` órfãos gerados durante a investigação foram encerrados.

---

## 1. RESUMO EXECUTIVO

O núcleo do Dossiê Técnico (migration V33, repositório, serviço) é **estruturalmente sólido**: isolamento multiempresa e cross-atendimento comprovados com 39/39 testes adversariais próprios (além dos 15 do Codex), transações atômicas comprovadas com rollback real forçado, optimistic locking funcional, unicidade garantida por constraint real no banco (não só SELECT-antes-do-INSERT). Isso é fundação aceitável para 3B.

Porém, há dois problemas que impedem homologação sem ressalvas:

1. **CRITICAL de escopo**: a entrega inclui ~1200 linhas de código **fora do escopo da Etapa 3A** — Quality Gate com retry automático (segunda chamada de IA), Context Engine completo, Token Budget, PDF Visual via Puppeteer (nova dependência pesada em produção), Safe Web Fetch com SSRF-guard. Isso não é "Dossiê Técnico Persistente Mínimo" — é a fusão de pelo menos 3-4 etapas inteiras não autorizadas nesta rodada, incluindo features que eu havia classificado como P1/P2/P3 em validação técnica anterior.
2. **HIGH de qualidade de teste**: o teste permanente do Codex (`etapa2-1-homologacao.test.js`, que não é da 3A mas foi reexecutado na regressão pedida) **trava silenciosamente e sai com exit code 0 sem executar ~40% de suas próprias asserções** (Quality Gate, persistência em banco, verificação de payload de imagem) — um falso positivo real e reproduzível, documentado em detalhe na seção 19.

Nenhum achado de segurança/isolamento multiempresa foi confirmado contra o **código da 3A propriamente dito**. O problema de maior risco é de **processo e escopo**, não de segurança de dados.

---

## 2. PARECER FINAL

# B — HOMOLOGAR COM RESSALVAS

A fundação do Dossiê Técnico (migration V33 + repository + service) passou em todos os testes adversariais de isolamento, transação e concorrência de melhor esforço que apliquei. Não há achado CRITICAL comprovado contra o código novo da 3A. As ressalvas (escopo excedido sem autorização, falso positivo em teste de regressão, redaction só na escrita) são reais, documentadas e corrigíveis sem redesenho — mas precisam ser endereçadas ou formalmente aceitas pelo usuário antes de abrir 3B, porque 3B herdaria a superfície de código não revisada (Quality Gate, PDF Visual, Safe Fetch) como se já fosse uma fundação homologada.

---

## 3. BASELINE/DIFF

```
HEAD: 5f7e1cdcb59fcf0ee00f3cdd0a0f8f833baf354c
Branch: feature/ia-command-multi-turn
```

**Arquivos modificados** (pré-existentes, alterados pela 3A):
- `apps/IA Service/backend/database/migrations.js` (+116 linhas — migrations v32 e v33)
- `apps/IA Service/backend/routes/index.js` (+30/-poucas — rota `GET /dossie`, imports)
- `apps/IA Service/backend/routes/externo-routes.js` (+4/-poucas)
- `apps/IA Service/backend/services/ai-provider-client.js` (+9)
- `apps/IA Service/backend/services/anexos-softexpert-service.js` (+2/-1)
- `apps/IA Service/backend/services/extracao-conteudo.js` (+72 — PDF visual/fallback)
- `apps/IA Service/backend/services/investigacao-service.js` (+285/-poucas — integração Quality Gate, Context Engine, Dossiê, auditoria de execução)
- `apps/IA Service/backend/services/technical-research-service.js` (+95 — fetch seguro de páginas)
- `apps/IA Service/tests/etapa2-extracao-e-versionamento.test.js` (+13/-poucas)

**Arquivos novos** (não rastreados):
- `apps/IA Service/backend/repositories/investigacao-dossie-repository.js` (393 linhas) — **3A**
- `apps/IA Service/backend/repositories/investigacao-execucao-repository.js` (113 linhas) — pré-3A (migration v32, auditoria de execução)
- `apps/IA Service/backend/services/investigacao-dossie-service.js` (230 linhas) — **3A**
- `apps/IA Service/backend/services/context-engine.js` (350 linhas) — **fora do escopo 3A**
- `apps/IA Service/backend/services/pdf-visual-service.js` (82 linhas) — **fora do escopo 3A**
- `apps/IA Service/backend/services/quality-gate-service.js` (66 linhas) — **fora do escopo 3A**
- `apps/IA Service/backend/services/redaction-service.js` (52 linhas) — componente homologado da Etapa 2, **reescrito** nesta entrega
- `apps/IA Service/backend/services/safe-web-fetch-service.js` (186 linhas) — **fora do escopo 3A**
- `apps/IA Service/backend/services/token-budget-service.js` (45 linhas) — **fora do escopo 3A**
- `apps/IA Service/tests/etapa3a-dossie-persistente.test.js` (220 linhas) — teste da 3A
- `apps/IA Service/tests/etapa2-1-homologacao.test.js`, `etapa2-2-fechamento.test.js`, `etapa2-contexto-pesquisa-quality.test.js` — testes de regressão para as features fora de escopo acima

**Também presentes no working tree, não relacionados a esta etapa nem ao IA Service** (já existiam antes, não tocados): `RELATORIO_AUDITORIA_IA_SERVICE_2026-10.md`, `RELATORIO_VALIDACAO_TECNICA_IA_SERVICE_2026-10.md`, `repomix-output.xml`, `repomix.config.json` — ignorados conforme instrução.

`package.json` ganhou `puppeteer@^25.10.0` e `puppeteer-core@^24.43.1` como dependências — confirmado instalado em `node_modules`.

Nenhuma reversão foi feita. Nenhum arquivo de produção foi editado por esta auditoria.

---

## 4. MIGRATION V33

Lida em `apps/IA Service/backend/database/migrations.js:756-834`. Cria exatamente as 3 tabelas esperadas:

- `investigacao_dossies` — `UNIQUE (empresa_id, atendimento_id)` real (constraint de banco, linha 782), `versao INTEGER NOT NULL DEFAULT 1`, `stale INTEGER NOT NULL DEFAULT 0`, FKs com `ON DELETE CASCADE`/`SET NULL` apropriados.
- `investigacao_itens` — `UNIQUE (empresa_id, atendimento_id, tipo, codigo)` real (linha 807), FK `dossie_id` com `ON DELETE CASCADE`.
- `investigacao_item_relacoes` — índices em `(empresa_id, item_id, criado_em)` e `(empresa_id, atendimento_id, alvo_tipo, alvo_id)`.

**Runner de migrations** (`backend/database/index.js:45-66`): padrão incremental correto — tabela `schema_migrations` rastreia versões aplicadas, `for` pula migrations já aplicadas (`aplicadas.has(migration.version)`), `foreign_keys = ON` está ativo via pragma, portanto os `REFERENCES ... ON DELETE` são de fato impostos pelo SQLite.

**Testado nos 3 cenários pedidos** (via teste do Codex + confirmação direta):
1. Banco novo: todas as 33 migrations aplicam em sequência sem erro.
2. Banco já migrado (reaberto): v33 não é reaplicada (`schema_migrations` já tem a versão).
3. Segunda execução explícita no mesmo processo de teste: `COUNT(*) WHERE version=33` permanece 1.

Nenhuma alteração destrutiva nas migrations 1-32 — a V33 só adiciona tabelas novas, não toca em colunas/tabelas existentes. **CONFIRMADO PELO CÓDIGO E POR EXECUÇÃO REAL.**

---

## 5. DOSSIÊ ÚNICO

`criarDossieSeNecessario` (repository, linhas 111-153) faz `SELECT` antes do `INSERT` (idempotência em nível de aplicação), **mas a proteção real está na constraint `UNIQUE (empresa_id, atendimento_id)`** da migration — confirmei isso não é "só SELECT": testei diretamente que duas chamadas a `obterOuCriarDossie` para o mesmo par retornam o **mesmo `id`** (teste do Codex, linha 102-103), e a constraint de banco garante que mesmo em caso de corrida entre duas chamadas simultâneas (duas conexões tentando o INSERT ao mesmo tempo), a segunda falharia com `SQLITE_CONSTRAINT_UNIQUE`, não geraria um dossiê duplicado. **CONFIRMADO** — constraint real existe e foi inspecionada no SQL da migration.

---

## 6. ITENS F/H/T/R

`proximoCodigoEOrdem` (repository, linhas 230-246) usa `SELECT MAX(CAST(SUBSTR(codigo,2) AS INTEGER))` — é o padrão "MAX+1" que a tarefa pediu para tratar com suspeita. **Mitigação real**: a unicidade final é garantida pela constraint `UNIQUE (empresa_id, atendimento_id, tipo, codigo)` da migration, não pelo cálculo em si — mesmo que dois cálculos de `MAX+1` concorrentes produzissem o mesmo código, o segundo INSERT falharia por violação de constraint (não geraria duplicata silenciosa). Validei com um teste de rajada: 20 criações sequenciais rápidas de FATO no mesmo atendimento produziram 20 códigos únicos, sem colisão. **Concorrência entre processos distintos não foi testada** (ver seção 12) — é uma limitação declarada, não uma falha observada.

Sequência é **independente por tipo** (`WHERE tipo = ?` no cálculo do MAX) — confirmado: F01/F02 e H01/T01/R01 foram gerados corretamente em paralelo no teste do Codex e no meu teste adicional.

---

## 7. PROVENIÊNCIA

Cadeia completa testada e reconstruída com sucesso no teste do Codex: F01→mensagem, F02→anexo, H01→F01, H01→F02, T01→H01, R01→T01. `obterEstadoCompleto` recupera tudo corretamente após fechar e reabrir a conexão do banco (teste do Codex, linhas 204-212). **CONFIRMADO, não é apenas INSERT bem-sucedido** — a recuperação via `getEstadoCompleto` foi exercitada e os relacionamentos (`relacoes.some(r => r.itemId === hipotese.id && r.alvoId === fato2.id)`) foram verificados.

---

## 8. MULTIEMPRESA

**Testado com 9 casos adversariais próprios, todos passaram** (ver arquivo de teste independente, removido ao final):

- `repo.getDossie(empresaB, dossieIdDeA)` → `null` (não vaza por ID direto).
- `repo.getItem(empresaB, itemIdDeA)` → `null`.
- `atualizarItem(empresaB, atendimentoB, itemIdDeA, ...)` → rejeita.
- **Caso mais crítico testado — query apenas por `id` sem `empresa_id` real**: `repo.atualizarDossie(empresaB, dossieIdDeA, {resumoEstado: 'HACK'})` → o `UPDATE` tem `WHERE id = ? AND empresa_id = ?` (repository linha 201), então o `UPDATE` afeta 0 linhas; confirmei que o dossiê de A **não foi alterado** após essa chamada.
- `criarRelacao` de item B apontando para mensagem/anexo/execução de A → rejeitado em todos os 3 casos (`_validarAlvo` sempre filtra por `empresa_id` E `atendimento_id`).
- `listarItens`/`listarRelacoes(empresaB, atendimentoIdDeA)` → retornam vazio, nunca os dados de A.

Toda função do repository que recebe `id` isolado (`getDossie`, `getItem`, `getRelacao`) tem `WHERE id = ? AND empresa_id = ?` — não encontrei nenhuma query filtrando só por `id`. **CONFIRMADO POR TESTE REAL, não apenas leitura de código.**

---

## 9. CROSS-ATENDIMENTO

Testado dentro da **mesma empresa**, dois atendimentos distintos (A e A2):

- Item do atendimento A2 tentando relacionar com mensagem do atendimento A → **rejeitado** (`_validarAlvo` filtra por `atendimento_id`, não só `empresa_id`).
- `atualizarItem` cruzado (item de A2 referenciado através do contexto de A) → **rejeitado** (`item.atendimentoId !== atendimentoId` no service, linha 179/199).
- `criarItem` com `criadoPorMensagemId` de outro atendimento da mesma empresa → **rejeitado** com mensagem explícita "não pertence" (`_validarReferenciasDeAtualizacao`).

**CONFIRMADO** — a separação não é só por empresa, é por atendimento dentro da empresa, em todos os pontos de entrada testados.

---

## 10. REDACTION

Reescrito em `redaction-service.js` (52 linhas). Testei os 11 padrões pedidos pela tarefa, incluindo o caso "Bearer curto" mencionado como alvo da correção — **todos passaram**: `Bearer ABC123`, `Bearer abcd` (4 chars, limite da classe `{4,}`), `Authorization: Bearer ABC123`, `session=XYZ789`, `session: XYZ789`, `session_id=XYZ789`, `password=MINHASENHA`, `senha=SEGREDO`, `token=ABC12345`, `api_key=sk-...`, `apikey: sk-...`. Testei também **over-redaction** com 4 frases técnicas comuns sem segredo real ("o token expirou", "a sessão foi encerrada", etc.) — nenhuma foi indevidamente redigida. `redigirUrl` remove credencial embutida (`user:pass@host`) e query params sensíveis, preservando parâmetros não sensíveis. Cookie header é removido corretamente.

**Achado real (não bloqueante, classificado em MEDIUM — seção 24)**: a redação ocorre **apenas na escrita** (funções `_json`/`_texto` do repository chamam `redigirValor` antes de persistir), **nunca na leitura** (`_rowDossie`/`_rowItem`/`_rowRelacao` não chamam `redigirValor`). Comprovei isso inserindo um registro via SQL cru direto na tabela (simulando dado legado ou qualquer futuro caminho de escrita que não passe pelo repository) contendo `session=SEGREDO-LEGADO-999` — a leitura via `dossieRepo.getItem` **devolveu o segredo em texto puro**. Isso não é um "bug" da 3A em si (a 3A nunca promete proteção retroativa de leitura), mas é relevante registrar porque **qualquer novo caminho de escrita futuro que não passe pelas funções `_json`/`_texto`/`criarItem`/`atualizarDossie` do repository perde a proteção silenciosamente** — não há um cinto de segurança na camada de leitura.

**Persistência de segredo testada em 3 campos diferentes** (`problemaAtual`, `diagnosticoAtual`, `pendencias` JSON, `dados_json` de item) — em todos os casos onde a escrita passou pelo repository, o segredo foi redigido e não reapareceu na leitura subsequente. **CONFIRMADO para o caminho normal de escrita.**

---

## 11. OPTIMISTIC LOCKING

Testado adversarialmente conforme pedido: dossiê criado com `versao=1`, atualizado com sucesso para `versao=2` usando `versaoEsperada=1`; segunda tentativa de atualização usando a **mesma versão antiga (1)** foi testada e **rejeitada corretamente** com `err.code === 'CONFLITO_VERSAO_DOSSIE'` (teste do Codex, linhas 121-125, reconfirmado). O mecanismo (`repository.atualizarDossie`, linha 198-205): `UPDATE ... WHERE id = ? AND empresa_id = ?` + `AND versao = ?` quando `versaoEsperada` é informado; se `info.changes === 0`, retorna `{conflito: true}`, que o service transforma em exceção com código padronizado.

**Não-atualização parcial em conflito**: confirmado pela própria natureza do SQL — é um único `UPDATE` atômico sobre uma linha; se o `WHERE` não casar (versão errada), **zero colunas são alteradas**, não há como um conflito de versão causar atualização parcial de campos dentro do mesmo dossiê. Itens/relações de outras operações não são afetados por esse conflito específico (são tabelas/linhas diferentes).

---

## 12. CONCORRÊNCIA

**NÃO VALIDADO EM RUNTIME PARA MÚLTIPLOS PROCESSOS/CONEXÕES REAIS** — declarado explicitamente, conforme pedido. `better-sqlite3` é síncrono e de processo único; todas as operações desta auditoria rodaram dentro do mesmo processo Node, mesma conexão. O que testei e é real:
- Rajada de 20 criações sequenciais rápidas (mesmo processo, mesma conexão, sem `await` de I/O externo entre elas) não gerou colisão de código — mas isso **não** prova ausência de race condition entre dois processos Node distintos acessando o mesmo arquivo `.db` simultaneamente.
- `db.transaction()` (usado em `executarTransacao`) serializa escritores **dentro do mesmo processo**; SQLite em modo WAL (confirmado ativo, `journal_mode = WAL` em `database/index.js:24`) permite um escritor por vez no nível do arquivo, então uma segunda conexão de outro processo tentando escrever durante uma transação da primeira ficaria bloqueada (ou falharia por `SQLITE_BUSY` após o timeout de `busy_timeout = 5000`, também configurado) — isso é uma propriedade do SQLite/WAL, não algo que o código da 3A implementa por conta própria, e não foi exercitado com dois processos reais nesta auditoria.
- **Como verificar de fato**: rodar dois processos Node independentes (não só duas chamadas de função no mesmo processo) contra o mesmo arquivo `ia-service.db`, cada um tentando criar um item FATO no mesmo atendimento no mesmo instante, e confirmar que ambos recebem código único sem exceção inesperada (exceto possível `SQLITE_BUSY` tratável). Resultado a coletar: nenhuma duplicata de código, nenhuma corrupção, erro de busy tratado com retry ou mensagem clara.

---

## 13. TRANSAÇÕES/ROLLBACK

**Testado com sucesso, caso exato pedido**: criar item com relação válida + relação inválida na mesma chamada de `dossieService.criarItem`. A segunda relação (`alvoId: 'anexo-inexistente-xyz'`) lança exceção dentro de `_validarAlvo`, dentro da `db.transaction()` de `executarTransacao`. Confirmei com medição antes/depois:
- Contagem de itens do atendimento: **inalterada**.
- Contagem de relações do atendimento: **inalterada** (a primeira relação válida também não foi persistida).
- Versão do dossiê: **inalterada** (o "bump" de versão que `criarItem` faz ao final também foi revertido).

**CONFIRMADO: nada da operação composta fica parcialmente persistido.** Isso usa a transação nativa do `better-sqlite3` (`db.transaction(fn)()`), que faz rollback automático em qualquer exceção lançada dentro de `fn`.

**Rollback × códigos**: após o rollback acima, criei um novo item do mesmo tipo (FATO) no mesmo atendimento — recebeu um código novo, sem duplicidade com os códigos já existentes, sem reaproveitar o número que teria sido usado pela tentativa revertida (o número da tentativa revertida nunca foi commitado, então não havia nada para "reaproveitar" — comportamento consistente e seguro, ainda que não seja gap-free, o que é aceitável).

---

## 14. STALE

Testado: `stale=false` (estado sincronizado) → marcar pendência (`marcarStale(true)`) → `stale=true` → `marcarStale(false)` → volta a `false`. Além disso, testei especificamente se **mudar o `status` do dossiê reseta `stale` implicitamente** (o que indicaria uso como "status genérico" disfarçado) — **não reseta**: marquei `stale=true`, depois atualizei `status` para `AGUARDANDO_VALIDACAO` via `atualizarDossie`, e `stale` permaneceu `true`. Os dois campos são de fato independentes um do outro no código (`atualizarDossie` só toca o que é passado explicitamente no objeto `dados`). **CONFIRMADO: `stale` não está sendo usado como status genérico da investigação.**

---

## 15. PERSISTÊNCIA

Confirmado real, não em memória: fechei a conexão do banco (`database.fecharDB()`) e reabri (`database.inicializarDB(mesmoPath)`) — todos os dados (dossiê, 2 fatos, 1 hipótese, 1 teste, 1 resultado, relações, versão, stale) foram recuperados corretamente do arquivo `.db` em disco (teste do Codex, linhas 204-212, reexecutado e confirmado).

---

## 16. API

`GET /api/ia-service/atendimentos/:id/dossie` (`routes/index.js:149-158`). Simulei a lógica exata da rota (sem montar o servidor Express completo, que exigiria autenticação de sessão fora do escopo local de teste) chamando a mesma sequência `atendimentoService.getAtendimento` → `investigacaoDossieService.obterEstadoCompleto` que o handler usa:

- Empresa correta lendo seu próprio atendimento → `200` com o estado completo.
- **Empresa B tentando ler atendimento de A** → `404 { error: 'Atendimento não encontrado.' }`.
- **Atendimento totalmente inexistente** → `404 { error: 'Atendimento não encontrado.' }` — **mensagem idêntica ao caso anterior**, confirmando que a rota não vaza a existência de um atendimento de outra empresa por diferença de resposta.
- `_handleErro` (`routes/index.js:38-46`) nunca repassa `err.stack`, apenas `err.message` — confirmado por leitura e pela simulação (nenhum stack trace no corpo da resposta simulada).

Autenticação/resolução de empresa (`empresa-context.js`, pré-existente, não é código novo da 3A) valida `empresa_id` explícito contra a sessão autenticada (`hasUserSystem`/`hasCompanySystem`) antes de aceitar — a rota do dossiê herda esse middleware globalmente (`app.use('/api/ia-service', requireAuth, requireIaService, requireEmpresaContext)`), então não há bypass possível só pela rota em si.

**NÃO VALIDADO EM RUNTIME**: a cadeia HTTP completa (sessão real, cookies, middleware Express rodando de fato) não foi exercitada ponta-a-ponta nesta auditoria — a simulação replicou a lógica de negócio exata do handler, mas não subiu um servidor real. Risco residual: baixo, porque o middleware de autenticação é compartilhado com todas as outras rotas já em produção, não é código novo desta etapa.

---

## 17. INTEGRAÇÃO COM FLUXO ATUAL

Esta é a seção onde a maior divergência do esperado aparece. O pedido da tarefa era confirmar que **a 3A apenas garante existência do dossiê**, sem alterar prompt/seleção de contexto/Quality Gate/retry/fallback. **Isso não é verdade para o estado real do `investigacao-service.js`**:

- `_garantirDossieSeguro` (linhas 26-34) é chamado no início de `processarTurno` — isso **é** escopo da 3A (criar o dossiê, com try/catch que não propaga falha — ver seção 23), correto.
- Porém `processarTurno` **também** foi reescrito para usar `contextEngine.montarContextoInvestigacao` (substituindo o antigo `promptBuilder.buildUserPrompt`), `qualityGateService.avaliarResposta` com **retry automático que faz uma segunda chamada completa de IA** (linhas 359-408), `execucaoRepo.salvarExecucao` em 4 pontos distintos do fluxo, e rasterização de PDF via Puppeteer condicionalmente. **Nenhuma dessas mudanças é "apenas garantir existência do dossiê"** — são alterações estruturais profundas no pipeline de prompt, seleção de contexto e no custo/latência de cada turno (dobra a chamada de IA quando o Quality Gate reprova).

Isso não é um problema de corretude comprovado (os testes de regressão da Etapa 2 passam — seção 21), mas é uma violação direta da premissa que a tarefa pediu para verificar. **Classificado como CRITICAL na seção 22 (limite da 3A), não porque o código esteja comprovadamente quebrado, mas porque a superfície de mudança é ordens de grandeza maior do que o que foi declarado e do que esta auditoria foi autorizada a considerar "fundação mínima".**

Também notei **código morto/duplicado**: a função `_carregarPayloadVisual` (linhas 72-115) reimplementa quase identicamente a lógica de carregamento de imagem/PDF que já existe inline em `processarTurno` (linhas 260-299) — a duplicada só é usada no caminho de retry do Quality Gate (linha 376). Isso é um sinal de qualidade/manutenibilidade, não um bug funcional comprovado, mas é exatamente o tipo de débito técnico que surge quando múltiplas features são implementadas na pressa dentro da mesma entrega.

---

## 18. LIMITE DA 3A

**Confirmado como violado.** Itens que a tarefa pediu para confirmar como **ausentes** e que na verdade **estão presentes** no working tree:

| Item que deveria estar ausente | Status real |
|---|---|
| Novas regras do Quality Gate | **PRESENTE** — `quality-gate-service.js`, integrado com retry automático em `investigacao-service.js` |
| Dossiê no context-engine | **PARCIALMENTE PRESENTE** — `context-engine.js` não lê/escreve o dossiê diretamente (confirmei por leitura: não há `require` do `investigacao-dossie-service` dentro de `context-engine.js`), mas é uma peça nova e grande, não documentada como fora do escopo desta etapa |
| AST universal / multi-arquivo | **NÃO encontrado** — confirmado ausente, correto |
| FTS/BM25/embeddings/vector DB/RAG | **NÃO encontrado** — confirmado ausente, correto |
| Multiagente/Model Router | **NÃO encontrado** — confirmado ausente, correto |
| Frontend | **NÃO encontrado** nesta entrega (nenhum arquivo em `frontend/` foi tocado) — correto |
| Extrator automático completo de fatos/hipóteses | **NÃO encontrado** — `investigacao-dossie-service.js` não é chamado por nenhum lugar que extraia fatos automaticamente do texto da IA; a criação de itens exige chamada explícita de `criarItem` com dados já estruturados, que **não é feita em nenhum lugar do `investigacao-service.js` revisado** — ou seja, a 3A criou a capacidade de popular o dossiê, mas nada no fluxo atual efetivamente popula fatos/hipóteses/testes automaticamente. Isso é consistente com "mínimo" para o dossiê em si. |
| **Itens adicionais não listados no pedido, mas claramente fora de qualquer leitura razoável de "Dossiê Técnico Persistente Mínimo"**: PDF Visual via Puppeteer, Safe Web Fetch com SSRF-guard completo, Token Budget, Context Engine de seleção de evidências por score | **TODOS PRESENTES E INTEGRADOS AO FLUXO PRINCIPAL** |

---

## 19. TESTES DO CODEX

`etapa3a-dossie-persistente.test.js` (220 linhas): executei e também o li linha a linha. Cobertura real, não superficial, dos pontos centrais: migration, unicidade de dossiê, optimistic locking (sequencial), F/H/T/R com códigos corretos, proveniência reconstruível, persistência real após reconexão, "não inventar estado" (mensagem "vou testar amanhã" não muda status de teste/hipótese). **Sem falso positivo identificado neste arquivo especificamente.**

**Lacunas de cobertura no teste do Codex** (não falso positivo, mas superficialidade real): não testa `getDossie`/`getItem` **por ID direto** de outra empresa (só testa via `obterEstadoCompleto`, que passa por `validarAtendimento` antes); não testa cross-atendimento dentro da mesma empresa; não testa transação/rollback composto (item + relação válida + relação inválida); não testa concorrência nem rajada de criação; não testa os outros padrões de redaction pedidos pela tarefa (Bearer curto isoladamente, cookie, URL com credencial, over-redaction). Todas essas lacunas foram cobertas pelo meu teste independente (seção 20).

**Falso positivo real encontrado, mas em outro arquivo de teste** (`etapa2-1-homologacao.test.js`, não é da 3A, mas faz parte da suíte de regressão executada nesta auditoria) — detalhado na seção 21.

---

## 20. TESTES INDEPENDENTES

Criei e executei um arquivo de teste adversarial temporário (removido ao final, confirmado por `git status`) cobrindo as 5 prioridades pedidas:

1. **Cross-tenant** (9 casos): `getDossie`/`getItem` por ID direto de empresa errada, `atualizarDossie` via UPDATE que não deveria casar linha nenhuma, `criarRelacao` de item B apontando para mensagem/anexo/execução de A, `listarItens`/`listarRelacoes` filtrados por empresa errada.
2. **Cross-atendimento** (3 casos): relação entre item e mensagem de atendimentos diferentes na mesma empresa, `atualizarItem` cruzado, `criadoPorMensagemId` de outro atendimento.
3. **Transação/rollback** (2 casos): operação composta com falha forçada na 2ª relação, criação pós-rollback sem duplicidade.
4. **Concorrência** (1 caso real + 1 declaração): rajada de 20 criações sequenciais sem colisão; concorrência real entre processos declarada como não validável neste ambiente.
5. **Redação** (14 casos): os 11 padrões pedidos pela tarefa + over-redaction + persistência em `dados_json`/pendências + registro legado inserido via SQL cru.

**Resultado: 39/39 passos passaram** (1 falha inicial era bug no meu próprio script de teste — contagem de parâmetros de um INSERT cru —, corrigida e reexecutada com sucesso).

Também testei a rota `GET /dossie` simulando sua lógica exata (seção 16): atendimento de outra empresa e atendimento inexistente devolvem a mesma resposta 404, sem vazar diferença.

---

## 21. REGRESSÃO ETAPA 2

Todos os 8 testes pedidos foram executados; todos reportaram sucesso (`exit 0`, mensagem "ok"):

```
etapa2-2-fechamento.test.js: ok
etapa2-1-homologacao.test.js: [NÃO IMPRIMIU "ok" — ver achado abaixo]
etapa2-contexto-pesquisa-quality.test.js: ok
etapa2-extracao-e-versionamento.test.js: ok (todos os asserts passaram)
ajustes-migracao-incremental.test.js: ok (todos os asserts passaram)
fundacao-repositories.test.js: ok (todos os asserts passaram)
fundacao-services.test.js: ok (todos os asserts passaram)
base-historica-import.test.js: ok (todos os asserts passaram)
```

**Achado HIGH confirmado por investigação ativa, não é apenas leitura de código**: `etapa2-1-homologacao.test.js` reporta **exit code 0** no shell, mas **nunca imprime sua própria linha de confirmação final** (`console.log('etapa2-1-homologacao.test.js: ok')`, linha 247) e **nunca executa as asserções das linhas 207-247** (Quality Gate com retry, e principalmente a verificação de persistência em `investigacao_execucoes` com redaction, que é diretamente relevante para o que esta auditoria deveria confirmar).

**Causa raiz identificada por reprodução isolada**: a função `capturarPayloadOpenAI` (linha 80-103) mocka `https.request` com um `EventEmitter` fake cujo `req.end()` deveria invocar `cb(res)` de forma assíncrona. Ao instrumentar o arquivo com marcadores de progresso, confirmei que a execução para **exatamente dentro dessa chamada mockada** (`aiProviderClient.chamarProvedor('openai', ...)`, linha 191-198) — a `Promise` retornada por `chamarProvedor` nunca resolve nem rejeita, e como o mock não mantém nenhum handle real do event loop (libuv) vivo, o **processo Node encerra silenciosamente com exit code 0 quando o event loop fica vazio**, abandonando a Promise pendente para sempre, sem lançar `unhandledRejection` (porque a Promise nunca chega a ser rejeitada) e sem erro visível.

Reproduzi esse comportamento isoladamente com um script mínimo (`Promise` que nunca resolve/rejeita, sem handle real) e confirmei: Node termina com exit 0 e nunca executa o `.then()`/`.catch()` pendente. Também reproduzi o mock exato do teste chamando `req.end()` sem nunca invocar `cb()` — mesmo resultado.

**Por que isso não foi pego antes**: o script usa `main().catch(err => { console.error(err); process.exit(1); })` — isso só captura **rejeições**, nunca o caso de uma Promise que fica pendurada para sempre sem nunca resolver ou rejeitar. Um harness de teste que depende de `process.exit(1)` em caso de erro, mas nunca verifica se todas as suas próprias asserções foram de fato alcançadas (ex. via contagem de asserções executadas, ou timeout explícito que force falha), pode reportar sucesso mesmo tendo executado **menos da metade do próprio arquivo**.

**Impacto real**: isso significa que a suíte de regressão, incluindo validações específicas do próprio Codex sobre redaction em `investigacao_execucoes` (dados de auditoria/execução, que são exatamente o tipo de dado sensível que a tarefa pediu para auditar com cuidado), **nunca foi de fato executada nas rodadas de CI/regressão que dependem desse comando**, mesmo reportando verde.

---

## 22. CRITICAL

**C1 — Escopo da entrega excede drasticamente o autorizado para a Etapa 3A.** A entrega inclui Quality Gate com retry automático (dobra custo/latência de chamadas de IA quando reprovado), Context Engine completo (substitui o prompt-builder antigo), Token Budget, PDF Visual via Puppeteer (nova dependência pesada, binário de Chromium, em produção), Safe Web Fetch com SSRF-guard. Nenhum desses itens é "Dossiê Técnico Persistente Mínimo". Isso não é um risco de segurança de dados comprovado — é um risco de processo: **3B herdaria toda essa superfície nova como se já fosse fundação revisada e aprovada**, quando na verdade só a parte do dossiê (migration V33 + repository + service) recebeu o nível de escrutínio que esta auditoria foi convocada para fazer. Arquivos: `context-engine.js`, `pdf-visual-service.js`, `quality-gate-service.js`, `safe-web-fetch-service.js`, `token-budget-service.js`, e a reescrita de `investigacao-service.js` (seção 17).

---

## 23. HIGH

**H1 — Falso positivo real e reproduzível em teste de regressão da suíte de homologação** (`etapa2-1-homologacao.test.js`). Detalhado na seção 21. Impede confiar cegamente em "todos os testes passam" como critério de aceite para qualquer entrega futura que dependa desse arquivo, incluindo potencialmente futuras validações de 3B.

**H2 — Redação só protege o caminho de escrita via repository, não a leitura.** Qualquer inserção futura que não passe por `criarItem`/`atualizarDossie`/`salvarMetadadosAnexo` do caminho correto perde a proteção silenciosamente, sem nenhum alerta. Comprovado por inserção direta via SQL (seção 10). Não é uma falha da 3A em si (que sempre escreve pelo caminho correto), mas é um risco estrutural para qualquer código futuro (incluindo o Context Engine/Quality Gate novos, que também escrevem em `investigacao_execucoes` via `execucaoRepo.salvarExecucao` — confirmei que esse repository **também** só redige na escrita, mesmo padrão).

---

## 24. MEDIUM

**M1 — Código duplicado/morto em `investigacao-service.js`**: `_carregarPayloadVisual` (linhas 72-115) duplica quase integralmente a lógica de carregamento de imagem/PDF inline (linhas 260-299), usada só no caminho de retry do Quality Gate. Risco de divergência futura entre os dois caminhos (ex. uma correção de bug aplicada em um e esquecida no outro).

**M2 — Inconsistência de ordem de fallback entre `proximoCodigoEOrdem`** não é mais relevante (já fechado na validação anterior) — mantenho fora desta lista por já estar resolvido/não aplicável à 3A.

**M3 — `_erroConflito` (service, linha 29-34) usa `err.status = 409` e `_erroParaStatus` (routes, linha 39) também checa `err.status === 409`** — duplicação de convenção (código + status) que funciona mas é frágil a divergência futura se alguém alterar um sem o outro.

---

## 25. LOW

**L1 — `ALVOS` (service, linha 27) inclui `'fonte_externa'` como tipo de alvo válido, mas `_validarAlvo` trata esse caso com `row = { ok: 1 }` incondicional** (linha 82) — ou seja, **qualquer `alvoId` é aceito sem validação real para esse tipo**, diferente de todos os outros tipos que fazem um SELECT real. Não é um vazamento multiempresa (não há dado real de outra empresa para vazar nesse caso, já que não há tabela de "fonte externa" com isolamento próprio), mas é uma inconsistência de rigor dentro da própria função que vale documentar — se no futuro "fonte_externa" passar a referenciar uma tabela real, essa validação vai precisar ser lembrada e implementada.

**L2 — Warning "Indexing all PDF objects" da lib `pdf-parse` aparece em stdout em múltiplos testes**, não é um erro, mas polui o output de forma que dificultou esta própria auditoria a confirmar rapidamente se um teste tinha ou não terminado.

---

## 26. CLAIMS DO CODEX CONFIRMADOS

- Migration V33 cria as 3 tabelas corretas, incrementalmente, idempotente. **CONFIRMADO POR EXECUÇÃO.**
- Dossiê único por empresa/atendimento, com constraint real no banco. **CONFIRMADO.**
- Códigos F01/F02/H01/T01/R01 gerados corretamente, sequência independente por tipo. **CONFIRMADO.**
- Proveniência reconstruível (F→mensagem/anexo, H→F, T→H, R→T). **CONFIRMADO.**
- Isolamento multiempresa nos testes do próprio Codex. **CONFIRMADO E AMPLIADO** (meus testes cobriram casos adicionais, todos passaram).
- Redaction removendo Bearer, session, password, senha nos casos testados pelo Codex. **CONFIRMADO E AMPLIADO.**
- Optimistic locking com `CONFLITO_VERSAO_DOSSIE`. **CONFIRMADO.**
- Persistência real sobrevivendo a reconexão. **CONFIRMADO.**
- "Não inventa estado" (mensagem "vou testar amanhã" não muda status). **CONFIRMADO.**

## 27. CLAIMS NÃO CONFIRMADOS

- Nenhum claim explícito do Codex foi encontrado afirmando que a entrega se restringiu ao escopo da 3A — mas a ausência dessa afirmação não isenta o achado da seção 22; o relatório de entrega (não lido nesta auditoria, pois a instrução foi "não aceitar apenas o relatório do Codex" e ir direto ao código) precisaria ser comparado à parte para saber se o excesso de escopo foi comunicado ao usuário ou não.
- Claim implícito de "todos os testes de regressão passam" — **parcialmente não confirmado**: o exit code é 0, mas um dos 8 arquivos não executa todas as suas próprias asserções (seção 21).

---

## 28. CORREÇÕES NECESSÁRIAS (descritas, não aplicadas)

1. **Decisão do usuário sobre o escopo excedido** (C1): aceitar formalmente as features extras como parte integrante desta entrega combinada (e então essas features precisariam de sua própria auditoria dedicada, equivalente a esta, antes de confiar nelas em produção), ou separá-las em um branch/revisão própria antes de prosseguir para 3B.
2. **Corrigir o mock de `capturarPayloadOpenAI`** em `etapa2-1-homologacao.test.js` para efetivamente invocar o callback de resposta (o padrão correto já existe no mesmo arquivo, em `mockRequestFactory`, linhas 43-55 — reaproveitar essa função em vez do mock ad-hoc resolveria). Depois, adicionar uma contagem de asserções executadas ou um `console.log` de progresso mínimo ao final de cada bloco lógico do teste, para que qualquer trava futura seja detectável por ausência de log, não apenas por exit code.
3. **Mover a verificação de redaction para também cobrir a leitura** (`_rowDossie`/`_rowItem`/`_rowRelacao` em `investigacao-dossie-repository.js` e a função equivalente em `investigacao-execucao-repository.js`), como defesa em profundidade contra qualquer caminho de escrita futuro que esqueça de redigir antes de persistir.
4. Remover a duplicação entre `_carregarPayloadVisual` e o bloco inline equivalente em `processarTurno`, consolidando em uma única função usada nos dois pontos.

---

## 29. RISCOS PARA 3B

- Se 3B assumir que Quality Gate, Context Engine, PDF Visual e Safe Web Fetch já são fundação estável e testada no mesmo nível que o Dossiê, há risco de construir sobre uma base que não recebeu este nível de escrutínio adversarial — recomendo que qualquer um desses 4 componentes passe por uma rodada de auditoria equivalente a esta antes de 3B depender estruturalmente deles.
- Se o padrão de mock quebrado em `etapa2-1-homologacao.test.js` não for corrigido, qualquer alteração futura em `ai-provider-client.js` ou no fluxo de Quality Gate pode introduzir regressões que a suíte de regressão **não vai detectar**, mesmo reportando verde — isso é um risco direto para a confiabilidade do próprio processo de validação que as etapas seguintes vão usar.
- A ausência de redação na leitura (H2) é um risco crescente à medida que mais código passa a escrever nessas tabelas (3B provavelmente adicionará mais pontos de escrita) — cada novo ponto de escrita precisa lembrar manualmente de usar o caminho redigido.

---

## 30. CONCLUSÃO

A fundação específica do Dossiê Técnico (migration V33, `investigacao-dossie-repository.js`, `investigacao-dossie-service.js`) é tecnicamente sólida e passou em testes adversariais reais de isolamento multiempresa, cross-atendimento, transação/rollback, optimistic locking e persistência — não encontrei nenhum achado CRITICAL comprovado contra esse núcleo específico. A homologação com ressalvas (parecer B) reflete que os problemas reais encontrados são de **escopo da entrega** (muito além do que a Etapa 3A deveria cobrir) e de **confiabilidade da suíte de testes** (um falso positivo real e reproduzível), não de segurança ou corrupção de dados no dossiê em si. Antes de abrir 3B, recomendo que o usuário decida explicitamente sobre o escopo excedido e que o mock quebrado seja corrigido — ambos são corrigíveis sem redesenho, mas não devem ser ignorados silenciosamente.

---

**Fim da auditoria independente. Nenhum código de produção foi alterado. Nenhum arquivo temporário de teste permanece no repositório (confirmado por `git status`). Nenhuma Etapa 3B foi iniciada.**
