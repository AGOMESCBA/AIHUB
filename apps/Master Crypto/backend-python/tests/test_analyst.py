import pytest
from app.api.v1.analyst import chat_with_analyst, get_suggested_questions, ChatRequest

@pytest.mark.asyncio
async def test_analyst_suggestions():
    data = await get_suggested_questions()
    assert "suggestions" in data
    assert len(data["suggestions"]) >= 3

@pytest.mark.asyncio
async def test_analyst_chat_flow():
    req = ChatRequest(
        message="Qual o risco desta operação?",
        opportunity={"symbol": "SOLUSDT", "strategy": "PULLBACK", "score": 93}
    )
    resp = await chat_with_analyst(req)
    assert "risco" in resp.reply.lower()
    assert len(resp.suggested_actions) > 0
