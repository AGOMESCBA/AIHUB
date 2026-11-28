# IA Talk — Contratos congelados (C0)

Fonte única de API REST, Socket.IO, formatos e estados. O código usa
`backend/contratos/index.js` (enums e `FORMAS`); os testes conferem o servidor
simulado contra essas formas, e depois o real.

**Mudar contrato** = combinar entre Claude Code e Antigravity, atualizar este
arquivo, `backend/contratos/index.js`, o simulado e os testes **no mesmo
commit**, e registrar em `docs/andamento.md`.

Exemplos completos de cada resposta: rode o servidor simulado e chame a rota
(os dados estão em `backend/simulado/dados.js`).

---

## 1. Convenções gerais

| Item | Regra |
|---|---|
| Base | Tudo sob `/app/ia-talk/`. API administrativa `/app/ia-talk/api/admin`, pública `/app/ia-talk/api/publico`, integradores `/app/ia-talk/api/v1`, Socket.IO path `/app/ia-talk/socket.io`, namespace `/talk`. |
| Idioma | Campos, códigos e mensagens em **pt-BR**. `mensagem` é texto para a pessoa ler. |
| JSON | `snake_case`. Datas ISO 8601 em UTC (`2026-11-25T14:00:00.000Z`). |
| IDs | Aleatórios com prefixo: `emp_` empresa, `usr_` usuário, `app_` aplicação, `tok_` token, `cn_` canal, `msg_` mensagem, `evt_` evento, `aud_` auditoria, `dsf_` desafio de login; C8: `set_` setor, `cv_` conversa, `itm_` item de conversa, `ct_` contato, `rr_` resposta rápida. Nunca sequenciais (o `protocolo` da conversa é só número de exibição). |
| Números de telefone | **Nunca** saem completos nas respostas administrativas: sempre `*_mascarado` (`+55 65 9••••-0000`). Entram completos (só dígitos, com DDI). |
| Segredos | Token de aplicação e segredo de webhook aparecem **uma única vez**, na resposta de geração. Depois só `prefixo` / `segredo_configurado: true`. |

### 1.1 Autenticação e contexto de empresa

| API | Como autentica | De onde vem a empresa |
|---|---|---|
| `admin` | Cookie de sessão do Talk (`talk.sid`, `HttpOnly`, `Secure`, `SameSite=Lax`, path `/app/ia-talk`). Criado pelo login por telefone ou pela entrada via IAHub (C1). | Da **sessão**. Nenhuma rota recebe `empresa_id` no corpo ou na URL para escolher contexto. Trocar de empresa: `POST /sessao/empresa`. |
| `publico` | Nenhuma (só página de entrada e login). Limite de tentativas. | Do **apelido** do link. |
| `v1` | `Authorization: Bearer <token da aplicação>`. | Da **aplicação** dona do token; o canal precisa estar em `canais_autorizados`. |

Não existe login por e-mail e senha (decisão de 25/11/2026). Entradas: telefone
com código no WhatsApp (código pelo canal vinculado à empresa; e-mail
cadastrado como reserva), card do IAHub (ticket assinado de 60 s) e
sessão emitida servidor a servidor (padrão do chat Protheus, C1).

### 1.2 Erros

```json
{ "erro": { "codigo": "requisicao_invalida", "mensagem": "Confira os campos destacados.",
            "campos": { "apelido": "Use só letras minúsculas, números e hífen (3 a 40)." },
            "detalhe": { "tentativas_restantes": 3 } } }
```

`campos` e `detalhe` são opcionais. Compare sempre `codigo`, nunca a mensagem.

| HTTP | `codigo` | Quando |
|---|---|---|
| 400 | `requisicao_invalida` | Campo faltando/inválido (`campos`), JSON inválido, cursor inválido |
| 401 | `nao_autenticado` | Sem sessão, sessão vencida, token ausente/inválido |
| 403 | `sem_permissao`, `canal_nao_autorizado` | Papel/rotina sem acesso; canal fora do escopo da aplicação |
| 404 | `nao_encontrado` | Registro inexistente **ou de outra empresa** (nunca 403, para não revelar que existe) |
| 409 | `conflito`, `idempotencia_conflito` | Edição concorrente (`versao`), duplicidade (apelido, celular), chave de idempotência reutilizada com outro corpo |
| 413 | `requisicao_invalida` | Corpo grande demais |
| 422 | `recurso_nao_suportado`, `canal_desconectado`, `fora_da_janela_24h` | O canal/provedor não faz o que foi pedido |
| 429 | `limite_excedido` | Limite de requisições. Cabeçalho `Retry-After` em segundos |
| 500 | `erro_interno` | Falha não prevista (sem detalhe técnico na resposta) |
| 503 | `indisponivel` | Serviço/provedor fora do ar |

**Equivalência com a nomenclatura sugerida pelo Antigravity:** `status` = código HTTP, `code` = `erro.codigo`, `error` = `erro.mensagem`, `details` = `erro.detalhe` (+ `erro.campos` para erro por campo).

### 1.3 Listas: paginação, filtros e ordenação

```
GET …/mensagens?limite=50&cursor=<opaco>&busca=texto&<filtro>=valor&ordenar=criada_em&ordem=desc
→ { "itens": [...], "proximo_cursor": "<opaco>" | null, "total": 64 }
```

* `limite` 1–200 (padrão 50). `cursor`: repassar exatamente o `proximo_cursor` recebido.
* `total` é opcional (pode faltar em listas grandes). Mostre "N de total" só quando vier.
* `busca`: texto livre nos campos indicados em cada rota. Filtros: valor exato, salvo indicação.
* `ordenar` = campo da resposta; `ordem` = `asc` | `desc` (padrão `desc` para datas).
* Filtro de vários valores: separar por `|` (`estado=falhou|desconhecida`).

### 1.4 Concorrência de edição

Recursos com `versao` (sites autorizados; outros a definir) exigem a `versao`
lida no `PUT`. Versão antiga → `409 conflito`; a tela recarrega e avisa.

---

## 2. Estados (vocabulário único)

Rótulos e cores: `TalkUI.pill()` em `frontend/js/talk-ui.js`.

| Domínio | Valores | Observação |
|---|---|---|
| Canal | `parado`, `iniciando`, `qr_pendente`, `conectado`, `reconectando`, `desconectado`, `erro` | Equivalência pedida: disconnected=`desconectado`/`parado`, qr=`qr_pendente`, connecting=`iniciando`/`reconectando`, connected=`conectado`, error=`erro` |
| Mensagem de saída | `aceita` → `aguardando` → `encaminhada` → `enviada` → `entregue` → `lida`; ou `falhou`; ou `desconhecida` | Só estados comprovados. **`aceita` não é entrega.** `desconhecida` nunca é reenviada sozinha |
| Mensagem de entrada | `recebida` | |
| Ação manual | só em `desconhecida` e `falhou` | Reenviar / dar como falha |
| Entrega de webhook | `pendente`, `entregue`, `falhando`, `esgotado` | |
| Cadastros | empresa `ativa`/`inativa`; usuário, membro `ativo`/`inativo`; aplicação `ativa`/`inativa` | |

---

## 3. G1 — Acesso e cadastros

