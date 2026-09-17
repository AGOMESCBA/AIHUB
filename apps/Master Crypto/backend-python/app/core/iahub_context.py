from dataclasses import dataclass
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

    try:
        user_id = int(user_raw) if user_raw else None
    except (TypeError, ValueError):
        user_id = None

    return IAHUBContext(company_id=company_id, user_id=user_id)
