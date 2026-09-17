import pandas as pd
from typing import Optional, List
from app.domain.schemas import TradePlan, StrategyEnum, MarketRegimeEnum
from app.engines.price_structure import PriceStructureEngine
from app.core.config import settings

class StrategyEngine:
    """
    Motor de Estratégias V1 (Seção 4.1)
    Implementa as 4 estratégias: Pullback, Recovery, Breakout e Momentum.
    Regime -> Estratégia -> Oportunidade / Trade Plan.
    """

    @classmethod
    def evaluate_opportunity(
        cls,
        symbol: str,
        df_annotated: pd.DataFrame,
        regime: MarketRegimeEnum,
        timeframe: str = "4H"
    ) -> Optional[TradePlan]:
        if df_annotated.empty or len(df_annotated) < 30:
            return None

        last = df_annotated.iloc[-1]
        close = float(last["close"])
        ema9 = float(last.get("ema_9", close))
        ema21 = float(last.get("ema_21", close))
        rsi = float(last.get("rsi_14", 50.0))
        rvol = float(last.get("rvol", 1.0))
        atr = float(last.get("atr_14", close * 0.02))

        support, resistance, space_pct = PriceStructureEngine.get_nearest_support_and_resistance(df_annotated, close)

        # 1. Estratégia Pullback em Tendência
        if regime == MarketRegimeEnum.TRENDING_UP:
            # Preço fez pullback próximo da EMA 21 ou EMA 9 com RSI saudável (45 a 65)
            if abs(close - ema21) / close <= 0.02 and rsi >= 45.0:
                stop_loss = round(min(support, close - (1.5 * atr)), 4)
                risk = close - stop_loss
                if risk <= 0:
                    return None

                target_t2 = round(close * 1.053, 4)  # ~5.3% alvo principal
                reward = target_t2 - close
                rr = round(reward / risk, 2)
                potential_pct = round(((target_t2 - close) / close) * 100.0, 2)

                if rr >= settings.MIN_RISK_REWARD_RATIO and potential_pct >= settings.MIN_TECHNICAL_POTENTIAL_PCT:
                    return TradePlan(
                        symbol=symbol,
                        timeframe=timeframe,
                        strategy=StrategyEnum.PULLBACK,
                        entry_zone_min=round(close * 0.997, 4),
                        entry_zone_max=round(close * 1.003, 4),
                        stop_loss=stop_loss,
                        target_t1=round(close * 1.025, 4),
                        target_t2=target_t2,
                        target_t3=round(close * 1.085, 4),
                        risk_reward_ratio=rr,
                        potential_gain_pct=potential_pct,
                        invalidation_reason=f"Fechamento {timeframe} abaixo de {stop_loss} com perda de suporte.",
                        reasons_for_entry=[
                            f"Pullback saudável na EMA 21 ({ema21:.2f})",
                            f"Regime {regime.value} com RSI em {rsi:.1f}",
                            f"Espaço técnico favorável de {space_pct:.1f}% até a resistência"
                        ]
                    )

        # 2. Estratégia Recovery / Reversal
        if regime == MarketRegimeEnum.RECOVERY:
            if close > ema9 and rsi >= 42.0:
                stop_loss = round(support * 0.99, 4)
                risk = close - stop_loss
                if risk <= 0:
                    return None

                target_t2 = round(close * 1.055, 4)  # ~5.5%
                reward = target_t2 - close
                rr = round(reward / risk, 2)
                potential_pct = round(((target_t2 - close) / close) * 100.0, 2)

                if rr >= settings.MIN_RISK_REWARD_RATIO and potential_pct >= settings.MIN_TECHNICAL_POTENTIAL_PCT:
                    return TradePlan(
                        symbol=symbol,
                        timeframe=timeframe,
                        strategy=StrategyEnum.RECOVERY,
                        entry_zone_min=round(close * 0.996, 4),
                        entry_zone_max=round(close * 1.004, 4),
                        stop_loss=stop_loss,
                        target_t1=round(close * 1.025, 4),
                        target_t2=target_t2,
                        target_t3=round(close * 1.09, 4),
                        risk_reward_ratio=rr,
                        potential_gain_pct=potential_pct,
                        invalidation_reason=f"Perda do suporte de recuperação em {stop_loss}.",
                        reasons_for_entry=[
                            f"Reversão a partir do suporte chave em {support:.2f}",
                            f"Cruzamento altista acima da EMA 9 ({ema9:.2f})",
                            f"RSI 14 em recuperação ({rsi:.1f})"
                        ]
                    )

        # 3. Estratégia Breakout
        if rvol >= 1.25 and close >= (resistance * 0.998):
            stop_loss = round(close - (1.2 * atr), 4)
            risk = close - stop_loss
            if risk <= 0:
                return None

            target_t2 = round(close * 1.06, 4)  # ~6.0%
            reward = target_t2 - close
            rr = round(reward / risk, 2)
            potential_pct = round(((target_t2 - close) / close) * 100.0, 2)

            if rr >= settings.MIN_RISK_REWARD_RATIO and potential_pct >= settings.MIN_TECHNICAL_POTENTIAL_PCT:
                return TradePlan(
                    symbol=symbol,
                    timeframe=timeframe,
                    strategy=StrategyEnum.BREAKOUT,
                    entry_zone_min=round(close * 0.998, 4),
                    entry_zone_max=round(close * 1.005, 4),
                    stop_loss=stop_loss,
                    target_t1=round(close * 1.03, 4),
                    target_t2=target_t2,
                    target_t3=round(close * 1.10, 4),
                    risk_reward_ratio=rr,
                    potential_gain_pct=potential_pct,
                    invalidation_reason=f"Falso rompimento com fechamento abaixo de {stop_loss}.",
                    reasons_for_entry=[
                        f"Rompimento de resistência com Volume Relativo elevado (RVOL {rvol:.2f}x)",
                        f"Aceleração de preço acima de {resistance:.2f}",
                        f"Relação Risco/Retorno atrativa de 1:{rr}"
                    ]
                )

        return None
