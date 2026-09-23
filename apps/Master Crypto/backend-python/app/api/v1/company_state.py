import hashlib
import hmac
import time
from typing import Any, Dict
from urllib.parse import urlencode

import httpx
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
    radar_auto_refresh_seconds: int | None = Field(default=None, ge=0, le=86400)
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
        if "exchange_api_key" in data:
            data["exchange_api_key"] = str(data["exchange_api_key"] or "").strip()
        if "exchange_api_secret" in data:
            data["exchange_api_secret"] = str(data["exchange_api_secret"] or "").strip()
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


@router.get("/mobile-token")
def get_mobile_token(request: Request):
    ctx = get_iahub_context(request)
    return store.get_mobile_token(ctx.company_id)


@router.post("/mobile-token/regenerate")
def regenerate_mobile_token(request: Request):
    ctx = get_iahub_context(request)
    return store.regenerate_mobile_token(ctx.company_id)


@router.post("/test-exchange")
async def test_exchange_connection(req: ExchangeConnectionTest, request: Request):
    ctx = get_iahub_context(request)
    exchange = str(req.exchange or DEFAULT_SETTINGS["selected_exchange"]).upper()

    api_key = str(req.api_key or "").strip()
    api_secret = str(req.api_secret or "").strip()
    if not api_key or not api_secret:
        current = store.get_settings(ctx.company_id)
        api_key = api_key or str(current.get("exchange_api_key", "")).strip()
        api_secret = api_secret or str(current.get("exchange_api_secret", "")).strip()

    public_result = await _test_public_connection(exchange, api_key, api_secret)
    assets_result = await _test_assets_read(exchange, api_key, api_secret)
    success = bool(public_result.get("success") and assets_result.get("success"))
    return {
        "success": success,
        "exchange": exchange,
        "message": "Teste concluido.",
        "checks": {
            "connection": public_result,
            "assets": assets_result,
        },
    }


@router.post("/test-exchange/connection")
async def test_exchange_public_connection(req: ExchangeConnectionTest, request: Request):
    get_iahub_context(request)
    exchange = str(req.exchange or DEFAULT_SETTINGS["selected_exchange"]).upper()
    api_key = str(req.api_key or "").strip()
    api_secret = str(req.api_secret or "").strip()
    return await _test_public_connection(exchange, api_key, api_secret)


@router.post("/test-exchange/assets")
async def test_exchange_assets_read(req: ExchangeConnectionTest, request: Request):
    ctx = get_iahub_context(request)
    exchange = str(req.exchange or DEFAULT_SETTINGS["selected_exchange"]).upper()
    api_key = str(req.api_key or "").strip()
    api_secret = str(req.api_secret or "").strip()
    if not api_key or not api_secret:
        current = store.get_settings(ctx.company_id)
        api_key = api_key or str(current.get("exchange_api_key", "")).strip()
        api_secret = api_secret or str(current.get("exchange_api_secret", "")).strip()
    return await _test_assets_read(exchange, api_key, api_secret)


async def _test_public_connection(exchange: str, api_key: str, api_secret: str) -> Dict[str, Any]:
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
            "kind": "connection",
            "message": f"Conexao publica com {exchange} OK. BTCUSDT em {price:.2f}.",
            "btc_usdt": round(float(price), 8),
        }
    except Exception as exc:
        return {
            "success": False,
            "exchange": exchange,
            "kind": "connection",
            "message": f"Nao foi possivel conectar com {exchange}: {str(exc)}",
        }


async def _test_assets_read(exchange: str, api_key: str, api_secret: str) -> Dict[str, Any]:
    if exchange != "BINANCE":
        return {
            "success": False,
            "exchange": exchange,
            "kind": "assets",
            "message": "Leitura autenticada de ativos disponivel apenas para Binance nesta versao.",
        }
    try:
        account = await _get_binance_account(api_key, api_secret)
        balances = account.get("balances", [])
        assets_with_balance = [
            item for item in balances
            if float(item.get("free") or 0) + float(item.get("locked") or 0) > 0
        ]
        return {
            "success": True,
            "exchange": exchange,
            "kind": "assets",
            "message": f"Leitura autenticada OK. {len(assets_with_balance)} ativo(s) com saldo retornado(s).",
            "assets_count": len(assets_with_balance),
        }
    except Exception as exc:
        return {
            "success": False,
            "exchange": exchange,
            "kind": "assets",
            "message": f"Nao foi possivel ler ativos da conta Spot: {str(exc)}",
        }


async def _get_binance_account(api_key: str, api_secret: str) -> Dict[str, Any]:
    if not api_key or not api_secret:
        raise ValueError("Chaves da Binance nao configuradas para a empresa ativa.")

    timestamp = int(time.time() * 1000)
    query = urlencode({"timestamp": timestamp, "recvWindow": 5000})
    signature = hmac.new(api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
    url = f"https://api.binance.com/api/v3/account?{query}&signature={signature}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url, headers={"X-MBX-APIKEY": api_key})

    if response.status_code >= 400:
        detail = (response.text or "").strip()[:300]
        if "-2015" in detail or "Invalid API-key" in detail:
            detail = (
                "API Key/Secret sem acesso autenticado a conta Spot. Confira se a chave salva pertence "
                "a empresa ativa, se o IP de saida do backend esta liberado na Binance e se ha permissao de leitura."
            )
        raise ValueError(detail)
    return response.json()
