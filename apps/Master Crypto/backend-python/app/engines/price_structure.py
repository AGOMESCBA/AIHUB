import pandas as pd
import numpy as np
from typing import List, Dict, Tuple

class PriceStructureEngine:
    """
    Motor de Estrutura de Preço (Price Structure Engine)
    Identifica suportes e resistências pivotais e calcula o espaço técnico até a resistência principal.
    """

    @staticmethod
    def find_pivots(df: pd.DataFrame, window: int = 3) -> Tuple[List[float], List[float]]:
        """
        Encontra topos pivotais (resistências) e fundos pivotais (suportes) em uma série temporal.
        """
        supports = []
        resistances = []

        if len(df) < (window * 2 + 1):
            return supports, resistances

        highs = df["high"].values
        lows = df["low"].values

        for i in range(window, len(df) - window):
            # Pivô de Alta (Resistência)
            if all(highs[i] >= highs[i - j] for j in range(1, window + 1)) and \
               all(highs[i] >= highs[i + j] for j in range(1, window + 1)):
                resistances.append(float(highs[i]))

            # Pivô de Baixa (Suporte)
            if all(lows[i] <= lows[i - j] for j in range(1, window + 1)) and \
               all(lows[i] <= lows[i + j] for j in range(1, window + 1)):
                supports.append(float(lows[i]))

        return supports, resistances

    @classmethod
    def get_nearest_support_and_resistance(
        cls,
        df: pd.DataFrame,
        current_price: float
    ) -> Tuple[Optional[float], Optional[float], float]:
        """
        Retorna (suporte_mais_proximo, resistencia_mais_proxima, espaco_tecnico_resistencia_pct).
        """
        supports, resistances = cls.find_pivots(df)

        valid_supports = [s for s in supports if s < current_price]
        valid_resistances = [r for r in resistances if r > current_price]

        nearest_support = max(valid_supports) if valid_supports else (current_price * 0.95)
        nearest_resistance = min(valid_resistances) if valid_resistances else (current_price * 1.08)

        space_to_resistance_pct = round(((nearest_resistance - current_price) / current_price) * 100.0, 2)

        return nearest_support, nearest_resistance, space_to_resistance_pct
