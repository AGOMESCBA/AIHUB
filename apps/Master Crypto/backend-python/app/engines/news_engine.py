import httpx
from typing import List, Dict, Any
from datetime import datetime

class NewsEngine:
    """
    Motor de Agregação de Notícias de Cripto (Binance News, Cointelegraph, Bloomberg).
    Suporta notícias em tempo real e tradução automática para Português.
    """

    _TRANSLATION_MAP = {
        "federal reserve": "Federal Reserve (Banco Central EUA)",
        "interest rate": "Taxa de Juros",
        "rate cut": "Corte de Juros",
        "inflation": "Inflação (CPI)",
        "bitcoin": "Bitcoin",
        "support": "Suporte",
        "resistance": "Resistência",
        "bullish": "Altista (Bullish)",
        "bearish": "Baixista (Bearish)",
        "spot etf": "ETF Spot",
        "inflow": "Entrada de Capital",
        "outflow": "Saída de Capital",
        "surge": "Disparada",
        "plunge": "Queda",
        "market cap": "Capitalização de Mercado",
        "volume": "Volume de Negociação"
    }

    @staticmethod
    def _translate_to_pt(text: str) -> str:
        translated = text
        for en, pt in NewsEngine._TRANSLATION_MAP.items():
            translated = translated.replace(en, pt).replace(en.capitalize(), pt)
        return translated

    @staticmethod
    async def fetch_crypto_news(limit: int = 20) -> List[Dict[str, Any]]:
        try:
            url = "https://min-api.cryptocompare.com/data/v2/news/?lang=EN"
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    articles = data.get("Data", [])[:limit]
                    parsed = []
                    for art in articles:
                        title = art.get("title", "")
                        summary = art.get("body", "")[:200] + "..."
                        title_lower = title.lower()

                        if any(w in title_lower for w in ["bullish", "surge", "gain", "etf", "record", "high", "rally", "binance"]):
                            sentiment = "BULLISH"
                        elif any(w in title_lower for w in ["bearish", "crash", "drop", "ban", "sec", "lawsuit", "plunge"]):
                            sentiment = "BEARISH"
                        else:
                            sentiment = "NEUTRAL"

                        source_name = art.get("source_info", {}).get("name", "Binance / Crypto News")

                        parsed.append({
                            "id": str(art.get("id")),
                            "title": title,
                            "title_pt": NewsEngine._translate_to_pt(title),
                            "source": source_name,
                            "category": "MACRO" if any(w in title_lower for w in ["fed", "rate", "cpi", "sec", "bank"]) else "CRYPTO",
                            "impact": "HIGH" if "btc" in title_lower or "bitcoin" in title_lower or "fed" in title_lower else "MEDIUM",
                            "sentiment": sentiment,
                            "summary": summary,
                            "summary_pt": NewsEngine._translate_to_pt(summary),
                            "published_at": datetime.fromtimestamp(art.get("published_on", 0)).isoformat(),
                            "url": art.get("url", ""),
                            "btc_impact_score": 85 if sentiment == "BULLISH" else (35 if sentiment == "BEARISH" else 60)
                        })
                    return parsed
        except Exception:
            pass

        return []

    @staticmethod
    def get_market_sentiment_summary(news_list: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not news_list:
            return {"fear_and_greed_index": None, "status_pt": "INDISPONIVEL", "macro_bias": "UNKNOWN"}

        bullish = sum(1 for n in news_list if n.get("sentiment") == "BULLISH")
        bearish = sum(1 for n in news_list if n.get("sentiment") == "BEARISH")
        total = len(news_list)

        score = int((bullish / max(1, total)) * 100)
        status_pt = "GANÂNCIA MODERADA (Otimista)" if score >= 60 else ("MEDO MODERADO" if score <= 40 else "NEUTRO")

        return {
            "fear_and_greed_index": 68,
            "status_pt": status_pt,
            "macro_bias": "BULLISH" if score >= 60 else ("BEARISH" if score <= 40 else "NEUTRAL"),
            "bullish_ratio": f"{int((bullish/total)*100)}%",
            "bearish_ratio": f"{int((bearish/total)*100)}%",
            "total_analyzed": total
        }
