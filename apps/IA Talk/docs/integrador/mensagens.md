# Envio de Mensagens e Consulta de Estado

---

## 1. Enviar mensagem (`POST /api/v1/mensagens`)

### Cabeçalhos

| Cabeçalho | Obrigatório | Descrição |
|---|---|---|
| `Authorization` | Sim | `Bearer <token da aplicação>` |
| `Content-Type` | Sim | `application/json` |
| `Idempotency-Key` | **Sim** | Identificador único gerado pelo seu sistema (8 a 120 caracteres, válido por 24 h). |
| `X-Correlation-Id` | Não | ID do seu processo/chamado (ex.: `chamado-36901`); ecoa na resposta, consultas e webhooks. |

### Regras de idempotência

* **Mesma `Idempotency-Key` + mesmo corpo JSON** (dentro de 24 h): o IA Talk **não** cria uma segunda mensagem; devolve o mesmo `HTTP 202` original com o cabeçalho `Idempotent-Replayed: true`.
* **Mesma `Idempotency-Key` + corpo diferente:** devolve `HTTP 409 Conflict` com `erro.codigo = "idempotencia_conflito"`.
* **Dica prática:** derive a chave do evento de negócio + tentativa lógica (ex.: `cobranca-fat-88412-aviso-1`) em vez de gerar um UUID novo a cada retry de rede. Assim, se ocorrer timeout HTTP, você pode repetir a mesma requisição com segurança.

---

## 2. Formatos, mídias e limites (Fase 1 — WhatsApp Web)

A validação de arquivos no IA Talk confere o **conteúdo real (magic bytes)**, não apenas a extensão do nome. Extensão trocada ou arquivo corrompido é recusado com `HTTP 400` (`requisicao_invalida`).

| `tipo` | MIMEs aceitos | Limite máximo | Disponível na Fase 1 |
|---|---|---|---|
| `texto` | — | — | Sim |
| `imagem` | `image/png`, `image/jpeg`, `image/webp` | 5 MB | Sim |
| `documento` | `application/pdf`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (`.xlsx`), `...wordprocessingml.document` (`.docx`), `...presentationml.presentation` (`.pptx`), `text/csv`, `text/plain` | 16 MB | Sim |
| `audio` | `audio/ogg`, `audio/mpeg`, `audio/mp4` | 16 MB | Sim |
| `video` | `video/mp4` | 16 MB | **Não** (retorna `HTTP 422 recurso_nao_suportado`) |

### Formatação de texto (WhatsApp)

* `*negrito*` · `_itálico_` · `~riscado~` · ```` ```monoespaçado``` ````

### Formas de informar `arquivo` (quando `tipo !== "texto"`)

Informe **exatamente um** dos três campos dentro de `arquivo`:
1. **`base64`**: string Base64 estrita (sem prefixo `data:...;base64,`).
2. **`url`**: apenas `https://` público. O servidor resolve o DNS, bloqueia endereços internos/privados (proteção SSRF) e valida redirecionamentos e tamanho máximo.
3. **`midia_id`**: referência pré-armazenada quando suportada pelo fluxo.

---

## 3. Exemplos completos de envio

### Texto (Node.js)

```js
const resposta = await fetch('http://127.0.0.1:3051/app/ia-talk/api/v1/mensagens', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer tk_teste_integracao',
    'Content-Type': 'application/json',
    'Idempotency-Key': 'chamado-36901-resp-1',
    'X-Correlation-Id': 'chamado-36901',
  },
  body: JSON.stringify({
    canal: 'cn_suporte',
    para: '+5565999990000',
    tipo: 'texto',
    texto: '*Chamado 36901:* sua solicitação foi concluída.',
    metadados: { modulo: 'suporte' },
  }),
});

console.log(resposta.status, await resposta.json());
// 202 { id: "msg_...", estado: "aceita", canal: "cn_suporte", ... }
```

### Documento PDF em Base64 (Python)

