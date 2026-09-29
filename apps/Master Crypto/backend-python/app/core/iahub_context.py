from dataclasses import dataclass
import os
import secrets

from fastapi import HTTPException, Request


@dataclass(frozen=True)
class IAHUBContext:
    company_id: int
    user_id: int | None = None


def get_iahub_context(request: Request) -> IAHUBContext:
    company_raw = request.headers.get("x-iahub-company-id")
    user_raw = request.headers.get("x-iahub-user-id")

    try:
        company_id = int(company_raw or 0)
    except (TypeError, ValueError):
        company_id = 0

    if company_id <= 0:
        raise HTTPException(status_code=403, detail="Empresa IAHUB nao informada")

    token = request.headers.get("x-company-token")
    internal_secret = request.headers.get("x-master-crypto-internal-secret")
    configured_internal_secret = os.getenv("MASTER_CRYPTO_INTERNAL_SECRET", "").strip()
    client_host = (request.client.host if request.client else "") or ""
    is_local_proxy = client_host in {"127.0.0.1", "::1", "localhost"}
    is_internal = bool(
        configured_internal_secret
        and internal_secret
        and secrets.compare_digest(configured_internal_secret, internal_secret)
    )

    if token:
        from app.persistence.company_store import store

        if not store.validate_mobile_token(company_id, token):
            raise HTTPException(status_code=403, detail="Token mobile invalido para a empresa informada")
    elif not is_local_proxy and not is_internal:
        raise HTTPException(status_code=403, detail="Token mobile obrigatorio para acesso externo")

    try:
        user_id = int(user_raw) if user_raw else None
    except (TypeError, ValueError):
        user_id = None

    return IAHUBContext(company_id=company_id, user_id=user_id)
