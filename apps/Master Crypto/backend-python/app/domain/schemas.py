from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field

class MarketRegimeEnum(str, Enum):
    TRENDING_UP = "TRENDING_UP"
    TRENDING_DOWN = "TRENDING_DOWN"
    SIDEWAYS = "SIDEWAYS"
    RECOVERY = "RECOVERY"
    HIGH_VOLATILITY = "HIGH_VOLATILITY"

class StrategyEnum(str, Enum):
    PULLBACK = "PULLBACK"
    RECOVERY = "RECOVERY"
    BREAKOUT = "BREAKOUT"
    MOMENTUM = "MOMENTUM"

class OpportunityStateEnum(str, Enum):
    DETECTED = "DETECTED"
    OBSERVING = "OBSERVING"
    APPROACHING_ENTRY = "APPROACHING_ENTRY"
    ENTRY_ZONE = "ENTRY_ZONE"
    CONFIRMED = "CONFIRMED"
    OPEN_TRADE = "OPEN_TRADE"
    MANAGEMENT = "MANAGEMENT"
    PARTIAL_TARGET = "PARTIAL_TARGET"
    CLOSED_PROFIT = "CLOSED_PROFIT"
    CLOSED_LOSS = "CLOSED_LOSS"
    CANCELLED = "CANCELLED"
    INVALIDATED = "INVALIDATED"

class Candle(BaseModel):
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float

class BTCContext(BaseModel):
    trend_status: str  # BULLISH, BEARISH, NEUTRAL
    rsi_14: float
    score: float  # 0 a 100

class TradePlan(BaseModel):
    symbol: str
    timeframe: str = "4H"
    strategy: StrategyEnum
    entry_zone_min: float
    entry_zone_max: float
    stop_loss: float
    target_t1: float
    target_t2: float  # ~5% alvo principal
    target_t3: float  # ~8-10% extensão
    risk_reward_ratio: float
    potential_gain_pct: float
    invalidation_reason: str
    reasons_for_entry: List[str]

class OpportunityScoreResult(BaseModel):
    symbol: str
    total_score: float  # 0 a 100
    dimension_scores: Dict[str, float]
    regime: MarketRegimeEnum
    trade_plan: Optional[TradePlan] = None
    is_valid_opportunity: bool = False

class PositionSizingInput(BaseModel):
    account_balance: float
    risk_per_trade_pct: float = 2.0
    entry_price: float
    stop_loss_price: float

class PositionSizingResult(BaseModel):
    position_size_usd: float
    position_size_units: float
    max_loss_usd: float
    risk_pct_actual: float
    stop_distance_pct: float