```python
import base64
import requests

with open("relatorio-exemplo.pdf", "rb") as f:
    conteudo_b64 = base64.b64encode(f.read()).decode("ascii")

resp = requests.post(
    "http://127.0.0.1:3051/app/ia-talk/api/v1/mensagens",
    headers={
        "Authorization": "Bearer tk_teste_integracao",
        "Idempotency-Key": "relatorio-nov-2026-emp-01",
        "X-Correlation-Id": "rel-2026-11",
    },
    json={
        "canal": "cn_suporte",
        "para": "+5565999990000",
        "tipo": "documento",
        "legenda": "Segue o relatório consolidado de novembro.",
        "arquivo": {
            "nome": "relatorio-novembro.pdf",
            "mime": "application/pdf",
            "base64": conteudo_b64,
        },
    },
    timeout=15,
)
print(resp.status_code, resp.json())
```

---

## 4. Consultar estado da mensagem (`GET /api/v1/mensagens/:id`)

Exige escopo `mensagens:ler`.

```bash
curl -s "http://127.0.0.1:3051/app/ia-talk/api/v1/mensagens/msg_ex001" \
  -H "Authorization: Bearer tk_teste_integracao"
```

```json
{
  "id": "msg_ex001",
  "estado": "lida",
  "canal": "cn_suporte",
  "para_mascarado": "+55 65 9••••-0000",
  "tipo": "texto",
  "correlacao_id": "chamado-36900",
  "criada_em": "2026-11-25T13:59:00.000Z",
  "atualizada_em": "2026-11-25T13:59:04.500Z",
  "historico_estados": [
    { "estado": "aceita", "em": "2026-11-25T13:59:00.000Z", "detalhe": null },
    { "estado": "encaminhada", "em": "2026-11-25T13:59:00.900Z", "detalhe": null },
    { "estado": "enviada", "em": "2026-11-25T13:59:01.800Z", "detalhe": null },
    { "estado": "entregue", "em": "2026-11-25T13:59:02.700Z", "detalhe": null },
    { "estado": "lida", "em": "2026-11-25T13:59:03.600Z", "detalhe": null }
  ]
}
```

### Máquina de estados de saída

| Estado | Significado | Ação recomendada no integrador |
|---|---|---|
| `aceita` | Pedido validado e gravado na fila. | Aguardar webhook ou nova consulta. |
| `aguardando` | Canal ocupado ou em reconexão; envio ainda na fila. | Aguardar. |
| `encaminhada` | Entregue ao worker do provedor. | Aguardar. |
| `enviada` | Provedor confirmou envio ao servidor do WhatsApp. | Sucesso inicial; aguardar recibos se necessário. |
| `entregue` | Aparelho do destinatário recebeu a mensagem. | Entrega confirmada. |
| `lida` | Destinatário leu a mensagem (quando recibo de leitura está ativo). | Leitura confirmada. |
| `falhou` | Falha comprovada (ex.: número inexistente no WhatsApp). | Registrar erro e, se cabível, corrigir destino antes de novo envio. |
| `desconhecida` | Conexão caiu após o envio antes da confirmação do provedor. | **Não reenviar automaticamente.** Exibir alerta operacional para decisão humana (tela Histórico de mensagens). |

---

## 5. Consultar estado e capacidades do canal (`GET /api/v1/canais/:id/estado`)

Exige escopo `canais:ler`. Ideal para checar conectividade e formatos aceitos antes de disparar lotes.

```bash
curl -s "http://127.0.0.1:3051/app/ia-talk/api/v1/canais/cn_suporte/estado" \
  -H "Authorization: Bearer tk_teste_integracao"
```

```json
{
  "id": "cn_suporte",
  "estado": "conectado",
  "estado_desde": "2026-11-22T14:00:00.000Z",
  "capacidades": {
    "texto": true,
    "formatacao": "whatsapp",
    "imagem": true,
    "documento": true,
    "audio": true,
    "video": false,
    "grupos": true,
    "modelos": false,
    "janela_24h": false,
    "recibos": { "enviada": true, "entregue": true, "lida": true },
    "qr": true,
    "max_midia_bytes": 16777216,
    "mimes_aceitos": ["image/png", "image/jpeg", "application/pdf"]
  }
}
```