### 3.1 Página de entrada e login (`/api/publico`)

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /empresa/:apelido` | — | `{ nome, apelido, logo_url, metodos: ['telefone'] }`. Empresa inativa/inexistente: 404 |
| `POST /login/codigo` | `{ apelido, telefone }` | `{ desafio_id, expira_em, enviado_por: 'whatsapp'\|'email', destino_mascarado }`. Resposta igual para número não cadastrado (não revela cadastro) |
| `POST /login/confirmar` | `{ desafio_id, codigo }` | `{ ok: true, redirecionar }` + cookie. Código errado: 400 com `campos.codigo` e `detalhe.tentativas_restantes`. Mais de 5: 429 |
| `GET /entrar-hub?ticket=…` | — | Redireciona para o shell com sessão criada. Ticket inválido/vencido/reusado: 401 (página de erro). Na primeira entrada cadastra a empresa do IAHub e o usuário |
| `GET /link/:token` | — | Link de uso único (15 min) gerado no servidor (`backend/cli/primeiro-acesso.js`). Redireciona para o shell; usado/vencido: 401 |

Card do IAHub: `GET /api/ia-talk/entrar` (no IAHub) confere empresa, usuário e sistema, assina o ticket (Ed25519, 60 s, uso único;
chaves em `apps/IAHUB/data/ia-talk/`) e redireciona para `…/api/publico/entrar-hub`. Em desenvolvimento, `IA_TALK_URL` no `.env`
aponta o endereço do Talk (ex.: `http://127.0.0.1:3050/app/ia-talk/`).

Página de entrada (G1): `frontend/entrar.html`, servida em `/app/ia-talk/<apelido>` (já no simulado; no servidor real, C1). A tela lê o apelido do último trecho do endereço; aberta direto como `entrar.html`, usa `?apelido=`. No simulado o código é sempre `123456`; `?simular=email` mostra o envio pelo e-mail de reserva.

### 3.2 Sessão (`/api/admin`)

| Rota | Resposta / efeito |
|---|---|
| `GET /sessao` | `{ usuario: { id, nome, telefone_mascarado, administrador_plataforma }, empresa: { id, nome, apelido, logo_url }, papel, rotinas: [...], empresas_disponiveis: [{ id, nome, apelido }], origem: 'telefone'\|'hub'\|'servidor', expira_em }` |
| `POST /sessao/empresa` | `{ empresa_id }` → troca o contexto (só empresas em `empresas_disponiveis`). A tela recarrega todas as abas |
| `POST /sair` | `{ ok, redirecionar }` |

Rotinas (menu): `talk-painel`, `talk-canais`, `talk-mensagens`, `talk-eventos`, `talk-aplicacoes`, `talk-usuarios`, `talk-configuracoes`, `talk-auditoria`, `talk-empresas` (só plataforma).

De onde vêm as rotinas da sessão: entrada pelo card do IAHub de **usuário comum** = as rotinas `talk-*` liberadas na
IA Gestão (Usuários › Permissões, por usuário e empresa; o ticket as leva). Administrador do IAHub e demais entradas
(telefone, link) = papel do Talk. A tela Início do shell monta os cards a partir do menu já filtrado por essas rotinas.

### 3.3 Cadastros

| Recurso | Rotas | Forma (`FORMAS`) | Filtros / busca |
|---|---|---|---|
| Empresas (plataforma) | `GET/POST /empresas`, `GET/PUT /empresas/:id` | `empresa` | `busca` (nome, apelido, CNPJ), `situacao`, `vinculo_hub=com\|sem` |
| Usuários da empresa | `GET/POST /usuarios`, `GET/PUT /usuarios/:id` | `usuario` | `busca` (nome, e-mail, celular), `papel`, `situacao` |
| Papéis | `GET /papeis` | `papel` | — |
| Sites autorizados | `GET/PUT /sites-autorizados` (`{ origens, versao }`) | `sitesAutorizados` | Só `https://host[:porta]`, sem caminho |
| E-mail de envio | `GET/PUT /email-envio`, `POST /email-envio/testar` | `emailEnvio` | Senha só entra; sai `senha_configurada`. Teste devolve `etapas: [{ etapa: dns\|porta\|autenticacao\|envio, ok, mensagem }]` (padrão "E-mail Geral" do IA Recruit) |
| Aplicações | `GET/POST /aplicacoes`, `GET/PUT /aplicacoes/:id` | `aplicacao` | `busca`, `situacao` |
| Tokens | `POST /aplicacoes/:id/tokens` → `{ token, registro, aviso }` (token completo **só aqui**); `DELETE /aplicacoes/:id/tokens/:tokenId` → revoga | `tokenAplicacao` | Rotação = gerar novo + revogar o antigo (dois válidos durante a troca) |
| Segredo do webhook | `POST /aplicacoes/:id/webhook/segredo` → `{ segredo, aviso }` | — | Mostrado uma vez |

Corpo de usuário: `{ nome, telefone (dígitos com DDI), email?, papel, situacao? }`.
Corpo de aplicação: `{ nome, descricao?, escopos: ['mensagens:enviar'|'mensagens:ler'|'eventos:ler'|'canais:ler'], canais_autorizados: [cn_…], webhook?: { url, ativo } }`.

---

## 4. G2 — Canais

| Rota | Efeito |
|---|---|
| `GET /canais` | Lista (forma `canal`). Filtros `busca`, `estado`, `provedor` |
| `POST /canais` | `{ nome, numero, provedor: 'wweb' }` (Meta → 400 até a G6). Nasce `parado`. `numero` com DDI e DDD, obrigatório e único entre os canais (com ou sem o nono dígito) → 409 `conflito` |
| `GET/PUT /canais/:id` | `PUT { nome?, numero?, empresas_vinculadas?: [{ id, padrao }] }`. Trocar `numero` só com o canal parado e sem sessão salva (senão 409) |
| `POST /canais/:id/conectar` | `parado` → `qr_pendente` (gera QR). Canal sem `numero` → 400 |
| `POST /canais/:id/desconectar` | → `parado` (mantém a sessão salva) |
| `POST /canais/:id/reconectar` | → `reconectando` |
| `POST /canais/:id/novo-qr` | Novo QR (o anterior deixa de valer) |
| `POST /canais/:id/limpar-sessao` | **Destrutiva**: exige `{ confirmar: true }`. Apaga a sessão; o celular lê QR de novo. A tela pede confirmação explícita, dizendo isso |
| `GET /canais/:id/qr` | `{ canal_id, estado, qr: dataURL\|null, expira_em }` (só em `qr_pendente`) |
| `POST /canais/:id/enviar-teste` | **C3.** `{ para_indice, texto }`: `para_indice` = posição (0, 1, …) em `numeros_teste_mascarados` — o número completo nunca passa pela tela; texto 1–1000. → `202` com `mensagemDetalhe` (`estado: 'aceita'`, `origem: 'teste_tela'`, `aplicacao: null`). `para_indice` ausente/não inteiro ou texto inválido → `400`; envio desligado ou canal não conectado → `409 conflito`; posição que não existe na lista → `403 sem_permissao` (com `campos.para_indice`). Os estados seguem pelo socket `mensagem:estado` (salas `painel` e `canal:<id>`) e por `GET /mensagens/:id` |
| `GET /canais/:id/log` | Página de `{ em, tipo, mensagem, mensagem_id?, texto? }`, mais recente primeiro. `texto` (e `mensagem_id`) só em linhas de mensagem enviada **pela empresa da sessão** — vem da mensagem, nunca do log (o log não guarda texto). O aviso `canal:log` traz só `mensagem_id`; a tela busca o texto em `GET /mensagens/:id` (detalhe traz `texto` completo; a lista, só a prévia). `tipo` ∈ `info, success, warning, error, received, sent, system` (mesmas cores do terminal do IA Command) |

