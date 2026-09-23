# IA SERVICE — Etapa 1: Fundação Técnica

Data: 2026-09-23 (revisão 2 — ajustes finais aplicados após revisão da fundação)
Repositório: `c:\Apps\iahub` (branch `feature/ia-command-multi-turn`)
Etapa anterior: `IA_SERVICE_ANALISE_IAHUB_COMMAND.md` (Etapa 0 — análise, revisada com a decisão SQLite/colar+anexar+Enter)

Escopo desta etapa: fundação técnica do IA Service — registro no IA HUB, persistência SQLite própria, camadas Repository/Service, entidades Atendimento/Mensagem/Anexo/Consultor, contrato canônico de entrada, segregação multiempresa, testes básicos. **Sem motor de IA, sem chat completo, sem integração SoftExpert, sem Knowledge Base** — conforme delimitado no prompt da Etapa 1.

> **Nota de revisão**: após a fundação ser aprovada, o time pediu 3 ajustes antes de autorizar a Etapa 2 — atomicidade real na criação de atendimento+primeira mensagem, remoção do UNIQUE de idempotência (a entrada manual não deve ser bloqueada por semântica de idempotência que só fará sentido com a integração), e separação de `origem` (fonte de negócio) e `canal_entrada` (meio técnico de chegada). A seção 7 detalha esses ajustes; o restante do documento original (seções 1-9) permanece válido e não foi reescrito, exceto onde os ajustes tocaram diretamente o conteúdo (marcado inline).

---

## 1. Arquivos criados

### Backend (`apps/IA Service/backend/`)

| Arquivo | Responsabilidade |
|---|---|
| `database/index.js` | Conexão `better-sqlite3`, WAL, `foreign_keys=ON`, `busy_timeout=5000`, execução de migrations. Aceita `dbPathOverride` opcional (só usado pelos testes, para isolar o banco). |
| `database/migrations.js` | 6 migrations versionadas: `consultores` (v1), `atendimentos` (v2), `mensagens` (v3), `anexos` (v4), remoção do UNIQUE de idempotência (v5), `canal_entrada` (v6) — v5/v6 adicionadas nos ajustes finais, seção 7. |
| `repositories/atendimento-repository.js` | Único ponto de acesso SQL à tabela `atendimentos`. Toda função exige `empresaId` explícito. |
| `repositories/mensagem-repository.js` | Único ponto de acesso SQL à tabela `mensagens`. Valida que o atendimento pertence à empresa antes de gravar. |
| `repositories/anexo-repository.js` | Único ponto de acesso SQL à tabela `anexos` (metadados apenas). |
| `repositories/consultor-repository.js` | Único ponto de acesso SQL à tabela `consultores`. |
| `services/empresa-context.js` | Guard multiempresa — réplica fiel do padrão `apps/IA Command/modules/empresa-context.js`, adaptado ao `system_code = 'ia-service'`. |
| `services/atendimento-service.js` | Normalização do contrato canônico, criação de atendimento + primeira mensagem, transições de status. Nenhum SQL aqui. |
| `services/consultor-service.js` | Validação de vínculo consultor↔usuário IA HUB (rejeita usuário inexistente/inativo). Nenhum SQL aqui. |
| `services/armazenamento-anexos.js` | Fundação de armazenamento: validação de MIME/extensão/tamanho, geração de nome interno seguro (UUID), gravação em disco fora do SQLite. |
| `routes/index.js` | Registro das rotas `/api/ia-service/*`, aplicando `requireAuth + requireIaService + requireEmpresaContext`. |

### Frontend (`apps/IA Service/frontend/`)

| Arquivo | Responsabilidade |
|---|---|
| `atendimentos.html` | Tela mínima: composer de texto livre ("colar + Enter", upload desabilitado nesta etapa) + lista de atendimentos recentes. Consome `/api/ia-service/atendimentos`. |
| `consultores.html` | Tela mínima de cadastro: vincula `usuario_id_iahub` (+ `id_softexpert` opcional) à empresa corrente. Consome `/api/ia-service/consultores`. |

Ambas seguem o padrão vanilla HTML/CSS/JS do restante do IA HUB (`/css/iahub.css`, `/js/auth.js`), sem framework novo.

### Testes (`apps/IA Service/tests/`)

