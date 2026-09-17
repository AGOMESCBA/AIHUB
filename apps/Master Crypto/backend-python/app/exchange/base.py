from abc import ABC, abstractmethod
from typing import List, Dict, Optional
from app.domain.schemas import Candle

class ExchangeAdapter(ABC):
    """
    Exchange Abstraction Layer (EAL) - Seção 16
    Garante que o domínio do sistema seja totalmente independente da corretora.
    """

    @abstractmethod
    async def get_candles(self, symbol: str, interval: str, limit: int = 200) -> List[Candle]:
        """Obtém histórico de velas para anotação de indicadores."""
        pass

    @abstractmethod
    async def get_ticker_price(self, symbol: str) -> float:
        """Obtém preço atual do ativo."""
        pass

    @abstractmethod
    async def place_order(
        self,
        symbol: str,
        side: str,
        order_type: str,
        quantity: float,
        price: Optional[float] = None
    ) -> Dict:
        """Emite ordem de negociação."""
        pass

    @abstractmethod
    async def cancel_order(self, symbol: str, order_id: str) -> Dict:
        """Cancela ordem pendente."""
        pass
