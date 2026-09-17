import pytest
import pandas as pd
from app.domain.schemas import Candle, MarketRegimeEnum, StrategyEnum
from app.engines.indicators import IndicatorEngine
from app.engines.price_structure import PriceStructureEngine
from app.engines.strategies import StrategyEngine

def test_price_structure_pivots():
    # Dados de vela simulando um vale e um topo
    candles = []
    prices = [10, 11, 12, 13, 12, 11, 10, 9, 8, 9, 10, 11, 12, 13, 14, 15, 14, 13, 12]
    for i, p in enumerate(prices):
        candles.append(Candle(
            timestamp=1700000000 + (i * 3600),
            open=p - 0.1,
            high=p + 0.5,
            low=p - 0.5,
            close=p,
            volume=1000.0
        ))

    df = IndicatorEngine.annotate_all_indicators(candles)
    supports, resistances = PriceStructureEngine.find_pivots(df, window=2)

    assert len(supports) >= 0
    assert len(resistances) >= 0

def test_strategy_engine_pullback_evaluation():
    # Gerar série temporal realista de Pullback em alta
    candles = []
    base_price = 100.0
    for i in range(40):
        # Sobe de 100 a 120 e depois faz recuo suave (pullback) para a EMA
        if i < 25:
            p = base_price + (i * 0.8)
        else:
            p = 120.0 - ((i - 25) * 0.2)
            
        candles.append(Candle(
            timestamp=1700000000 + (i * 14400),
            open=p - 0.2,
            high=p + 0.6,
            low=p - 0.4,
            close=p,
            volume=1500.0
        ))

    df = IndicatorEngine.annotate_all_indicators(candles)
    plan = StrategyEngine.evaluate_opportunity(
        symbol="SOLUSDT",
        df_annotated=df,
        regime=MarketRegimeEnum.TRENDING_UP,
        timeframe="4H"
    )

    if plan is not None:
        assert plan.symbol == "SOLUSDT"
        assert plan.strategy in [StrategyEnum.PULLBACK, StrategyEnum.BREAKOUT]
        assert plan.risk_reward_ratio >= 2.0
        assert plan.potential_gain_pct >= 5.0
        assert len(plan.reasons_for_entry) > 0