| Arquivo | Cobertura |
|---|---|
| `fundacao-repositories.test.js` | Camada Repository isolada (SQLite temporário em `os.tmpdir()`). Criação de atendimento, código amigável único, isolamento multiempresa em `getAtendimento`/`listarAtendimentos`, mensagem não cruza empresa, metadados de anexo, cadastro de consultor (incluindo duplicidade e multiempresa do mesmo usuário). Atualizado nos ajustes finais (seção 7.5) para refletir a remoção do UNIQUE de idempotência, `canal_entrada`, transação atômica e rollback real. |
| `fundacao-services.test.js` | Camada Service. Contrato canônico cria atendimento + primeira mensagem automaticamente; validações de entrada (origem inválida, conteúdo vazio, status inválido); usuário IA HUB inexistente rejeitado explicitamente (lê o cadastro real via `usuarios/database.js`, só leitura). Atualizado nos ajustes finais (seção 7.5) para `origem`/`canalEntrada` separados. |
| `fundacao-persistencia.test.js` | Fecha e reabre a conexão SQLite (simula restart do processo) — confirma que dado e código amigável sobrevivem, e que migrations não são reaplicadas. Atualizado nos ajustes finais para refletir 6 migrations (não mais 4). |
| `ajustes-migracao-incremental.test.js` | **Novo (ajustes finais, seção 7.5)**: simula upgrade de um banco só com v1-v4 para v1-v6, confirmando preservação de dados e não-duplicação de migrations. |

Padrão de teste: script standalone com `assert` do Node, mesmo padrão já usado em `apps/IA Command/tests/*.test.js` (sem framework de teste, execução via `node arquivo.test.js`).

---

## 2. Arquivos existentes alterados

| Arquivo | Mudança |
|---|---|
| `apps/registry.js` | Nova entrada `APPS.iaService` (`code: 'ia-service'`, `frontendDir`, `backendDir`, `staticDirs`). |
| `apps/IAHUB/backend/sistemas/database.js` | Nova entrada em `DEFAULT_SYSTEMS` (`code: 'ia-service'`, ativo, não admin-only). |
| `apps/IAHUB/backend/permissoes/system-routines.js` | `systemActiveFromRotinas` reconhece prefixo `svc-*` para o `system_code = 'ia-service'`. |
| `index.js` | Criado `requireIaService = requireSystemAccess('ia-service')`; rota de redirecionamento `/app/ia-service` → `/app/ia-service/atendimentos.html`; `mountStaticDirs('/app/ia-service', ...)`; inicialização do banco (`apps/IA Service/backend/database.inicializarDB()`) e registro de rotas, logo após o bloco do IA Command. |
| `packages/auth/frontend/js/auth.js` | Adicionadas entradas em `_PAGINA_ROTINA` (`/app/ia-service/atendimentos.html` → `svc-atendimentos`, `/app/ia-service/consultores.html` → `svc-consultores`) e em `_ROTINA_LABELS` (labels amigáveis). |
| `apps/IAHUB/frontend/iahub.html` | Adicionado ícone SVG próprio em `SYSTEM_ICONS['ia-service']`. **Não** foi adicionada imagem de card em `DEFAULT_SYSTEM_CARD_IMAGES` — não há arquivo de imagem disponível para criar nesta etapa; o sistema usa a imagem `default` até uma imagem própria ser fornecida (não bloqueia funcionamento). |

Nenhum outro arquivo do IA HUB, IA Command, IA Recruit ou Master Crypto foi tocado.

---

## 3. Migrations e tabelas criadas

Banco: `apps/IA Service/data/ia-service.db` (arquivo próprio e exclusivo — nunca `ia-command.db`). Mesmo padrão do IA Command: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, tabela `schema_migrations` (`version`, `descricao`, `aplicado_em`).

**v1 — `consultores`**: `id, usuario_id_iahub, empresa_id, id_softexpert, ativo, criado_em, atualizado_em`. Índice único `(usuario_id_iahub, empresa_id)`; índice único condicional `(empresa_id, id_softexpert) WHERE id_softexpert IS NOT NULL`.

**v2 — `atendimentos`**: `id, codigo, empresa_id, origem, referencia_externa, conteudo_bruto, contexto_estruturado_json, contexto_origem, precisa_revisao, status, criado_por_usuario_id, criado_por_integracao, consultor_id (FK consultores), criado_em, atualizado_em`. Índice único em `codigo`; ~~índice único condicional de idempotência~~ — **removido pela v5, ver seção 7.2**.

