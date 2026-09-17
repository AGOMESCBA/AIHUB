import pandas as pd
import numpy as np
from typing import List, Dict, Optional
from pydantic import BaseModel
from app.domain.schemas import Candle, MarketRegimeEnum
from app.engines.indicators import IndicatorEngine
from app.engines.regimes import RegimeEngine
from app.engines.strategies import StrategyEngine

class BacktestResult(BaseModel):
    symbol: str
    timeframe: str
    total_candles_analyzed: int
    total_trades: int
    wins_count: int
    losses_count: int
    win_rate_pct: float
    net_return_pct: float
    max_drawdown_pct: float
    profit_factor: float
    trades: List[Dict]

class BacktestEngine:
    """
    Motor de Backtest Sem Viés de Futuro (Seção 14.2 & Seção L)
    Executa testes históricos determinísticos utilizando janela deslizante.
    """

    @classmethod
    def run_backtest(
        cls,
        candles: List[Candle],
        symbol: str = "SOLUSDT",
        timeframe: str = "4H",
        initial_capital: float = 10000.0
    ) -> BacktestResult:
        if not candles or len(candles) < 50:
            return BacktestResult(
                symbol=symbol,
                timeframe=timeframe,
                total_candles_analyzed=len(candles),
                total_trades=0,
                wins_count=0,
                losses_count=0,
                win_rate_pct=0.0,
                net_return_pct=0.0,
                max_drawdown_pct=0.0,
                profit_factor=0.0,
                trades=[]
            )

        df_full = IndicatorEngine.annotate_all_indicators(candles)
        capital = initial_capital
        peak_capital = initial_capital
        max_drawdown = 0.0
        trades_executed = []

        # Simulação com Janela Deslizante (Window Sliding) a partir do índice 30
        in_trade = False
        active_trade_plan = None
        entry_idx = 0

        for i in range(30, len(df_full) - 1):
            # Janela de dados disponível estritamente até i (sem enxergar i+1)
            df_window = df_full.iloc[:i + 1]
            current_candle = df_full.iloc[i]
            next_candle = df_full.iloc[i + 1]

            if not in_trade:
                regime = RegimeEngine.classify_regime(df_window)
                plan = StrategyEngine.evaluate_opportunity(
                    symbol=symbol,
                    df_annotated=df_window,
                    regime=regime,
                    timeframe=timeframe
                )

                if plan is not None:
                    # Abre operação na abertura da próxima vela (sem look-ahead bias)
                    in_trade = True
                    active_trade_plan = plan
                    entry_idx = i + 1
                    fill_price = float(next_candle["open"])
                    active_trade_plan.entry_zone_min = fill_price
            else:
                # Gerencia operação aberta
                high = float(current_candle["high"])
                low = float(current_candle["low"])
                stop = active_trade_plan.stop_loss
                target = active_trade_plan.target_t2

                if low <= stop:
                    # Stop loss atingido
                    pnl_pct = ((stop - active_trade_plan.entry_zone_min) / active_trade_plan.entry_zone_min) * 100.0
                    pnl_usd = capital * (pnl_pct / 100.0) * 0.02  # Risco de 2% do capital
                    capital += pnl_usd

                    trades_executed.append({
                        "entry_idx": entry_idx,
                        "exit_idx": i,
                        "strategy": active_trade_plan.strategy.value,
                        "result": "LOSS",
                        "pnl_pct": round(pnl_pct, 2),
                        "pnl_usd": round(pnl_usd, 2)
                    })
                    in_trade = False

                elif high >= target:
                    # Target atingido
                    pnl_pct = ((target - active_trade_plan.entry_zone_min) / active_trade_plan.entry_zone_min) * 100.0
                    pnl_usd = capital * (pnl_pct / 100.0) * 0.02
                    capital += pnl_usd

                    trades_executed.append({
                        "entry_idx": entry_idx,
                        "exit_idx": i,
                        "strategy": active_trade_plan.strategy.value,
                        "result": "WIN",
                        "pnl_pct": round(pnl_pct, 2),
                        "pnl_usd": round(pnl_usd, 2)
                    })
                    in_trade = False

            # Atualiza Max Drawdown
            peak_capital = max(peak_capital, capital)
            dd = ((peak_capital - capital) / peak_capital) * 100.0
            max_drawdown = max(max_drawdown, dd)

        wins = [t for t in trades_executed if t["result"] == "WIN"]
        losses = [t for t in trades_executed if t["result"] == "LOSS"]
        total_trades = len(trades_executed)

        win_rate = (len(wins) / total_trades) * 100.0 if total_trades > 0 else 0.0
        gross_profit = sum(t["pnl_usd"] for t in wins)
        gross_loss = abs(sum(t["pnl_usd"] for t in losses))
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (gross_profit if gross_profit > 0 else 0.0)
        net_return_pct = ((capital - initial_capital) / initial_capital) * 100.0

        return BacktestResult(
            symbol=symbol,
            timeframe=timeframe,
            total_candles_analyzed=len(df_full),
            total_trades=total_trades,
            wins_count=len(wins),
            losses_count=len(losses),
            win_rate_pct=round(win_rate, 2),
            net_return_pct=round(net_return_pct, 2),
            max_drawdown_pct=round(max_drawdown, 2),
            profit_factor=round(profit_factor, 2),
            trades=trades_executed
        )
