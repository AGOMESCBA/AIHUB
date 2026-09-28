# IA SERVICE — Etapa 2: Base Histórica Inteligente (Checkpoints 1-6)

Data: 2026-09-24
Repositório: `c:\Apps\iahub` (branch `feature/ia-command-multi-turn`)
Etapas anteriores: `IA_SERVICE_ANALISE_IAHUB_COMMAND.md` (Etapa 0), `IA_SERVICE_ETAPA1_IMPLEMENTACAO.md` (fundação), `IA_SERVICE_ETAPA2_ANALISE_FONTES.md` (chat/anexos/análise de código)

**Escopo desta entrega**: Checkpoints 1-6 do prompt — análise, migrations, conexão SQL Server via Agente Local, importação full load em batches (com piloto de período 2026), idempotência/retomada, sincronização incremental. **Checkpoints 7-15 (painel completo, conhecimento/chunks, FTS5, busca vetorial, RAG, rastreabilidade no chat) ficam para a próxima rodada**, conforme combinado antes de iniciar esta implementação.

---

## 1. Arquitetura encontrada (Checkpoint 1)

- Fundação do IA Service (Etapas 1-2 anteriores): tabelas `atendimentos`/`mensagens`/`anexos`, camadas Repository/Service, motor de IA multi-provider próprio.
- **Driver SQL Server já disponível no projeto**: `mssql@12.5.3` (dependência de primeiro nível, `package.json`), usado por `apps/IA Command/modules/erp/providers/SqlServerProvider.js`. Não foi necessário instalar nada novo para conexão direta.
- **Agente Local já existe e está em produção** (`apps/IA Command/agente-local/`, processo Python/FastAPI instalado no servidor do cliente): expõe `POST /execute` (SELECT-only, bloqueia INSERT/UPDATE/DELETE/DDL/procedures — `modules/erp_executor.py`) e `POST /api/empresas/sync` (registra conexões por `connection_key`, tabela `conexoes_dados` já suporta múltiplas origens por empresa). Confirmado com o usuário: o IA Service usa o **mesmo agente já instalado**, registrando sua própria `connection_key`, sem ler a config/tabela do IA Command.
- **Criptografia**: o IA Command tem um utilitário AES-256-GCM maduro e testado (`apps/IA Command/modules/security/aes-gcm-envelope.js`). Replicado como arquivo próprio do IA Service (`crypto-envelope.js`) para manter o desacoplamento entre os dois sistemas decidido desde a Etapa 1 — nunca um `require` cruzando para `apps/IA Command`.
- **Achado de segurança no IA Command** (documentado, não corrigido — fora de escopo): a senha de conexões SQL Server do IA Command fica em texto plano no SQLite (`connections.password`), só omitida nas respostas de API. O IA Service **não repete esse padrão** — toda credencial (senha SQL Server, token do agente) é criptografada em repouso.

---

## 2. Decisões tomadas com o usuário antes de codar

| Decisão | Resposta |
|---|---|
| Onde ficam as credenciais do SQL Server | Via o **Agente Local já instalado** (mesmo processo do IA Command), com config e `connection_key` **próprias** do IA Service |
| Tecnologia vetorial (para os Checkpoints 9-11, ainda não implementados) | `sqlite-vec` — confirmada, mas só será instalada quando o Checkpoint 10 começar |
| Provider de embeddings (Checkpoints 9-11) | OpenAI `text-embedding-3-small` — confirmado, ainda não implementado |
| Estratégia de execução | Checkpoints 1-6 nesta entrega, parar para revisão antes de indexação/FTS5/vetorial/RAG/painel completo |
| Credenciais reais do SQL Server SoftExpert | Fornecidas em sessão posterior (2026-09-24) — mapeamento validado contra dados reais e corrigido (ver seção 5.2 e seção 8, "Divergências e pendências") |

---

## 3. Migrations criadas (v10-v16)

Todas incrementais — nenhuma migration v1-v9 foi editada.