**v3 — `mensagens`**: `id, empresa_id, atendimento_id (FK atendimentos, CASCADE), papel, conteudo, usuario_id, criado_em`.

**v4 — `anexos`**: `id, empresa_id, atendimento_id (FK, CASCADE), mensagem_id (FK, SET NULL), nome_original, nome_interno, mime_type, tamanho, caminho_relativo, usuario_id, criado_em`. Índice único em `nome_interno`.

**v5 — remove UNIQUE de idempotência** (ajustes finais, ver seção 7.2).

**v6 — adiciona `canal_entrada`** à tabela `atendimentos` (ajustes finais, ver seção 7.3).

**Ordem das migrations**: `consultores` foi criada em v1 (antes de `atendimentos`, que é conceitualmente a "entidade central") porque `atendimentos.consultor_id` referencia `consultores(id)` via FK — com `foreign_keys=ON`, SQLite exige que a tabela referenciada já exista no momento do `CREATE TABLE`. Isso é uma decisão técnica de ordenação, não de prioridade conceitual.

---

## 4. Consultor IA HUB ↔ ID SoftExpert — como ficou

### Decisão: `usuario_id_iahub + empresa_id`, não `usuario_id_iahub` global

O prompt da Etapa 1 (seção 17) pediu para decidir com base no modelo real do IA HUB, documentando a justificativa. Investigação feita:

- `apps/IAHUB/backend/usuarios/database.js` confirma que um usuário tem campo `empresas` (array de IDs, ou `'all'` para admin) — **um mesmo usuário pode ter acesso a mais de uma empresa cliente**.
- O padrão real do IA Command para "configuração por empresa" (`apps/IA Command/modules/database/migrations.js`, tabela `ai_config`) usa `empresa_id INTEGER NOT NULL UNIQUE` — uma linha por empresa, nunca um registro global compartilhado entre empresas.
- `id_softexpert` é, por natureza do domínio, específico da **instância SoftExpert de cada empresa cliente** — dois clientes diferentes do IA HUB têm instâncias SoftExpert diferentes, com numeração de técnico própria. Um consultor global colidiria dois `id_softexpert` de instâncias diferentes no mesmo registro, ou exigiria uma segunda tabela de vínculo por empresa — desnecessariamente mais complexo.

**Modelo implementado**: tabela `consultores` com `(usuario_id_iahub, empresa_id)` único. Um usuário do IA HUB que atende duas empresas clientes tem **dois registros de consultor**, cada um com seu próprio `id_softexpert` (testado explicitamente em `fundacao-repositories.test.js`: o usuário 1 foi vinculado como consultor tanto na empresa 9001 quanto na 9002, com IDs SoftExpert diferentes, sem conflito).

### Validação de vínculo

`consultor-service.js` chama `usuariosDb.buscarPorId(usuarioIdIahub)` antes de criar o vínculo — se o usuário não existir ou estiver inativo, a criação falha explicitamente (`Usuário IA HUB não encontrado: <id>` / `Usuário IA HUB inativo: <id>`), atendendo ao requisito da seção 17 do prompt ("usuário IA HUB inexistente não pode ser vinculado silenciosamente"). Testado em `fundacao-services.test.js` e confirmado via HTTP real na seção 6 abaixo.

---

## 5. Contrato canônico de entrada — como ficou

Implementado em `services/atendimento-service.js`, função `_normalizarEntradaCanonica` (privada) + `criarAtendimentoDeEntradaCanonica` (pública, é o único caminho de criação de atendimento usado pela rota `POST /api/ia-service/atendimentos`):

```
{
  origem: 'manual' | 'softexpert' | 'outro',        // fonte de NEGÓCIO — ver seção 7.3
  canalEntrada: 'web' | 'api' | 'importacao',        // meio TÉCNICO de chegada — ver seção 7.3
  referenciaExterna: string | null,
  empresaId: number,               // obrigatório, nunca inferido
  conteudoBruto: string,           // obrigatório, preservado imutável
  contextoEstruturado: object | null,
  contextoOrigem: 'ia' | 'nao_processado' | ...,
  precisaRevisao: boolean,
  criadoPorUsuarioId: number | null,
  criadoPorIntegracao: string | null,
  consultorId: string | null,
}
```

**Atualização (ajustes finais, seção 7.3)**: `'api'` foi removida de `origem` — API não é uma origem de negócio, é um canal técnico. O campo `canalEntrada` foi adicionado como dimensão independente.