Campos extras do canal (C2, aditivos): `modo_teste` (bool), `numeros_teste_mascarados`, `recebidas_descartadas`.
C3 (aditivo): `envio_habilitado` (bool) — começa `false` em produção (publicado desligado); a tela mostra o envio
desabilitado com o motivo enquanto estiver `false`.
**Regras do canal (26/11, migração 8):** `envio_modo` ∈ `desligado | teste | qualquer` e `recebimento_modo` ∈ `teste | todos`,
**independentes** (liberar o envio não passa a gravar as conversas de outros sistemas no mesmo número). `envio_habilitado`
(= envio ≠ desligado) e `modo_teste` seguem na resposta só por compatibilidade. `PUT /canais/:id` (só a plataforma) aceita
`envio_modo`, `recebimento_modo`, `numeros_teste_adicionar: [número digitado]` e `numeros_teste_remover: [posição]` (a lista
sai mascarada; sem duplicar com/sem o nono dígito). Cada mudança vira uma linha na auditoria (`canal.regra_envio`,
`canal.regra_recebimento`, `canal.numeros_teste`). Linha de comando equivalente: `cli/canal-teste.js --envio … --recebimento …`.
`PUT /canais/:id` aceita `modo_teste` e `numeros_teste` (só administração da plataforma). Em modo de teste, só as
mensagens dos números da lista entram no log/banco; das demais fica só a contagem.
**Número cadastrado (26/11, como no IA Command):** o número sai só mascarado (`numero_mascarado`). Se o QR for lido
por outro número, o Talk sai do WhatsApp (o aparelho some do celular), apaga a sessão, deixa o canal desligado e vai
para `erro` com o motivo no log. Canal antigo sem número recebe o número lido no primeiro pareamento.
Evento extra: `canal:mensagem` `{ canal_id, de_mascarado, tipo, em }` (mensagem aceita no modo de teste).

Canal compartilhado: `empresa_dona` configura; `empresas_vinculadas` usam o
número (como hoje no IA Command). `padrao: true` = canal que envia o código de
login daquela empresa.

**Quem pode ser vinculada (26/11, regra do IA Command):** `GET /canais/empresas-vinculaveis` →
`{ itens: [{ id, nome }] }`. Entrada pelo IAHub: empresas com o **IA Talk liberado** em que a pessoa
também tem a rotina `talk-canais` (administrador do IAHub dispensa a rotina, não a liberação) — lista
calculada e assinada pelo IAHub na entrada; liberou uma empresa nova, entra de novo no Talk. Sessão
local da plataforma: empresas ativas do Talk. Demais: só a própria empresa. `id` `hub:<n>` = empresa
do IAHub que ainda não existe no Talk: no `PUT` ela é criada já ligada ao IAHub (nunca duplica com a
entrada pelo card). Empresa nova fora da lista → 403; as já vinculadas continuam editáveis. Empresa
sem nenhum canal padrão recebe este como padrão.

### Socket.IO

Conexão: `TalkApi.socket()` (path `/app/ia-talk/socket.io`, namespace `/talk`; no real, autenticado pelo cookie da sessão).

| Direção | Evento | Corpo |
|---|---|---|
| cliente → servidor | `canal:assinar` | `{ canal_id }` (recebe na hora o estado e, se houver, o QR) |
| cliente → servidor | `canal:sair` | `{ canal_id }` |
| cliente → servidor | `painel:assinar` | `{}` |
| servidor → cliente | `canal:estado` | `{ canal_id, estado, em, detalhe? }` |
| servidor → cliente | `canal:qr` | `{ canal_id, qr, expira_em }` (renova sozinho) |
| servidor → cliente | `canal:log` | `{ canal_id, em, tipo, mensagem }` |
| servidor → cliente | `mensagem:estado` | `{ id, estado, em }` |
| servidor → cliente | `painel:atualizado` | mesmo corpo de `GET /painel` |
| servidor → cliente | `erro` | `{ codigo, mensagem }` |

A tela **sempre** carrega o estado inicial pela API e usa o socket só para
atualizar; se o socket cair, consulta a API a cada 30 s (padrão do chat do IA Service).

---

## 5. G3 — Painel, histórico e eventos

| Rota | Detalhe |
|---|---|
| `GET /painel` | Forma `painel`: `canais { total, conectados, com_problema }`, `mensagens_hoje { enviadas, recebidas, falhas }`, `fila { aguardando, desconhecidas }`, `tempo_medio_envio_ms` (pode ser `null`), `pendencias: [{ tipo, gravidade: alta\|media\|baixa, mensagem, link }]`, `atualizado_em` |
| `GET /mensagens` | Forma `mensagemResumo`. Filtros: `de`, `ate` (AAAA-MM-DD), `canal_id`, `provedor`, `aplicacao_id` (`nenhuma` = sem aplicação), `direcao` (`entrada`\|`saida`), `tipo`, `estado` (vários com `\|`), `apenas_falhas=1`, `correlacao_id` (contém), `destinatario` (número completo digitado; resposta mascarada), `busca` (prévia, id, correlação) |
| `GET /mensagens/:id` | Forma `mensagemDetalhe`: + `historico_estados [{ estado, em, detalhe }]`, `metadados`, `anexos [{ id, nome, mime, tamanho }]` |
| `GET /mensagens/exportar` | Mesmos filtros; CSV (`;`, UTF-8 com BOM), até 200 linhas no simulado. Exige rotina `talk-mensagens` |
| `POST /mensagens/:id/reenviar` | Só `desconhecida`/`falhou` (senão 409) |
| `POST /mensagens/:id/dar-como-falha` | Idem |
| `GET /eventos` | Forma `evento`: `entrega { situacao, tentativas, proxima_tentativa_em, ultimo_status_http }`. Filtros `tipo`, `aplicacao_id`, `situacao`, `de`, `ate`, `busca` |
| `GET /eventos/:id` | + `corpo` (o que foi enviado ao consumidor) e `tentativas [{ em, status_http, duracao_ms }]` |
| `POST /eventos/:id/reentregar` | Volta para `pendente` |
| `GET /auditoria` | Forma `auditoria` (`ip_mascarado`). Filtros `acao` (prefixo), `usuario_id`, `de`, `ate`, `busca` |

A prévia de mensagem já vem resumida e sem dado sensível; a tela não recebe o texto completo na lista.

---

## 6. G5 — API oficial v1 (integradores)

Especificação: `docs/openapi-v1.yaml`. Resumo:

| Rota | |
|---|---|
| `POST /v1/mensagens` | Cabeçalhos: `Authorization: Bearer`, **`Idempotency-Key` obrigatório** (24 h), `X-Correlation-Id` opcional. Corpo `{ canal, para, tipo, texto?, legenda?, arquivo?: { nome, mime, base64 \| url \| midia_id }, metadados? }`. Resposta **202** `{ id, estado: 'aceita', canal, criada_em, correlacao_id, aviso }` |
| `GET /v1/mensagens/:id` | `{ id, estado, canal, para_mascarado, tipo, correlacao_id, criada_em, atualizada_em, historico_estados }` |
| `GET /v1/canais/:id/estado` | `{ id, estado, estado_desde, capacidades }` |
| `GET /v1/eventos?depois=<cursor>` | Recuperar o que o webhook não entregou: `{ itens, proximo_cursor, tem_mais }` |

* Mesma chave + mesmo corpo → mesma resposta (`Idempotent-Replayed: true`). Mesma chave + outro corpo → 409 `idempotencia_conflito`.
* **C3 (26/11), como está no servidor real:**
  - Token `Authorization: Bearer tk_live_…` da tela Aplicações. Escopos: `mensagens:enviar` (POST), `mensagens:ler` (GET mensagem), `canais:ler` (estado do canal). O canal precisa estar em `canais_autorizados` da aplicação **e** a empresa da aplicação precisa usar o canal → senão 403 `canal_nao_autorizado`.
  - **Só texto** por enquanto (até 4096 caracteres); outro `tipo` → 422 `recurso_nao_suportado`. `GET /canais/:id/estado` devolve as capacidades **reais de envio** (imagem/documento/áudio `false` até a C3b) e `envio_habilitado`.
  - Envio desligado no canal → 422 `envio_desligado`. Canal parado → 422 `canal_desconectado`. Canal ligado mas reconectando → aceita e espera na fila (`aguardando`); sem sair em 24 h → `falhou`.
  - Canal em modo de teste: só os números da lista → senão 403 `sem_permissao` (`campos.para`).
  - `X-Correlation-Id` (até 128) vira `correlacao_id`. `metadados`: objeto JSON até 4 KB.
  - Limite: 120 pedidos/min **por aplicação** (`X-RateLimit-*`, 429 + `Retry-After`).
  - Ritmo de saída por canal: uma mensagem por vez, 3 a 5 s entre elas (protege o número no WhatsApp Web). Resultado incerto → `desconhecida` (nunca reenviada sozinha; recibo posterior do WhatsApp corrige para enviada/entregue/lida).
