# IA Talk — Guia do Integrador (API v1)

Documentação oficial para conectar ERPs, sistemas internos, robôs e serviços ao **IA Talk** usando a **API v1** e **webhooks assinados**.

> **Importante:** todos os exemplos deste guia usam valores fictícios (`tk_teste_exemplo_nao_usar`, `whsec_exemplo_ficticio_...`, `+5565999990000`). Nunca grave tokens ou segredos reais em repositórios, logs ou código-fonte.

---

## Sumário

1. [Autenticação e tokens de aplicação](./autenticacao.md) — cadastro, escopos, canais autorizados e rotação sem parada.
2. [Envio de mensagens e consulta de estado](./mensagens.md) — `POST /mensagens`, idempotência, mídias/limites, formatação, `GET /mensagens/:id` e `GET /canais/:id/estado`.
3. [Webhooks e verificação de assinatura](./webhooks.md) — cabeçalhos `X-Talk-*`, validação HMAC-SHA256 com `backend/lib/assinatura`, deduplicação, retentativas e recuperação via `GET /eventos`.
4. [Erros padronizados, limites e paginação](./erros-e-paginacao.md) — códigos `erro.codigo`, `429 Retry-After` e cursor opaco.
5. [Especificação OpenAPI 3.1](../openapi-v1.yaml) — contrato formal completo de rotas, parâmetros e schemas.

---

## Endereços base

| Ambiente | URL base da API v1 | Autenticação |
|---|---|---|
| Produção | `https://<seu-dominio>/app/ia-talk/api/v1` | `Authorization: Bearer <token da aplicação>` |
| Servidor simulado (desenvolvimento) | `http://127.0.0.1:3051/app/ia-talk/api/v1` | Qualquer token iniciado por `tk_teste_` (ex.: `tk_teste_integracao`) |

Para subir o servidor simulado localmente (na raiz do repositório):

```bash
node "apps/IA Talk/backend/simulado/servidor-simulado.js"
```

---

## Início rápido (3 passos)

### 1. Verifique se o canal autorizado está conectado

```bash
curl -s "http://127.0.0.1:3051/app/ia-talk/api/v1/canais/cn_suporte/estado" \
  -H "Authorization: Bearer tk_teste_integracao"
```

### 2. Envie uma mensagem com `Idempotency-Key`

```bash
curl -i -X POST "http://127.0.0.1:3051/app/ia-talk/api/v1/mensagens" \
  -H "Authorization: Bearer tk_teste_integracao" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pedido-36901-envio-01" \
  -H "X-Correlation-Id: pedido-36901" \
  -d '{
    "canal": "cn_suporte",
    "para": "+5565999990000",
    "tipo": "texto",
    "texto": "*Pedido 36901* aprovado e pronto para faturamento."
  }'
```

A resposta imediata é **`HTTP 202 Accepted`** com `estado: "aceita"`. **Isso confirma apenas que o pedido entrou na fila**, nunca que o destinatário recebeu a mensagem.

### 3. Acompanhe o estado real da entrega

Consulte pelo `id` retornado ou receba a transição automática via [webhook assinado](./webhooks.md):

```bash
curl -s "http://127.0.0.1:3051/app/ia-talk/api/v1/mensagens/msg_ex001" \
  -H "Authorization: Bearer tk_teste_integracao"
```

---

## Princípios do contrato que todo integrador precisa respeitar

* **Empresa vem do token:** nunca envie `empresa_id` na URL ou no JSON; o IA Talk determina a empresa exclusivamente pelo token da aplicação.
* **Estados honestos:** trate `aceita` como enfileirada, `entregue`/`lida` como confirmação do provedor, `falhou` como erro definitivo e `desconhecida` como incerto (**nunca** reenvie automaticamente uma mensagem `desconhecida` para evitar duplicidade no WhatsApp do cliente).
* **Sem degradação silenciosa:** se o canal não suporta um tipo de mídia (por exemplo, `video` na Fase 1), a API devolve `HTTP 422` (`recurso_nao_suportado`). Verifique `capacidades` antes de enviar.
* **Privacidade nos retornos:** números de telefone retornam mascarados (`+55 65 9••••-0000`) nas consultas administrativas e de status.
