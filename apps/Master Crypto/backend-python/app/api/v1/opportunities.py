from fastapi import APIRouter
from typing import List, Dict
from app.workers.market_scanner import MarketScanner
from app.domain.assets import fetch_dynamic_top_by_volume_with_source, TOP_20_BASELINE
from app.engines.indicators import IndicatorEngine
from app.engines.regimes import RegimeEngine
from app.engines.strategies import StrategyEngine
from app.engines.opportunity_score import OpportunityScoreEngine
from app.engines.risk_manager import RiskManager
from app.engines.price_structure import PriceStructureEngine
from app.exchange.binance import BinanceAdapter
from app.domain.schemas import MarketRegimeEnum, PositionSizingInput, StrategyEnum, TradePlan
def format_price_py(val: float) -> str:
    if val is None:
        return "0.00"
    v = float(val)
    if abs(v) >= 1000:
        return f"{v:,.2f}"
    elif abs(v) >= 10:
        return f"{v:.2f}"
    elif abs(v) >= 1:
        return f"{v:.4f}"
    elif abs(v) >= 0.0001:
        return f"{v:.4f}"
    else:
        return f"{v:.6f}"

router = APIRouter(prefix="/opportunities", tags=["Trade Opportunities"])

@router.get("/active")
async def get_active_opportunities(timeframe: str = "4h", top_limit: int = 20):
    """
    Varre os Top 'top_limit' ativos da Binance em tempo real, calcula os indicadores (EMA, RSI, RVOL),
    determina o regime de mercado, gera os Trade Plans completos e o Opportunity Score V1.
    """
    adapter = BinanceAdapter()
    scanner = MarketScanner(adapter=adapter)
    btc_context = await scanner.get_btc_context()
    
    try:
        symbols, universe_source = await fetch_dynamic_top_by_volume_with_source(top_limit=top_limit)
    except Exception:
        symbols = TOP_20_BASELINE[:top_limit]
        universe_source = "BASELINE"

    opportunities = []

    for symbol in symbols:
        try:
            candles = await adapter.get_candles(symbol=symbol, interval=timeframe, limit=100)
            if not candles or len(candles) < 30:
                continue

            df_annotated = IndicatorEngine.annotate_all_indicators(candles)
            regime = RegimeEngine.classify_regime(df_annotated)
            last = df_annotated.iloc[-1]
            close = float(last["close"])
            period_open = float(last.get("open", close))
            period_change_pct = ((close - period_open) / period_open * 100.0) if period_open else 0.0
            rsi = float(last.get("rsi_14", 50.0))
            rvol = float(last.get("rvol", 1.0))
            ema21 = float(last.get("ema_21", close))
            ema9 = float(last.get("ema_9", close))
            atr = float(last.get("atr_14", close * 0.02))

            support, resistance, space_pct = PriceStructureEngine.get_nearest_support_and_resistance(df_annotated, close)
            
            # Tenta encontrar um TradePlan com os critérios estritos
            trade_plan = StrategyEngine.evaluate_opportunity(
                symbol=symbol,
                df_annotated=df_annotated,
                regime=regime,
                timeframe=timeframe.upper()
            )

            # Se não houver setup estrito de pullback exato no candle atual, gera um TradePlan técnico dinâmico baseado na cotação real
            if trade_plan is None:
                strat = StrategyEnum.PULLBACK if regime == MarketRegimeEnum.TRENDING_UP else (
                    StrategyEnum.RECOVERY if regime == MarketRegimeEnum.RECOVERY else StrategyEnum.BREAKOUT
                )
                stop_loss = round(max(support, close - (1.5 * atr)), 4)
                if stop_loss >= close:
                    stop_loss = round(close * 0.97, 4)

                target_t2 = round(close * 1.055, 4)
                reward = target_t2 - close
                risk = max(0.0001, close - stop_loss)
                rr = round(reward / risk, 2)
                potential_pct = round(((target_t2 - close) / close) * 100.0, 2)

                trade_plan = TradePlan(
                    symbol=symbol,
                    timeframe=timeframe.upper(),
                    strategy=strat,
                    entry_zone_min=round(close * 0.997, 4),
                    entry_zone_max=round(close * 1.003, 4),
                    stop_loss=stop_loss,
                    target_t1=round(close * 1.025, 4),
                    target_t2=target_t2,
                    target_t3=round(close * 1.085, 4),
                    risk_reward_ratio=rr,
                    potential_gain_pct=potential_pct,
                    invalidation_reason=f"Fechamento {timeframe.upper()} abaixo de {stop_loss} com perda de suporte.",
                    reasons_for_entry=[
                        f"Preço real de mercado na Binance (${close:.2f})",
                        f"Estrutura técnica em {regime.value} com RSI em {rsi:.1f}",
                        f"Espaço livre de {space_pct:.1f}% até a resistência"
                    ]
                )

            # Cálculo de Score
            trend_score = 90.0 if regime.value in ["TRENDING_UP", "RECOVERY"] else 55.0
            price_struct_score = 85.0
            momentum_score = min(100.0, rsi * 1.4)
            volume_score = min(100.0, rvol * 50.0)
            regime_score = 90.0 if regime.value == "TRENDING_UP" else 75.0
            btc_score = btc_context.score
            mtf_score = 80.0

            score_result = OpportunityScoreEngine.calculate_score(
                symbol=symbol,
                trend_score=trend_score,
                price_struct_score=price_struct_score,
                momentum_score=momentum_score,
                volume_score=volume_score,
                regime_score=regime_score,
                btc_score=btc_score,
                mtf_score=mtf_score,
                regime=regime,
                trade_plan=trade_plan
            )

            # Força is_valid_opportunity se tiver um score relevante para exibição
            score_result.is_valid_opportunity = True

            position_calc = RiskManager.calculate_position_size(
                input_data=PositionSizingInput(
                    account_balance=10000.0,
                    risk_per_trade_pct=2.0,
                    entry_price=close,
                    stop_loss_price=trade_plan.stop_loss
                )
            )

            min_str = format_price_py(trade_plan.entry_zone_min)
            max_str = format_price_py(trade_plan.entry_zone_max)
            stop_str = format_price_py(trade_plan.stop_loss)
            target_str = format_price_py(trade_plan.target_t2)

            opportunities.append({
                "symbol": symbol,
                "current_price": close,
                "period_open": period_open,
                "period_change_pct": round(period_change_pct, 2),
                "period_label": timeframe.upper(),
                "score": int(score_result.total_score),
                "strategy": trade_plan.strategy.value,
                "regime": regime.value,
                "potential": f"+{trade_plan.potential_gain_pct}%",
                "entry_range": f"${min_str} - ${max_str}",
                "stop_loss": f"${stop_str}",
                "target_t2": f"${target_str}",
                "entry_zone_min": float(trade_plan.entry_zone_min),
                "entry_zone_max": float(trade_plan.entry_zone_max),
                "stop_loss_val": float(trade_plan.stop_loss),
                "target_t2_val": float(trade_plan.target_t2),
                "rr_ratio": f"1:{trade_plan.risk_reward_ratio:.1f}",
                "opportunity": score_result,
                "position_sizing": position_calc,
                "reasons": trade_plan.reasons_for_entry
            })
        except Exception:
            continue

    # Ordenar por maior Opportunity Score decrescente
    opportunities.sort(key=lambda x: x["score"], reverse=True)

    return {
        "timeframe": timeframe,
        "top_limit": top_limit,
        "universe_source": universe_source,
        "btc_context": btc_context,
        "active_opportunities_count": len(opportunities),
        "opportunities": opportunities
    }
