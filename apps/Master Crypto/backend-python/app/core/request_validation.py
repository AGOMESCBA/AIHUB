import re
from typing import Literal

from fastapi import HTTPException


Timeframe = Literal["1m", "5m", "15m", "1h", "4h", "1d"]


def normalize_symbol(symbol: str) -> str:
    clean = str(symbol or "").replace("/", "").upper().strip()
    if not re.fullmatch(r"[A-Z0-9]{5,20}", clean):
        raise HTTPException(status_code=400, detail="Simbolo de mercado invalido")
    return clean
