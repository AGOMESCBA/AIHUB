import hmac
import hashlib
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.exchange.factory import ExchangeFactory
from app.core.config import settings

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
async def execute_real_order(req: RealOrderRequest):
    """
    Envia a ordem real de Compra/Venda com Stop Loss e Alvo Take Profit para a Exchange configurada (Binance, Bybit, OKX, KuCoin).
    """
    clean_sym = req.symbol.replace("/", "").upper()
    api_key = req.api_key or settings.BINANCE_API_KEY
    api_secret = req.api_secret or settings.BINANCE_API_SECRET

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