* Tela (sessão): `GET /mensagens` (filtros do §5), `GET /mensagens/:id`, `POST /mensagens/:id/reenviar` (`falhou`/`desconhecida`), `POST /mensagens/:id/dar-como-falha` (só `desconhecida`), `GET /painel`. Socket: `painel:assinar` entra na sala do **painel da própria empresa**; `mensagem:estado` vai para a sala do canal e do painel da empresa dona da mensagem.
* Limites: cabeçalhos `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; acima → 429 + `Retry-After`.
* Texto formatado: marcação do WhatsApp (`*negrito*`, `_itálico_`, `~riscado~`, ` ```mono``` `). Recurso que o canal não tem → 422 `recurso_nao_suportado` (sem converter nem trocar de canal).

### Webhooks do Talk para o consumidor

```
POST <url da aplicação>
Content-Type: application/json
X-Talk-Evento-Id: evt_…
X-Talk-Timestamp: 1764072000
X-Talk-Assinatura: sha256=<hex>      HMAC-SHA256(segredo, "1764072000.<corpo cru>")

{ "id": "evt_…", "tipo": "mensagem.estado_alterado", "em": "…", "dados": { "mensagem_id": "msg_…", "estado": "lida", "correlacao_id": "…" } }
```

Tipos: `mensagem.recebida`, `mensagem.estado_alterado`, `canal.estado_alterado`, `conversa.responsavel_alterado`.
Garantia **pelo menos uma vez**: deduplicar por `X-Talk-Evento-Id`. Rejeitar timestamp com mais de 300 s. Responder 2xx em até 10 s.
Novas tentativas: 1 min, 5 min, 15 min, 1 h, 3 h, 6 h (até 24 h), depois `esgotado`; ficam em `GET /v1/eventos` por 7 dias.
Ordem garantida só dentro da mesma conversa.

---

## 7. Provedor (interface interna, G6)

`backend/provedores/interface.js`: `ProvedorBase` (EventEmitter), `capacidades()`,
`iniciar()`, `parar()`, `estado()`, `enviar(envelope)`, `processarWebhook({ cabecalhos, rawBody })`.
Capacidades: `texto, formatacao, imagem, documento, audio, video, grupos, modelos, janela_24h, recibos { enviada, entregue, lida }, qr, max_midia_bytes, mimes_aceitos`.
Erros de envio: `ErroProvedor(tipo: temporario|permanente|desconhecido, codigo, mensagem)`.
Detalhes e regras da Meta: `docs/guia-antigravity.md` §5.

---

## 8. C8 — Atendimento (Fase 2): setores, conversas e fila

Combinado em 27/11/2026. Decisões do usuário: opções A e B; setor padrão por número;
distribuição manual; mensagem de fora do horário por setor, publicada desligada; setores
cadastrados pelo administrador da empresa e pela supervisão.

Servidor simulado: `backend/simulado/atendimento.js`.
Servidor real:
- C9: conversas e roteador.
- C10: setores e fila.
- C11: responder e mídia.

### 8.1 Uso do número (canal)

| Campo do canal | Valores |
|---|---|
| `uso` | `integracao` (padrão; Fase 1: só API, as mensagens recebidas não viram conversa) · `atendimento` (opção A: quem escreve vira conversa) · `compartilhado` (opção B: o número também é do IA Command; quem está autorizado no IA Command fica com ele, os demais viram conversa no Talk) |
| `atendimento` | `null` ou `{ empresa: { id, nome }, setor_padrao: { id, nome } }`. **Uma** empresa atende o número, e só ela vê as conversas, mesmo que outras empresas estejam vinculadas ao canal |

`PUT /canais/:id` aceita três campos:

| Campo | Regra | Quem pode mudar |
|---|---|---|
| `uso` | um dos valores acima | só a administração da plataforma |
| `atendimento_empresa_id` | empresa vinculada ao canal; padrão: a dona | só a administração da plataforma |
| `setor_padrao_id` | setor ativo da empresa que atende; obrigatório quando `uso` ≠ `integracao` | a plataforma ou quem tem `talk-setores` na empresa que atende |

* Cada mudança fica na auditoria como `canal.uso`.
* `recebimento_modo` continua valendo: em `teste`, só os números da lista viram conversa.
* `envio_modo` vale também para as respostas.
* **`compartilhado` (C9 parte 2, 27/11/2026):** a cada mensagem, o Talk pergunta ao IA Command (rota interna, 127.0.0.1 + segredo) se ela é dele. Só grava se a pessoa **não** é autorizada no IA Command ou está em atendimento humano. Se o IA Command não responde, não tem o número cadastrado ou está com a chave do canal desligada, o Talk **não grava** e avisa no Terminal (no máximo 1 vez a cada 10 min). A chave fica no IA Command (tela de canais: "Quem não está autorizado"), nasce **desligada**, e com ela desligada o IA Command funciona exatamente como antes.
* **"Estou vivo" (27/11, auditoria 2):** o Talk avisa o IA Command a cada minuto, por número compartilhado conectado. Sem sinal há mais de 3 min, o IA Command responde **como sempre**, mesmo com a chave ligada: ninguém fica sem resposta com o Talk parado. Quem estava em atendimento volta ao assistente, e quem pede "atendente" recebe "O atendimento com a equipe não está disponível agora…".
* **Decisão por mensagem:** o IA Command registra atomicamente o dono no seu banco por canal, telefone e ID da mensagem. O Talk guarda uma cópia pendente antes de consultar e só exibe a mensagem se o dono for o Talk; se o dono for o assistente, descarta a cópia. Após 8 s sem decisão, o IA Command registra a decisão pelo assistente. Pendentes são retomados no início e a cada minuto por até 30 minutos; após isso, permanecem guardados e geram aviso para análise.
* **Reconciliação:** ao iniciar e a cada 5 min, o Talk tenta sincronizar conversas abertas com atividade em 4 h e encerradas em 24 h, sem enviar mensagem automática. A sincronização preserva a hora real da atividade e o retorno explícito ao assistente; a fila é por pessoa no número.
* **Passagem:** a rota interna `talk/decisao` registra ou lê o dono antes da entrega. Um pedido de atendente usa a mesma decisão. Uma resposta perdida é consultada novamente pela fila persistente.
* **Marcar e desmarcar** (Talk → IA Command): fila por conversa, na ordem em que aconteceram, com 3 tentativas. Se falhar, fica um evento na conversa e um aviso no Terminal.
* **Remetente sem telefone** (código interno do WhatsApp não resolvido): sai do provedor como `de.tipo: 'lid'` e **nunca** vira conversa.
* **Dono de cada mensagem (27/11, protocolo final):** uma linha por mensagem no banco do IA Command (`talk_decisoes_mensagem`): canal, número e **ID final da mensagem** (`msg.id.id`, igual nas duas cópias; o `_serialized` traz o remetente e **nunca** é usado). Quem grava primeiro ganha, e os dois lados só agem depois de ler o dono. Sem ID final, não há decisão: o Talk não grava e o IA Command responde como sempre. O ID final aparece no log dos dois lados (6 últimos caracteres), para a conferência nos aparelhos reais antes de ligar a chave.
* **Banco falhando ao gravar o dono:** 3 tentativas, além da espera do SQLite. Sem conseguir, o IA Command responde como sempre e registra **erro** no monitor. É o único caso conhecido de resposta em dobro: risco aceito, nunca mensagem perdida.
* **Retomada pelo Talk:** se o assistente ficou com a mensagem de quem **não é autorizado** e não respondeu em 3 min (caiu antes do aviso), o Talk assume. Até lá a mensagem fica pendente, sem aparecer ao atendente. Pergunta de usuário do ERP nunca é assumida pelo Talk.
* **Passagem para o atendimento:** a pessoa autorizada escreve uma palavra fixa (`atendente`, `falar com atendente`…; a mensagem inteira) e o assistente avisa e fica em silêncio para ela. Ela volta ao assistente quando: o Talk encerra a conversa (o Talk manda "O atendimento foi encerrado. O assistente voltou a responder por aqui."), ela escreve `voltar ao assistente`, ou passam 4 h sem mensagem. Quando o Talk abre ou responde uma conversa com uma pessoa autorizada (chamado, resposta do atendente), marca o atendimento no IA Command, para a resposta dela ir ao atendente.
* Estes campos são aditivos: entram em `FORMAS.canal` quando o servidor real os tiver (C9).

### 8.2 Rotinas e quem vê o quê

| Rotina | Tela | Papéis |
|---|---|---|
| `talk-atendimento` | Central de atendimento (conversas, contatos) | admin_empresa, supervisor, atendente |
| `talk-setores` | Setores e respostas rápidas (cadastro) | admin_empresa, supervisor |

* **Atendente:** vê as conversas dos setores de que é membro e as que estão com ele. Conversa fora disso → **404** (nunca 403).
* **Supervisor e administrador da empresa:** veem todas as conversas da empresa.
* **Setores e respostas rápidas:** ler pede `talk-atendimento` ou `talk-setores`; criar e alterar pede `talk-setores`.
* **IA Gestão (IAHub › Permissões):** as duas rotinas entram na lista do IA Talk quando os menus forem publicados (C9).

### 8.3 Setores e respostas rápidas

| Rota | Detalhe |
|---|---|
| `GET /setores` | Forma `setor`. Filtros `situacao` (`ativo`\|`inativo`) e `busca` (nome, descrição) |
| `GET /setores/:id` | Forma `setor` |
| `POST /setores` | `{ nome, codigo?, descricao?, membros?: [usuario_id], horario?, fora_horario? }` → 201. `nome` de 1 a 60 caracteres, único na empresa (repetido → 409). `codigo`: 2 a 30 caracteres `a-z0-9-`, único (→ 409); sem ele, nasce do nome (`Fiscal e Tributos` → `fiscal-e-tributos`). `descricao` até 200 |
| `PUT /setores/:id` | `{ versao, nome?, descricao?, membros?, horario?, fora_horario?, situacao? }`. **O `codigo` não muda depois de criado** (→ 400), porque os sistemas de origem usam ele. Versão antiga → 409. Setor não é excluído: é inativado. Inativar setor com conversa aberta, ou que seja setor padrão de um canal → 409, e a mensagem diz o que fazer |
| `GET /respostas-rapidas` | Forma `respostaRapida`. Com `setor_id`, devolve as gerais (`setor: null`) **mais** as daquele setor, que é o que a Central oferece ao digitar `/`. Filtros `situacao` (`ativa`\|`inativa`) e `busca` |
| `POST /respostas-rapidas` | `{ atalho, titulo, texto, setor_id? }` → 201. `atalho`: `/` seguido de 2 a 30 caracteres `a-z0-9-`, único (repetido → 409). `titulo` até 60, `texto` até 1000 |
| `PUT /respostas-rapidas/:id` | Campos parciais e `situacao`. Resposta rápida não é excluída: é inativada |

Campos do `setor`:
- `membros: [{ id, nome }]`: usuários ativos.
- `horario: { ligado, fuso: 'America/Cuiaba', dias: [{ dia, inicio: 'HH:MM', fim: 'HH:MM' }] }`, com `dia` de 0 (domingo) a 6.
- `fora_horario: { ligado, texto }`: texto até 1000 caracteres; nasce **desligado**.
- `conversas_abertas`, `na_fila`, `versao`.

O texto da resposta rápida aceita `{nome_contato}` e `{nome_atendente}`. **A tela** faz a troca antes de enviar; o servidor envia o texto como recebeu.

### 8.4 Conversas

**Listas e leitura**

| Rota | Detalhe |
|---|---|
| `GET /conversas` | Forma `conversaResumo`. `visao`: `minhas` \| `fila` \| `abertas` (padrão) \| `encerradas` \| `todas`. Filtros: `setor_id`, `canal_id`, `contato_id`, `responsavel_id` (`nenhum` = sem responsável), `etiqueta` e `busca` (nome do contato, protocolo, prévia; com 4 ou mais dígitos, procura no final do telefone). Ordem padrão: na `fila`, prioridade `alta` primeiro e, dentro de cada prioridade, por `aguardando_desde` (quem espera há mais tempo vem primeiro); nas demais, por `atualizada_em`, da mais recente para a mais antiga |
| `GET /conversas/contadores` | Forma `contadoresAtendimento`: `minhas`, `fila`, `abertas` e `por_setor: [{ id, nome, abertas, na_fila }]`, só com os setores que a pessoa vê |
| `GET /conversas/:id` | Forma `conversaDetalhe`. Além do resumo: `contato` completo (forma `contato`), `motivo_encerramento` e `envio: { pode_responder, motivo, limite_caracteres }`. Quando não é possível responder, `motivo` explica em pt-BR (encerrada, com outra pessoa, envio desligado, canal desconectado, só números de teste); a tela desabilita o campo e mostra o motivo |
| `GET /conversas/:id/itens` | Página de `itemConversa`, **da mais recente para a mais antiga** (a tela inverte). Filtro `categoria` (vários valores com `\|`) |

**Ações**

| Rota | Detalhe |
|---|---|
| `POST /conversas/:id/assumir` | Conversa da fila passa a ser sua. Se já é sua → 200 sem mudar nada. Se está com outra pessoa → **409** (`"Bruno Lima já assumiu esta conversa."`). Assim, se dois atendentes clicam juntos, só um fica com ela |
| `POST /conversas/:id/devolver` | Volta para a fila do setor. Pode o responsável ou a supervisão |
| `POST /conversas/:id/transferir` | `{ setor_id?, responsavel_id?, nota? }`, com pelo menos um dos dois primeiros. Só setor → vai para a fila dele. Pessoa → precisa ser membro do setor de destino (senão 400 em `campos.responsavel_id`). `nota` vira nota interna. Auditoria `conversa.transferida` |
| `POST /conversas/:id/encerrar` | `{ motivo? }`, até 200 caracteres. Zera `nao_lidas` |
| `POST /conversas/:id/reabrir` | Só para conversa encerrada, e só se o contato não tiver outra aberta no mesmo canal (senão 409 com `detalhe.conversa_id`). Volta com você como responsável |
| `POST /conversas/:id/marcar-lida` | Zera `nao_lidas` |
| `PUT /conversas/:id/etiquetas` | `{ etiquetas: [texto] }`: até 10, com até 30 caracteres cada. Substitui a lista inteira |
| `POST /conversas/:id/notas` | `{ texto }` até 2000 caracteres → 201 `itemConversa` com `categoria: 'nota'`. **Nunca vai para o contato** |
| `POST /conversas/:id/responder` | `{ texto }` de 1 a 4096 caracteres → **202** `itemConversa` com `estado: 'aceita'` e `mensagem_id`. Detalhes abaixo |

`POST /conversas/:id/responder`:
- Passa pela fila de saída da C3, com os mesmos estados e o mesmo ritmo.
- Responder uma conversa da fila já faz você assumi-la.

| Situação | Resposta |
|---|---|
| Conversa encerrada ou com outra pessoa | 409 |
| Envio desligado no canal | 422 `envio_desligado` |
| Canal parado | 422 `canal_desconectado` |
| Contato fora da lista de teste | 403 `sem_permissao` |

Envio de mídia: C11.

**Contatos**

| Rota | Detalhe |
|---|---|
| `GET /contatos/:id` | Forma `contato`. O atendente só vê contato de conversa que ele vê. Histórico do contato: `GET /conversas?contato_id=…&visao=todas` |
| `PUT /contatos/:id` | `{ nome }` de 1 a 80 caracteres. O nome que vem do WhatsApp fica guardado em `nome_whatsapp` |

Campos do `conversaResumo`:

| Campo | Conteúdo |
|---|---|
| `protocolo` | número de exibição, ex.: `2026-000123` |
| `canal` | `{ id, nome }` |
| `contato` | `{ id, nome, telefone_mascarado }` |
| `setor` | `{ id, nome }` |
| `responsavel` | `{ id, nome }` ou `null` |
| `situacao` | `aberta` \| `encerrada` |
| `na_fila` | conversa aberta e sem responsável |
| `nao_lidas` | número de mensagens não lidas |
| `ultima_mensagem` | `{ previa, direcao, autor_tipo, em }` ou `null` |
| `aguardando_desde` | hora da 1ª mensagem do contato ainda sem resposta; `null` se já respondida. Numa conversa aberta pelo sistema de origem que ninguém respondeu, é a hora de abertura. É a base do tempo de espera |
| `etiquetas` | lista de textos |
| `prioridade` | `normal` ou `alta` |
| `referencias` | chamados ligados à conversa: `[{ sistema, id, titulo, link, aplicacao { id, nome } }]` (§8.9) |

Campos do `itemConversa`:

| Campo | Conteúdo |
|---|---|
| `categoria` | `mensagem` \| `nota` \| `evento` |
| `direcao` | `entrada` \| `saida` \| `null` |
| `autor` | `{ tipo, id, nome }`, com `tipo` = `contato` \| `atendente` \| `sistema` \| `ia` |
| `tipo` | texto ou mídia; só em mensagem |
| `texto` | conteúdo do item |
| `estado` | saída: os estados do §2; entrada: `recebida`; nota e evento: `null` |
| `mensagem_id` | a mesma do Histórico de mensagens; pode ser `null` em itens antigos |
| `em` | data e hora |

Os eventos do sistema (`categoria: 'evento'`) registram a história da conversa: aberta no setor, assumida, transferida, devolvida, encerrada, reaberta.

### 8.5 Socket.IO (Central)

| Direção | Evento | Corpo |
|---|---|---|
| cliente → servidor | `atendimento:assinar` | `{}`. Recebe `atendimento:contadores` na hora |
| cliente → servidor | `conversa:assinar` / `conversa:sair` | `{ conversa_id }`. Conversa que a pessoa não vê → `erro` `nao_encontrado` |
| servidor → cliente | `atendimento:contadores` | forma `contadoresAtendimento` |
| servidor → cliente | `conversa:atualizada` | forma `conversaResumo`. Vai quando a conversa é nova, muda de dono ou de setor, ou recebe mensagem |
| servidor → cliente | `conversa:saiu` | `{ id }`. A conversa deixou de ser visível para quem recebe (ex.: transferida para um setor de que a pessoa não é membro) |
| servidor → cliente | `conversa:item` | `{ conversa_id, item }`, só na sala da conversa |
| servidor → cliente | `conversa:item_estado` | `{ conversa_id, item_id, estado, em }` |

* No servidor real, cada aviso vai **só a quem pode ver** a conversa, por salas de setor e de pessoa.
* Como nas outras telas, o estado inicial vem pela API e o socket só atualiza. Sem socket, a tela consulta a cada 5 s.

### 8.6 Regras de entrada (C9, servidor real)

* **Contato sem conversa aberta naquele canal:** nasce uma conversa nova no setor padrão do canal, na fila.
* **Contato com conversa aberta:** a mensagem entra nela e `nao_lidas` aumenta em 1.
* **Conversa encerrada não reabre sozinha:** uma nova mensagem abre uma conversa nova, com protocolo novo. O histórico do contato liga as duas.
* **Grupos, status e listas de transmissão** não viram conversa.
* **Fora do horário do setor, com `fora_horario.ligado`:** sai **uma** mensagem automática por conversa a cada 12 h (item com `autor.tipo: 'sistema'`), respeitando `envio_modo`. Nenhuma outra mensagem é enviada sozinha.
* **Número `compartilhado`:** os números autorizados no IA Command continuam com ele, e o Talk não grava essas conversas. Os demais viram conversa.

### 8.7 Privacidade

* O texto das conversas fica no banco do Talk, porque ele é o atendimento. **Nunca vai para o log**, nem do canal nem do servidor.
* O texto só sai para quem pode ver a conversa: em `GET /conversas/:id/itens`, em `conversa:item` e no detalhe da mensagem.
* O telefone sai sempre mascarado. A busca usa o final do número (4 ou mais dígitos).
* **Guarda do texto (decidido em 27/11/2026):** parâmetro por empresa na IA Gestão com os dias de guarda do texto das conversas encerradas. **Vazio = não apaga nada.** A limpeza só roda quando o parâmetro tiver valor (C9).

### 8.8 Simulado

* **Dados da J2A:**
  - 3 setores: Suporte, Financeiro e Comercial;
  - 8 contatos;
  - 9 conversas: 3 na fila, 3 com responsável e 3 encerradas;
  - 5 respostas rápidas.

  O canal `cn_suporte` está em `compartilhado`, com o Suporte como setor padrão.
* **Números de teste:** Mariana e João usam números da lista de teste do `cn_suporte`. Só para eles a resposta sai; nas demais conversas aparece o motivo.
* **Visão de atendente:** com `?simular=atendente` (ou o cabeçalho `X-Talk-Simular: atendente`), o simulado responde como Carla Souza, atendente do Suporte.
* **Mensagem chegando:** `POST /simulado/receber { contato_id?, texto? }` simula uma mensagem do contato (essa rota só existe no simulado). Além disso, chega uma mensagem sozinha a cada 25 s.
* **Teste de falha:** uma resposta com a palavra "falha" termina no estado `falhou`.
* **Sistema de origem (§8.9):**
  - na API v1, qualquer token `tk_teste_…` fala como a aplicação "SoftExpert (simulado)";
  - as conversas da Mariana (chamado 036988) e do João (036990, prioridade alta) vieram de chamados;
  - há 2 retornos pendentes e 1 já confirmado.

### 8.9 API v1 do sistema de origem (chamado → fila, retornos com confirmação)

Decisões de 27/11/2026:
- Quem chama o Talk é o **sistema de origem** (ex.: SoftExpert), direto. O IA Service não entra nesta integração.
- O Talk **não manda a primeira mensagem** por padrão: o chamado entra na fila e o atendente decide quando escrever.
- O retorno fica guardado no Talk até o sistema de origem **buscar e confirmar** ("OK"). Só então sai da fila de retornos.

**Autenticação e escopos.** Mesmo token da API v1: `Authorization: Bearer tk_live_…`, criado na tela Aplicações. São dois escopos novos:
- `conversas:criar`: `POST /v1/conversas`;
- `conversas:ler`: `GET /v1/conversas`, `GET /v1/retornos` e `POST /v1/retornos/confirmar`.

O canal precisa estar em `canais_autorizados` da aplicação e ter `uso` ≠ `integracao`; senão → 422 `recurso_nao_suportado`. A tela Aplicações ainda precisa mostrar os dois escopos novos.

| Rota | Detalhe |
|---|---|
| `POST /v1/conversas` | Abre (ou acha) a conversa do chamado. Corpo abaixo |
| `GET /v1/conversas/:id` | Forma `v1Conversa`. Só conversa com chamado **desta** aplicação; as demais → 404 |
| `GET /v1/conversas?referencia=softexpert:036988` | Página de `v1Conversa` daquele chamado: a aberta e as anteriores, se ele já voltou à fila. Filtro `situacao` |
| `GET /v1/retornos?limite=50&tipo=` | Retornos **ainda não confirmados** desta aplicação, do mais antigo para o mais novo: `{ itens: [v1Retorno], tem_mais }`. `limite` de 1 a 200 |
| `POST /v1/retornos/confirmar` | `{ ids: [rt_…] }`, de 1 a 200 → `{ confirmados, desconhecidos }`. Confirmar de novo não muda nada |

**Corpo de `POST /v1/conversas`:**

```json
{ "canal": "cn_…",
  "contato": { "telefone": "5565999990000", "nome": "Mariana Oliveira" },
  "referencia": { "sistema": "softexpert", "id": "036988", "titulo": "Relatório lento", "link": "https://…/036988" },
  "setor": "suporte",
  "prioridade": "alta",
  "contexto": "Descrição do chamado…",
  "mensagem_inicial": "Olá, Mariana! …" }
