from typing import List, Dict, Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from app.domain.schemas import TradePlan
from app.engines.risk_manager import RiskManager

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class PaperTrade(BaseModel):
    id: str
    symbol: str
    strategy: str
    status: str = "OPEN"  # OPEN, CLOSED_PROFIT, CLOSED_LOSS, CLOSED_MANUAL, INVALIDATED
    entry_price: float
    simulated_fill_price: float
    stop_loss: float
    target_t1: float
    target_t2: float
    target_t3: float
    quantity: float
    risk_reward_ratio: float
    max_favorable_excursion: float = 0.0  # MFE %
    max_adverse_excursion: float = 0.0   # MAE %
    pnl_usd: float = 0.0
    pnl_pct: float = 0.0
    opened_at: datetime = Field(default_factory=utc_now)
    closed_at: Optional[datetime] = None
    close_reason: Optional[str] = None

class PaperTradingEngine:
    """
    Motor de Paper Trading Autônomo (Seção 14)
    Simula execuções virtuais 24x7 com derrapagem (slippage), taxas e regras de Anti-Chasing.
    """

    SLIPPAGE_PCT: float = 0.0008  # 0.08% slippage simulado
    FEE_PCT: float = 0.0010       # 0.10% taxa Binance
    INITIAL_BANK: float = 10000.0 # \$ 10.000,00 USD Banca Inicial

    def __init__(
        self,
        initial_bank: float = INITIAL_BANK,
        active_trades: Optional[Dict[str, PaperTrade]] = None,
        trade_history: Optional[List[PaperTrade]] = None
    ):
        self.initial_bank = float(initial_bank or self.INITIAL_BANK)
        self.active_trades: Dict[str, PaperTrade] = active_trades or {}
        self.trade_history: List[PaperTrade] = trade_history or []

    def open_paper_trade(
        self,
        trade_id: str,
        plan: TradePlan,
        current_market_price: float,
        position_size_usd: float = 1000.0
    ) -> Optional[PaperTrade]:
        """
        Abre um trade virtual após validar a regra de Anti-Chasing.
        """
        if not RiskManager.validate_anti_chasing(current_market_price, plan):
            return None

        fill_price = current_market_price * (1.0 + self.SLIPPAGE_PCT)
        quantity = position_size_usd / fill_price

        trade = PaperTrade(
            id=trade_id,
            symbol=plan.symbol,
            strategy=plan.strategy.value if hasattr(plan.strategy, 'value') else str(plan.strategy),
            status="OPEN",
            entry_price=current_market_price,
            simulated_fill_price=round(fill_price, 4),
            stop_loss=plan.stop_loss,
            target_t1=plan.target_t1,
            target_t2=plan.target_t2,
            target_t3=plan.target_t3,
            quantity=round(quantity, 6),
            risk_reward_ratio=plan.risk_reward_ratio
        )

        self.active_trades[trade_id] = trade
        return trade

    def close_paper_trade_manually(self, trade_id: str, current_price: float) -> Optional[PaperTrade]:
        """
        Encerra um trade ativo manualmente pelo usuário.
        """
        if trade_id not in self.active_trades:
            return None

        trade = self.active_trades[trade_id]
        exit_price = current_price * (1.0 - self.SLIPPAGE_PCT)
        
        trade.status = "CLOSED_MANUAL"
        trade.closed_at = utc_now()
        trade.close_reason = "Encerrado Manualmente pelo Usuário"
        trade.pnl_pct = round(((exit_price - trade.simulated_fill_price) / trade.simulated_fill_price) * 100.0, 2)
        trade.pnl_usd = round(trade.quantity * (exit_price - trade.simulated_fill_price), 2)

        self.trade_history.append(trade)
        del self.active_trades[trade_id]
        return trade

    def update_trade_with_candle(self, trade_id: str, high: float, low: float, close: float) -> PaperTrade:
        """
        Atualiza o estado de um Paper Trade ativo conforme os preços de alta/baixa da vela atual.
        """
        if trade_id not in self.active_trades:
            raise KeyError("Trade não encontrado")

        trade = self.active_trades[trade_id]
        if trade.status != "OPEN":
            return trade

        mfe = ((high - trade.simulated_fill_price) / trade.simulated_fill_price) * 100.0
        mae = ((low - trade.simulated_fill_price) / trade.simulated_fill_price) * 100.0

        trade.max_favorable_excursion = max(trade.max_favorable_excursion, round(mfe, 2))
        trade.max_adverse_excursion = min(trade.max_adverse_excursion, round(mae, 2))

        # Checagem de Stop Loss (Prioridade de proteção)
        if low <= trade.stop_loss:
            exit_price = trade.stop_loss * (1.0 - self.SLIPPAGE_PCT)
            trade.status = "CLOSED_LOSS"
            trade.closed_at = utc_now()
            trade.close_reason = "Stop Loss Atingido"
            
            trade.pnl_pct = round(((exit_price - trade.simulated_fill_price) / trade.simulated_fill_price) * 100.0, 2)
            trade.pnl_usd = round(trade.quantity * (exit_price - trade.simulated_fill_price), 2)
            
            self.trade_history.append(trade)
            del self.active_trades[trade_id]
            return trade

        # Checagem de Alvo Principal (Target T2)
        if high >= trade.target_t2:
            exit_price = trade.target_t2 * (1.0 - self.SLIPPAGE_PCT)
            trade.status = "CLOSED_PROFIT"
            trade.closed_at = utc_now()
            trade.close_reason = "Alvo Principal T2 Atingido"
            
            trade.pnl_pct = round(((exit_price - trade.simulated_fill_price) / trade.simulated_fill_price) * 100.0, 2)
            trade.pnl_usd = round(trade.quantity * (exit_price - trade.simulated_fill_price), 2)
            
            self.trade_history.append(trade)
            del self.active_trades[trade_id]
            return trade

        return trade

    def get_performance_metrics(self) -> Dict:
        """
        Retorna as métricas estatísticas consolidadas dos Paper Trades executados (Seção 14.1).
        """
        total_pnl = sum(t.pnl_usd for t in self.trade_history)
        current_balance = self.initial_bank + total_pnl

        if not self.trade_history:
            return {
                "initial_bank_usd": self.initial_bank,
                "current_balance_usd": round(current_balance, 2),
                "total_trades": 0,
                "wins_count": 0,
                "losses_count": 0,
                "win_rate_pct": 0.0,
                "profit_factor": 0.0,
                "expectancy_usd": 0.0,
                "net_pnl_usd": 0.0
            }

        wins = [t for t in self.trade_history if t.pnl_usd > 0]
        losses = [t for t in self.trade_history if t.pnl_usd <= 0]

        total_trades = len(self.trade_history)
        win_rate = (len(wins) / total_trades) * 100.0 if total_trades > 0 else 0.0

        gross_profit = sum(t.pnl_usd for t in wins)
        gross_loss = abs(sum(t.pnl_usd for t in losses))

        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (gross_profit if gross_profit > 0 else 0.0)
        net_pnl = gross_profit - gross_loss
        expectancy = net_pnl / total_trades if total_trades > 0 else 0.0

        return {
            "initial_bank_usd": self.initial_bank,
            "current_balance_usd": round(current_balance, 2),
            "total_trades": total_trades,
            "wins_count": len(wins),
            "losses_count": len(losses),
            "win_rate_pct": round(win_rate, 2),
            "gross_profit_usd": round(gross_profit, 2),
            "gross_loss_usd": round(gross_loss, 2),
            "net_pnl_usd": round(net_pnl, 2),
            "profit_factor": round(profit_factor, 2),
            "expectancy_usd": round(expectancy, 2)
        }
