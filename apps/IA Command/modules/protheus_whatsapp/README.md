# Protheus WhatsApp (protheus_whatsapp)

Canal de entrada para o IA Command que roda **dentro do ERP Protheus**, em uma tela
embutida (TWebEngine) com aparência e comportamento de chat estilo WhatsApp. Não é
uma integração com o WhatsApp real — é uma simulação visual do WhatsApp, hospedada
no Protheus, falando com o mesmo backend de IA.

**Status**: Fases 1–3 do plano implementadas e testadas (backend + frontend). Fase 4
(rotina ADVPL) documentada abaixo como referência, a implementar e testar pelo time
Protheus em ambiente de homologação — este repositório não tem como rodar ADVPL.

Módulo isolado propositalmente: nenhum arquivo é compartilhado fisicamente com
`modules/whatsapp/` (esse é o canal WhatsApp real, via `whatsapp-web.js`, e continua
existindo sem alterações). O reuso entre os dois canais acontece só por import dos
módulos de domínio que já são neutros em relação a canal — eles não sabem se quem
chamou foi o WhatsApp ou o Protheus:

- `../ai/intent-service` (`classificar`) — classificação de intenção
- `../ai/intent-merger` (`mesclar`) — mescla com contexto anterior
- `../erp/core/intent-router` (`rotear`) — roteamento e execução (SQL, guards)
- `../erp/core/response-formatter` (`formatar`) — formatação da resposta (texto/tabela
  genérico, sem nada específico de WhatsApp — mesmo corte usado em `whatsapp/service.js`
  antes de `_quebrarMensagemWhatsapp`/`canonical-whatsapp-format`)

## Identidade e segurança

A identidade do usuário é o **número de celular**, como já funciona hoje para o
WhatsApp — não um sistema de identidade novo. O celular deve existir também no
cadastro de usuário do Protheus; a tela dentro do ERP já sabe automaticamente quem é
o usuário logado e manda esse número junto de cada pergunta.

`intent._remetente = celular` chega **inalterado** aos guards (`vendedor-seguranca.js`,
`cliente-seguranca.js`) e à tabela `whatsapp_allowed_numbers` — zero duplicação de
lógica de permissão entre os dois canais. Um número não cadastrado em
`whatsapp_allowed_numbers` é bloqueado da mesma forma que já é hoje no WhatsApp.

## Autenticação da tela (token de sessão)

A rotina ADVPL, ao abrir o `TWebEngine`, primeiro chama `POST
/api/ia-command/protheus/token` para obter um **token opaco de curta duração (5
minutos)**, armazenado em `protheus_chat_tokens` com expiração. Esse token é o que vai
na URL carregada pelo `TWebEngine:Navigate(...)` e depois é usado como `Bearer` em
todas as chamadas seguintes (mensagem, sessões).

**Nota de implementação**: o rascunho original desta arquitetura previa JWT assinado.
Na implementação, seguimos o padrão que já existe no resto do projeto para
autenticação servidor-a-servidor (agente local, worker do WhatsApp) — token opaco
gerado com `crypto.randomBytes`, validado por lookup em tabela, sem depender da
biblioteca `jsonwebtoken` (que não é usada em nenhum outro lugar do repositório).
Efeito prático é o mesmo: token de curta duração, não falsificável, revogável.

Motivo de não usar uma chave fixa de integração: uma chave única por empresa poderia
ser inspecionada por qualquer usuário com acesso ao Protheus e reaproveitada para se
passar por outro vendedor/cliente, furando os guards. Um token por sessão, de curta
duração, limita o raio de dano de um vazamento a minutos. Diferente de um token de uso
único: a sessão de chat faz várias chamadas (mensagem, listar sessões, trocar de
conversa) dentro da mesma janela de 5 minutos, então o token é válido para todas elas
até expirar — não é invalidado no primeiro uso.

A emissão de token (`POST /token`) é opcionalmente protegida por um segredo de
aplicação: se a variável de ambiente `IAC_PROTHEUS_CHAT_SECRET` estiver definida, o
chamador deve enviá-la no header `X-Protheus-Secret`. Sem essa variável configurada, o
endpoint fica aberto — **recomendado configurar antes de expor a Fase 4 em produção**.

## Estrutura implementada