```

| Campo | Regra |
|---|---|
| `contato.telefone` | obrigatório; só dígitos, com DDI e DDD (12 ou 13 dígitos) |
| `contato.nome` | opcional; até 80 caracteres |
| `referencia.sistema` | obrigatório; 2 a 30 caracteres `a-z0-9-` |
| `referencia.id` | obrigatório; até 64 caracteres |
| `referencia.titulo` | opcional; até 200 caracteres |
| `referencia.link` | opcional; precisa começar com `https://` |
| `setor` | opcional; o **código** do setor (§8.3). Sem ele, vai para o setor padrão do canal |
| `prioridade` | opcional; `normal` (padrão) ou `alta`. Alta passa na frente na fila |
| `contexto` | opcional; até 4000 caracteres. Vira **nota interna** com `autor.tipo: 'sistema'` e nunca vai ao contato |
| `mensagem_inicial` | opcional; até 4096 caracteres. Ver abaixo |

`Idempotency-Key` é opcional nesta rota: a própria referência do chamado já evita duplicar.

**O que acontece no `POST /v1/conversas`**, campo `resultado` da resposta:

| Situação | `resultado` | HTTP |
|---|---|---|
| O chamado já tem conversa **aberta** | `existente`: devolve a mesma, com `Idempotent-Replayed: true`. Reenviar é seguro | 200 |
| O contato já está em conversa aberta naquele número | `vinculada`: o chamado entra nela, com o evento "Chamado … vinculado". O `setor` pedido só vale para conversa nova | 200 |
| Nenhum dos dois casos acima, inclusive chamado reenviado depois de encerrado | `criada`: conversa nova, na fila do setor | 201 |

