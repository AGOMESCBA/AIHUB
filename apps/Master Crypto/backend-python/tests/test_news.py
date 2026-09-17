import pytest
from app.engines.news_engine import NewsEngine
from app.api.v1.news import get_news_feed, get_news_sentiment

@pytest.mark.asyncio
async def test_news_engine_max_10_articles():
    news = await NewsEngine.fetch_crypto_news(limit=20)
    assert len(news) <= 10
    
    feed_response = await get_news_feed(limit=50)
    assert feed_response["news_count"] <= 10
    assert len(feed_response["articles"]) <= 10
    assert "sentiment_summary" in feed_response

@pytest.mark.asyncio
async def test_news_sentiment_summary():
    sentiment = await get_news_sentiment()
    assert "fear_and_greed_index" in sentiment
    assert "macro_bias" in sentiment
    assert "status_pt" in sentiment
