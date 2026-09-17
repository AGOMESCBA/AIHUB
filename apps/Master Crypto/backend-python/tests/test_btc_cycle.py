import pytest
from app.engines.btc_cycle import BTCCycleEngine

def test_btc_cycle_comparison_generation():
    res = BTCCycleEngine.generate_calendar_year_overlay(current_year=2026, year_a=2020, year_b=2016)
    
    assert res.current_year == 2026
    assert res.compare_year_1 == 2020
    assert res.compare_year_2 == 2016
    assert 0.0 <= res.similarity_score_year_1 <= 100.0
    assert 0.0 <= res.similarity_score_year_2 <= 100.0
    assert res.most_similar_year in [2020, 2016]
    assert len(res.layman_explanation) > 50
    assert "2026" in res.normalized_series
    assert "2020" in res.normalized_series
    assert "2016" in res.normalized_series
