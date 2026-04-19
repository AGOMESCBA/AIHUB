# AIHUB
Hub de conexões com vários processamentos diferentes.

## Como fazer push no GitHub

### Via terminal

```bash
git add .
git commit -m "descrição do que foi feito"
git push
```

### Via VSCode (sem terminal)

1. Abra o **Source Control** com `Ctrl+Shift+G`
2. Veja os arquivos alterados e escreva a mensagem de commit
3. Clique em **Commit**
4. Clique em **Sync Changes** (ou o ícone de nuvem/seta) para fazer o push

## Configuração das APIs de Inteligência Artificial

O sistema utiliza duas IAs em cascata: **Groq** como principal e **Google Gemini** como fallback automático quando o limite de tokens do Groq é atingido.

---

### Groq (Principal)

- **Site:** https://console.groq.com
- **Plano gratuito:** 100.000 tokens/dia
- **Modelo utilizado:** `llama-3.3-70b-versatile` e `llama-3.1-8b-instant`

**Como gerar a chave:**
1. Acesse https://console.groq.com e crie uma conta
2. No menu lateral, clique em **API Keys**
3. Clique em **Create API Key**, dê um nome e confirme
4. Copie a chave gerada (começa com `gsk_...`)
5. Cole no arquivo `.env` na variável `GROQ_API_KEY`

---

### Google Gemini (Fallback)

- **Site:** https://aistudio.google.com
- **Plano gratuito:** 1.500 requisições/dia e 1.000.000 tokens/dia
- **Modelo utilizado:** `gemini-2.0-flash`

**Como gerar a chave:**
1. Acesse https://aistudio.google.com e faça login com sua conta Google
2. Clique em **Get API Key** no menu lateral
3. Clique em **Create API Key**
4. Selecione um projeto Google Cloud existente ou crie um novo
5. Copie a chave gerada
6. Cole no arquivo `.env` na variável `GEMINI_API_KEY`

---

### Configuração no arquivo `.env`

```env
# Chave da API do Groq (obtenha grátis em https://console.groq.com)
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Chave da API do Google Gemini (fallback quando Groq atinge limite)
GEMINI_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Comportamento do fallback (extração de currículo):**
1. Groq `llama-3.3-70b` — extração JSON completa (principal)
2. Groq `llama-3.1-8b` — extração JSON simplificada
3. Google Gemini `gemini-2.0-flash` — fallback automático (quando Groq atinge limite diário)
4. Groq `llama-3.1-8b` — extração JSON mínima com prompt adaptado para PDFs multi-coluna
5. Texto livre — último recurso (se todas as tentativas anteriores falharem)