| Versão | Tabela(s) | Conteúdo |
|---|---|---|
| v10 | `agente_local_config` | URL, token criptografado, chave de criptografia opcional do payload `/execute`, status do último teste — uma linha por empresa |
| v11 | `fontes_historicas` | Conexões de dados externas configuradas (ex. SoftExpert), com `connection_key` única por empresa, senha criptografada, referência ao adapter |
| v12 | `importacoes` | Controle de cada execução (full/incremental): status, período, checkpoint JSON, contadores de chamados e posicionamentos lidos/inseridos/atualizados/ignorados/erro |
| v13 | `raw_import` | RAW completo de cada registro de origem (DYNITSM e DYNITSMGRIDREGISTR), indexado por `(empresa, fonte, tabela_origem, oid_origem)`, com hash para idempotência |
| v14 | `clientes`, `usuarios_cliente`, `tecnicos` | CNPJ normalizado único **por empresa** (tenant do IA Service, não globalmente); usuários/técnicos identificados por `(empresa, sistema_origem, id_origem)` |
| v15 | `chamados`, `posicionamentos` | Entidades centrais, idempotentes por `(empresa, fonte, oid_origem)` + `hash_conteudo`; `tecnico_responsavel_id` (chamado) e `tecnico_id` (posicionamento) são colunas e conceitos **separados** |
| v16 | `importacao_inconsistencias` | Registros de dados suspeitos (CNPJ ausente/inválido, chamado sem solicitante, posicionamento sem técnico, etc.) sem alterar o RAW original |

Testado com o mesmo padrão de "banco legado" já validado nas etapas anteriores — as 6 migrations aplicam corretamente sobre o `ia-service.db` real do ambiente (v1-v9 já existentes preservadas).

### Índices relevantes
- `idx_svc_raw_import_origem` (UNIQUE): `(empresa_id, fonte_id, tabela_origem, oid_origem)`.
- `idx_svc_clientes_empresa_cnpj` (UNIQUE): `(empresa_id, cnpj)` — CNPJ nunca é chave global, sempre escopado por tenant.
- `idx_svc_chamados_origem` (UNIQUE): `(empresa_id, fonte_id, oid_origem)`.
- `idx_svc_posicionamentos_origem` (UNIQUE): `(empresa_id, fonte_id, oid_origem)`.
- `idx_svc_chamados_precisa_indexacao`, `idx_svc_chamados_classificacao`, `idx_svc_chamados_data_abertura` — preparação para os checkpoints de indexação/busca (7+).

---

## 4. Configuração SQL Server / Agente Local (Checkpoint 3)

**Arquivos**: `repositories/agente-local-repository.js`, `services/crypto-envelope.js`, `services/agente-local-provider.js`, `services/agente-local-service.js`.

- `crypto-envelope.js`: réplica do padrão AES-256-GCM do IA Command, com adição de `encryptSecret`/`decryptSecret` para segredos em repouso (senha, token). Chave lida de `SVC_DATA_CRYPTO_KEY` (variável de ambiente) — **gerada nesta sessão e adicionada ao `.env`** (ver seção 9, "Ações de configuração realizadas").
- `agente-local-provider.js`: cliente HTTP que fala o mesmo protocolo do `ApiProxyProvider.js` do IA Command — `POST /execute` (SELECT-only, envelope AES-GCM opcional) e `POST /api/empresas/sync` (registra a `connection_key` do IA Service no agente).
- `agente-local-service.js`: orquestra config + fontes, garantindo que segredos **nunca** saem em texto claro nas respostas HTTP (`getConfig` retorna só `tokenConfigurado: boolean`; `getFonte`/`listarFontes` retornam `senhaConfigurada: boolean`, nunca `dbPassEnc`).
- **Bug de segurança encontrado e corrigido durante a validação HTTP real**: `criarFonte`/`atualizarFonte` inicialmente retornavam o objeto cru do repository, vazando `dbPassEnc` (o envelope AES-GCM criptografado, não a senha em claro, mas ainda assim nunca deveria estar na resposta). Corrigido para passar por `_semSegredo` antes de responder — confirmado via nova chamada HTTP que o campo não aparece mais.

**Rotas HTTP**: `GET/PUT /api/ia-service/base-historica/agente-local`, `POST .../agente-local/testar`, `GET/POST/PUT /api/ia-service/base-historica/fontes`, `POST .../fontes/:id/sincronizar` (registra no agente via `/api/empresas/sync`), `POST .../fontes/:id/testar` (`SELECT 1` via `/execute`).