Nesta etapa, como não há extração automática por IA (fora de escopo — seção 23 do prompt), `contextoOrigem` nasce como `'nao_processado'` quando nenhum `contextoEstruturado` é fornecido — o campo existe e está pronto para receber `'ia'`/`'corrigido_manualmente'` quando o motor de IA da etapa futura for implementado, sem exigir migration nova.

A rota HTTP (`POST /api/ia-service/atendimentos`) já passa pela mesma função de normalização que uma futura integração usaria — não há caminho alternativo de criação de atendimento na rota que pule essa normalização, atendendo à seção 18 do prompt ("entrada manual deve usar o mesmo pipeline").

`criarAtendimentoDeEntradaCanonica` também já persiste a primeira mensagem (o próprio `conteudoBruto`, papel `user`) — testado em `fundacao-services.test.js`.

---

## 6. Testes executados e resultados

### 6.1 Testes automatizados (arquivo `.test.js`)

```
node "apps/IA Service/tests/fundacao-repositories.test.js"  → ok
node "apps/IA Service/tests/fundacao-services.test.js"       → ok
node "apps/IA Service/tests/fundacao-persistencia.test.js"   → ok
```

Todos os `assert` passaram nas 3 execuções (rodados novamente ao final desta etapa para confirmar).

### 6.2 Validação end-to-end via HTTP real (servidor subido localmente, porta 3000)

Servidor subiu limpo (`node index.js`), sem erros de boot em nenhum módulo — IA Command inicializou normalmente (94 migrations aplicadas, nenhuma reaplicação) e IA Service inicializou logo em seguida (4 migrations aplicadas, arquivo `ia-service.db` próprio criado).

| # | Cenário do checklist da seção 26 do prompt | Resultado |
|---|---|---|
| 1 | IA Service registrado no IA HUB | Confirmado — `GET /api/sistemas/disponiveis` (autenticado) lista `ia-service` junto aos demais sistemas |
| 2 | Usuário sem acesso não consegue acessar | Confirmado — `GET /api/ia-service/health` e `GET /app/ia-service/atendimentos.html` retornam `401` sem sessão |
| 3 | Usuário autorizado consegue acessar | Confirmado — após login + seleção de empresa + seleção do sistema `ia-service`, `health` retorna `200` |
| 4 | Empresa corrente é identificada corretamente | Confirmado — atendimento criado ficou associado a `empresaId: 1`, igual à empresa selecionada na sessão |
| 5 | Banco `ia-service.db` é criado/inicializado corretamente | Confirmado — log de boot mostra `[IA Service] Banco SQLite inicializado: ...\ia-service.db` |
| 6 | Migrations executam uma única vez | Confirmado — teste de persistência reabre o banco e `schema_migrations` continua com 4 linhas (não duplica) |
| 7 | Atendimento pode ser criado | Confirmado — `POST /api/ia-service/atendimentos` retornou `201` com `codigo: "AI-000001"` |
| 8 | Código amigável do atendimento é gerado corretamente | Confirmado — padrão `AI-000001`, sequencial, único (testado também com 2 atendimentos na mesma empresa) |
| 9 | Atendimento pode ser consultado somente dentro da empresa correta | Confirmado — `GET /api/ia-service/atendimentos?empresa_id=1` retorna o atendimento |
| 10 | Tentativa de acesso por outra empresa não retorna o atendimento | Confirmado — `GET /api/ia-service/atendimentos?empresa_id=3` (mesma sessão admin, empresa diferente) retornou lista vazia |
| 11 | Mensagem pode ser persistida | Confirmado (teste automatizado + criação automática pela entrada canônica) |
| 12 | Mensagem não pode cruzar empresa | Confirmado (teste automatizado — `mensagemRepo.salvarMensagem` de outra empresa lança erro explícito) |
| 13 | Metadados de anexo podem ser persistidos | Confirmado (teste automatizado) |
| 14 | Cadastro de Consultor/Técnico funciona | Confirmado — `POST /api/ia-service/consultores` (usuário real 1/admin) retornou `201` |
| 15 | Consultor está vinculado a usuário IA HUB | Confirmado — `usuarioIdIahub: 1` no retorno, validado contra `usuarios/database.js` |
| 16 | `id_softexpert` pode ser persistido | Confirmado — `idSoftexpert: "784"` retornado corretamente |
| 17 | Usuário IA HUB inexistente não pode ser vinculado silenciosamente | Confirmado — `POST` com `usuarioIdIahub: 999999` retornou `404` com mensagem explícita, nenhum registro criado |
| 18 | Contrato canônico pode criar um atendimento manual básico | Confirmado (teste automatizado + HTTP real) |
| 19 | Reiniciar aplicação não perde os dados | Confirmado (teste automatizado dedicado, fecha/reabre conexão SQLite) |
| 20 | IA Command continua funcionando sem alteração/regressão aparente | Confirmado — após navegar para o IA Service e voltar para o IA Command na mesma sessão, `GET /api/ia-command/health` retornou `200` com as 94 migrations intactas; `shell.html` do IA Command carrega normalmente |

