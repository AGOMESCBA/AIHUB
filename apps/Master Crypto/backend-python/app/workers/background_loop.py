import asyncio
import logging
from app.workers.market_scanner import MarketScanner
from app.engines.opportunity_score import OpportunityScoreEngine

logger = logging.getLogger("market_worker")

class BackgroundMarketWorker:
    """
    Worker 24x7 executado continuamente no backend FastAPI.
    Consulta cotações na Binance a cada intervalo (ex: 4 Horas ou 60s em dev),
    recalcula scores e atualiza o estado de mercado.
    """

    def __init__(self, interval_seconds: int = 300):
        self.interval_seconds = interval_seconds
        self.scanner = MarketScanner()
        self.is_running = False

    async def start_loop(self):
        self.is_running = True
        logger.info(f"🚀 Worker de Scan 24x7 iniciado (Intervalo: {self.interval_seconds}s)")
        
        while self.is_running:
            try:
                logger.info("📡 Iniciando varredura automatizada de mercado no Top 20...")
                btc_context = await self.scanner.get_btc_context()
                scanned_items = await self.scanner.scan_all_top(timeframe="4h", top_limit=20)
                
                logger.info(f"✅ Scan concluído para {len(scanned_items)} ativos. BTC Context Score: {btc_context.score}")
            except Exception as e:
                logger.error(f"❌ Erro no loop do MarketWorker: {str(e)}")
            
            await asyncio.sleep(self.interval_seconds)

    def stop(self):
        self.is_running = False
        logger.info("🛑 Worker de Scan finalizado.")
