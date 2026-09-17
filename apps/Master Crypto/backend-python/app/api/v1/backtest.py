from fastapi import APIRouter
from app.backtest.backtest_engine import BacktestEngine, BacktestResult
from app.exchange.binance import BinanceAdapter

router = APIRouter(prefix="/backtest", tags=["Backtest Engine"])

@router.get("/run")
async def run_backtest_endpoint(symbol: str = "SOLUSDT", timeframe: str = "4h", limit: int = 300):
    adapter = BinanceAdapter()
    candles = await adapter.get_candles(symbol=symbol, interval=timeframe, limit=limit)
    
    result = BacktestEngine.run_backtest(
        candles=candles,
        symbol=symbol,
        timeframe=timeframe.upper()
    )

    return result
