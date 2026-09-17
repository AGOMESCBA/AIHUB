import pytest
from app.domain.schemas import (
    PositionSizingInput,
    TradePlan,
    StrategyEnum,
    MarketRegimeEnum,
    Candle
)
from app.engines.risk_manager import RiskManager
from app.engines.opportunity_score import OpportunityScoreEngine
from app.engines.indicators import IndicatorEngine
from app.engines.regimes import RegimeEngine

def test_position_sizing_calculation():
    input_data = PositionSizingInput(
        account_balance=10000.0,
        risk_per_trade_pct=2.0,
        entry_price=100.0,
        stop_loss_price=95.0
    )
    result = RiskManager.calculate_position_size(input_data)
    
    assert result.max_loss_usd == 200.0
    assert result.stop_distance_pct == 5.0
    assert result.position_size_usd == 4000.0
    assert result.position_size_units == 40.0

def test_risk_manager_trade_plan_validation():
    valid_plan = TradePlan(
        symbol="BTCUSDT",
        strategy=StrategyEnum.BREAKOUT,
        entry_zone_min=60000,
        entry_zone_max=60500,
        stop_loss=59000,
        target_t1=62000,
        target_t2=63500,
        target_t3=65000,
        risk_reward_ratio=2.33,
        potential_gain_pct=5.4,
        invalidation_reason="Fechamento abaixo de 59000",
        reasons_for_entry=["Rompimento com volume"]
    )
    assert RiskManager.validate_trade_plan(valid_plan) is True

    invalid_rr_plan = valid_plan.model_copy(update={"risk_reward_ratio": 1.5})
    assert RiskManager.validate_trade_plan(invalid_rr_plan) is False

    invalid_potential_plan = valid_plan.model_copy(update={"potential_gain_pct": 3.2})
    assert RiskManager.validate_trade_plan(invalid_potential_plan) is False

def test_anti_chasing_rule():
    plan = TradePlan(
        symbol="SOLUSDT",
        strategy=StrategyEnum.PULLBACK,
        entry_zone_min=100.0,
        entry_zone_max=102.0,
        stop_loss=96.0,
        target_t1=106.0,
        target_t2=112.0,
        target_t3=115.0,
        risk_reward_ratio=2.5,
        potential_gain_pct=10.0,
        invalidation_reason="Stop loss",
        reasons_for_entry=["Pullback"]
    )

    # Preço dentro da zona: OK
    assert RiskManager.validate_anti_chasing(101.0, plan) is True

    # Preço subiu um pouco mas R/R ainda decente (preço 103, stop 96 -> risco 7; alvo 112 -> recompensa 9; R/R = 1.28 < 2.0) -> INVALIDA
    assert RiskManager.validate_anti_chasing(103.0, plan) is False

def test_opportunity_score_calculation():
    plan = TradePlan(
        symbol="ETHUSDT",
        strategy=StrategyEnum.RECOVERY,
        entry_zone_min=3000,
        entry_zone_max=3020,
        stop_loss=2900,
        target_t1=3150,
        target_t2=3250,
        target_t3=3400,
        risk_reward_ratio=2.27,
        potential_gain_pct=7.9,
        invalidation_reason="Perda do suporte",
        reasons_for_entry=["Suporte forte no diário"]
    )

    result = OpportunityScoreEngine.calculate_score(
        symbol="ETHUSDT",
        trend_score=90,
        price_struct_score=85,
        momentum_score=80,
        volume_score=75,
        regime_score=85,
        btc_score=80,
        mtf_score=70,
        regime=MarketRegimeEnum.RECOVERY,
        trade_plan=plan
    )

    assert result.total_score > 70.0
    assert result.is_valid_opportunity is True
    assert "trend_structure" in result.dimension_scores
    assert result.dimension_scores["trend_structure"] == 22.5

def test_indicator_engine_and_regimes():
    # Gerar dados sintéticos de subida
    candles = []
    base_price = 100.0
    for i in range(50):
        price = base_price + (i * 0.5)
        candles.append(Candle(
            timestamp=1700000000 + (i * 14400),
            open=price - 0.2,
            high=price + 0.5,
            low=price - 0.3,
            close=price,
            volume=1000.0 + (i * 10)
        ))

    df = IndicatorEngine.annotate_all_indicators(candles)
    assert "ema_9" in df.columns
    assert "rsi_14" in df.columns
    assert "atr_14" in df.columns
    assert "rvol" in df.columns

    regime = RegimeEngine.classify_regime(df)
    assert regime == MarketRegimeEnum.TRENDING_UP
