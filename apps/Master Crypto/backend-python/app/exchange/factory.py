from app.exchange.base import ExchangeAdapter
from app.exchange.binance import BinanceAdapter
from app.exchange.bybit import BybitAdapter
from app.exchange.okx import OKXAdapter
from app.exchange.kucoin import KuCoinAdapter

class ExchangeFactory:
    """
    Factory pattern para suportar Binance, Bybit, OKX e KuCoin de forma dinâmica.
    """
    @staticmethod
    def get_adapter(exchange_name: str = "BINANCE", api_key: str = "", api_secret: str = "") -> ExchangeAdapter:
        name = exchange_name.upper().strip()
        if name == "BYBIT":
            return BybitAdapter(api_key=api_key, api_secret=api_secret)
        elif name == "OKX":
            return OKXAdapter(api_key=api_key, api_secret=api_secret)
        elif name == "KUCOIN":
            return KuCoinAdapter(api_key=api_key, api_secret=api_secret)
        else:
            return BinanceAdapter(api_key=api_key, api_secret=api_secret)
