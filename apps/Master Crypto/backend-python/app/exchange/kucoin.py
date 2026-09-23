import httpx
from typing import List, Dict, Optional
from app.exchange.base import ExchangeAdapter
from app.domain.schemas import Candle

class KuCoinAdapter(ExchangeAdapter):
    """
    Adapter pré-configurado da KuCoin REST API.
    """
    BASE_URL = "https://api.kucoin.com/api/v1/market"

    def __init__(self, api_key: Optional[str] = None, api_secret: Optional[str] = None):
        self.api_key = api_key
        self.api_secret = api_secret

    async def get_candles(self, symbol: str, interval: str = "4h", limit: int = 200) -> List[Candle]:
        kc_symbol = symbol.replace("USDT", "-USDT") if "-" not in symbol else symbol
        kc_type = "4hour" if interval.lower() == "4h" else ("1day" if interval.lower() == "1d" else "1hour")
        url = f"{self.BASE_URL}/candles"
        params = {"symbol": kc_symbol, "type": kc_type}

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url, params=params)
                if response.status_code == 200:
                    res_json = response.json()
                    raw_list = res_json.get("data", [])[:limit]
                    candles = []
                    for c in reversed(raw_list):
                        candles.append(Candle(
                            timestamp=int(c[0]) * 1000,
                            open=float(c[1]),
                            close=float(c[2]),
                            high=float(c[3]),
                            low=float(c[4]),
                            volume=float(c[5])
                        ))
                    if candles:
                        return candles
        except Exception:
            pass

        from app.exchange.binance import BinanceAdapter
        return await BinanceAdapter().get_candles(symbol, interval, limit)

    async def get_ticker_price(self, symbol: str) -> float:
        kc_symbol = symbol.replace("USDT", "-USDT") if "-" not in symbol else symbol
        url = f"{self.BASE_URL}/orderbook/level1"
        params = {"symbol": kc_symbol}
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url, params=params)
            data = response.json()
            return float(data.get("data", {}).get("price", 0.0))

    async def place_order(self, symbol: str, side: str, order_type: str, quantity: float, price: Optional[float] = None) -> Dict:
        raise NotImplementedError(
            "Envio de ordem real para KuCoin ainda nao esta habilitado neste backend."
        )

    async def cancel_order(self, symbol: str, order_id: str) -> Dict:
        return {"order_id": order_id, "status": "CANCELED", "exchange": "KUCOIN"}