**`mensagem_inicial`:**
- Só é enviada em conversa `criada`, e respeita as regras do canal (`envio_modo`, lista de teste, canal conectado).
- Se não puder sair, a conversa fica na fila do mesmo jeito e a resposta diz por quê.
- Campo da resposta: `mensagem_inicial: null | { estado: 'aceita' | 'nao_enviada', motivo, item_id }`.

**Forma `v1Conversa`:**

| Campo | Conteúdo |
|---|---|
| `id`, `protocolo`, `situacao`, `na_fila` | identificação e situação da conversa |
| `canal` | id do canal |
| `setor` | `{ codigo, nome }` |
| `responsavel` | `{ id, nome }` ou `null` |
| `prioridade` | `normal` ou `alta` |
| `referencias` | só as desta aplicação: `[{ sistema, id, titulo, link }]` |
| `aberta_em`, `atualizada_em`, `encerrada_em`, `motivo_encerramento` | datas e motivo |
| `link` | endereço da conversa na Central |

O telefone nunca volta, nem mascarado.

**Forma `v1Retorno`:** `{ id, tipo, em, conversa: { id, protocolo, situacao }, referencias, dados }`.

| `tipo` | `dados` |
|---|---|
| `conversa.criada` / `conversa.vinculada` | `{ setor { codigo, nome }, na_fila, referencia { sistema, id } }` |
| `conversa.assumida` | `{ responsavel { id, nome } }` |
| `conversa.transferida` | `{ setor, responsavel \| null }` |
| `conversa.devolvida` | `{ setor }` |
| `conversa.encerrada` | `{ motivo, responsavel, encerrada_em }` |
| `conversa.reaberta` | `{ responsavel }` |