**Nota sobre credenciais usadas no teste**: o login foi feito com o usuário `admin` já existente nos dados reais do ambiente local, usando a senha padrão documentada no próprio código (`apps/IAHUB/backend/auth/database.js`, fallback `ADMIN_PASS || 'iahub@2024'`) — nenhuma senha foi alterada, descoberta por força bruta ou exposta neste documento além do que já está em texto claro no código-fonte como fallback de desenvolvimento. Os testes de leitura contra `usuarios/database.js` e `empresas/database.js` (empresa 1, 3; usuário 1) **não escreveram** nesses arquivos JSON — apenas leitura.

---

## 7. Ajustes finais (pós-revisão da fundação)

A fundação da Etapa 1 foi aprovada; esta seção documenta os 3 ajustes pedidos antes de autorizar a Etapa 2. Nenhum deles alterou o escopo — motor de IA, chat completo, KB/RAG e integração SoftExpert continuam fora desta etapa.

### 10.1 Arquivos alterados nesta rodada de ajustes

| Arquivo | Mudança |
|---|---|
| `apps/IA Service/backend/database/migrations.js` | Adicionadas migrations **v5** (remove o índice único de idempotência) e **v6** (adiciona `canal_entrada`). Migrations v1-v4 **não foram editadas** — apenas apensadas novas versões, conforme instruído. |
| `apps/IA Service/backend/repositories/atendimento-repository.js` | Refatorado: extraídas `_inserirAtendimento`/`_inserirMensagem` (SQL puro, sem transação própria) reaproveitadas por `criarAtendimento` (mantida) e pela nova `criarAtendimentoComPrimeiraMensagem` (transação real via `db.transaction()`, cobrindo INSERT do atendimento + INSERT da primeira mensagem). `_rowParaDominio` passou a incluir `canalEntrada`. |
| `apps/IA Service/backend/services/atendimento-service.js` | `ORIGENS_VALIDAS` agora é `{'manual','softexpert','outro'}` (removido `'api'`); nova constante `CANAIS_ENTRADA_VALIDOS = {'web','api','importacao'}`; `_normalizarEntradaCanonica` valida e inclui `canalEntrada` (default `'web'`); `criarAtendimentoDeEntradaCanonica` agora chama `atendimentoRepo.criarAtendimentoComPrimeiraMensagem` (uma única chamada transacional) em vez de duas chamadas separadas a repositories diferentes. |
| `apps/IA Service/backend/routes/index.js` | `POST /api/ia-service/atendimentos` passa a aceitar e repassar `canalEntrada` do corpo da requisição (default `'web'` quando omitido). |

### 10.2 Idempotência / UNIQUE — o que mudou

O índice `idx_svc_atendimentos_idempotencia` (UNIQUE em `empresa_id, origem, referencia_externa`) foi **removido** pela migration v5 (`DROP INDEX IF EXISTS ...`), substituído por um índice normal (`idx_svc_atendimentos_referencia_externa`, sem UNIQUE) que preserva a performance de busca por referência externa sem impedir duplicidade.

**Motivo**: a entrada manual pode legitimamente gerar mais de um atendimento IA Service relacionado ao mesmo número de chamado SoftExpert (ex.: o analista reabre a investigação, ou dois analistas tratam o mesmo chamado de ângulos diferentes). A idempotência real — impedir que a *mesma integração* crie duplicata por reprocessamento de webhook, por exemplo — só faz sentido quando a semântica de evento externo existir (a diferença entre "eu, humano, decidi criar de novo" e "o SoftExpert reenviou o mesmo evento por engano"). Impor UNIQUE agora bloquearia o primeiro caso para resolver um problema que ainda não existe.