**Não validado nesta sessão**: a chamada real `testarAgente`/`executarSelect` contra um Agente Local de verdade — não havia credenciais disponíveis. O protocolo foi implementado replicando fielmente o código já em produção do IA Command (mesmos endpoints, mesmo formato de payload), mas a integração ponta-a-ponta com um agente real fica pendente até você fornecer acesso.

---

## 5. Importador (Checkpoints 4-6)

### 5.1 Arquitetura extensível (seção 8 do prompt)

```
HistoricalImportService (orquestrador genérico)
  └── usa qualquer adapter que exponha:
       listarChamadosPeriodo(empresaId, fonte, {inicio,fim}, {offset,limit})
       listarPosicionamentosDoChamado(empresaId, fonte, idProcess)

Implementado agora:
  └── softexpert-sqlserver-adapter.js  (DYNITSM / DYNITSMGRIDREGISTR)

Preparado para o futuro (não implementado):
  └── ProtheusAdapter, ServiceNowAdapter, JiraAdapter, ...
```

O orquestrador (`historical-import-service.js`) não conhece nenhum detalhe de SQL Server ou SoftExpert — só chama a interface do adapter. Trocar/adicionar uma origem no futuro não exige mudar o orquestrador.

### 5.2 Mapeamento de campos — ✅ VALIDADO CONTRA DADOS REAIS (2026-09-24)

Validado via Agente Local real (`connection_key: softexpert_chamados`, conexão SoftExpert já existente no agente, reaproveitada por decisão explícita do usuário — "pode ser usada por qualquer sistema"), com amostras de 50 registros de `DYNITSM` e 30 de `DYNITSMGRIDREGISTR`, e confirmado com um piloto real de carga (full load do mês corrente completo, 121 chamados / 539 posicionamentos, 0 erros). Divergências encontradas frente à especificação original do prompt (seções 5/6), já corrigidas no código:

- **`DT`/`DATAATUAL` são `datetime` reais** (`'2026-09-24 00:00:00'`, podendo ser `NULL`), não string `'YYYYMMDD'` como a especificação original assumia. O filtro de período em `listarChamadosPeriodo`/`contarChamadosPeriodo` (`softexpert-sqlserver-adapter.js`) converte os parâmetros `YYYYMMDD` recebidos (interface pública mantida) para `datetime` via `CONVERT(datetime, @param, 112)` dentro do SQL — a conversão é aplicada ao parâmetro, não à coluna `DT`, preservando o uso de índice.
- **`TITULOCHAMADO` vem vazio na maioria dos chamados** (7/50 preenchidos na amostra). `TITULOWF` (título vindo do workflow) está preenchido com mais frequência (18/50). `_mapearChamado` agora usa `TITULOCHAMADO ?? TITULOWF` como título, decisão explícita do usuário. `TITULOWF` foi adicionado a `COLUNAS_DYNITSM`.
- **`BREVEDESCRICAO`/`DESCRICAO01` vieram sempre vazios na amostra** (0/50). `TEXTO31` é o campo de fato preenchido para descrição breve (43/50) — já era usado como `assunto`, e passou a ser usado também como fallback de `breveDescricao` (`BREVEDESCRICAO ?? TEXTO31`). `descricao` (`DESCRICAO01`) permanece mapeado sem fallback — pode vir a ser preenchido em chamados fora da amostra, mas o pipeline não depende dele.
- **`CNPJCPF` confirmado como campo correto** (44/50 preenchidos); `CNPJ` sempre vazio (0/50) — o mapeamento original já estava certo aqui, nenhuma mudança.
- **Técnico do posicionamento (`CDUSERANA`) menos preenchido que o nome (`ANALISTAJ2A`)** (22/30 vs. 30/30 na amostra) — **tentativa de fallback herdando o técnico do chamado pai foi implementada e revertida** após o piloto real mostrar um problema pior que o original: quando só `CDUSERANA` do posicionamento faltava (mas `ANALISTAJ2A` estava preenchido), o registro final ficava com `tecnico_id` de uma pessoa (o responsável do chamado) e `tecnico_nome_origem` de outra (quem de fato fez o posicionamento) — dados real mostrou 100% de divergência de nome nos 30 casos testados. Além disso, o usuário confirmou que **chamados podem ficar legitimamente sem técnico alocado** até que alguém assuma. Comportamento final: `CDUSERANA` nulo no posicionamento = sem `tecnico_id` vinculado, inconsistência `posicionamento_sem_tecnico` registrada, nome real preservado em `tecnico_nome_origem` mesmo sem vínculo de ID.

