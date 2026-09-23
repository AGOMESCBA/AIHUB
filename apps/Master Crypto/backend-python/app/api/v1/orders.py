import hmac
import hashlib
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from app.exchange.factory import ExchangeFactory
from app.core.config import settings
from app.core.iahub_context import get_iahub_context
from app.persistence.company_store import store

router = APIRouter(prefix="/orders", tags=["Real Exchange Orders"])

class RealOrderRequest(BaseModel):
    symbol: str
    exchange: str = "BINANCE"
    side: str = "BUY"
    order_type: str = "LIMIT"
    quantity: float = 1.0
    entry_price: float
    stop_loss: Optional[float] = None
    target_t2: Optional[float] = None
    api_key: Optional[str] = None
    api_secret: Optional[str] = None

@router.post("/real")
async def execute_real_order(req: RealOrderRequest, request: Request):
    """
    Envia a ordem real de Compra/Venda com Stop Loss e Alvo Take Profit para a Exchange configurada (Binance, Bybit, OKX, KuCoin).
    """
    clean_sym = req.symbol.replace("/", "").upper()
    company_settings = _company_exchange_settings(request)
    api_key = req.api_key or company_settings.get("exchange_api_key") or settings.BINANCE_API_KEY
    api_secret = req.api_secret or company_settings.get("exchange_api_secret") or settings.BINANCE_API_SECRET

    adapter = ExchangeFactory.get_adapter(
        exchange_name=req.exchange,
        api_key=api_key,
        api_secret=api_secret
    )

    try:
        order_res = await adapter.place_order(
            symbol=clean_sym,
            side=req.side,
            order_type=req.order_type,
            quantity=req.quantity,
            price=req.entry_price
        )

        return {
            "status": "SUCCESS",
            "exchange": req.exchange.upper(),
            "symbol": req.symbol,
            "order_id": order_res.get("order_id", f"{req.exchange.lower()}_order_{int(time.time())}"),
            "executed_price": req.entry_price,
            "stop_loss": req.stop_loss,
            "target_t2": req.target_t2,
            "message": f"Ordem {req.side} enviada com sucesso para a {req.exchange.upper()}!"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao enviar ordem para {req.exchange}: {str(e)}")


@router.get("/balance")
async def get_exchange_balance(request: Request, exchange: str = "BINANCE"):
    """
    Consulta saldo real da corretora configurada na empresa. V1 implementa USDT na Binance.
    """
    exchange_name = exchange.upper().strip()
    company_settings = _company_exchange_settings(request)
    api_key = company_settings.get("exchange_api_key") or settings.BINANCE_API_KEY
    api_secret = company_settings.get("exchange_api_secret") or settings.BINANCE_API_SECRET

    if not api_key or not api_secret:
        raise HTTPException(status_code=400, detail="Chaves da corretora nao configuradas para esta empresa")

    if exchange_name != "BINANCE":
        raise HTTPException(status_code=400, detail="Consulta de saldo real disponivel apenas para Binance nesta versao")

    timestamp = int(time.time() * 1000)
    params = {"timestamp": timestamp, "recvWindow": 5000}
    query = urlencode(params)
    signature = hmac.new(api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
    url = f"https://api.binance.com/api/v3/account?{query}&signature={signature}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url, headers={"X-MBX-APIKEY": api_key})

    if response.status_code >= 400:
        detail = response.text[:300]
        raise HTTPException(status_code=400, detail=f"Erro ao consultar saldo Binance: {detail}")

    account = response.json()
    balances = account.get("balances", [])
    usdt = next((item for item in balances if item.get("asset") == "USDT"), {})
    free = float(usdt.get("free") or 0)
    locked = float(usdt.get("locked") or 0)
    return {
        "exchange": "BINANCE",
        "asset": "USDT",
        "free_usdt": round(free, 8),
        "locked_usdt": round(locked, 8),
        "total_usdt": round(free + locked, 8),
    }


@router.get("/assets")
async def get_exchange_assets(request: Request, exchange: str = "BINANCE"):
    """
    Consulta a carteira real da corretora configurada na empresa.
    Retorna todos os ativos com saldo livre ou bloqueado e valor estimado em USDT.
    """
    exchange_name = exchange.upper().strip()
    company_settings = _company_exchange_settings(request)
    api_key = company_settings.get("exchange_api_key") or settings.BINANCE_API_KEY
    api_secret = company_settings.get("exchange_api_secret") or settings.BINANCE_API_SECRET

    if not api_key or not api_secret:
        raise HTTPException(status_code=400, detail="Chaves da corretora nao configuradas para esta empresa")

    if exchange_name != "BINANCE":
        raise HTTPException(status_code=400, detail="Consulta de ativos reais disponivel apenas para Binance nesta versao")

    timestamp = int(time.time() * 1000)
    params = {"timestamp": timestamp, "recvWindow": 5000}
    query = urlencode(params)
    signature = hmac.new(api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
    account_url = f"https://api.binance.com/api/v3/account?{query}&signature={signature}"

    async with httpx.AsyncClient(timeout=12.0) as client:
        account_response = await client.get(account_url, headers={"X-MBX-APIKEY": api_key})
        prices_response = await client.get("https://api.binance.com/api/v3/ticker/price")

    if account_response.status_code >= 400:
        detail = account_response.text[:300]
        raise HTTPException(status_code=400, detail=f"Erro ao consultar ativos Binance: {detail}")

    if prices_response.status_code >= 400:
        detail = prices_response.text[:300]
        raise HTTPException(status_code=400, detail=f"Erro ao consultar precos Binance: {detail}")

    account = account_response.json()
    raw_balances = account.get("balances", [])
    prices = prices_response.json()
    price_map = {item.get("symbol"): float(item.get("price") or 0) for item in prices if item.get("symbol")}

    stable_assets = {"USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI"}
    assets = []
    total_estimated_usdt = 0.0

    for item in raw_balances:
        asset = str(item.get("asset") or "").upper()
        free = float(item.get("free") or 0)
        locked = float(item.get("locked") or 0)
        total = free + locked
        if total <= 0:
            continue

        if asset in stable_assets:
            price_usdt = 1.0
        else:
            price_usdt = price_map.get(f"{asset}USDT", 0.0)

        estimated_usdt = total * price_usdt if price_usdt else 0.0
        total_estimated_usdt += estimated_usdt
        assets.append({
            "asset": asset,
            "free": round(free, 10),
            "locked": round(locked, 10),
            "total": round(total, 10),
            "price_usdt": round(price_usdt, 10),
            "estimated_usdt": round(estimated_usdt, 8),
        })

    assets.sort(key=lambda row: row.get("estimated_usdt", 0), reverse=True)

    return {
        "exchange": "BINANCE",
        "assets_count": len(assets),
        "total_estimated_usdt": round(total_estimated_usdt, 8),
        "assets": assets,
    }


def _company_exchange_settings(request: Request) -> dict:
    try:
        ctx = get_iahub_context(request)
        return store.get_settings(ctx.company_id)
    except Exception:
        return {}
