from typing import Any, Dict

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.core.iahub_context import get_iahub_context
from app.exchange.factory import ExchangeFactory
from app.persistence.company_store import DEFAULT_SETTINGS, store

router = APIRouter(prefix="/company", tags=["IAHUB Company State"])


class CompanySettingsUpdate(BaseModel):
    initial_bank_usd: float | None = Field(default=None, gt=0)
    risk_per_trade_pct: float | None = Field(default=None, gt=0, le=100)
    scanner_top_limit: int | None = Field(default=None, ge=1, le=100)
    scanner_timeframe: str | None = None
    min_risk_reward_ratio: float | None = Field(default=None, gt=0)
    mode: str | None = None
    selected_exchange: str | None = None
    exchange_api_key: str | None = None
    exchange_api_secret: str | None = None

    def clean_patch(self) -> Dict[str, Any]:
        data = self.model_dump(exclude_none=True)
        if "scanner_timeframe" in data:
            data["scanner_timeframe"] = str(data["scanner_timeframe"] or DEFAULT_SETTINGS["scanner_timeframe"]).lower()
        if "mode" in data:
            data["mode"] = str(data["mode"] or DEFAULT_SETTINGS["mode"]).lower()
        if "selected_exchange" in data:
            data["selected_exchange"] = str(data["selected_exchange"] or DEFAULT_SETTINGS["selected_exchange"]).upper()
        return data


class ExchangeConnectionTest(BaseModel):
    exchange: str = "BINANCE"
    api_key: str | None = None
    api_secret: str | None = None


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


@router.post("/test-exchange")
async def test_exchange_connection(req: ExchangeConnectionTest, request: Request):
    ctx = get_iahub_context(request)
    exchange = str(req.exchange or DEFAULT_SETTINGS["selected_exchange"]).upper()

    api_key = req.api_key or ""
    api_secret = req.api_secret or ""
    if not api_key or not api_secret:
        current = store.get_settings(ctx.company_id)
        api_key = api_key or current.get("exchange_api_key", "")
        api_secret = api_secret or current.get("exchange_api_secret", "")

    try:
        adapter = ExchangeFactory.get_adapter(
            exchange_name=exchange,
            api_key=api_key,
            api_secret=api_secret,
        )
        price = await adapter.get_ticker_price("BTCUSDT")
        return {
            "success": True,
            "exchange": exchange,
            "message": f"Conexao com {exchange} OK. BTCUSDT em {price:.2f}.",
        }
    except Exception as exc:
        return {
            "success": False,
            "exchange": exchange,
            "message": f"Nao foi possivel conectar com {exchange}: {str(exc)}",
        }
