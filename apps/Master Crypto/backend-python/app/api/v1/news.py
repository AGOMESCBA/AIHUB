from fastapi import APIRouter
from app.engines.news_engine import NewsEngine

router = APIRouter(prefix="/news", tags=["Crypto & Macro News"])

@router.get("/feed")
async def get_news_feed(limit: int = 10):
    """
    Retorna o feed de notícias (máximo 10 notícias relevantes) de Cripto e Mercado Financeiro Macro que afetam o BTC.
    """
    max_limit = min(limit, 10)
    news = await NewsEngine.fetch_crypto_news(limit=max_limit)
    summary = NewsEngine.get_market_sentiment_summary(news)
    return {
        "news_count": len(news),
        "sentiment_summary": summary,
        "articles": news
    }

@router.get("/sentiment")
async def get_news_sentiment():
    """
    Retorna apenas o indicador sintético de Sentimento Macro e Índice de Medo & Ganância.
    """
    news = await NewsEngine.fetch_crypto_news(limit=10)
    summary = NewsEngine.get_market_sentiment_summary(news)
    return summary
