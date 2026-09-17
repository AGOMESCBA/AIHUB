from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.iahub_context import get_iahub_context
from app.domain.schemas import TradePlan
from app.paper_trading.paper_engine import PaperTradingEngine, PaperTrade
from app.persistence.company_store import store

router = APIRouter(prefix="/paper", tags=["Paper Trading"])


class StartPaperTradeRequest(BaseModel):
    trade_id: str
    symbol: str
    current_market_price: float
    trade_plan: TradePlan
    position_size_usd: float = 1000.0


class ClosePaperTradeRequest(BaseModel):
    trade_id: str
    current_market_price: float


def _engine_for_company(company_id: int) -> PaperTradingEngine:
    settings = store.get_settings(company_id)
    paper = store.get_paper_state(company_id)
    active_trades = {
        trade_id: PaperTrade.model_validate(trade)
        for trade_id, trade in paper.get("active_trades", {}).items()
    }
    trade_history = [
        PaperTrade.model_validate(trade)
        for trade in paper.get("trade_history", [])
    ]
    return PaperTradingEngine(
        initial_bank=float(settings.get("initial_bank_usd", 10000.0)),
        active_trades=active_trades,
        trade_history=trade_history,
    )


def _persist_company_engine(company_id: int, engine: PaperTradingEngine) -> None:
    store.save_paper_state(
        company_id=company_id,
        active_trades=engine.active_trades,
        trade_history=engine.trade_history,
    )


@router.post("/start")
def start_paper_trade(req: StartPaperTradeRequest, request: Request):
    ctx = get_iahub_context(request)
    paper_engine = _engine_for_company(ctx.company_id)
    trade = paper_engine.open_paper_trade(
        trade_id=req.trade_id,
        plan=req.trade_plan,
        current_market_price=req.current_market_price,
        position_size_usd=req.position_size_usd,
    )
    if trade is None:
        return {"status": "REJECTED", "reason": "Preco fora da zona ou degradou R/R (Anti-Chasing)"}

    _persist_company_engine(ctx.company_id, paper_engine)
    return {"status": "SUCCESS", "trade": trade}


@router.get("/active")
def get_active_paper_trades(request: Request):
    ctx = get_iahub_context(request)
    paper_engine = _engine_for_company(ctx.company_id)
    return {
        "active_trades_count": len(paper_engine.active_trades),
        "trades": list(paper_engine.active_trades.values()),
    }


@router.get("/history")
def get_paper_trade_history(request: Request):
    ctx = get_iahub_context(request)
    paper_engine = _engine_for_company(ctx.company_id)
    return {
        "history_count": len(paper_engine.trade_history),
        "trades": paper_engine.trade_history,
    }


@router.post("/close")
def close_paper_trade(req: ClosePaperTradeRequest, request: Request):
    ctx = get_iahub_context(request)
    paper_engine = _engine_for_company(ctx.company_id)
    trade = paper_engine.close_paper_trade_manually(req.trade_id, req.current_market_price)
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade simulado nao encontrado")
    _persist_company_engine(ctx.company_id, paper_engine)
    return {"status": "CLOSED", "trade": trade}


@router.get("/metrics")
def get_paper_trading_metrics(request: Request):
    ctx = get_iahub_context(request)
    paper_engine = _engine_for_company(ctx.company_id)
    return paper_engine.get_performance_metrics()
