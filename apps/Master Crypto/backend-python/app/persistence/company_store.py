import json
import secrets
from copy import deepcopy
from pathlib import Path
from threading import RLock
from typing import Any, Dict, List

from app.paper_trading.paper_engine import PaperTrade


DEFAULT_SETTINGS = {
    "initial_bank_usd": 10000.0,
    "risk_per_trade_pct": 2.0,
    "scanner_top_limit": 20,
    "scanner_timeframe": "4h",
    "radar_auto_refresh_seconds": 0,
    "min_risk_reward_ratio": 2.0,
    "mode": "demo",
    "selected_exchange": "BINANCE",
    "exchange_api_key": "",
    "exchange_api_secret": "",
}


def _new_mobile_token(company_id: int) -> str:
    return f"MC-EMP-{company_id}-{secrets.token_urlsafe(24)}"


class CompanyStore:
    def __init__(self, path: Path | None = None):
        base_dir = Path(__file__).resolve().parents[2] / "data"
        self.path = path or (base_dir / "iahub_master_crypto.json")
        self._lock = RLock()

    def _empty(self) -> Dict[str, Any]:
        return {"companies": {}}

    def _load(self) -> Dict[str, Any]:
        if not self.path.exists():
            return self._empty()
        try:
            with self.path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            if not isinstance(data, dict):
                return self._empty()
            data.setdefault("companies", {})
            return data
        except Exception:
            return self._empty()

    def _save(self, data: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.path.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        tmp_path.replace(self.path)

    def _company(self, data: Dict[str, Any], company_id: int) -> Dict[str, Any]:
        companies = data.setdefault("companies", {})
        key = str(company_id)
        if key not in companies:
            companies[key] = {
                "settings": deepcopy(DEFAULT_SETTINGS),
                "mobile_token": _new_mobile_token(company_id),
                "paper": {"active_trades": {}, "trade_history": []},
            }
        company = companies[key]
        company.setdefault("settings", deepcopy(DEFAULT_SETTINGS))
        if not company.get("mobile_token"):
            company["mobile_token"] = _new_mobile_token(company_id)
        company.setdefault("paper", {"active_trades": {}, "trade_history": []})
        company["paper"].setdefault("active_trades", {})
        company["paper"].setdefault("trade_history", [])
        return company

    def get_settings(self, company_id: int) -> Dict[str, Any]:
        with self._lock:
            data = self._load()
            settings = self._company(data, company_id)["settings"]
            return {**deepcopy(DEFAULT_SETTINGS), **deepcopy(settings)}

    def update_settings(self, company_id: int, patch: Dict[str, Any]) -> Dict[str, Any]:
        allowed = set(DEFAULT_SETTINGS.keys())
        clean = {key: value for key, value in patch.items() if key in allowed}
        with self._lock:
            data = self._load()
            company = self._company(data, company_id)
            company["settings"] = {**deepcopy(DEFAULT_SETTINGS), **company.get("settings", {}), **clean}
            self._save(data)
            return deepcopy(company["settings"])

    def get_mobile_token(self, company_id: int) -> Dict[str, str]:
        with self._lock:
            data = self._load()
            company = self._company(data, company_id)
            token = company["mobile_token"]
            self._save(data)
            return {"mobile_token": token}

    def regenerate_mobile_token(self, company_id: int) -> Dict[str, str]:
        with self._lock:
            data = self._load()
            company = self._company(data, company_id)
            company["mobile_token"] = _new_mobile_token(company_id)
            self._save(data)
            return {"mobile_token": company["mobile_token"]}

    def get_paper_state(self, company_id: int) -> Dict[str, Any]:
        with self._lock:
            data = self._load()
            paper = self._company(data, company_id)["paper"]
            return deepcopy(paper)

    def save_paper_state(
        self,
        company_id: int,
        active_trades: Dict[str, PaperTrade],
        trade_history: List[PaperTrade],
    ) -> None:
        with self._lock:
            data = self._load()
            company = self._company(data, company_id)
            company["paper"] = {
                "active_trades": {
                    trade_id: trade.model_dump(mode="json")
                    for trade_id, trade in active_trades.items()
                },
                "trade_history": [trade.model_dump(mode="json") for trade in trade_history],
            }
            self._save(data)

    def get_summary(self, company_id: int) -> Dict[str, Any]:
        from app.paper_trading.paper_engine import PaperTradingEngine

        settings = self.get_settings(company_id)
        paper = self.get_paper_state(company_id)
        engine = PaperTradingEngine(
            initial_bank=float(settings.get("initial_bank_usd", DEFAULT_SETTINGS["initial_bank_usd"])),
            active_trades={
                trade_id: PaperTrade.model_validate(trade)
                for trade_id, trade in paper.get("active_trades", {}).items()
            },
            trade_history=[
                PaperTrade.model_validate(trade)
                for trade in paper.get("trade_history", [])
            ],
        )
        metrics = engine.get_performance_metrics()
        return {
            "settings": settings,
            "paper_metrics": metrics,
            "active_trades_count": len(engine.active_trades),
            "history_count": len(engine.trade_history),
        }


store = CompanyStore()
