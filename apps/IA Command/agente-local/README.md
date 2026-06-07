# IA Command — Agente Local

API Python que roda no servidor do cliente e executa SQL diretamente no banco do ERP local (Protheus/TOTVS), recebendo comandos seguros da nuvem IA Command.

---

## Estrutura

```
agente-local/
├── main.py                  ← FastAPI: /health, /execute, painel web
├── database.py              ← SQLite audit.db
├── auth.py                  ← Autenticação token API + sessão web
├── config.py                ← Leitura/escrita do .env
├── modules/
│   ├── erp_executor.py      ← Execução SQL via pyodbc (somente SELECT)
│   └── factory_reset.py     ← Restauração de fábrica
├── templates/               ← Painel web (login + dashboard)
├── static/css/style.css     ← Design IA Command
├── backup_original/         ← Cópias imutáveis dos arquivos originais
├── deploy/                  ← Scripts NSSM para o serviço Windows
├── audit.db                 ← Gerado automaticamente
├── .env                     ← Configurações locais (não commitar)
└── .env.example             ← Modelo de configuração
```

---

## Instalação

### 1. Pré-requisitos

- Python 3.11+
- NSSM (https://nssm.cc) no PATH
- Driver ODBC instalado: `ODBC Driver 17 for SQL Server`

### 2. Criar ambiente virtual e instalar dependências

```bat
cd agente-local
python -m venv venv
venv\Scripts\pip install -r requirements.txt
```

### 3. Configurar o .env

```bat
copy .env.example .env
notepad .env
```

Preencha: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`, `FILIAL`.

### 4. Instalar como serviço Windows

Execute como Administrador:

```bat
deploy\install-service.bat
```

O serviço `IACommand-Agente` será criado com inicialização automática.

### 5. Configurar token na nuvem

1. Acesse o painel admin local: `http://localhost:8765` (senha padrão: `admin`)
2. Vá em **Segurança → Token de API → Gerar novo token**
3. Copie o token
4. No painel nuvem do IA Command → **Configurar IA → Agente Local**
5. Cole o token e a URL do agente, ative e salve

---

## Gerenciamento do serviço

```bat
deploy\start-service.bat    ← Iniciar
deploy\stop-service.bat     ← Parar
deploy\remove-service.bat   ← Remover
```

Ou via NSSM diretamente:

```bat
nssm start   IACommand-Agente
nssm stop    IACommand-Agente
nssm restart IACommand-Agente
nssm status  IACommand-Agente
```

---

## Endpoints da API

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET`  | `/health` | Health check (público) |
| `POST` | `/execute` | Executa SQL no ERP (requer Bearer token) |

### Formato de requisição `/execute`

```json
{
  "sql":      "SELECT TOP 10 * FROM SF2010",
  "limit":    10000,
  "uuid":     "uuid-gerado-pela-nuvem",
  "modulo":   "faturamento",
  "operacao": "resumo_faturamento_dia"
}
```

### Formato de resposta

```json
{
  "rows":         [...],
  "status":       "ok",
  "duracao_ms":   145,
  "sql_executado": "SELECT TOP 10000 * FROM SF2010"
}
```

---

## Segurança

- Somente comandos `SELECT` são aceitos. `INSERT`, `UPDATE`, `DELETE`, `DROP` e similares são bloqueados.
- Limite máximo de 50.000 linhas por consulta.
- Autenticação por Bearer token em todas as chamadas da nuvem.
- Painel admin protegido por senha bcrypt com sessão assinada.

---

## Factory Reset

Caso os arquivos Python tenham sido modificados e causem problemas:

1. Acesse o painel admin: `http://localhost:8765`
2. Vá em **Sistema → Restaurar Código Original**
3. Digite `RESTAURAR` e confirme
4. O serviço será reiniciado automaticamente com os arquivos originais

> As configurações do `.env` (token, senha, banco) **não são afetadas** pelo reset.
