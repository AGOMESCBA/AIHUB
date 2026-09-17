from app.domain.schemas import PositionSizingInput, PositionSizingResult, TradePlan
from app.core.config import settings

class RiskManager:
    """
    Motor de Gerenciamento de Risco (Risk Manager)
    Garante a preservação do capital e impõe limites estritos de R/R,
    dimensionamento de posição (Position Sizing) e validações técnicas.
    """

    @staticmethod
    def calculate_position_size(input_data: PositionSizingInput) -> PositionSizingResult:
        if input_data.entry_price <= 0 or input_data.stop_loss_price <= 0:
            raise ValueError("Preço de entrada e stop loss devem ser maiores que zero.")

        stop_distance = abs(input_data.entry_price - input_data.stop_loss_price)
        stop_distance_pct = (stop_distance / input_data.entry_price)

        if stop_distance_pct == 0:
            raise ValueError("Distância do stop loss não pode ser zero.")

        max_loss_usd = input_data.account_balance * (input_data.risk_per_trade_pct / 100.0)
        position_size_usd = max_loss_usd / stop_distance_pct
        position_size_units = position_size_usd / input_data.entry_price

        return PositionSizingResult(
            position_size_usd=round(position_size_usd, 2),
            position_size_units=round(position_size_units, 6),
            max_loss_usd=round(max_loss_usd, 2),
            risk_pct_actual=input_data.risk_per_trade_pct,
            stop_distance_pct=round(stop_distance_pct * 100.0, 2)
        )

    @staticmethod
    def validate_trade_plan(plan: TradePlan, min_rr: float = None, min_potential: float = None) -> bool:
        """
        Valida se o Trade Plan atende às regras mínimas de risco/retorno e potencial técnico.
        """
        target_min_rr = min_rr if min_rr is not None else settings.MIN_RISK_REWARD_RATIO
        target_min_potential = min_potential if min_potential is not None else settings.MIN_TECHNICAL_POTENTIAL_PCT

        if plan.risk_reward_ratio < target_min_rr:
            return False

        if plan.potential_gain_pct < target_min_potential:
            return False

        return True

    @staticmethod
    def validate_anti_chasing(current_price: float, plan: TradePlan) -> bool:
        """
        Regra de Anti-Chasing (Seção 10):
        Se o preço atual subiu além da zona de entrada e reduziu o R/R para menos de 1:2,
        a operação DEVE ser invalidada/cancelada.
        """
        if current_price > plan.entry_zone_max:
            # Recalcula R/R com base no novo preço de entrada
            new_risk = current_price - plan.stop_loss
            if new_risk <= 0:
                return False
            
            new_reward = plan.target_t2 - current_price
            new_rr = new_reward / new_risk

            if new_rr < settings.MIN_RISK_REWARD_RATIO:
                return False

        return True
