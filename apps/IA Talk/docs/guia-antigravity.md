# IA Talk — Guia da trilha do Antigravity

Para quem desenvolve as etapas **G4, G1, G2, G3, G5, A0 e G6** em paralelo
com o Claude Code. Leia antes: `apps/IA Talk/AGENTS.md` (regras) e
`apps/IA Talk/docs/contratos.md` (API congelada).

Ordem da trilha: **G4 → G1 → G2 → G3 → G5 → A0**, e **G6** quando houver número
Meta. Pontos de encontro com o Claude Code: G1↔C1, G2↔C2, G3↔C4.

---

## 1. Quem é dono de cada caminho

Nunca edite um arquivo fora da sua coluna. Precisa mudar algo do outro lado?
Abra a pendência em `docs/andamento.md` e peça.

### Exclusivo do Antigravity

| Caminho | Etapa |
|---|---|
| `apps/IA Talk/backend/lib/midia/**` | G4 |
| `apps/IA Talk/backend/lib/assinatura/**` | G4 |
| `apps/IA Talk/tests/g4-*.test.js` | G4 |
| `apps/IA Talk/frontend/entrar.html` | G1 |
| `apps/IA Talk/frontend/usuarios.html`, `aplicacoes.html`, `configuracoes.html` | G1 |
| `apps/IA Talk/frontend/canais.html` | G2 |
| `apps/IA Talk/frontend/painel.html`, `mensagens.html`, `eventos.html`, `auditoria.html` | G3 |
| `apps/IA Talk/frontend/js/telas/**` (JS próprio de cada tela, se separar do HTML) | G1–G3 |
| `apps/IA Talk/frontend/css/telas/**` (CSS só de uma tela) | G1–G3 |
| `apps/IA Talk/tests/telas/**` (testes de tela/Playwright) | G1–G3 |
| `apps/IA Talk/docs/integrador/**` | G5 |
| `apps/IA Talk/docs/openapi-v1.yaml` | G5 (a partir da G5; até lá, só o Claude Code) |
| `apps/IA Talk/prototipos/**` | A0 |
| `apps/IA Talk/backend/provedores/meta/**` e `apps/IA Talk/tests/provedor-meta*.test.js` | G6 |

### Exclusivo do Claude Code

| Caminho | Por quê |
|---|---|
| `apps/IA Talk/backend/**` exceto as pastas acima | núcleo, rotas reais, segurança, isolamento |
| `apps/IA Talk/backend/database/**` | **migrações: uma só numeração** |
| `apps/IA Talk/backend/contratos/**`, `docs/contratos.md` | contrato congelado (mudança combinada) |
| `apps/IA Talk/backend/simulado/**` | servidor simulado (peça mudança se faltar cenário) |
| `apps/IA Talk/frontend/shell.html`, `frontend/js/talk-*.js`, `frontend/css/talk.css`, `frontend/empresas.html`, `frontend/em-breve.html` | shell, utilitários e tela modelo |
| `apps/IA Talk/AGENTS.md`, `docs/guia-antigravity.md` | regras |
| `apps/IA Talk/tests/*.test.js` exceto `g4-*` e `provedor-meta*` | testes do núcleo |
| **Tudo fora de `apps/IA Talk/`**: IA Command, IA Service, IAHUB, `index.js`, `packages/`, `deploy/`, `data/` | **o Antigravity nunca mexe** |

`docs/andamento.md`: as duas IAs escrevem, cada uma só na linha da própria etapa.

Precisa de algo novo em `talk.css` ou `talk-ui.js`? Coloque primeiro no CSS/JS da
sua tela; se servir para várias telas, peça a promoção no `andamento.md`.

---

## 2. Comandos (rodar na raiz do repositório, `C:\Apps\iahub`)

| O quê | Comando | Endereço |
|---|---|---|
| Servidor simulado (telas, guia, protótipo) | `node "apps/IA Talk/backend/simulado/servidor-simulado.js"` | `http://127.0.0.1:3051/app/ia-talk/` |
| Outra porta | PowerShell: `$env:IA_TALK_SIMULADO_PORT=3061; node "apps/IA Talk/backend/simulado/servidor-simulado.js"` | `http://127.0.0.1:3061/app/ia-talk/` |
| Servidor real (esqueleto, sem login até a C1) | `node "apps/IA Talk/backend/servidor.js"` | `http://127.0.0.1:3050/app/ia-talk/` |
| Testes do IA Talk | `node --test "apps/IA Talk/tests/*.test.js"` | — |
| Só os da G4 | `node --test "apps/IA Talk/tests/g4-*.test.js"` | — |