```
protheus_whatsapp/
  token-service.js    emissão/validação do token opaco de sessão (tabela protheus_chat_tokens)
  session-store.js     CRUD de sessões/mensagens (protheus_chat_sessions, protheus_chat_messages);
                        título da sessão = primeira pergunta truncada (60 chars);
                        ultimoIntent() supre o "contexto anterior" ao pipeline de IA
  service.js            orquestração: recebe { empresaId, celular, sessaoId, texto },
                         chama intent-service → intent-merger → intent-router →
                         response-formatter, persiste o turno via session-store
  routes.js              endpoints HTTP (ver contrato abaixo) + serve a página estática
  public/
    protheus-chat.html   frontend de produção (chat + sidebar), sem color-mix() —
                          compatível com Chromium 111+ (baseline do TWebEngine)
```

Migration: `database/migrations.js` versão 67 — cria `protheus_chat_tokens`,
`protheus_chat_sessions`, `protheus_chat_messages`.

Registro em `modules/routes.js`: as rotas deste módulo são registradas **antes** do
`app.use('/api/ia-command', requireAuth, ...)`, porque são chamadas sem sessão de
usuário do IAHub (mesmo padrão do `worker-event` do WhatsApp).

## Contrato de API (implementado)

```
POST /api/ia-command/protheus/token
  headers: X-Protheus-Secret (se IAC_PROTHEUS_CHAT_SECRET configurado)
  body: { empresaId, celular, filial? }
  → { token, expiraEm }

GET /api/ia-command/protheus/chat
  → serve public/protheus-chat.html (o front lê ?token=...&usuario=... da querystring)

POST /api/ia-command/protheus/mensagem
  auth: Bearer <token>
  body: { texto, sessaoId? }        (sessaoId omitido cria sessão nova)
  → { sessaoId, resposta: { texto, temDados, rowsCount, tipo }, criadoEm }

GET /api/ia-command/protheus/sessoes
  auth: Bearer <token>
  → [{ sessaoId, titulo, ultimaMensagem, atualizadoEm }]

POST /api/ia-command/protheus/sessoes
  auth: Bearer <token>
  → { sessaoId }

GET /api/ia-command/protheus/sessoes/:id/mensagens?cursor=...
  auth: Bearer <token>
  → { mensagens: [{ texto, temDados, rowsCount, tipo, ... }], proximoCursor }

GET /api/ia-command/protheus/sessoes/:id/relatorio
  auth: Bearer <token>
  → { id, texto, rows, rowsCount, tipo, gridConfig, criadoEm } | null
```

## Frontend

`public/protheus-chat.html` — chat com bolhas estilo WhatsApp (verde/branco, dark mode
espelhando WhatsApp Dark) + sidebar de conversas, sem dependências externas (nenhum
CDN, tudo inline). Lê `token` e `usuario` da querystring; todas as cores translúcidas
usam variáveis RGBA fixas (não `color-mix()`) para compatibilidade com o Chromium
111+ do `TWebEngine` (ver seção de compatibilidade abaixo).

Carregado pela rotina ADVPL via:
```
TWebEngine:Navigate("https://<host-iahub>/api/ia-command/protheus/chat?token=" + cToken + "&usuario=" + cNomeUsuario)
```

## Compatibilidade com o Protheus (SmartClient Desktop)

- `TWebEngine`/`TWebChannel` rodam sobre Chromium 111+ a partir do SmartClient
  20.3.2.0. O frontend deste módulo evita recursos CSS não suportados nessa versão
  (especificamente `color-mix()`, substituído por RGBA fixo).
- **Risco assumido conscientemente**: a TOTVS descontinua o SmartClient Desktop em
  30/06/2026 (obrigatório WebApp a partir do release 12.1.2410). Não há confirmação de
  que `TWebEngine`/`TWebChannel` existem da mesma forma no SmartClient WebApp — este
  módulo mira o ambiente Desktop atual; uma migração de arquitetura da TOTVS pode
  exigir revisão da Fase 4.

## Como testar o backend isoladamente (sem Protheus)

```bash
node -e "
require('./apps/IA Command/modules/database').inicializarDB();
const tokenService = require('./apps/IA Command/modules/protheus_whatsapp/token-service');
const { token } = tokenService.emitir({ empresaId: <id>, celular: '<numero_cadastrado>' });
console.log(token);
"
```

Depois abra `http://localhost:<porta>/api/ia-command/protheus/chat?token=<token>` no
navegador — o chat funciona ponta a ponta fora do Protheus, contra o pipeline de IA
real (útil para validar a Fase 3 antes de envolver o time ADVPL).

## Fase 4 — Integração ADVPL

