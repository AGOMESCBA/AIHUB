"""
Universo de Criptomoedas por Capitalização/Liquidez (Seção 2)
Permite ao usuário configurar o limite (Top 10, Top 20, Top 30, Top 50).
Exclui stablecoins (USDT, USDC, DAI, TUSD, etc.) e tokens pareados.
"""

from typing import List, Tuple
import httpx

# Lista Baseline das Top 20 mais consolidadas do mercado
TOP_20_BASELINE = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "ADAUSDT",
    "AVAXUSDT",
    "SUIUSDT",
    "LINKUSDT",
    "DOTUSDT",
    "NEARUSDT",
    "SHIBUSDT",
    "PEPEUSDT",
    "BCHUSDT",
    "UNIUSDT",
    "LTCUSDT",
    "APTUSDT",
    "ICPUSDT",
    "FETUSDT"
]

TOP_20_SYMBOLS = TOP_20_BASELINE

async def fetch_dynamic_top_by_volume_with_source(top_limit: int = 20) -> Tuple[List[str], str]:
    """
    Busca dinamicamente na Binance as 'top_limit' moedas de maior volume de negociação (24h)
    filtrando stablecoins e moedas pareadas.
    """
    url = "https://api.binance.com/api/v3/ticker/24hr"
    excluded_keywords = ["USDC", "DAI", "FDUSD", "TUSD", "USDS", "WBTC", "WETH", "EUR", "BUSD", "PYUSD", "USD1", "RLUSD"]
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        if response.status_code != 200:
            return TOP_20_BASELINE[:top_limit], "BASELINE"
            
        data = response.json()
        
    usdt_pairs = []
    for item in data:
        symbol = item["symbol"]
        if symbol.endswith("USDT") and not any(k in symbol for k in excluded_keywords):
            usdt_pairs.append({
                "symbol": symbol,
                "quote_volume": float(item.get("quoteVolume", 0))
            })
            
    # Ordenar por volume decrescente
    sorted_pairs = sorted(usdt_pairs, key=lambda x: x["quote_volume"], reverse=True)
    dynamic_list = [p["symbol"] for p in sorted_pairs[:top_limit]]

    if len(dynamic_list) == top_limit:
        return dynamic_list, "BINANCE_24H_VOLUME"
    return TOP_20_BASELINE[:top_limit], "BASELINE"


async def fetch_dynamic_top_by_volume(top_limit: int = 20) -> List[str]:
    symbols, _source = await fetch_dynamic_top_by_volume_with_source(top_limit=top_limit)
    return symbols
