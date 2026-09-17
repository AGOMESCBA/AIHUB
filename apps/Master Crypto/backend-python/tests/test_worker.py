import pytest
import asyncio
from app.workers.background_loop import BackgroundMarketWorker

@pytest.mark.asyncio
async def test_background_market_worker_cycle():
    worker = BackgroundMarketWorker(interval_seconds=1)
    assert not worker.is_running
    
    # Executa por 0.1s e para
    task = asyncio.create_task(worker.start_loop())
    await asyncio.sleep(0.1)
    assert worker.is_running
    
    worker.stop()
    task.cancel()
    assert not worker.is_running
