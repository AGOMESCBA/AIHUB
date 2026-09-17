import pandas as pd
import numpy as np
from typing import List, Dict
from app.domain.schemas import Candle

class IndicatorEngine:
    """
    Motor de Cálculo de Indicadores Core V1 (Seção 3.2)
    - EMAs (9, 21, 50, 200)
    - RSI (14)
    - ATR (14)
    - Volume Relativo (RVOL)
    """

    @staticmethod
    def calculate_emas(df: pd.DataFrame, spans: List[int] = [9, 21, 50, 200]) -> pd.DataFrame:
        df_res = df.copy()
        for span in spans:
            df_res[f"ema_{span}"] = df_res["close"].ewm(span=span, adjust=False).mean()
        return df_res

    @staticmethod
    def calculate_rsi(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
        df_res = df.copy()
        delta = df_res["close"].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()

        rs = gain / loss.replace(0, np.nan)
        df_res[f"rsi_{period}"] = 100 - (100 / (1 + rs))
        df_res[f"rsi_{period}"] = df_res[f"rsi_{period}"].fillna(50.0)
        return df_res

    @staticmethod
    def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
        df_res = df.copy()
        high_low = df_res["high"] - df_res["low"]
        high_close = (df_res["high"] - df_res["close"].shift()).abs()
        low_close = (df_res["low"] - df_res["close"].shift()).abs()

        ranges = pd.concat([high_low, high_close, low_close], axis=1)
        true_range = ranges.max(axis=1)
        df_res[f"atr_{period}"] = true_range.rolling(window=period).mean()
        return df_res

    @staticmethod
    def calculate_rvol(df: pd.DataFrame, period: int = 20) -> pd.DataFrame:
        df_res = df.copy()
        avg_volume = df_res["volume"].rolling(window=period).mean()
        df_res["rvol"] = df_res["volume"] / avg_volume.replace(0, np.nan)
        df_res["rvol"] = df_res["rvol"].fillna(1.0)
        return df_res

    @classmethod
    def annotate_all_indicators(cls, candles: List[Candle]) -> pd.DataFrame:
        if not candles:
            return pd.DataFrame()

        data = [c.model_dump() for c in candles]
        df = pd.DataFrame(data)
        df = df.sort_values(by="timestamp").reset_index(drop=True)

        df = cls.calculate_emas(df)
        df = cls.calculate_rsi(df)
        df = cls.calculate_atr(df)
        df = cls.calculate_rvol(df)

        return df
