import httpx
from typing import List, Dict, Optional
from app.exchange.base import ExchangeAdapter
from app.domain.schemas import Candle

class BybitAdapter(ExchangeAdapter):
    """
    Adapter pré-configurado da Bybit V5 REST API.
    """
    BASE_URL = "https://api.bybit.com/v5/market"

    def __init__(self, api_key: Optional[str] = None, api_secret: Optional[str] = None):
        self.api_key = api_key
        self.api_secret = api_secret

    async def get_candles(self, symbol: str, interval: str = "4h", limit: int = 200) -> List[Candle]:
        # Converter interval do padrão (4h, 1d) para formato Bybit V5 (240, D)
        bybit_interval = "240" if interval.lower() == "4h" else ("D" if interval.lower() == "1d" else "60")
        url = f"{self.BASE_URL}/kline"
        params = {"category": "spot", "symbol": symbol, "interval": bybit_interval, "limit": limit}

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url, params=params)
                if response.status_code == 200:
                    res_json = response.json()
                    raw_list = res_json.get("result", {}).get("list", [])
                    candles = []
                    for c in reversed(raw_list):
                        candles.append(Candle(
                            timestamp=int(c[0]),
                            open=float(c[1]),
                            high=float(c[2]),
                            low=float(c[3]),
                            close=float(c[4]),
                            volume=float(c[5])
                        ))
                    if candles:
                        return candles
        except Exception:
            pass

        # Fallback Binance em caso de falha de rota
        from app.exchange.binance import BinanceAdapter
        return await BinanceAdapter().get_candles(symbol, interval, limit)

    async def get_ticker_price(self, symbol: str) -> float:
        url = f"{self.BASE_URL}/tickers"
        params = {"category": "spot", "symbol": symbol}
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url, params=params)
            data = response.json()
            tickers = data.get("result", {}).get("list", [])
            if tickers:
                return float(tickers[0].get("lastPrice", 0.0))
        return 0.0

    async def place_order(self, symbol: str, side: str, order_type: str, quantity: float, price: Optional[float] = None) -> Dict:
        return {"order_id": "bybit_simulated_123", "symbol": symbol, "status": "FILLED", "exchange": "BYBIT"}

    async def cancel_order(self, symbol: str, order_id: str) -> Dict:
        return {"order_id": order_id, "status": "CANCELED", "exchange": "BYBIT"}
