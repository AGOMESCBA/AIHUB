from typing import Dict
from app.domain.schemas import (
    OpportunityScoreResult,
    MarketRegimeEnum,
    TradePlan,
    StrategyEnum
)
from app.engines.risk_manager import RiskManager

class OpportunityScoreEngine:
    """
    Motor de Cálculo do Opportunity Score V1 (Seção 5)
    Calcula uma pontuação ponderada de 0 a 100 auditável e não-colinear.
    """

    WEIGHTS = {
        "trend_structure": 0.25,
        "price_structure": 0.20,
        "momentum": 0.15,
        "volume_confirmation": 0.15,
        "regime_strength": 0.10,
        "btc_context": 0.10,
        "multi_timeframe": 0.05
    }

    @classmethod
    def calculate_score(
        self,
        symbol: str,
        trend_score: float,        # 0 - 100
        price_struct_score: float, # 0 - 100
        momentum_score: float,     # 0 - 100
        volume_score: float,       # 0 - 100
        regime_score: float,       # 0 - 100
        btc_score: float,          # 0 - 100
        mtf_score: float,          # 0 - 100
        regime: MarketRegimeEnum,
        trade_plan: TradePlan
    ) -> OpportunityScoreResult:

        dimensions: Dict[str, float] = {
            "trend_structure": round(trend_score * self.WEIGHTS["trend_structure"], 2),
            "price_structure": round(price_struct_score * self.WEIGHTS["price_structure"], 2),
            "momentum": round(momentum_score * self.WEIGHTS["momentum"], 2),
            "volume_confirmation": round(volume_score * self.WEIGHTS["volume_confirmation"], 2),
            "regime_strength": round(regime_score * self.WEIGHTS["regime_strength"], 2),
            "btc_context": round(btc_score * self.WEIGHTS["btc_context"], 2),
            "multi_timeframe": round(mtf_score * self.WEIGHTS["multi_timeframe"], 2)
        }

        total_score = round(sum(dimensions.values()), 2)

        # Validação rígida com o Risk Manager
        is_risk_valid = RiskManager.validate_trade_plan(trade_plan)
        is_valid = (total_score >= 70.0) and is_risk_valid

        return OpportunityScoreResult(
            symbol=symbol,
            total_score=total_score,
            dimension_scores=dimensions,
            regime=regime,
            trade_plan=trade_plan,
            is_valid_opportunity=is_valid
        )
