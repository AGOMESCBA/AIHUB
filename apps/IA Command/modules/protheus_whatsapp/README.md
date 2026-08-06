# Protheus WhatsApp (protheus_whatsapp)

Canal de entrada para o IA Command que roda **dentro do ERP Protheus**, em uma tela
embutida (TWebEngine) com aparência e comportamento de chat estilo WhatsApp. Não é
uma integração com o WhatsApp real — é uma simulação visual do WhatsApp, hospedada
no Protheus, falando com o mesmo backend de IA.

Módulo isolado propositalmente: nenhum arquivo é compartilhado fisicamente com
`modules/whatsapp/` (esse é o canal WhatsApp real, via `whatsapp-web.js`, e continua
existindo sem alterações). O reuso entre os dois canais acontece só por import dos
módulos de domínio que já são neutros em relação a canal — eles não sabem se quem
chamou foi o WhatsApp ou o Protheus:

- `../ai/intent-service` — classificação de intenção
- `../erp/.../intent-merger` — mescla com contexto anterior
- `../erp/.../intent-router` — roteamento e execução (SQL, guards)
- `../erp/core/response-formatter.js` — formatação da resposta (texto/tabela genérico,
  sem nada específico de WhatsApp — é o ponto de corte identificado no `whatsapp/service.js`
  linha ~2657, antes de `_quebrarMensagemWhatsapp`/`canonical-whatsapp-format`)

## Identidade e segurança

A identidade do usuário continua sendo o **número de celular**, como já funciona hoje
para o WhatsApp — não um sistema de identidade novo. O celular passa a existir também
no cadastro de usuário do Protheus; a tela dentro do ERP já sabe automaticamente quem
é o usuário logado e manda esse número junto de cada pergunta.

Isso significa que `intent._remetente = celular` chega **inalterado** aos guards
(`vendedor-seguranca.js`, `cliente-seguranca.js`) e à tabela `whatsapp_allowed_numbers`
— zero duplicação de lógica de permissão entre os dois canais.

## Autenticação da tela (token de sessão)

A rotina ADVPL, ao abrir o `TWebEngine`, primeiro chama um endpoint do IAHub para obter
um **token curto (JWT, poucos minutos de validade)**, assinado com chave que existe
somente no servidor do IAHub — nunca no Protheus nem no navegador do usuário. Esse
token (contendo celular + empresaId + filial) é o que vai na URL carregada pelo
`TWebEngine:Navigate(...)`.

Motivo de não usar uma chave fixa de integração: uma chave única por empresa poderia
ser inspecionada por qualquer usuário com acesso ao Protheus e reaproveitada para se
passar por outro vendedor/cliente, furando os guards. Um token por sessão, de curta
duração, limita o raio de dano de um vazamento a minutos.

## Estrutura planejada

```
protheus_whatsapp/
  service.js         orquestração: recebe { texto, celular, empresaId, sessaoId },
                      chama intent-service → intent-merger → intent-router →
                      response-formatter, sem nada de WhatsApp (sem quebra de 3500
                      caracteres, sem canonical-whatsapp-format)
  routes.js           endpoints HTTP (ver contrato abaixo)
  session-store.js     CRUD de sessões/mensagens para alimentar a sidebar de conversas
  token-service.js     emissão/validação do JWT curto de sessão
```

## Contrato de API (rascunho)

```
POST /api/ia-command/protheus/token
  body: { celular, empresaId, filial }   (chamado pelo ADVPL antes de abrir o TWebEngine)
  → { token }

POST /api/ia-command/protheus/mensagem
  auth: Bearer <token>
  body: { texto, sessaoId }
  → { sessaoId, resposta: { texto, rows?, tipo }, criadoEm }

GET /api/ia-command/protheus/sessoes
  auth: Bearer <token>
  → [{ sessaoId, titulo, ultimaMensagem, atualizadoEm, naoLidas }]

GET /api/ia-command/protheus/sessoes/:id/mensagens?cursor=...
  auth: Bearer <token>
  → mensagens paginadas (scroll-para-cima carrega mais)

POST /api/ia-command/protheus/sessoes
  auth: Bearer <token>
  → cria sessão nova
```

## Frontend

Protótipo visual aprovado: chat com bolhas estilo WhatsApp (verde/branco, dark mode
espelhando WhatsApp Dark) + sidebar de conversas agrupadas por data, no mesmo padrão
do WhatsApp Web. A ser movido para cá como página estática servida pelo IAHub e
carregada via `TWebEngine:Navigate("https://.../protheus-chat?token=...")`.

## Decisões em aberto

1. **Título da sessão na sidebar**: gerar via LLM (resumo curto da primeira pergunta,
   custo pequeno com Haiku) vs. usar a primeira pergunta truncada (zero custo).
2. **Módulo do menu Protheus para o piloto**: candidato inicial é o módulo Comercial
   (SIGAFAT), a validar com um grupo pequeno de usuários antes de expandir.
3. **Normalização do celular** cadastrado no Protheus deve seguir o mesmo formato que
   `whatsapp_allowed_numbers` já usa hoje (`_normalizarNumeroWa`, só dígitos) — checar
   na hora de implementar o cadastro/sync.
