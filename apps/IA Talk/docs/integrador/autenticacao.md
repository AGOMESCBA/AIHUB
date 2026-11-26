# Autenticação e Tokens de Aplicação

A API v1 do IA Talk autentica exclusivamente por **token de aplicação** (Bearer Token). Cada aplicação pertence a **uma única empresa**, tem escopos explícitos e lista fechada de canais autorizados.

---

## 1. Como criar uma aplicação e gerar o token

1. Acesse o IA Talk com um perfil administrador da empresa e abra **Integrações › Aplicações e tokens**.
2. Clique em **+ Nova aplicação** e informe:
   * **Nome** e **descrição** (ex.: `ERP Faturamento`).
   * **Escopos necessários** (princípio do menor privilégio):
     | Escopo | Permite |
     |---|---|
     | `mensagens:enviar` | `POST /api/v1/mensagens` |
     | `mensagens:ler` | `GET /api/v1/mensagens/:id` |
     | `eventos:ler` | `GET /api/v1/eventos` |
     | `canais:ler` | `GET /api/v1/canais/:id/estado` |
   * **Canais autorizados:** selecione apenas os canais (`cn_...`) que esta aplicação pode usar.
   * **Webhook (opcional):** informe a URL HTTPS do seu sistema e ative o recebimento.
3. Na aba **Tokens**, clique em **Gerar novo token**.
4. **Copie o token imediatamente e armazene no cofre de segredos / variável de ambiente do seu sistema.** O IA Talk guarda apenas o hash criptográfico; depois de fechar o aviso, apenas o prefixo (`tk_...`) volta a aparecer.

---

## 2. Como autenticar as chamadas

Envie o token no cabeçalho `Authorization` em toda requisição para `/app/ia-talk/api/v1/*`:

```http
Authorization: Bearer tk_teste_exemplo_nao_usar
```

### Exemplo em Node.js

```js
const TALK_BASE_URL = process.env.IA_TALK_BASE_URL || 'http://127.0.0.1:3051/app/ia-talk/api/v1';
const TALK_TOKEN = process.env.IA_TALK_TOKEN; // ex.: tk_teste_exemplo_nao_usar no simulado

async function talkFetch(caminho, opcoes = {}) {
  const resp = await fetch(`${TALK_BASE_URL}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${TALK_TOKEN}`,
      Accept: 'application/json',
      ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opcoes.headers || {}),
    },
  });
  const dados = await resp.json().catch(() => null);
  if (!resp.ok) {
    const err = new Error(dados?.erro?.mensagem || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.codigo = dados?.erro?.codigo || 'erro_interno';
    err.campos = dados?.erro?.campos || null;
    throw err;
  }
  return dados;
}
```

---

## 3. Rotação de token sem tempo de parada

Uma aplicação pode manter **mais de um token ativo ao mesmo tempo**, permitindo troca segura sem derrubar integrações em produção:

1. Gere um **novo token** na tela **Aplicações e tokens** (o antigo continua funcionando).
2. Atualize a variável de ambiente / cofre do seu sistema integrador e reinicie os workers.
3. Confirme na coluna **Último uso** que o tráfego já migrou para o prefixo do token novo.
4. **Revogue o token antigo.** A revogação tem efeito imediato; qualquer chamada com o token revogado passa a receber `HTTP 401` (`nao_autenticado`).

---

## 4. Isolamento entre empresas e canais

* Um token nunca acessa recursos de outra empresa. Consultar um `id` de outra empresa devolve `HTTP 404` (`nao_encontrado`).
* Tentar enviar por um canal que não está em `canais_autorizados` da aplicação devolve `HTTP 403` (`canal_nao_autorizado`) ou `HTTP 400` no simulado.
* Se a aplicação for marcada como **inativa**, todos os seus tokens param de autenticar imediatamente.
