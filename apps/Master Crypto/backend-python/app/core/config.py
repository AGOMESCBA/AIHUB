from pydantic_settings import BaseSettings
from pydantic import Field, ConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "Crypto Swing API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Supabase PostgreSQL Database
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/crypto_swing",
        alias="DATABASE_URL"
    )
    SUPABASE_URL: str = Field(default="", alias="SUPABASE_URL")
    SUPABASE_ANON_KEY: str = Field(default="", alias="SUPABASE_ANON_KEY")
    
    # Binance Exchange
    BINANCE_API_KEY: str = Field(default="", alias="BINANCE_API_KEY")
    BINANCE_API_SECRET: str = Field(default="", alias="BINANCE_API_SECRET")
    BINANCE_TESTNET: bool = Field(default=True, alias="BINANCE_TESTNET")

    # Scanner Settings
    DEFAULT_TOP_LIMIT: int = 20

    # Risk Manager Baseline Settings
    DEFAULT_RISK_PER_TRADE_PCT: float = 2.0
    MIN_RISK_REWARD_RATIO: float = 2.0
    MIN_TECHNICAL_POTENTIAL_PCT: float = 5.0

    model_config = ConfigDict(env_file=".env", extra="ignore")

settings = Settings()
