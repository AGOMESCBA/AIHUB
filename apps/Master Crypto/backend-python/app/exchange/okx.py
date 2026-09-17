import httpx
from typing import List, Dict, Optional
from app.exchange.base import ExchangeAdapter
from app.domain.schemas import Candle

class OKXAdapter(ExchangeAdapter):
    """
    Adapter pré-configurado da OKX V5 REST API.
    """
    BASE_URL = "https://www.okx.com/api/v5/market"

    def __init__(self, api_key: Optional[str] = None, api_secret: Optional[str] = None):
        self.api_key = api_key
        self.api_secret = api_secret

    async def get_candles(self, symbol: str, interval: str = "4h", limit: int = 200) -> List[Candle]:
        okx_symbol = symbol.replace("USDT", "-USDT") if "-" not in symbol else symbol
        okx_bar = "4H" if interval.lower() == "4h" else ("1D" if interval.lower() == "1d" else "1H")
        url = f"{self.BASE_URL}/candles"
        params = {"instId": okx_symbol, "bar": okx_bar, "limit": limit}

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url, params=params)
                if response.status_code == 200:
                    res_json = response.json()
                    raw_list = res_json.get("data", [])
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

        from app.exchange.binance import BinanceAdapter
        return await BinanceAdapter().get_candles(symbol, interval, limit)

    async def get_ticker_price(self, symbol: str) -> float:
        okx_symbol = symbol.replace("USDT", "-USDT") if "-" not in symbol else symbol
        url = f"{self.BASE_URL}/ticker"
        params = {"instId": okx_symbol}
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url, params=params)
            data = response.json()
            tickers = data.get("data", [])
            if tickers:
                return float(tickers[0].get("last", 0.0))
        return 0.0

    async def place_order(self, symbol: str, side: str, order_type: str, quantity: float, price: Optional[float] = None) -> Dict:
        return {"order_id": "okx_simulated_123", "symbol": symbol, "status": "FILLED", "exchange": "OKX"}

    async def cancel_order(self, symbol: str, order_id: str) -> Dict:
        return {"order_id": order_id, "status": "CANCELED", "exchange": "OKX"}