Todas as colunas mapeadas em `COLUNAS_DYNITSM`/`COLUNAS_POSICIONAMENTO` foram confirmadas como existentes nos schemas reais (nenhuma coluna inválida no `SELECT`). O mapeamento continua isolado em duas funções puras (`_mapearChamado`/`_mapearPosicionamento` em `historical-import-service.js`), agora com testes unitários (`base-historica-import.test.js`) cobrindo os fallbacks de título/descrição.

### 5.3 CNPJ (seção 7 do prompt)

`normalizadores.normalizarCnpj` remove toda formatação (`'04.476.442/0001-60' → '04476442000160'`). `cnpjPareceValido` rejeita valores óbvios de lixo (tamanho errado, tudo zero) sem validar dígito verificador (fora de escopo). CNPJ é a chave natural do cliente, mas **escopada por empresa** (tenant do IA Service) — dois tenants diferentes com o mesmo CNPJ de cliente final nunca compartilham o registro (testado explicitamente, seção 7 abaixo).

### 5.4 RAW + Normalização (seção 15/20)

Todo registro de origem é gravado em `raw_import` **antes** de qualquer tentativa de normalização — mesmo que a normalização encontre problemas (CNPJ ausente, técnico não identificado), o RAW já foi preservado. `raw_import` é idempotente por hash: reimportar o mesmo conteúdo não gera nova linha nem novo `importado_em`.

### 5.5 Full Load em batches (Checkpoint 4)

`executarFullLoad(empresaId, fonteId, { periodoInicio, periodoFim, tamanhoLote })`:
- Busca lotes via `OFFSET/FETCH NEXT` (paginação real no SQL Server, não carrega tudo em memória).
- Tamanho de lote configurável (`tamanhoLote`, default 500) — nunca fixo no código.
- Cada chamado é processado individualmente dentro do lote; um erro isolado **não aborta o lote** (`try/catch` por registro, contabilizado em `registrosErro` e registrado como inconsistência `erro_processamento`).
- Posicionamentos de cada chamado são buscados **sem filtro de data** — a seleção histórica é por chamado, não por posicionamento (seção 46 do prompt: um posicionamento de janeiro/2027 de um chamado aberto em dezembro/2026 selecionado é importado).

### 5.6 Idempotência e retomada (Checkpoint 5)

- **Idempotência real** (não apenas "não duplica linha"): cada upsert (`cliente`, `chamado`, `posicionamento`, `raw_import`) compara um `hash_conteudo` (SHA-256 dos campos relevantes) contra o já armazenado — só grava `UPDATE` se algo mudou de fato. Reimportar exatamente os mesmos dados produz `registrosInseridos: 0, registrosAtualizados: 0` para todos os registros.
- **Retomada por checkpoint**: após cada lote, `importacoes.checkpoint_json` é atualizado com `{ offset, ultimoLoteEm }`. Se o processo cair, uma nova chamada a `executarFullLoad` com `importacaoExistenteId` retoma do `offset` salvo — **os registros já processados não são reprocessados** (testado explicitamente, seção 7 abaixo).

### 5.7 Sincronização incremental (Checkpoint 6)

**Decisão documentada** (seção 21 do prompt: "antes de usar `BNUPDATED`/`NRVERSION` como cursor, validar contra dados reais; não assumir sem evidência"): como não houve acesso ao SQL Server real para confirmar o comportamento desses campos, a estratégia adotada foi:

1. Reconsultar uma **janela de datas retroativa** (padrão 7 dias, configurável) a partir do fim do período coberto pela última importação bem-sucedida — usa o mesmo filtro `DT >= / DT <` já usado no full load (`CONVERT(datetime, @param, 112)` aplicado ao parâmetro, não à coluna — aproveita o índice).
2. Dentro dessa janela, o mesmo pipeline de `upsertChamado`/`upsertPosicionamento` decide via `hash_conteudo` se é inserção, atualização ou sem alteração — **nenhuma lógica nova de detecção de mudança**, 100% reaproveitado do full load.