Não instale dependência. O que existe e pode usar: Express 4, Socket.IO 4 (cliente em
`/app/ia-talk/socket.io/socket.io.js`), Tabulator 6.3.1 (unpkg), `qrcode`, Playwright
(para testes de tela). Qualquer outra → peça antes.

O simulado aceita 3051 por padrão porque 3000 é o IAHub, 3050 o Talk real e 3101+
os workers do WhatsApp.

---

## 3. Contratos

Tudo em `docs/contratos.md`: autenticação e contexto de empresa (§1.1), erros (§1.2),
paginação/filtros/ordenação (§1.3), estados (§2), G1 (§3), G2 + Socket.IO (§4),
G3 (§5), G5 + webhooks (§6), provedor (§7). Formas obrigatórias de cada resposta:
`FORMAS` em `backend/contratos/index.js`.

**Diferenças em relação ao que foi pedido (decisões já tomadas):**
* não há login por e-mail/senha (telefone + código, entrada pelo IAHub, sessão servidor a servidor);
* nomes em pt-BR: estados `qr_pendente`, `conectado`…; erro `{ erro: { codigo, mensagem, campos, detalhe } }` (tabela de equivalência em contratos.md §1.2 e §2);
* ações de canal: `conectar`, `desconectar`, `reconectar`, `novo-qr`, `limpar-sessao` (esta com `{ confirmar: true }`).

---

## 4. Servidor simulado

Dados fictícios em `backend/simulado/dados.js` (4 empresas, 4 usuários, 3 aplicações,
3 canais, 64 mensagens, 24 eventos, 18 registros de auditoria). Nada real.

### Cenários

Cabeçalho `X-Talk-Simular` ou `?simular=` (vários com vírgula). Nas telas, pelo console:

```js
sessionStorage.setItem('talk_simular', 'vazio');        // listas vazias, painel zerado
sessionStorage.setItem('talk_simular', 'lento');        // +1,5 s em toda resposta (ver carregando)
sessionStorage.setItem('talk_simular', 'lento,vazio');
sessionStorage.setItem('talk_simular', '403');          // 400 401 403 404 409 422 429 500
sessionStorage.removeItem('talk_simular');              // volta ao normal
```

O shell mostra uma faixa amarela enquanto houver cenário ativo.

| Necessidade | Como ver |
|---|---|
| Lista vazia / painel zerado | `vazio` |
| Carregando | `lento` |
| Erros 400 (com `campos`), 401, 403, 404, 409, 422, 429 (`Retry-After: 30`), 500 | o código como cenário |
| Erro por campo real | salvar empresa/usuário com campos inválidos ou apelido `j2a` (409) |
| Troca de empresa | botão da empresa no topo do shell (`POST /sessao/empresa`); empresa inativa → 403 |
| QR Code fake | canal **Teste homologação** (`cn_teste`): `GET /canais/cn_teste/qr` e evento `canal:qr`, renovado a cada 20 s |
| Terminal ao vivo | assinar qualquer canal: `canal:log` a cada 2 s |
| Troca de estado ao vivo | canal **Financeiro** alterna `reconectando` ↔ `conectado` a cada ~30 s |
| Painel ao vivo | `painel:assinar` → `painel:atualizado` a cada ~30 s |
| Login | qualquer celular; código `123456`; `?simular=email` = envio pelo e-mail de reserva |
| Token gerado | `POST /aplicacoes/:id/tokens` devolve o token completo uma vez |
| API v1 | `Authorization: Bearer tk_teste_qualquer` |

Faltou cenário? Peça no `andamento.md`; não edite o simulado.

---

## 5. G4 — bibliotecas isoladas (encaixam direto na C3 e na C4)

Assinaturas **congeladas** com JSDoc nos próprios arquivos; testes de contrato prontos
com `todo` — implemente, tire o `todo`, faça passar. Funções puras: sem banco, sem
sessão, sem `require` de fora da pasta além de módulos nativos do Node.

### 5.1 `backend/lib/midia/index.js`

