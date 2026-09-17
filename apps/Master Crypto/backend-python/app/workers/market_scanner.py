import asyncio
import logging
from typing import List, Dict, Optional
from app.domain.assets import TOP_20_BASELINE, fetch_dynamic_top_by_volume
from app.exchange.binance import BinanceAdapter
from app.engines.indicators import IndicatorEngine
from app.engines.regimes import RegimeEngine
from app.domain.schemas import MarketRegimeEnum, BTCContext

logger = logging.getLogger(__name__)

class MarketScanner:
    """
    Worker 24x7 de Scanner de Mercado (Fase 1)
    Coleta velas de múltiplos timeframes (4H, 1H, 1D) em paralelo para as Top N criptomoedas
    (configurável pelo usuário: Top 10, Top 20, Top 30, Top 50),
    calcula os indicadores e determina os regimes de mercado e contexto de BTC.
    """

    def __init__(self, adapter: Optional[BinanceAdapter] = None):
        self.adapter = adapter or BinanceAdapter()

    async def scan_single_symbol(self, symbol: str, timeframe: str = "4h") -> Dict:
        try:
            candles = await self.adapter.get_candles(symbol=symbol, interval=timeframe, limit=100)
            if not candles:
                return {"symbol": symbol, "status": "ERROR", "reason": "Sem dados"}

            df_annotated = IndicatorEngine.annotate_all_indicators(candles)
            regime = RegimeEngine.classify_regime(df_annotated)
            last_row = df_annotated.iloc[-1]

            return {
                "symbol": symbol,
                "timeframe": timeframe,
                "status": "OK",
                "current_price": float(last_row["close"]),
                "regime": regime.value,
                "rsi_14": float(last_row.get("rsi_14", 50.0)),
                "ema_21": float(last_row.get("ema_21", 0.0)),
                "ema_50": float(last_row.get("ema_50", 0.0)),
                "rvol": float(last_row.get("rvol", 1.0)),
                "candle_count": len(candles)
            }
        except Exception as e:
            logger.error(f"Erro ao escanear símbolo {symbol}: {str(e)}")
            return {"symbol": symbol, "status": "ERROR", "reason": str(e)}

    async def get_btc_context(self) -> BTCContext:
        btc_data = await self.scan_single_symbol("BTCUSDT", "4h")
        if btc_data["status"] == "OK":
            rsi = btc_data["rsi_14"]
            price = btc_data["current_price"]
            ema21 = btc_data["ema_21"]

            trend = "BULLISH" if price > ema21 else "BEARISH"
            score = 85.0 if trend == "BULLISH" else 40.0

            return BTCContext(trend_status=trend, rsi_14=rsi, score=score)

        return BTCContext(trend_status="NEUTRAL", rsi_14=50.0, score=50.0)

    async def scan_all_top(self, timeframe: str = "4h", top_limit: int = 20, use_dynamic: bool = True) -> List[Dict]:
        """
        Executa a varredura nas Top 'top_limit' moedas.
        """
        if use_dynamic:
            symbols = await fetch_dynamic_top_by_volume(top_limit=top_limit)
        else:
            symbols = TOP_20_BASELINE[:top_limit]

        tasks = [self.scan_single_symbol(sym, timeframe) for sym in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        scanned = []
        for res in results:
            if isinstance(res, dict):
                scanned.append(res)
        return scanned