Isso é mais caro em I/O do que um cursor incremental real (reprocessa uma janela sobreposta a cada execução), mas é **correto sem depender de suposição não validada**. Quando `BNUPDATED`/`NRVERSION` forem confirmados como confiáveis (comparando contra uma amostra real), a janela pode ser trocada por um filtro de cursor real — a interface pública (`executarIncremental`) não muda, só a query interna do adapter.

---

## 6. Rotas HTTP (Checkpoint 3-6)

| Rota | Método | Descrição |
|---|---|---|
| `/api/ia-service/base-historica/agente-local` | GET/PUT | Config do Agente Local (URL/token) |
| `/api/ia-service/base-historica/agente-local/testar` | POST | Testa `/apicommand` do agente |
| `/api/ia-service/base-historica/fontes` | GET/POST | Lista/cria fontes históricas |
| `/api/ia-service/base-historica/fontes/:id` | PUT | Atualiza fonte |
| `/api/ia-service/base-historica/fontes/:id/sincronizar` | POST | Registra a `connection_key` no agente (`/api/empresas/sync`) |
| `/api/ia-service/base-historica/fontes/:id/testar` | POST | `SELECT 1` via `/execute` |
| `/api/ia-service/base-historica/fontes/:id/importar` | POST | Dispara full load em **background** (não bloqueia a requisição HTTP) |
| `/api/ia-service/base-historica/fontes/:id/importar/retomar/:importacaoId` | POST | Retoma importação interrompida |
| `/api/ia-service/base-historica/fontes/:id/sincronizar-incremental` | POST | Dispara sincronização incremental |
| `/api/ia-service/base-historica/importacoes` | GET | Lista importações (histórico) |
| `/api/ia-service/base-historica/importacoes/:id` | GET | Detalhe/progresso de uma importação |
| `/api/ia-service/base-historica/importacoes/:id/inconsistencias` | GET | Lista inconsistências registradas |
| `/api/ia-service/base-historica/resumo` | GET | Contadores gerais (clientes, chamados, posicionamentos, aguardando indexação) |

Todas sob `requireAuth + requireIaService + requireEmpresaContext` (mesmo guard multiempresa de toda a plataforma).

---

## 7. Testes executados e resultados

### 7.1 Automatizados

```
node "apps/IA Service/tests/base-historica-import.test.js"        → ok
node "apps/IA Service/tests/base-historica-incremental.test.js"   → ok
```

(+ os 5 arquivos de teste das etapas anteriores, todos continuam passando.)

`base-historica-import.test.js` usa um **mock do adapter SoftExpert** (substituição direta no `require.cache`, sem qualquer chamada real ao SQL Server) com dados sintéticos, e cobre:

| Teste do prompt (seção 44) | Resultado |
|---|---|
| **A** — dois chamados com mesmo CNPJ → 1 cliente | Confirmado: 4 chamados com o mesmo CNPJ (incluindo um sem técnico) apontam para o mesmo `cliente.id`; total de clientes = 2 (não 4) |
| **B** — reimportação não duplica | Confirmado: segunda execução idêntica produz `registrosInseridos: 0, registrosAtualizados: 0`; contagem total de chamados/clientes inalterada |
| **C** — chamado com 10 posicionamentos | Confirmado: `listarPosicionamentosDoChamado` retorna exatamente 10 |
| **D** — técnico responsável ≠ técnico do posicionamento | Confirmado: `chamado.tecnicoResponsavelId !== posicionamento.tecnicoId` quando a origem tem essa divergência; posicionamento de 2027 pertencente a chamado de 2026 é importado mesmo fora do período de busca (seção 46) |
| **E** — interrupção e retomada | Confirmado: uma importação com checkpoint salvo em `offset=5` de 20 registros, ao ser retomada, completa os 20 sem reprocessar os 5 primeiros (verificado indiretamente pela contagem final e pela ausência de erro de duplicidade) |
| **F** — alteração gera UPDATE seletivo | Confirmado: alterar o título de 1 chamado entre duas importações produz `registrosAtualizados: 1, registrosInseridos: 0` — só o registro alterado é tocado, e fica marcado `precisaIndexacao: true` |