| Função | Entrada | Saída |
|---|---|---|
| `detectarMime(dados)` | `Buffer` | mime pelo conteúdo (magic bytes) ou `null` |
| `validarArquivo(arquivo, regras)` | `{ nome, mime, dados: Buffer }`, `{ mimesAceitos, limiteBytes }` | `{ ok: true, mime, tamanho, nome }` ou `{ ok: false, codigo: 'arquivo_invalido'\|'tipo_nao_suportado'\|'arquivo_grande', mensagem }` |
| `ipBloqueado(ip)` | `string` | `boolean` |
| `baixarUrlSegura(url, opcoes?)` | `{ limiteBytes=16MB, tempoMs=15000, maxRedirecionamentos=3, resolverDns? }` | `Promise<{ dados, mime, nome }>`; erro `ErroMidia(codigo)` |

Tipos e limites da Fase 1 (WhatsApp Web; a C3 passa `regras` a partir das capacidades do canal):

| Tipo | MIME | Extensões | Limite |
|---|---|---|---|
| imagem | `image/png`, `image/jpeg`, `image/webp` | png, jpg, jpeg, webp | 5 MB |
| documento | `application/pdf`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `…wordprocessingml.document`, `…presentationml.presentation`, `text/csv`, `text/plain` | pdf, xlsx, docx, pptx, csv, txt | 16 MB |
| áudio | `audio/ogg`, `audio/mpeg`, `audio/mp4` | ogg, mp3, m4a | 16 MB |
| vídeo | `video/mp4` | mp4 | 16 MB (desligado na Fase 1) |

Base64 na API v1: decodificar em modo estrito (recusar caractere inválido, tamanho
decodificado acima do limite antes de alocar tudo). A extensão do nome só serve para
nome de exibição; o tipo vem do conteúdo. OOXML (xlsx/docx/pptx) é ZIP: conferir o
`[Content_Types].xml` ou o diretório do ZIP para distinguir.

Proteção SSRF de `baixarUrlSegura`: só `https`; resolver DNS e recusar se **qualquer**
endereço for bloqueado; conectar no IP conferido (usar `lookup` fixo no agente); reconferir
a cada redirecionamento; parar ao passar do limite; sem cookies/credenciais; tempo total
limitado. Referência de padrão no repositório (só leitura, não importar): `apps/IA Service/backend/services/safe-web-fetch-service.js`.

### 5.2 `backend/lib/assinatura/index.js`

| Função | Entrada | Saída |
|---|---|---|
| `gerarSegredo()` | — | `whsec_` + 32 bytes base64url |
| `assinar({ segredo, timestamp, corpo })` | `timestamp` em segundos; `corpo` string ou Buffer (o corpo **cru** enviado) | `'sha256=<hex minúsculo>'` de HMAC-SHA256 sobre `` `${timestamp}.${corpo}` `` |
| `verificar({ segredo, timestamp, corpo, assinatura, toleranciaSeg=300, agoraMs })` | | `{ ok: true }` ou `{ ok: false, motivo: 'assinatura_ausente'\|'formato_invalido'\|'timestamp_invalido'\|'timestamp_expirado'\|'assinatura_invalida' }` |
| `verificarAssinaturaMeta({ appSecret, rawBody, cabecalho })` | `rawBody` Buffer; `cabecalho` = `X-Hub-Signature-256` | `boolean` |

Cabeçalhos dos webhooks do Talk: `X-Talk-Evento-Id`, `X-Talk-Timestamp`, `X-Talk-Assinatura`.
Comparação sempre em tempo constante (`crypto.timingSafeEqual`, com checagem de tamanho antes).

---

## 6. G6 — Adaptador Meta Cloud API

Pasta `backend/provedores/meta/`. Estende `ProvedorBase` (`backend/provedores/interface.js`)
e passa em `conferirImplementacao()`.

* `codigo` = `'meta'`. Capacidades: `texto, formatacao:'whatsapp', imagem, documento, audio, video: true`,
  `grupos: false`, **`modelos: true`, `janela_24h: true`**, `recibos { enviada, entregue, lida }: true`,
  `qr: false`, limites por tipo conforme a documentação vigente da Meta (confirmar na época da G6).
* Credenciais por canal (cifradas pelo núcleo; o adaptador só recebe): `phone_number_id`,
  `waba_id`, `token` (System User), `app_secret`, `verify_token`.
