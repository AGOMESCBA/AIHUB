import pytest
from app.domain.schemas import TradePlan, StrategyEnum, Candle
from app.paper_trading.paper_engine import PaperTradingEngine
from app.backtest.backtest_engine import BacktestEngine

def test_paper_trading_execution_flow():
    engine = PaperTradingEngine()
    plan = TradePlan(
        symbol="BTCUSDT",
        strategy=StrategyEnum.PULLBACK,
        entry_zone_min=50000,
        entry_zone_max=50500,
        stop_loss=48000,
        target_t1=52000,
        target_t2=53500,
        target_t3=55000,
        risk_reward_ratio=2.33,
        potential_gain_pct=7.0,
        invalidation_reason="Stop loss",
        reasons_for_entry=["Pullback"]
    )

    # Abre trade virtual
    trade = engine.open_paper_trade(
        trade_id="trade_001",
        plan=plan,
        current_market_price=50200.0,
        position_size_usd=1000.0
    )
    assert trade is not None
    assert trade.status == "OPEN"

    # Simula vela que atinge o Alvo T2 (53500)
    updated = engine.update_trade_with_candle("trade_001", high=54000.0, low=50000.0, close=53800.0)
    assert updated.status == "CLOSED_PROFIT"
    assert updated.pnl_usd > 0.0

    # Verifica métricas consolidadas
    metrics = engine.get_performance_metrics()
    assert metrics["total_trades"] == 1
    assert metrics["wins_count"] == 1
    assert metrics["win_rate_pct"] == 100.0
    assert metrics["initial_bank_usd"] == 10000.0
    assert metrics["current_balance_usd"] > 10000.0

def test_paper_trading_manual_close():
    engine = PaperTradingEngine()
    plan = TradePlan(
        symbol="SOLUSDT",
        strategy=StrategyEnum.RECOVERY,
        entry_zone_min=140,
        entry_zone_max=142,
        stop_loss=135,
        target_t1=148,
        target_t2=152,
        target_t3=158,
        risk_reward_ratio=2.5,
        potential_gain_pct=7.5,
        invalidation_reason="Stop loss",
        reasons_for_entry=["Recovery"]
    )
    trade = engine.open_paper_trade(
        trade_id="trade_002",
        plan=plan,
        current_market_price=141.0,
        position_size_usd=1000.0
    )
    assert trade is not None

    closed = engine.close_paper_trade_manually("trade_002", current_price=146.0)
    assert closed is not None
    assert closed.status == "CLOSED_MANUAL"
    assert len(engine.active_trades) == 0
    assert len(engine.trade_history) == 1

def test_backtest_engine_execution():
    candles = []
    base_price = 100.0
    for i in range(100):
        price = base_price + (i * 0.5) if i < 60 else base_price + 30.0 - ((i - 60) * 0.3)
        candles.append(Candle(
            timestamp=1700000000 + (i * 14400),
            open=price - 0.2,
            high=price + 0.8,
            low=price - 0.5,
            close=price,
            volume=2000.0
        ))

    result = BacktestEngine.run_backtest(candles=candles, symbol="TESTUSDT", timeframe="4H")
    assert result.symbol == "TESTUSDT"
    assert result.total_candles_analyzed == 100
    assert result.win_rate_pct >= 0.0
    assert result.profit_factor >= 0.0
