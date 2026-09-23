import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from app.core.config import settings
from app.exchange.binance import BinanceAdapter
from app.api.v1.scanner import router as scanner_router
from app.api.v1.opportunities import router as opportunities_router
from app.api.v1.paper_trading import router as paper_router
from app.api.v1.company_state import router as company_router
from app.api.v1.backtest import router as backtest_router
from app.api.v1.btc_cycle import router as btc_cycle_router
from app.api.v1.analyst import router as analyst_router
from app.workers.background_loop import BackgroundMarketWorker

worker = BackgroundMarketWorker(interval_seconds=300)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: inicia worker de scan 24x7
    task = asyncio.create_task(worker.start_loop())
    yield
    # Shutdown: para o worker
    worker.stop()
    task.cancel()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan
)

from app.api.v1.news import router as news_router
from app.api.v1.orders import router as orders_router

app.include_router(scanner_router, prefix=settings.API_V1_STR)
app.include_router(opportunities_router, prefix=settings.API_V1_STR)
app.include_router(paper_router, prefix=settings.API_V1_STR)
app.include_router(company_router, prefix=settings.API_V1_STR)
app.include_router(backtest_router, prefix=settings.API_V1_STR)
app.include_router(btc_cycle_router, prefix=settings.API_V1_STR)
app.include_router(analyst_router, prefix=settings.API_V1_STR)
app.include_router(news_router, prefix=settings.API_V1_STR)
app.include_router(orders_router, prefix=settings.API_V1_STR)

from typing import List

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

ws_manager = ConnectionManager()

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.websocket("/api/v1/ws/market")
async def websocket_market_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # Envia mensagem inicial de boas-vindas / ping
        await websocket.send_json({"type": "CONNECTED", "message": "Crypto Radar AI WebSocket Live Feed Ativo"})
        while True:
            # Mantém a conexão viva escutando pings do cliente
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "PONG"})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)

@app.get(f"{settings.API_V1_STR}/market/candles")
async def get_market_candles(symbol: str = "SOLUSDT", interval: str = "4h", limit: int = 50):
    adapter = BinanceAdapter()
    candles = await adapter.get_candles(symbol=symbol, interval=interval, limit=limit)
    return {"symbol": symbol, "interval": interval, "count": len(candles), "candles": candles}

@app.get(f"{settings.API_V1_STR}/market/price")
async def get_market_price(symbol: str = "BTCUSDT"):
    clean_symbol = symbol.replace("/", "").upper()
    adapter = BinanceAdapter()
    price = await adapter.get_ticker_price(clean_symbol)
    return {"symbol": clean_symbol, "exchange": "BINANCE", "price": price}