* `processarWebhook({ cabecalhos, rawBody })`: **validar `X-Hub-Signature-256` sobre `rawBody`
  com `verificarAssinaturaMeta` antes de qualquer `JSON.parse`**; percorrer **todos** os
  `entry[]` e `changes[]` (o IA Recruit só lia o primeiro); emitir `mensagem` e `status`.
  A verificação GET (`hub.mode`, `hub.verify_token`, `hub.challenge`) é rota do núcleo (C4),
  que chama um método `verificarAssinatura`/`verify_token` do adaptador.
* Fora da janela de 24 h sem `envelope.modelo` → `erro('fora_da_janela_24h', …)` (422). Nunca
  converter em modelo sozinho.
* Erros da Graph API → `ErroProvedor`: 4xx de parâmetro/número = `permanente`; 429/5xx/rede =
  `temporario`; resposta perdida depois de enviar = `desconhecido`.
* Testes só com respostas gravadas/simuladas (nunca chamar a Meta nos testes automáticos).
* Referência de leitura (não copiar): `apps/IA Recruit/backend/whatsapp-curriculo/service-meta.js`.

---

## 7. Padrão de frontend

### Navegação

Mesmo modelo do IA Service e do IA Command: **`shell.html` com menu lateral + abas internas;
cada rotina é uma página HTML própria aberta num `<iframe>`**. Não é SPA. Uma tela =
um arquivo `frontend/<tela>.html`. O menu fica em `frontend/js/talk-sidebar.js` (`MENU`):
ao entregar a tela, peça para trocar `etapa: 'G1'` por `etapa: null` (o item deixa de abrir
`em-breve.html`).

Dentro de uma tela, para abrir outra aba: `window.top.TalkAbas?.abrir(url, rotulo, icone)`.
Links das pendências do painel usam `?id=` / filtros na URL (ex.: `mensagens.html?estado=desconhecida`).

### Cabeçalho de toda tela (copie de `frontend/empresas.html`)

```html
<script src="/app/ia-talk/js/talk-ui.js"></script>          <!-- primeiro: aplica o tema antes de pintar -->
<link rel="stylesheet" href="/app/ia-talk/ui/css/iahub.css"> <!-- packages/ui, servido pelo Talk -->
<link rel="stylesheet" href="https://unpkg.com/tabulator-tables@6.3.1/dist/css/tabulator.min.css"> <!-- se tiver grade -->
<link rel="stylesheet" href="/app/ia-talk/css/talk.css">
…
<script src="https://unpkg.com/tabulator-tables@6.3.1/dist/js/tabulator.min.js"></script>
<script src="/app/ia-talk/ui/js/grid-group-panel.js"></script>  <!-- agrupamento padrão das grades -->
<script src="/app/ia-talk/js/talk-api.js"></script>
<script src="/app/ia-talk/socket.io/socket.io.js"></script>      <!-- só se usar tempo real -->
```

Caminhos sempre absolutos com `/app/ia-talk/`. `<body class="tlk-pagina">` e `<main class="tlk-conteudo">`.

### Organização do JS (sem framework, sem build)

* Um IIFE por tela, no fim do HTML (ou `frontend/js/telas/<tela>.js`).
* Chamadas só por `TalkApi.get/post/put/del` (base, cenário simulado, erro padrão, aviso de sessão vencida).
* Erros: `catch (err)` → `TalkUI.errosNoFormulario(form, err)` para `err.campos`; senão alerta
  no topo do formulário ou `TalkUI.estadoDoErro(el, err, tentarDeNovo)` na lista. `409` = recarregar e avisar.
* Estados: `TalkUI.estado(el, 'carregando'|'vazio'|'erro'|'sem_permissao', …)`. O vazio diz
  **por que** está vazio (sem cadastro × filtro) e oferece a próxima ação.
* Estados de canal/mensagem/entrega: sempre `TalkUI.pill(valor)` (vocabulário único).
* Sempre `TalkUI.esc()` ao montar HTML com dado do servidor.
* Tempo real: carregar pela API, depois `TalkApi.socket()` só para atualizar; sem socket, consultar a API a cada 30 s.
* Datas: `TalkUI.dataHora` / `TalkUI.relativo`. Avisos: `TalkUI.toast(texto, 'ok'|'erro')`.

### Lista + detalhe (referências: Histórico de Interpretações e Jobs)