Nenhum dado existente foi perdido ou teve que ser migrado para essa mudança — é apenas remoção de um índice, operação instantânea em SQLite.

### 10.3 Origem × Canal de entrada — o que mudou

Antes: `origem` aceitava `'manual' | 'softexpert' | 'api' | 'outro'`, misturando fonte de negócio com meio técnico.

Depois:
- `origem` (fonte de negócio, tabela `atendimentos.origem`, sem mudança de schema): `'manual' | 'softexpert' | 'outro'`.
- `canal_entrada` (meio técnico, coluna nova via migration v6): `'web' | 'api' | 'importacao'`, default `'web'` — todos os atendimentos já existentes no banco (criados antes desta migration) receberam automaticamente `canal_entrada = 'web'`, já que web era o único canal em uso.

Exemplo do fluxo atual: `origem = 'manual'`, `canal_entrada = 'web'`. Exemplo de um cenário futuro (não implementado): `origem = 'softexpert'`, `canal_entrada = 'api'` — testado no service com dados simulados (`fundacao-services.test.js`), sem nenhuma integração real.

### 10.4 Atomicidade — o que mudou e como foi provado

`criarAtendimentoComPrimeiraMensagem` (novo, em `atendimento-repository.js`) envolve o INSERT do atendimento e o INSERT da primeira mensagem dentro de um único `db.transaction()` do `better-sqlite3` — que mapeia para `BEGIN`/`COMMIT` reais do SQLite, com `ROLLBACK` automático se qualquer instrução dentro da função lançar exceção.

**Prova de rollback real** (não apenas inspeção de código): o teste `fundacao-repositories.test.js` chama `criarAtendimentoComPrimeiraMensagem` passando `papel: null` na mensagem — isso viola a constraint `NOT NULL` da coluna `mensagens.papel`, um erro de SQL genuíno (não simulado/mockado). O teste então:
1. Confirma que a chamada lança exceção (`NOT NULL constraint failed`);
2. Relista os atendimentos da empresa e confirma que o atendimento com o conteúdo específico dessa tentativa **não existe** — provando que o `ROLLBACK` desfez também o INSERT do atendimento, que tecnicamente já tinha sido executado antes do INSERT da mensagem falhar.

Sem a transação, esse cenário deixaria um atendimento órfão gravado sem sua mensagem inicial — com a transação, nada é persistido.

### 10.5 Testes desta rodada de ajustes

| Teste | O que verifica | Resultado |
|---|---|---|
| `fundacao-repositories.test.js` (atualizado) | Idempotência permite 2 atendimentos manuais com mesma `referencia_externa`; `canal_entrada` default `web`; transação atômica com sucesso; **rollback real** quando a mensagem é inválida | ok |
| `fundacao-services.test.js` (atualizado) | `'api'` rejeitada como origem; `canalEntrada` inválido rejeitado; `origem=softexpert + canalEntrada=api` aceito (dimensões independentes); 2 atendimentos com mesma referência aceitos no nível de service | ok |
| `fundacao-persistencia.test.js` (atualizado) | `schema_migrations` reflete 6 versões (não mais 4) após restart | ok |
| `ajustes-migracao-incremental.test.js` (novo) | Simula um banco "legado" contendo *apenas* as migrations v1-v4 tal como existiam antes destes ajustes (schema com UNIQUE de idempotência, sem `canal_entrada`), grava um atendimento real nesse schema antigo, depois abre o mesmo arquivo com o código atual (v1-v6) e confirma: (1) v1-v4 continuam registradas em `schema_migrations`, nunca reaplicadas; (2) v5/v6 aplicam uma única vez, mesmo reabrindo o banco de novo; (3) o atendimento gravado sob o schema antigo permanece íntegro e ganha `canal_entrada='web'` automaticamente; (4) o UNIQUE antigo de fato não existe mais nesse banco upgradeado — um segundo atendimento com a mesma referência externa é aceito | ok |

Todos os 4 arquivos de teste executados juntos, ao final, sem falhas.

**Validação adicional em banco real** (não apenas simulado): o arquivo `apps/IA Service/data/ia-service.db`, criado durante a validação end-to-end da primeira rodada da Etapa 1 (continha só v1-v4 e 1 atendimento de teste), foi efetivamente atualizado subindo o servidor real com o código dos ajustes — o log de boot confirmou a aplicação de v5 e v6 sobre esse banco de produção local, sem duplicar v1-v4 e sem perder o atendimento pré-existente (confirmado por consulta direta ao arquivo `.db` antes e depois). Em seguida, via HTTP real autenticado, foram criados dois novos atendimentos com `origem=softexpert` e a mesma `referenciaExterna="005821"` — ambos retornaram `201 Created` com IDs distintos, confirmando o comportamento em condição real, não só em teste isolado. O health check do IA Command foi checado novamente após essas mudanças (`200 OK`, 94 migrations intactas).

