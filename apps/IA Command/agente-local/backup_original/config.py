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
    "ADMIN_HASH":    "",
    "SESSION_SECRET": "",
}


def get_config() -> dict:
    """Retorna todas as configurações mesclando .env + os.environ."""
    values = dict(_DEFAULTS)
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key in _DEFAULTS:
                values[key] = val
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
