from app.domain.schemas import StrategyEnum, TradePlan
from app.paper_trading.paper_engine import PaperTradingEngine
from app.persistence.company_store import CompanyStore


def _plan(symbol="SOLUSDT"):
    return TradePlan(
        symbol=symbol,
        strategy=StrategyEnum.PULLBACK,
        entry_zone_min=140,
        entry_zone_max=142,
        stop_loss=135,
        target_t1=148,
        target_t2=152,
        target_t3=158,
        risk_reward_ratio=2.5,
        potential_gain_pct=7.5,
        invalidation_reason="Stop loss",
        reasons_for_entry=["Pullback"],
    )


def test_company_store_isolates_paper_trades_by_company(tmp_path):
    store = CompanyStore(path=tmp_path / "mc.json")

    engine_a = PaperTradingEngine()
    trade_a = engine_a.open_paper_trade(
        trade_id="trade_a",
        plan=_plan("SOLUSDT"),
        current_market_price=141.0,
        position_size_usd=1000.0,
    )
    assert trade_a is not None
    store.save_paper_state(empresa_a := 101, engine_a.active_trades, engine_a.trade_history)

    state_a = store.get_paper_state(empresa_a)
    state_b = store.get_paper_state(empresa_b := 202)

    assert "trade_a" in state_a["active_trades"]
    assert state_b["active_trades"] == {}
    assert store.get_summary(empresa_a)["active_trades_count"] == 1
    assert store.get_summary(empresa_b)["active_trades_count"] == 0


def test_company_store_keeps_settings_by_company(tmp_path):
    store = CompanyStore(path=tmp_path / "mc.json")

    store.update_settings(101, {"initial_bank_usd": 25000.0, "risk_per_trade_pct": 1.5})
    store.update_settings(202, {"initial_bank_usd": 5000.0})

    assert store.get_settings(101)["initial_bank_usd"] == 25000.0
    assert store.get_settings(101)["risk_per_trade_pct"] == 1.5
    assert store.get_settings(202)["initial_bank_usd"] == 5000.0
    assert store.get_settings(202)["risk_per_trade_pct"] == 2.0


def test_company_store_encrypts_exchange_credentials_and_masks_public_settings(tmp_path, monkeypatch):
    monkeypatch.setenv("MASTER_CRYPTO_DATA_CRYPTO_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
    store = CompanyStore(path=tmp_path / "mc.json")

    public = store.update_settings(101, {
        "exchange_api_key": "public-key-123456",
        "exchange_api_secret": "secret-key-abcdef",
    })

    assert public["exchange_api_key"] == ""
    assert public["exchange_api_secret"] == ""
    assert public["exchange_api_key_configured"] is True
    assert public["exchange_api_secret_configured"] is True
    assert public["exchange_api_key_masked"].startswith("publ")
    assert public["exchange_api_key_masked"].endswith("3456")
    assert public["exchange_api_secret_masked"].startswith("secr")
    assert public["exchange_api_secret_masked"].endswith("cdef")

    raw_text = (tmp_path / "mc.json").read_text(encoding="utf-8")
    assert "secret-key-abcdef" not in raw_text
    assert "public-key-123456" not in raw_text

    private = store.get_settings(101, include_secrets=True)
    assert private["exchange_api_key"] == "public-key-123456"
    assert private["exchange_api_secret"] == "secret-key-abcdef"


def test_company_store_validates_mobile_token_by_company(tmp_path):
    store = CompanyStore(path=tmp_path / "mc.json")

    token_a = store.get_mobile_token(101)["mobile_token"]
    token_b = store.get_mobile_token(202)["mobile_token"]

    assert store.validate_mobile_token(101, token_a)
    assert store.validate_mobile_token(202, token_b)
    assert not store.validate_mobile_token(101, token_b)
    assert not store.validate_mobile_token(101, "")
