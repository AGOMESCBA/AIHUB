import httpx
from typing import List, Dict, Optional
from app.exchange.base import ExchangeAdapter
from app.domain.schemas import Candle
from app.core.config import settings

class BinanceAdapter(ExchangeAdapter):
    """
    Implementação Padrão V1 do Adapter da Binance via REST API.
    """

    BASE_URL = "https://api.binance.com/api/v3"

    def __init__(self, api_key: Optional[str] = None, api_secret: Optional[str] = None):
        self.api_key = api_key or settings.BINANCE_API_KEY
        self.api_secret = api_secret or settings.BINANCE_API_SECRET

    async def get_candles(self, symbol: str, interval: str = "4h", limit: int = 200) -> List[Candle]:
        url = f"{self.BASE_URL}/klines"
        params = {"symbol": symbol, "interval": interval, "limit": limit}
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            raw_candles = response.json()

        candles = []
        for c in raw_candles:
            candles.append(Candle(
                timestamp=c[0],
                open=float(c[1]),
                high=float(c[2]),
                low=float(c[3]),
                close=float(c[4]),
                volume=float(c[5])
            ))
        return candles

    async def get_ticker_price(self, symbol: str) -> float:
        url = f"{self.BASE_URL}/ticker/price"
        params = {"symbol": symbol}
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            return float(data["price"])

    async def place_order(
        self,
        symbol: str,
        side: str,
        order_type: str,
        quantity: float,
        price: Optional[float] = None
    ) -> Dict:
        # Mock/Sandbox para V1 de desenvolvimento inicial
        return {
            "order_id": "simulated_order_12345",
            "symbol": symbol,
            "status": "FILLED" if order_type == "MARKET" else "NEW",
            "side": side,
            "quantity": quantity,
            "price": price or 0.0
        }

    async def cancel_order(self, symbol: str, order_id: str) -> Dict:
        return {"order_id": order_id, "status": "CANCELED"}