**Regras dos retornos:**
- Um retorno por aplicação que tem chamado ligado à conversa. Cada sistema só vê os seus, e conversa sem chamado não gera retorno.
- **Pelo menos uma vez:** o mesmo retorno volta em todo `GET` até ser confirmado. O sistema de origem processa, chama `confirmar` e só então o retorno sai da fila.
- Use o `id` do retorno para não gravar duas vezes.
- Retorno sem confirmação por 30 dias vence e aparece como pendência no Painel (C9).
- Webhook (C4) poderá avisar que há retorno novo, mas a confirmação continua sendo pelo `POST /v1/retornos/confirmar`.

---

## 9. C10 — Onda 1: atendimento profissional

Plano: `docs/plano-produto.md`. Tudo **nasce desligado** e liga por configuração do setor ou do canal.
Simulado: `backend/simulado/atendimento.js` + `backend/simulado/atendimento-onda1.js`.
Servidor real: C11 a C16. Bibliotecas puras: X1 a X4 (Codex).

### 9.1 Portal do atendente

| Item | Regra |
|---|---|
| URL | `/app/ia-talk/<apelido>/atendimento`, uma por empresa, pelo mesmo apelido da página de entrada. Serve `frontend/portal.html` (G15) |
| Sem sessão (ou sessão de outra empresa) | Redireciona para `/app/ia-talk/<apelido>?destino=atendimento`. Depois do código, o login devolve `redirecionar` para o portal |
| Login | O mesmo: celular + código no WhatsApp (`/api/publico`, §3.1). `POST …/verificar` aceita `destino: 'atendimento'` |
| Quem entra | Quem tem a rotina `talk-atendimento` naquela empresa. Sem ela → página "Sem acesso ao atendimento" |
| API | A mesma do §8 (`/api/admin`), com o cookie da sessão |

O portal é a Central em tela cheia, sem o menu de administração. Funciona no celular, com som,
notificação do navegador e contador no título da aba. O link "Abrir a administração" só aparece
para quem tem outras rotinas.

### 9.2 Status do atendente (presença)

| Rota | Detalhe |
|---|---|
| `GET /atendentes/eu` | Forma `atendente` da pessoa da sessão |
| `PUT /atendentes/eu` | `{ status?, alertas_whatsapp? }`. `status` ∈ `disponivel` \| `ocupado` \| `ausente` |
| `GET /atendentes?setor_id=` | Página de `atendente` (supervisão e quem cadastra setores; atendente → 403) |

Forma `atendente`:

