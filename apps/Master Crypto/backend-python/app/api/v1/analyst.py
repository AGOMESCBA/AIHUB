from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

router = APIRouter(prefix="/analyst", tags=["Analyst Chat"])


class ChatRequest(BaseModel):
    message: str
    opportunity: Optional[Dict[str, Any]] = None
    btc_regime: Optional[str] = "TRENDING_UP"


class ChatResponse(BaseModel):
    reply: str
    suggested_actions: List[str]


@router.get("/suggestions")
async def get_suggested_questions():
    """
    Retorna perguntas sugeridas ao usuario para engajamento no Analista IA.
    """
    return {
        "suggestions": [
            "Por que esta oportunidade tem o maior score?",
            "Por que este stop loss foi escolhido?",
            "Como o Bitcoin afeta esta operacao?",
            "Qual a gestao de risco recomendada para a banca?",
            "O que fazer se o mercado virar contra o trade?",
        ]
    }


@router.post("/chat", response_model=ChatResponse)
async def chat_with_analyst(req: ChatRequest):
    """
    Co-piloto de Swing Trade. Usa a mensagem do usuario, o plano ativo
    e o contexto de mercado carregado pela tela.
    """
    msg = req.message.lower().strip()
    opp = req.opportunity or {}
    symbol = opp.get("symbol", "ativo selecionado")
    strategy = opp.get("strategy", "setup atual")
    score = opp.get("score", "-")
    stop_loss = opp.get("stop_loss", "-")
    target_t2 = opp.get("target_t2", "-")
    potential = opp.get("potential", "-")
    entry_range = opp.get("entry_range", "zona tecnica de entrada")

    suggested = [
        "Por que este stop loss foi escolhido?",
        "Qual o risco desta operacao?",
        "O que fazer se o Bitcoin cair?",
    ]

    if "stop" in msg or "perda" in msg or "invalid" in msg:
        reply = (
            f"Analise de protecao ({symbol}):\n\n"
            f"O stop loss esta em {stop_loss}. Ele representa o ponto em que a tese tecnica do setup {strategy} deixa de ser valida.\n\n"
            "Regra pratica: nao aumente o risco depois que a operacao foi aberta. Se o preco bater no stop, aceite a perda calculada e preserve capital para o proximo setup."
        )
    elif "alvo" in msg or "profit" in msg or "gain" in msg or "tp" in msg:
        reply = (
            f"Analise de alvos ({symbol}):\n\n"
            f"O alvo principal T2 esta em {target_t2}, com potencial estimado de {potential}.\n\n"
            "Uma leitura conservadora e realizar parcial no primeiro alvo, proteger a posicao quando o trade andar a favor e evitar transformar lucro em prejuizo."
        )
    elif "btc" in msg or "bitcoin" in msg or "mercado" in msg or "fed" in msg:
        reply = (
            "Contexto de mercado:\n\n"
            f"O Bitcoin esta em regime {req.btc_regime}. Isso influencia diretamente a qualidade dos setups de altcoins.\n\n"
            f"Para {symbol}, um BTC saudavel tende a favorecer a continuidade do setup {strategy}. Se o BTC perder forca, reduza exposicao e seja mais exigente com entrada e stop."
        )
    elif "risco" in msg or "tamanho" in msg or "banca" in msg:
        reply = (
            f"Gestao de risco ({symbol}):\n\n"
            "Use o percentual de risco configurado para a empresa como limite por operacao. O tamanho da posicao deve nascer da distancia entre entrada e stop, nao de uma aposta fixa.\n\n"
            f"Entrada: {entry_range}\nStop: {stop_loss}\nScore: {score}/100"
        )
    else:
        reply = (
            f"Analise do setup {strategy} para {symbol}:\n\n"
            f"Entrada: {entry_range}\n"
            f"Stop: {stop_loss}\n"
            f"Alvo T2: {target_t2} ({potential})\n"
            f"Score: {score}/100\n\n"
            "Posso detalhar stop, alvo, risco da banca ou impacto do Bitcoin neste plano."
        )

    return ChatResponse(reply=reply, suggested_actions=suggested)
