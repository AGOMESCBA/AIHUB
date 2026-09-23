import pandas as pd
import numpy as np
from typing import List, Dict, Optional
from pydantic import BaseModel

class BTCCycleComparison(BaseModel):
    current_year: int
    compare_year_1: int
    compare_year_2: int
    similarity_score_year_1: float  # 0 a 100% de similaridade
    similarity_score_year_2: float
    most_similar_year: int
    days_since_halving: int
    cycle_phase_description: str
    layman_explanation: str
    technical_explanation: str
    normalized_series: Dict[str, List[Dict[str, float]]]  # { "2026": [...], "2020": [...], "2016": [...] }
    disclaimer: str

class BTCCycleEngine:
    """
    Motor do BTC Cycle (Seção 7.2)
    Normaliza anos e ciclos de Halving para comparação visual de trajetórias
    e gera explicações em linguagem simples para leigos.
    """

    HALVING_DATES = {
        2012: "2012-11-28",
        2016: "2016-07-09",
        2020: "2020-05-11",
        2024: "2024-04-19"
    }

    @classmethod
    def generate_calendar_year_overlay(
        cls,
        current_year: int = 2026,
        year_a: int = 2020,
        year_b: int = 2016
    ) -> BTCCycleComparison:
        """
        Normaliza os retornos dos 3 anos a partir de 1º de Janeiro = 0.0%
        e gera gráficos e explicações para usuários leigos.
        """
        # Dados simulados/representativos normalizados para demonstração determinística
        np.random.seed(42)
        days = list(range(1, 250))  # Até o dia atual do ano

        # Trajetórias normalizadas (% acumulado a partir de 0%)
        series_current = [{"day": d, "return_pct": round(float(np.sin(d / 15) * 8 + (d * 0.15)), 2)} for d in days]
        series_year_a = [{"day": d, "return_pct": round(float(np.sin(d / 14) * 10 + (d * 0.18)), 2)} for d in days]
        series_year_b = [{"day": d, "return_pct": round(float(np.cos(d / 18) * 6 + (d * 0.08)), 2)} for d in days]

        # Cálculo de similaridade por correlação de Pearson
        arr_curr = np.array([x["return_pct"] for x in series_current])
        arr_a = np.array([x["return_pct"] for x in series_year_a])
        arr_b = np.array([x["return_pct"] for x in series_year_b])

        corr_a = float(np.corrcoef(arr_curr, arr_a)[0, 1])
        corr_b = float(np.corrcoef(arr_curr, arr_b)[0, 1])

        sim_score_a = round(max(0.0, corr_a * 100.0), 1)
        sim_score_b = round(max(0.0, corr_b * 100.0), 1)

        most_similar = year_a if sim_score_a >= sim_score_b else year_b

        # Explicação em Linguagem Simples (Leigos)
        layman_text = (
            f"Hoje o Bitcoin está no ano de {current_year}. Comparando a trajetória de preços deste ano "
            f"com os anos históricos de {year_a} e {year_b}, o comportamento atual do Bitcoin possui "
            f"**{max(sim_score_a, sim_score_b)}% de semelhança com o ano de {most_similar}**.\n\n"
            f"💡 **O que isso significa na prática?**\n"
            f"Em {most_similar}, nesta mesma época do ano, o Bitcoin passou por um período de consolidação "
            f"antes de iniciar um movimento de expansão. Historicamente, essa fase do ciclo criou um "
            f"ambiente altamente favorável para Swing Trades em altcoins de alta qualidade."
        )

        technical_text = (
            f"Análise de correlação temporal normalizada (Dia 1 de Jan = 0.0%). "
            f"Correlação Pearson {current_year} vs {year_a}: r = {corr_a:.2f} ({sim_score_a}%). "
            f"Correlação {current_year} vs {year_b}: r = {corr_b:.2f} ({sim_score_b}%). "
            f"Volatilidade relativa em alinhamento com a fase pós-Halving de 2024 (aprox. 870 dias pós-halving)."
        )

        return BTCCycleComparison(
            current_year=current_year,
            compare_year_1=year_a,
            compare_year_2=year_b,
            similarity_score_year_1=sim_score_a,
            similarity_score_year_2=sim_score_b,
            most_similar_year=most_similar,
            days_since_halving=878,
            cycle_phase_description="Fase 3 do Ciclo de Halving (Maturação e Expansão de Criptoativos)",
            layman_explanation=layman_text,
            technical_explanation=technical_text,
            normalized_series={
                str(current_year): series_current,
                str(year_a): series_year_a,
                str(year_b): series_year_b
            },
            disclaimer="AVISO IMPORTANTE: Esta versão usa série normalizada demonstrativa para leitura macro visual. Não é histórico real da Binance. Desempenho e padrões históricos, quando integrados, servirão exclusivamente como contexto e não constituem garantia nem previsão determinística de retornos futuros."
        )
