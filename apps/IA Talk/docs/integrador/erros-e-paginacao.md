# Erros Padronizados, Limites e Paginação

---

## 1. Formato único de erro

Todas as rotas do IA Talk devolvem erros no mesmo envelope JSON:

```json
{
  "erro": {
    "codigo": "requisicao_invalida",
    "mensagem": "Confira os campos destacados.",
    "campos": {
      "para": "Informe o número com DDI e DDD."
    },
    "detalhe": null
  }
}
```

* **Sempre compare `erro.codigo` no seu código**, nunca o texto de `erro.mensagem` (que é voltado a leitura humana e pode ser aprimorado).
* `campos` aparece quando o erro é de validação por campo; `detalhe` carrega metadados opcionais quando aplicável.

---

## 2. Catálogo de códigos HTTP e `erro.codigo`

| HTTP | `erro.codigo` | Quando ocorre | Como reagir no integrador |
|---|---|---|---|
| `400` | `requisicao_invalida` | JSON inválido, campo obrigatório ausente, `Idempotency-Key` ausente, arquivo/MIME inválido ou cursor corrompido. | Corrigir payload antes de tentar novamente (não fazer retry cego). |
| `401` | `nao_autenticado` | Token ausente, inválido, revogado ou aplicação inativa. | Conferir cabeçalho `Authorization: Bearer` e status do token. |
| `403` | `sem_permissao` | Token não possui o escopo exigido pela rota. | Habilitar o escopo na aplicação. |
| `403` | `canal_nao_autorizado` | Canal informado não está em `canais_autorizados` da aplicação. | Autorizar o canal na tela **Aplicações e tokens**. |
| `404` | `nao_encontrado` | Mensagem ou canal inexistente **ou pertencente a outra empresa**. | Tratar como inexistente. |
| `409` | `idempotencia_conflito` | Mesma `Idempotency-Key` reutilizada com um corpo diferente. | Gerar nova `Idempotency-Key` para um conteúdo diferente. |
| `409` | `conflito` | Conflito de estado ou edição concorrente. | Recarregar o recurso antes de repetir. |
| `413` | `requisicao_invalida` | Corpo da requisição excedeu o limite permitido. | Reduzir tamanho do anexo (máx. 5 MB imagem / 16 MB documento e áudio). |
| `422` | `recurso_nao_suportado` | Canal não suporta o recurso pedido (ex.: `video` na Fase 1). | Consultar `GET /canais/:id/estado` (`capacidades`) e adaptar o envio. |
| `422` | `canal_desconectado` | Canal está offline e não aceita envio imediato. | Alertar equipe de operação e aguardar reconexão do canal. |
| `422` | `fora_da_janela_24h` | Canal Meta Cloud API fora da janela de 24 h sem `modelo` aprovado. | Enviar usando modelo aprovado (Fase Meta / G6). |
| `429` | `limite_excedido` | Limite de requisições por janela atingido. | Respeitar o cabeçalho `Retry-After` (segundos) com backoff exponencial. |
| `500` | `erro_interno` | Falha inesperada no servidor. | Repetir com a **mesma `Idempotency-Key`** após breve backoff. |
| `503` | `indisponivel` | Serviço temporariamente indisponível. | Repetir com a **mesma `Idempotency-Key`** após backoff. |

---

## 3. Controle de taxa (Rate Limit)

Respostas da API v1 incluem os cabeçalhos:

* `X-RateLimit-Limit`: total permitido na janela atual (ex.: `120`).
* `X-RateLimit-Remaining`: requisições restantes na janela.
* `X-RateLimit-Reset`: Unix timestamp (em segundos) em que a janela reinicia.

Ao receber **`HTTP 429`**, leia o cabeçalho **`Retry-After`** (em segundos) e aguarde pelo menos esse tempo antes da próxima tentativa.

```js
async function enviarComRetry(url, init, maxTentativas = 3) {
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    const resp = await fetch(url, init);
    if (resp.status !== 429 && resp.status < 500) return resp;

    const retryAfter = Number(resp.headers.get('Retry-After')) || tentativa * 2;
    if (tentativa === maxTentativas) return resp;
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
  }
}
```

> Como `init.headers['Idempotency-Key']` permanece idêntica entre as tentativas, o retry em `429`, `500`, `503` ou erro de rede é 100% seguro contra envios duplicados.

---

## 4. Paginação por cursor opaco

O IA Talk usa **paginação por cursor opaco** (nunca `page=1,2,3`), evitando pulos ou duplicações quando novos itens entram durante a leitura.

* **`limite`**: inteiro de `1` a `200` (padrão `50`).
* **Na API v1 (`GET /api/v1/eventos`):**
  * Passe `depois=<proximo_cursor>` para avançar a partir do último item lido.
  * Continue paginando enquanto `tem_mais === true`.
  * Quando `tem_mais === false`, salve `proximo_cursor` para usar no próximo ciclo de polling.
* **Nunca tente decodificar ou fabricar cursores** — o formato interno é opaco e pode evoluir sem aviso.
