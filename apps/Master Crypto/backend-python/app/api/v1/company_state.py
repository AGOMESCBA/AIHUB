from typing import Any, Dict

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.core.iahub_context import get_iahub_context
from app.persistence.company_store import DEFAULT_SETTINGS, store

router = APIRouter(prefix="/company", tags=["IAHUB Company State"])


class CompanySettingsUpdate(BaseModel):
    initial_bank_usd: float | None = Field(default=None, gt=0)
    risk_per_trade_pct: float | None = Field(default=None, gt=0, le=100)
    scanner_top_limit: int | None = Field(default=None, ge=1, le=100)
    scanner_timeframe: str | None = None
    min_risk_reward_ratio: float | None = Field(default=None, gt=0)
    mode: str | None = None

    def clean_patch(self) -> Dict[str, Any]:
        data = self.model_dump(exclude_none=True)
        if "scanner_timeframe" in data:
            data["scanner_timeframe"] = str(data["scanner_timeframe"] or DEFAULT_SETTINGS["scanner_timeframe"]).lower()
        if "mode" in data:
            data["mode"] = str(data["mode"] or DEFAULT_SETTINGS["mode"]).lower()
        return data


@router.get("/settings")
def get_company_settings(request: Request):
    ctx = get_iahub_context(request)
    return store.get_settings(ctx.company_id)


@router.put("/settings")
def update_company_settings(req: CompanySettingsUpdate, request: Request):
    ctx = get_iahub_context(request)
    return store.update_settings(ctx.company_id, req.clean_patch())


@router.get("/summary")
def get_company_summary(request: Request):
    ctx = get_iahub_context(request)
    return store.get_summary(ctx.company_id)
