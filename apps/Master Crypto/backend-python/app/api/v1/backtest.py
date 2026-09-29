from fastapi import APIRouter, Query
from app.backtest.backtest_engine import BacktestEngine, BacktestResult
from app.core.request_validation import Timeframe, normalize_symbol
from app.exchange.binance import BinanceAdapter

router = APIRouter(prefix="/backtest", tags=["Backtest Engine"])

@router.get("/run")
async def run_backtest_endpoint(
    symbol: str = "SOLUSDT",
    timeframe: Timeframe = "4h",
    limit: int = Query(300, ge=50, le=1000),
):
    symbol = normalize_symbol(symbol)
    adapter = BinanceAdapter()
    candles = await adapter.get_candles(symbol=symbol, interval=timeframe, limit=limit)
    
    result = BacktestEngine.run_backtest(
        candles=candles,
        symbol=symbol,
        timeframe=timeframe.upper()
    )

    return result