| Campo | Conteúdo |
|---|---|
| `usuario` | `{ id, nome }` |
| `status` | `disponivel`, `ocupado` ou `ausente` |
| `online` | Tem a Central aberta agora (socket conectado) |
| `conversas_abertas` | Conversas abertas com ele |
| `limite` | Maior limite entre os setores dele (rodízio) |
| `setores` | `[{ id, nome }]` |
| `alertas_whatsapp` | Recebe alerta no WhatsApp (escolha da pessoa) |
| `status_desde` | Desde quando está no status atual |

- Só recebe conversa no rodízio quem está **disponível e online**.
- **Ocupado:** vê a fila, mas não recebe rodízio nem alerta de "nova na fila".
- **Ausente:** não recebe nada.
- Fechar a Central não muda o status; só muda `online`.
- Socket: `presenca:atualizada` `{ usuario_id, status, online, em }`, vai para a sala do atendimento da empresa.

### 9.3 Menu de setores no WhatsApp (triagem)

**No setor**, campo novo `menu`:
- `aparece` (bool, padrão `true`);
- `ordem` (inteiro);
- `texto` (opcional; até 60 caracteres; sem ele, usa o nome do setor).

**No canal**, campos novos no `PUT /canais/:id`, com a mesma permissão do uso do número:

| Campo | Regra |
|---|---|
| `menu_ligado` | Bool, padrão `false` |
| `menu_saudacao` | Até 500 caracteres; padrão: "Olá! Para agilizar seu atendimento, escolha o setor:" |
| `menu_tempo_min` | 1 a 60, padrão 10 |
| `menu_tentativas` | 1 a 5, padrão 2 |

O canal devolve `atendimento.menu: { ligado, saudacao, tempo_min, tentativas }`.

**Como funciona:**
- Com o menu ligado, a **conversa nova** nasce em **triagem**, fora da fila de qualquer setor. O Talk manda o menu, que é um item de saída com `autor.tipo: 'sistema'`.
- **Resposta válida** (número ou nome da opção): a conversa vai para a fila do setor escolhido, com o evento "Escolheu o setor X".
- **Resposta inválida:** o menu é repetido, até `menu_tentativas` vezes. Depois disso, ou se passar `menu_tempo_min` sem resposta, a conversa vai para o **setor padrão** do canal, com o evento "Sem escolha: setor padrão".
- Com **um setor só** no menu, o menu não é mandado e a conversa vai direto para ele.
- **Pedido de "atendente"** de um usuário do IA Command (número compartilhado): também passa pelo menu.

**Na conversa:**
- `triagem`: `{ desde, tentativas } | null`;
- visão nova `triagem` em `GET /conversas` (supervisão);
- contador `triagem` em `GET /conversas/contadores`.

A leitura da resposta vem da biblioteca X1 (`backend/lib/menu-setores`). A regra principal: **nunca escolher o setor por adivinhação**.

### 9.4 Distribuição no setor

**No setor**, campo novo `distribuicao`:
- `modo`: `fila_livre` (padrão) ou `rodizio`;
- `limite_por_atendente`: 1 a 50, padrão 5;
- `tempo_aceite_min`: 1 a 30, padrão 3.

**Fila livre (como hoje):** todos os disponíveis do setor são avisados, e o primeiro que **assumir** fica com a conversa.

**Rodízio:**
- O sistema **oferece** a conversa a um atendente: disponível, online, membro do setor e abaixo do limite.
- O critério é **menos conversas abertas**; no empate, quem recebeu há mais tempo (biblioteca X2).
- A conversa ganha `oferta: { para: { id, nome }, ate }`.
- Só essa pessoa (ou a supervisão) pode assumir. Assumir **aceita** a oferta.
- `POST /conversas/:id/recusar` (só quem recebeu a oferta) passa para o próximo.
- Se o tempo de aceite acabar, ou ninguém estiver apto, a conversa fica na fila do setor sem oferta, e o setor inteiro é avisado.

**Eventos na conversa:** "Oferecida a Fulana", "Fulana recusou" e "Sem aceite: voltou para a fila".

### 9.5 Alertas

**Na tela:** evento de socket `alerta`, só para a pessoa certa (sala por usuário). O alerta **nunca** traz texto do cliente.

```json
{ "id": "alr_…", "tipo": "nova_na_fila | oferta | espera_longa | sla_estourado | escalonamento",
  "conversa_id": "cv_…", "protocolo": "2026-000123", "setor": { "id": "set_…", "nome": "Suporte" },
  "mensagem": "Nova conversa na fila do Suporte (protocolo 2026-000123).", "em": "…" }
```

**Rotas:**
- `GET /alertas?limite=` devolve os da pessoa, mais recentes primeiro, com `lido_em`.
- `POST /alertas/lidos` com `{ ids: [...] }` ou `{ todos: true }`.

**No setor**, campo novo `alertas`:

| Campo | Regra |
|---|---|
| `whatsapp_ligado` | Bool, padrão `false` |
| `espera_min` | 1 a 120, padrão 5 |
| `escalonar_min` | 0 a 240, padrão 15 (0 = não escalona) |
| `escalonar_para` | `[usuario_id]`, padrão a supervisão do setor |

**No WhatsApp do atendente** (só com `whatsapp_ligado` e `alertas_whatsapp` da pessoa), quando:
- ninguém do setor está online;
- a conversa espera mais de `espera_min`;
- há escalonamento, depois de `escalonar_min`, para quem está em `escalonar_para`.

O texto tem protocolo, setor, tempo e link do portal, **sem texto do cliente**.

**Nunca repete:** um alerta por conversa, por tipo e por pessoa. Ninguém recebe alerta estando ausente ou fora do horário do setor. Quem alertar e quando vem da biblioteca X3.

### 9.6 SLA

**No setor**, campo novo `sla`:
- `primeira_resposta_min`: 1 a 1440, padrão 10;
- `atencao_pct`: 50 a 95, padrão 80.

**Na conversa:** `sla: { prazo, situacao: 'ok' | 'atencao' | 'estourado', alvo: 'primeira_resposta' } | null`.
- Vale enquanto ninguém respondeu; depois da primeira resposta do atendente, fica `null`.
- Ao chegar em `atencao` e em `estourado`, gera alerta.

### 9.7 Pesquisa de satisfação

**No setor**, campo novo `pesquisa`:
- `ligada` (padrão `false`);
- `pergunta` (até 300 caracteres); padrão: "Como você avalia este atendimento? Responda de 1 (ruim) a 5 (ótimo)."

**Como funciona:**
- **Ao encerrar,** a pergunta é enviada.
- A resposta do contato em até 24 h, quando é uma nota, é **registrada e não abre conversa nova**. Uma mensagem que não é nota abre conversa nova normalmente.
- A leitura da nota vem da biblioteca X4.

**Na conversa:** `pesquisa: { enviada_em, nota: 1–5 | null, comentario | null, respondida_em } | null`.

### 9.8 Painel ao vivo e relatórios

**`GET /atendimento/painel`** (supervisão) devolve:

| Campo | Conteúdo |
|---|---|
| `por_setor` | `[{ id, nome, na_fila, em_triagem, em_atendimento, maior_espera_ms, atendentes_online, sla_estourados }]` |
| `atendentes` | `[atendente]` |
| `hoje` | `{ conversas, encerradas, primeira_resposta_mediana_ms, satisfacao_media, respostas_pesquisa }` |
| `atualizado_em` | data e hora |

Socket: `atendimento:painel`, com o mesmo corpo, a cada mudança, só para a supervisão.

**`GET /atendimento/relatorio?de&ate&agrupar=setor|responsavel`** devolve:
- `{ periodo, total, abertas, na_fila, encerradas, primeira_resposta, espera_atual, duracao, satisfacao, grupos? }`;
- os campos `primeira_resposta`, `espera_atual` e `duracao` seguem a biblioteca L2;
- `satisfacao` é `{ media, respostas, distribuicao: { 1..5 } }`.
