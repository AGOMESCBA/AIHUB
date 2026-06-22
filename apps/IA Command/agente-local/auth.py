import bcrypt
from fastapi import HTTPException, Request
from config import get_config, set_config


def verificar_token_api(token: str) -> bool:
    cfg      = get_config()
    expected = cfg.get("API_TOKEN", "")
    return bool(expected and token == expected)


def verificar_sessao_web(request: Request):
    if not request.session.get("autenticado"):
        raise HTTPException(status_code=401, detail="Sessão expirada. Faça login novamente.")


def autenticar_admin(senha: str) -> bool:
    cfg       = get_config()
    hash_salvo = cfg.get("ADMIN_HASH", "")

    if not hash_salvo:
        # Primeiro acesso: senha padrão "admin" — força troca
        if senha == "admin":
            _salvar_hash("admin")
            return True
        return False

    try:
        return bcrypt.checkpw(senha.encode("utf-8"), hash_salvo.encode("utf-8"))
    except Exception:
        return False


def alterar_senha(senha_atual: str, nova_senha: str):
    if not autenticar_admin(senha_atual):
        raise HTTPException(status_code=400, detail="Senha atual incorreta.")
    if len(nova_senha) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter no mínimo 6 caracteres.")
    _salvar_hash(nova_senha)


def salvar_hash(senha: str):
    h = bcrypt.hashpw(senha.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    set_config("ADMIN_HASH", h)

# alias privado mantido para compatibilidade interna
_salvar_hash = salvar_hash
