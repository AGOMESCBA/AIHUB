import pytest
from app.workers.market_scanner import MarketScanner
from app.domain.assets import fetch_dynamic_top_by_volume
from app.domain.schemas import Candle


class FakeAdapter:
    async def get_candles(self, symbol: str, interval: str = "4h", limit: int = 200):
        return [
            Candle(
                timestamp=i,
                open=100 + i,
                high=102 + i,
                low=99 + i,
                close=101 + i,
                volume=1000 + i,
            )
            for i in range(limit)
        ]

@pytest.mark.asyncio
async def test_dynamic_top_limit_fetch():
    top5 = await fetch_dynamic_top_by_volume(top_limit=5)
    assert len(top5) == 5
    assert "BTCUSDT" in top5 or "ETHUSDT" in top5

    top10 = await fetch_dynamic_top_by_volume(top_limit=10)
    assert len(top10) == 10

@pytest.mark.asyncio
async def test_market_scanner_with_custom_top_limit(monkeypatch):
    async def fake_top(top_limit: int = 20):
        return ["BTCUSDT", "ETHUSDT", "SOLUSDT"][:top_limit]

    monkeypatch.setattr("app.workers.market_scanner.fetch_dynamic_top_by_volume", fake_top)
    scanner = MarketScanner(adapter=FakeAdapter())
    results = await scanner.scan_all_top(timeframe="4h", top_limit=3, use_dynamic=True)
    
    assert len(results) == 3
    for res in results:
        assert res["status"] == "OK"
        assert res["current_price"] > 0.0

@pytest.mark.asyncio
async def test_btc_context_scanner():
    scanner = MarketScanner(adapter=FakeAdapter())
    btc_ctx = await scanner.get_btc_context()
    assert btc_ctx.trend_status in ["BULLISH", "BEARISH", "NEUTRAL"]
    assert 0.0 <= btc_ctx.score <= 100.0
