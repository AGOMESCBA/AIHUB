from fastapi import APIRouter
from typing import List, Dict
from app.workers.market_scanner import MarketScanner
from app.domain.assets import fetch_dynamic_top_by_volume
from app.engines.indicators import IndicatorEngine
from app.engines.regimes import RegimeEngine
from app.engines.strategies import StrategyEngine
from app.engines.opportunity_score import OpportunityScoreEngine
from app.engines.risk_manager import RiskManager
from app.exchange.binance import BinanceAdapter

router = APIRouter(prefix="/opportunities", tags=["Trade Opportunities"])

@router.get("/active")
async def get_active_opportunities(timeframe: str = "4h", top_limit: int = 20):
    """
    Varre os Top 'top_limit' ativos em tempo real, aplica as 4 Estratégias V1,
    calcula o Opportunity Score V1 e gera os Trade Plans completos.
    """
    adapter = BinanceAdapter()
    scanner = MarketScanner(adapter=adapter)
    btc_context = await scanner.get_btc_context()
    
    symbols = await fetch_dynamic_top_by_volume(top_limit=top_limit)
    opportunities = []

    for symbol in symbols:
        try:
            candles = await adapter.get_candles(symbol=symbol, interval=timeframe, limit=100)
            if not candles:
                continue

            df_annotated = IndicatorEngine.annotate_all_indicators(candles)
            regime = RegimeEngine.classify_regime(df_annotated)
            
            # Avalia se há setup pelas Estratégias V1
            trade_plan = StrategyEngine.evaluate_opportunity(
                symbol=symbol,
                df_annotated=df_annotated,
                regime=regime,
                timeframe=timeframe.upper()
            )

            if trade_plan is not None:
                # Pontuações por dimensão
                last = df_annotated.iloc[-1]
                trend_score = 90.0 if regime.value in ["TRENDING_UP", "RECOVERY"] else 50.0
                price_struct_score = 85.0
                momentum_score = min(100.0, float(last.get("rsi_14", 50.0)) * 1.4)
                volume_score = min(100.0, float(last.get("rvol", 1.0)) * 50.0)
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

                if score_result.is_valid_opportunity:
                    # Calcula Position Sizing recomendado
                    position_calc = RiskManager.calculate_position_size(
                        input_data={
                            "account_balance": 10000.0,
                            "risk_per_trade_pct": 2.0,
                            "entry_price": (trade_plan.entry_zone_min + trade_plan.entry_zone_max) / 2.0,
                            "stop_loss_price": trade_plan.stop_loss
                        }
                    )

                    opportunities.append({
                        "symbol": symbol,
                        "opportunity": score_result,
                        "position_sizing": position_calc
                    })
        except Exception:
            continue

    # Ordenar por maior Opportunity Score decrescente
    opportunities.sort(key=lambda x: x["opportunity"].total_score, reverse=True)

    return {
        "timeframe": timeframe,
        "top_limit": top_limit,
        "btc_context": btc_context,
        "active_opportunities_count": len(opportunities),
        "opportunities": opportunities
    }