Fonte de referência em `advpl/IACCHAT.prw`. **Status: escrito fora de um ambiente
Protheus, nunca compilado nem testado** — este repositório é Node.js e não tem como
validar ADVPL. Antes de homologação, um desenvolvedor ADVPL do time precisa:

1. Compilar e revisar contra o Include da versão de Protheus em uso (nomes de
   classe/método podem variar entre releases — `FwRest`, `TWebEngine`, `TWebChannel`
   foram usados conforme documentação pública da TOTVS, sem validação local).
2. **Cadastrar os parâmetros SX6 `MV_IACEMID` e `MV_IACSECR`** em Configurador
   (SIGACFG) > Ambiente > Cadastros > Parâmetros — uma vez por empresa/filial
   Protheus, antes do primeiro uso (ver seção "Mapeamento empresa Protheus ↔
   empresa_id" abaixo). Sem isso o botão do chat mostra erro orientando o cadastro.
3. Confirmar o índice correto de `SYS_USR` usado em `IACLerCelularUsuario()`
   (`DbSetOrder(1)` é um placeholder — validar contra o dicionário de dados real).
4. Testar o fluxo completo em homologação: leitura do celular
   (`SYS_USR->USR_CELULAR`), chamada a `POST /token`, abertura do `TWebEngine`,
   conversa real.

### Mapeamento empresa Protheus ↔ empresa_id do IA Command

**Não existe hoje nenhuma tradução automática** entre código de empresa/filial
Protheus (`cEmpresaAnt`/`cFilAnt`, ex. `"01"`) e o `empresa_id` interno do IA
Command (inteiro sequencial gerado pelo cadastro de empresas do IAHub —
`apps/IAHUB/backend/empresas/`). São dois namespaces sem relação implícita entre
si; o cadastro de empresa do IAHub não tem campo de código ERP, e a tabela
`protheus_config` (`empresa_cod`, `filial_cod`) existente na migration 2 está
**órfã** — criada, nunca populada nem lida por nenhum código do sistema.

**Decisão**: parâmetro fixo por instalação (`MV_IACEMID`), não lookup automático.
Compensação em robustez menor por simplicidade: cada nova empresa-cliente exige
configurar esse parâmetro manualmente uma vez, olhando o `empresa_id` correto na
tela de administração do IA Command antes de cadastrar o SX6 no Protheus
correspondente. Se o volume de empresas-piloto crescer e essa configuração manual
virar gargalo operacional, migrar para lookup via `protheus_config` (populada +
endpoint de tradução) é a evolução natural — não implementado agora por decisão
explícita de manter a Fase 4 simples no piloto inicial.

O arquivo usa `SYS_USR->USR_CELULAR` como origem do celular (confirmado pelo usuário
como campo já existente) e `FWRest()` para a chamada HTTP ao endpoint de token —
padrão documentado publicamente pela TOTVS para requisições REST em ADVPL.

## Decisões (fechadas)

1. **Módulo do menu Protheus para o piloto**: **Comercial (SIGAFAT)**. Cenário já
   validado no protótipo (vendedor consultando faturamento, pedidos, clientes).
2. **Normalização do celular**: **automática no backend**, não depende de disciplina
   de quem cadastra no Protheus. Implementado em `token-service.js`
   (`normalizarCelular`, mesma regra do `_normalizarNumeroWa` do canal WhatsApp — só
   dígitos). A rotina ADVPL envia o celular como estiver gravado no cadastro SU (com
   ou sem máscara); o backend normaliza antes de gravar/comparar. Testado: `"(11)
   99999-8888"` → `"11999998888"`.
3. **Versão mínima de SmartClient**: **em aberto, sem bloqueio**. Não é pré-requisito
   para as Fases 1-3 (já entregues); só precisa ser resolvido antes de validar a Fase 4
   em homologação real.
4. **`IAC_PROTHEUS_CHAT_SECRET`**: **gerado e configurado** no `.env` deste ambiente,
   no mesmo padrão usado pelo agente local (`secrets.token_hex(32)` / 256 bits,
   `crypto.randomBytes(32).toString('hex')`). Documentado (sem valor) em
   `.env.example`. O time responsável pela rotina ADVPL vai precisar desse valor para
   configurar o header `X-Protheus-Secret` — repassar por canal seguro, não commitar.
5. **Título de sessão via IA**: mantido truncamento da primeira pergunta (zero custo).
   Resumo via LLM fica como melhoria futura, não bloqueante.
