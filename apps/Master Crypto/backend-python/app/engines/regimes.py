import pandas as pd
from app.domain.schemas import MarketRegimeEnum

class RegimeEngine:
    """
    Motor de Classificação de Regime de Mercado (Seção 4)
    Define se o ativo está em Tendência de Alta, Baixa, Lateralização ou Recuperação.
    """

    @staticmethod
    def classify_regime(df_annotated: pd.DataFrame) -> MarketRegimeEnum:
        if df_annotated.empty or len(df_annotated) < 20:
            return MarketRegimeEnum.SIDEWAYS

        last = df_annotated.iloc[-1]
        close = last["close"]
        ema9 = last.get("ema_9", close)
        ema21 = last.get("ema_21", close)
        ema50 = last.get("ema_50", close)
        ema200 = last.get("ema_200", close)
        rsi = last.get("rsi_14", 50.0)

        # Regra Trending Up: Preço > EMA21 > EMA50 > EMA200 e RSI saudável
        if close > ema21 and ema21 > ema50 and rsi >= 50.0:
            return MarketRegimeEnum.TRENDING_UP

        # Regra Recovery: Preço cruzando EMA21 para cima vindo de sobrevenda ou suporte
        if close > ema21 and ema21 < ema50 and rsi >= 45.0:
            return MarketRegimeEnum.RECOVERY

        # Regra Trending Down: Preço < EMA21 < EMA50
        if close < ema21 and ema21 < ema50 and rsi < 45.0:
            return MarketRegimeEnum.TRENDING_DOWN

        return MarketRegimeEnum.SIDEWAYS
