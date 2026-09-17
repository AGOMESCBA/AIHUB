from fastapi import APIRouter
from app.engines.btc_cycle import BTCCycleEngine, BTCCycleComparison

router = APIRouter(prefix="/btc-cycle", tags=["BTC Cycle Analysis"])

@router.get("/compare", response_model=BTCCycleComparison)
def compare_btc_cycles(current_year: int = 2026, year_a: int = 2020, year_b: int = 2016):
    """
    Compara o ano atual do Bitcoin com 2 anos históricos normalizados (0% em 1º de Janeiro).
    Retorna a série gráfica e a explicação em linguagem simples para leigos.
    """
    return BTCCycleEngine.generate_calendar_year_overlay(
        current_year=current_year,
        year_a=year_a,
        year_b=year_b
    )