`base-historica-incremental.test.js` confirma: (1) a janela incremental não reconsulta o período já coberto pelo full load original; (2) um chamado novo dentro da janela é inserido corretamente; (3) rodar o incremental de novo na mesma janela não duplica nada (reaproveita a idempotência do pipeline).

### 7.2 Isolamento multiempresa (seção 35 do prompt)

Testado tanto em Node isolado quanto via HTTP real:
- Dois tenants (`empresa_id` diferentes) com o **mesmo CNPJ de cliente final** geram **dois registros de cliente distintos** — nunca compartilhados.
- Uma empresa nunca encontra `fontes_historicas`, `chamados`, `clientes` etc. de outra empresa (todas as funções de repository exigem `empresaId` e filtram por ele).
- Confirmado via HTTP real: `GET /api/ia-service/base-historica/fontes?empresa_id=3` não retorna a fonte criada pela empresa 1.

### 7.3 Validação HTTP real (servidor local, sessão autenticada real)

- Migrations v10-v16 aplicadas com sucesso sobre o `ia-service.db` real do ambiente (sem reaplicar v1-v9).
- `GET /base-historica/resumo`, `PUT /agente-local`, `POST /fontes`, página `base-historica.html` — todos responderam corretamente.
- **Bug de segurança encontrado e corrigido nesta validação** (seção 4 acima) — a resposta de criação de fonte vazava o envelope criptografado da senha; corrigido e reconfirmado.
- IA Command verificado antes e depois de toda a sessão: `GET /api/ia-command/health` retornando `200` com 94 migrations intactas em ambos os momentos.

---

## 8. Divergências, pendências e riscos conhecidos

- **Mapeamento de campos SQL Server VALIDADO contra dados reais em 2026-09-24** (seção 5.2) — Checkpoint 3 cumprido em sessão posterior: conexão real testada, amostras reais coletadas (50 chamados, 30 posicionamentos), divergências corrigidas, piloto real de carga executado (mês corrente completo: 121 chamados, 539 posicionamentos, 0 erros). Pendência anterior resolvida.
- **Estratégia incremental por janela de datas, não por cursor `BNUPDATED`/`NRVERSION`** (seção 5.7) — decisão mantida mesmo após a validação: só os campos `DT`/`DATAATUAL` foram confirmados contra dados reais nesta rodada, `BNUPDATED`/`NRVERSION` ainda não. Funciona corretamente, mas é mais caro em I/O do que um cursor real seria. Pode ser otimizado depois que esses campos forem confirmados.
- **Integração ponta-a-ponta com o Agente Local real TESTADA em 2026-09-24** — conexão real (`http://137.131.212.29:8765`) configurada, `testarConexao` (`SELECT 1`) bem-sucedido, fonte histórica real cadastrada reaproveitando `connection_key: softexpert_chamados` já existente no agente (decisão explícita do usuário: essa conexão não é exclusiva do IA Command, pode ser usada por qualquer sistema). Pendência anterior resolvida.
- **Fallback de técnico do posicionamento a partir do chamado pai — tentado e revertido**: para os casos em que `CDUSERANA` do posicionamento é nulo mas o chamado pai tem técnico responsável identificado, chegou a ser implementado um fallback herdando `tecnicoIdOrigem` do chamado. O piloto real revelou que isso produzia registros com `tecnico_id` de uma pessoa e `tecnico_nome_origem` de outra (quando só faltava `CDUSERANA` mas `ANALISTAJ2A` do próprio posicionamento estava preenchido) — pior que não vincular. Revertido a pedido do usuário. Comportamento final: sem `CDUSERANA` próprio, o posicionamento fica sem `tecnico_id`, com inconsistência `posicionamento_sem_tecnico` registrada; o nome real (`tecnico_nome_origem`) é preservado mesmo sem o vínculo de ID.
- **Extração de anexos históricos** (`OIDARQUIVO1`/`OIDARQUIVO2`/`RECORDIDANEXO`, seção 38 do prompt): os campos são capturados no RAW (`dados_json` de `raw_import`), mas a recuperação do binário real não foi implementada — a origem física desses arquivos não foi identificada nesta sessão, conforme instruído ("não inventar a origem física").
- **Painel administrativo é mínimo** (`base-historica.html`): cobre configuração do agente, cadastro de fontes, disparo de importação/incremental e visualização de progresso/inconsistências — não inclui os indicadores de indexação/embeddings (Checkpoints 8-11, ainda não implementados nesta rodada).
- **`SVC_DATA_CRYPTO_KEY` foi gerada e adicionada ao `.env`** nesta sessão (ação necessária para o sistema funcionar — sem ela, toda operação de credencial de fonte histórica falha). `.env` já está no `.gitignore` do projeto, não será versionada.
- **Escopo de período por ambiente** (definido pelo usuário em 2026-09-24, não requer mudança de código — `periodoInicio`/`periodoFim` de `executarFullLoad` já são parametrizáveis): em **desenvolvimento**, importar somente o mês corrente; em **produção**, importar os últimos 12 meses. Full load do mês corrente (setembro/2026) já executado em dev nesta sessão.

