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
| IDs | Aleatórios com prefixo: `emp_` empresa, `usr_` usuário, `app_` aplicação, `tok_` token, `cn_` canal, `msg_` mensagem, `evt_` evento, `aud_` auditoria, `dsf_` desafio de login. Nunca sequenciais. |
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
| `GET /canais/:id/log` | Página de `{ em, tipo, mensagem }`, mais recente primeiro. `tipo` ∈ `info, success, warning, error, received, sent, system` (mesmas cores do terminal do IA Command) |

Campos extras do canal (C2, aditivos): `modo_teste` (bool), `numeros_teste_mascarados`, `recebidas_descartadas`.
`PUT /canais/:id` aceita `modo_teste` e `numeros_teste` (só administração da plataforma). Em modo de teste, só as
mensagens dos números da lista entram no log/banco; das demais fica só a contagem.
**Número cadastrado (26/11, como no IA Command):** o número sai só mascarado (`numero_mascarado`). Se o QR for lido
por outro número, o Talk sai do WhatsApp (o aparelho some do celular), apaga a sessão, deixa o canal desligado e vai
para `erro` com o motivo no log. Canal antigo sem número recebe o número lido no primeiro pareamento.
Evento extra: `canal:mensagem` `{ canal_id, de_mascarado, tipo, em }` (mensagem aceita no modo de teste).

Canal compartilhado: `empresa_dona` configura; `empresas_vinculadas` usam o
número (como hoje no IA Command). `padrao: true` = canal que envia o código de
login daquela empresa.

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
