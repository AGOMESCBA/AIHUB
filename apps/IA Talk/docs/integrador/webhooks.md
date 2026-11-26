# Webhooks e Verificação de Assinatura

Quando uma aplicação possui URL de webhook configurada e ativa, o IA Talk envia requisições `POST` com JSON assinado sempre que ocorrer um evento relevante.

---

## 1. Formato da entrega

```http
POST https://seu-sistema.exemplo.com.br/webhooks/ia-talk
Content-Type: application/json
X-Talk-Evento-Id: evt_ex001
X-Talk-Timestamp: 1764165600
X-Talk-Assinatura: sha256=3b4c5d...64-caracteres-hex-minusculos

{"id":"evt_ex001","tipo":"mensagem.estado_alterado","em":"2026-11-26T14:00:00.000Z","dados":{"mensagem_id":"msg_ex001","estado":"lida","correlacao_id":"chamado-36901"}}
```

### Tipos de evento

| `tipo` | Quando dispara |
|---|---|
| `mensagem.recebida` | Um contato enviou mensagem para um canal autorizado da aplicação. |
| `mensagem.estado_alterado` | Uma mensagem de saída mudou de estado (`enviada`, `entregue`, `lida`, `falhou`, `desconhecida`). |
| `canal.estado_alterado` | Um canal autorizado mudou de estado (`conectado`, `reconectando`, `desconectado`, `parado`, `erro`). |
| `conversa.responsavel_alterado` | Alteração de responsável na central de atendimento (Fase 2). |

---

## 2. Como validar a assinatura (obrigatório)

Cada entrega é assinada com **HMAC-SHA256** usando o segredo gerado na tela **Aplicações e tokens** (`whsec_...`, mostrado uma única vez):

```text
mensagem_assinada = "<X-Talk-Timestamp>.<corpo cru em bytes>"
assinatura        = "sha256=" + hex_minusculo(HMAC_SHA256(segredo, mensagem_assinada))
```

**Regras de segurança indispensáveis:**
1. Calcule o HMAC sobre o **corpo cru (`Buffer`) exatamente como chegou na rede**, antes de qualquer `JSON.parse` ou reserialização.
2. Rejeite requisições cujo `X-Talk-Timestamp` tenha diferença superior a **300 segundos (5 minutos)** em relação ao relógio atual (proteção contra replay).
3. Compare a assinatura recebida com a esperada em **tempo constante** (`crypto.timingSafeEqual` / `hmac.compare_digest`).

### Exemplo em Node.js + Express usando `backend/lib/assinatura`

Para sistemas internos no mesmo repositório (como IA Command, IA Service ou IAHub-Jobs), reutilize diretamente a biblioteca congelada `apps/IA Talk/backend/lib/assinatura/index.js`:

```js
'use strict';

const express = require('express');
const { verificar } = require('../../apps/IA Talk/backend/lib/assinatura');

const app = express();
const SEGREDO_WEBHOOK = process.env.IA_TALK_WEBHOOK_SECRET; // ex.: whsec_exemplo_ficticio
const eventosProcessados = new Set(); // em produção, persista em banco com TTL >= 7 dias

// Capture o corpo CRU (Buffer) antes de parsear o JSON!
app.post(
  '/webhooks/ia-talk',
  express.raw({ type: 'application/json', limit: '1mb' }),
  (req, res) => {
    const eventoId = req.get('X-Talk-Evento-Id');
    const timestamp = req.get('X-Talk-Timestamp');
    const assinatura = req.get('X-Talk-Assinatura');

    const resultado = verificar({
      segredo: SEGREDO_WEBHOOK,
      timestamp,
      corpo: req.body, // Buffer cru
      assinatura,
      toleranciaSeg: 300,
    });

    if (!resultado.ok) {
      // Motivos possíveis: assinatura_ausente | formato_invalido |
      // timestamp_invalido | timestamp_expirado | assinatura_invalida
      return res.status(401).json({ erro: resultado.motivo });
    }

    // Garantia "pelo menos uma vez": deduplique por X-Talk-Evento-Id
    if (!eventoId || eventosProcessados.has(eventoId)) {
      return res.status(200).json({ ok: true, duplicado: true });
    }
    eventosProcessados.add(eventoId);

    const evento = JSON.parse(req.body.toString('utf8'));

    // Responda 2xx em até 10 s; processe trabalhos pesados de forma assíncrona
    setImmediate(() => {
      console.log('Evento IA Talk recebido:', evento.id, evento.tipo);
    });

    return res.status(200).json({ ok: true });
  },
);
```

### Exemplo independente em Python (sem dependência do repositório)

```python
import hashlib
import hmac
import time

def verificar_assinatura_talk(segredo: str, timestamp: str, corpo_cru: bytes, assinatura: str, tolerancia_seg: int = 300) -> bool:
    if not assinatura or not assinatura.startswith("sha256="):
        return False
    if not timestamp or not timestamp.isdigit():
        return False

    ts = int(timestamp)
    if abs(time.time() - ts) > tolerancia_seg:
        return False

    payload = f"{ts}.".encode("utf-8") + corpo_cru
    esperada = "sha256=" + hmac.new(segredo.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(assinatura.strip(), esperada)
```

---

## 3. Garantia de entrega, retentativas e ordenação

* **Garantia:** *pelo menos uma vez* (*at-least-once*). Sempre deduplicar por `X-Talk-Evento-Id`.
* **Timeout do consumidor:** responda qualquer `HTTP 2xx` em até **10 segundos**.
* **Agenda de retentativas** (quando o consumidor retorna erro 4xx/5xx ou timeout):
  `1 min → 5 min → 15 min → 1 h → 3 h → 6 h` (até completar 24 h).
* Após esgotar as tentativas, o evento fica com situação `esgotado` na tela **Eventos e webhooks** (onde pode ser reentregue manualmente) e permanece consultável via API por **7 dias**.
* **Ordenação:** garantida apenas dentro da mesma conversa.

---

## 4. Recuperando eventos perdidos (`GET /api/v1/eventos`)

Se o seu servidor ficou fora do ar além da janela de retentativas (ou se você prefere consumir por polling), use `GET /api/v1/eventos` (escopo `eventos:ler`) guardando o último `proximo_cursor`:

```bash
# Primeira consulta
curl -s "http://127.0.0.1:3051/app/ia-talk/api/v1/eventos?limite=50" \
  -H "Authorization: Bearer tk_teste_integracao"

# Próxima consulta (repassando exatamente o proximo_cursor recebido)
curl -s "http://127.0.0.1:3051/app/ia-talk/api/v1/eventos?limite=50&depois=eyJvIjo1MH0" \
  -H "Authorization: Bearer tk_teste_integracao"
```

```json
{
  "itens": [
    {
      "id": "evt_ex001",
      "tipo": "mensagem.estado_alterado",
      "em": "2026-11-25T14:00:00.000Z",
      "dados": { "mensagem_id": "msg_ex001", "estado": "lida" }
    }
  ],
  "proximo_cursor": "eyJvIjoxfQ",
  "tem_mais": false
}
```
