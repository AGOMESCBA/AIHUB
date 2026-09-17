from fastapi import APIRouter
from app.workers.market_scanner import MarketScanner
from app.domain.assets import TOP_20_BASELINE, fetch_dynamic_top_by_volume

router = APIRouter(prefix="/scanner", tags=["Market Scanner"])

@router.get("/symbols")
async def get_top_symbols(top_limit: int = 20, dynamic: bool = True):
    if dynamic:
        symbols = await fetch_dynamic_top_by_volume(top_limit=top_limit)
    else:
        symbols = TOP_20_BASELINE[:top_limit]
    return {"dynamic": dynamic, "top_limit": top_limit, "count": len(symbols), "symbols": symbols}

@router.get("/run")
async def run_market_scan(timeframe: str = "4h", top_limit: int = 20, dynamic: bool = True):
    scanner = MarketScanner()
    btc_context = await scanner.get_btc_context()
    scanned_assets = await scanner.scan_all_top(timeframe=timeframe, top_limit=top_limit, use_dynamic=dynamic)

    return {
        "timeframe": timeframe,
        "top_limit": top_limit,
        "dynamic": dynamic,
        "btc_context": btc_context,
        "scanned_count": len(scanned_assets),
        "results": scanned_assets
    }