### 10.6 Confirmações pedidas pelo prompt de ajustes

- **Rollback transacional confirmado**: seção 7.4, com teste que causa uma falha real de constraint SQL (não simulada) e verifica ausência do atendimento órfão.
- **Referência externa repetida aceita no fluxo manual**: confirmado tanto em teste automatizado (repository e service) quanto via HTTP real (dois `POST /api/ia-service/atendimentos` com a mesma `referenciaExterna`, ambos `201`).
- **Origem/canal separados**: confirmado — `origem` não aceita mais `'api'`; `canalEntrada` é campo novo e independente, testado em combinações (`manual+web`, `softexpert+api`).
- **IA Command não foi alterado**: confirmado por `git status` (nenhuma entrada sob `apps/IA Command/`) e por health check funcional antes e depois dos ajustes.

---

## 8. Riscos e pendências identificados durante a implementação

- **Atomicidade cross-repository**: `criarAtendimentoDeEntradaCanonica` cria o atendimento e depois salva a primeira mensagem em duas chamadas separadas (dois repositories distintos). Como `better-sqlite3` é síncrono e cada `INSERT` individual é atômico, o risco de inconsistência é baixo, mas não há uma transação explícita cobrindo as duas operações juntas. Se o volume ou a criticidade justificarem no futuro, envolver isso numa única `db.transaction()` cross-repository é uma melhoria possível (exigiria os dois repositories compartilharem a mesma instância de `db` dentro da transação — hoje cada repository chama `getDB()` independentemente, o que já retorna o singleton correto, então a mudança seria de baixo risco quando necessária).
- **Imagem de card do IA Service no launcher**: não foi criado um arquivo de imagem (`/img/system-card-*.jpg`) para o card do IA Service em `iahub.html` — o sistema aparece corretamente na lista e é clicável, mas usa a imagem `default` compartilhada até uma imagem própria ser fornecida pelo time.
- **Backup do arquivo `ia-service.db`**: assim como observado na análise da Etapa 0 para o IA Command, não há rotina de backup automatizado visível no código para arquivos SQLite locais — presumivelmente depende de backup de infraestrutura/VM, não confirmado nesta etapa.
- **Upload de anexo real**: a fundação (validação, repository, armazenamento em disco) está pronta e testável (`services/armazenamento-anexos.js`), mas não está conectada a nenhuma rota HTTP de upload — conforme delimitado explicitamente pela Etapa 1 (UX completa de anexos fica para a Etapa 2). O input de arquivo na tela `atendimentos.html` está desabilitado com essa observação visível ao usuário.
- **Nenhum desvio arquitetural foi necessário** em relação ao prompt da Etapa 1 — a única decisão técnica não trivial (ordem das migrations `consultores` antes de `atendimentos`) foi resolvida sem alterar o desenho, apenas a sequência de criação das tabelas.

---

## 9. Confirmações finais

- **IA Command não foi refatorado**: nenhum arquivo dentro de `apps/IA Command/` foi criado, editado ou removido nesta etapa. Confirmado por `git status --porcelain` (nenhuma entrada sob `apps/IA Command/`) e pelo teste funcional do health check do IA Command após a integração do IA Service.
- **Nenhuma tabela do IA Command foi tocada**: `ia-service.db` é um arquivo SQLite fisicamente separado de `ia-command.db`; nenhum código do IA Service faz `require` ou abre conexão com o banco do IA Command.
- **Supabase não foi tocado**: nenhuma referência a Supabase foi adicionada; a credencial exposta identificada na Etapa 0 permanece como dívida documentada, sem alteração.
- **Nenhum commit ou push foi realizado.**

---

## 10. Não avançar

Conforme instruído, esta implementação **para aqui**. Não foram iniciados: motor de IA, chat completo, streaming, RAG/embeddings, Base de Conhecimento, integração SoftExpert (webhook/polling/retorno), ou qualquer refinamento de UX além do necessário para validar a fundação.

Aguardando revisão para autorizar a Etapa 2.