Estrutura de `empresas.html`: `head-row` (kicker, título, contador "N de total", ações) →
`filter-bar` (busca + filtros do servidor + "Mostrar agrupamento") → grade Tabulator
(`layout: 'fitDataFill'`, `movableColumns`, filtros no cabeçalho, `responsiveLayout: 'collapse'`)
→ "Carregar mais" com `proximo_cursor` → clique na linha abre o detalhe (`editor-bar` +
abas `role="tab"` + `tlk-form`). Formulário: rótulo visível, dica abaixo, erro abaixo do
campo, Salvar/Cancelar no fim. Ação destrutiva: confirmação na própria tela dizendo a
consequência (nunca `confirm()` sozinho).

### Telas específicas

* **Canais (G2):** lista com pill de estado + detalhe com QR (imagem grande, contagem até `expira_em`,
  "Novo QR") e **terminal** no padrão do IA Command (fundo `--terminal-bg` do DESIGN.md, cores
  por `tipo` iguais às `log-*`), auto-rolagem que pausa quando a pessoa sobe a rolagem.
* **Painel (G3):** resumo primeiro (números do `painel`), depois pendências com link, depois canais.
  Referência: painel da tela Jobs. Sem excesso de cartões.
* **Histórico (G3):** filtros de §5 do contrato; detalhe com linha do tempo de estados; ações
  manuais só em `desconhecida`/`falhou`; exportar com os filtros atuais.
* **Aplicações (G1):** token e segredo mostrados **uma vez** num quadro com "Copiar" e aviso;
  depois só o prefixo (o Agente Local mostra de novo pelo "olhinho" — aqui **não**).
* **Configurações (G1):** abas "Link de entrada" (apelido + logo), "Sites autorizados"
  (lista com versão), "E-mail de envio" (copiar o fluxo do "E-mail Geral" do IA Recruit:
  `modules/configuracoes/frontend/configuracoes.html`, com o teste em etapas).
* **Entrada (G1, `entrar.html`):** logo e nome da empresa pelo apelido, celular, código de 6
  dígitos, reenviar após 60 s, mensagens claras para link inexistente e muitas tentativas.
  Referência: `apps/IA Service/frontend/entrar.html`.

### Responsivo, tema e acessibilidade

* Celular: o menu vira gaveta (≤ 900 px). Grades colapsam colunas (`responsive: 0..3`);
  em listas muito usadas no celular, avaliar cartões (padrão `apps/IA Service/frontend/css/iaservice-mobile.css`).
* Tema escuro: só variáveis do `iahub.css`/`talk.css`; nenhuma cor literal fora dos pills.
* Teclado: tudo alcançável, foco visível, `aria-label` em botões só com ícone, `role="alert"` em erros.

### Pronto significa

1. `node --test "apps/IA Talk/tests/*.test.js"` passando (incluindo os seus).
2. Capturas da tela contra o simulado em **1440 e 390 px, claro e escuro** (4 imagens),
   mais `vazio`, `lento` (carregando) e um erro (`403` ou `500`), em `apps/IA Talk/tests/telas/capturas/`.
3. Nenhum número completo, token ou segredo nas capturas e nos logs.
4. Lista de arquivos alterados com caminho completo + linha atualizada no `docs/andamento.md`.
5. Sem commit e sem push: o usuário decide; o Claude Code revisa antes.

---

## 8. A0 — Protótipo da Central de Atendimento (Fase 2)

Detalhes em `apps/IA Talk/prototipos/central/README.md`. Resumo: salvar em
`apps/IA Talk/prototipos/central/` (`index.html`, `alternativa-a.html`, `alternativa-b.html`),
abrir pelo simulado em `/app/ia-talk/prototipos/central/`. Comparar **Alternativa A** (quatro
áreas: setores · conversas · conversa · contato/IA) e **Alternativa B** (três áreas + gaveta),
conforme a seção 12 do relatório. A escolha é do usuário.

---

## 9. Pontos de encontro (como evitar retrabalho)

| Encontro | O Antigravity entrega | O Claude Code faz |
|---|---|---|
| G1 ↔ C1 | Telas funcionando 100% contra o simulado, só com `TalkApi` | Liga as rotas reais com as mesmas formas; roda os testes de contrato no servidor real; revisa as telas |
| G2 ↔ C2 | Canais + QR + terminal só com contrato e socket | Socket autenticado por sessão, runner do WhatsApp emitindo os mesmos eventos |
| G3 ↔ C4 | Painel, histórico, eventos e auditoria | Rotas reais com isolamento por empresa e exportação com permissão |

Se a tela precisar de um campo que o contrato não tem: **não invente no front**; registre no
`andamento.md` e espere a mudança de contrato (vale para os dois lados).