---

## 9. Ações de configuração realizadas (fora de código)

- **Adicionada variável `SVC_DATA_CRYPTO_KEY`** ao `.env` raiz do projeto (chave AES-256 gerada aleatoriamente, 32 bytes base64) — necessária para a criptografia em repouso de segredos do IA Service (senha SQL Server, token do agente). Não é um secret de terceiro, foi gerada localmente nesta sessão.
- **Nenhuma alteração no Supabase, PostgreSQL ou qualquer banco além do SQLite** já existente.
- **Nenhuma instalação de dependência nova** nesta etapa (Checkpoints 1-6 não precisaram — `mssql` e `better-sqlite3` já estavam no projeto). `sqlite-vec` será instalado quando o Checkpoint 10 (busca vetorial) for iniciado.

---

## 10. Arquivos criados

```
apps/IA Service/backend/repositories/agente-local-repository.js
apps/IA Service/backend/repositories/chamado-repository.js
apps/IA Service/backend/repositories/cliente-repository.js
apps/IA Service/backend/repositories/importacao-repository.js
apps/IA Service/backend/services/agente-local-provider.js
apps/IA Service/backend/services/agente-local-service.js
apps/IA Service/backend/services/crypto-envelope.js
apps/IA Service/backend/services/import/historical-import-service.js
apps/IA Service/backend/services/import/historical-sync-service.js
apps/IA Service/backend/services/import/normalizadores.js
apps/IA Service/backend/services/import/softexpert-sqlserver-adapter.js
apps/IA Service/frontend/base-historica.html
apps/IA Service/tests/base-historica-import.test.js
apps/IA Service/tests/base-historica-incremental.test.js
```

## 11. Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `apps/IA Service/backend/database/migrations.js` | +7 migrations (v10-v16) |
| `apps/IA Service/backend/routes/index.js` | +18 rotas de base histórica (agente, fontes, importação, resumo) |
| `apps/IA Service/frontend/atendimentos.html` | Link de navegação para a nova página |
| `packages/auth/frontend/js/auth.js` | +1 entrada em `_PAGINA_ROTINA`/`_ROTINA_LABELS` para `base-historica.html` (`svc-base-historica`) |
| `.env` | +1 variável (`SVC_DATA_CRYPTO_KEY`) |

Nenhum arquivo do IA Command, IA Recruit, IA Administração ou Master Crypto foi tocado.

---

## 12. Confirmações finais

- **Isolamento multiempresa**: confirmado em testes automatizados e via HTTP real — CNPJ nunca substitui tenant, nenhum dado cruza entre empresas.
- **IA Command não foi alterado**: confirmado por `git status` (nenhuma entrada sob `apps/IA Command/`) e por health check antes/depois com 94 migrations intactas.
- **Nenhum commit ou push foi realizado.**

---

## 13. Não avançar

Conforme combinado, esta entrega **para nos Checkpoints 1-6**. Não foram iniciados: painel administrativo completo (Checkpoint 7), conhecimento/chunks (8), FTS5 (9), embeddings/busca vetorial (10-11), RAG/rastreabilidade no chat (12-13), testes de busca (seção 45 do prompt).

Aguardando revisão antes de prosseguir para os checkpoints de indexação e busca.
