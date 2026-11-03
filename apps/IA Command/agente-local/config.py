import os
from pathlib import Path

ENV_FILE = Path(__file__).parent / ".env"

_DEFAULTS = {
    "DB_HOST":       "",
    "DB_PORT":       "1433",
    "DB_NAME":       "",
    "DB_USER":       "",
    "DB_PASS":       "",
    "DB_DRIVER":     "ODBC Driver 17 for SQL Server",
    "FILIAL":        "01",
    "API_PORT":      "8765",
    "API_TOKEN":     "",
    "CRYPTO_KEY":    "",
    "CRYPTO_REQUIRED": "false",
    "ADMIN_HASH":    "",
    "SESSION_SECRET": "",
}


# Cache do .env: get_config() roda várias vezes por consulta; só relê o arquivo
# quando a data de alteração ou o tamanho mudam (edição manual ou set_config).
_env_cache = {"chave": None, "valores": {}}


def _ler_env() -> dict:
    try:
        st = ENV_FILE.stat()
    except FileNotFoundError:
        return {}
    chave = (st.st_mtime_ns, st.st_size)
    if _env_cache["chave"] == chave:
        return _env_cache["valores"]
    valores = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key in _DEFAULTS:
            valores[key] = val
    _env_cache["valores"] = valores
    _env_cache["chave"] = chave
    return valores


def get_config() -> dict:
    """Retorna todas as configurações mesclando .env + os.environ."""
    values = dict(_DEFAULTS)
    values.update(_ler_env())
    # Variáveis de ambiente têm precedência
    for key in _DEFAULTS:
        if key in os.environ:
            values[key] = os.environ[key]
    return values


def set_config(key: str, value: str):
    """Atualiza ou adiciona uma chave no arquivo .env local."""
    if key not in _DEFAULTS:
        return
    lines: list[str] = []
    found = False
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith(f"{key}=") or stripped.startswith(f"{key} ="):
                lines.append(f'{key}="{value}"')
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f'{key}="{value}"')
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    _env_cache["chave"] = None
