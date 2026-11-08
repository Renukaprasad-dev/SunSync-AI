from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    PROJECT_NAME: str = "SunSync AI"
    VERSION: str = "1.0.0"
    INTERVALS_PER_DAY: int = 96
    INTERVAL_MINUTES: int = 15
    INTERVAL_HOURS: float = 0.25 # 15 min = 0.25 hours
    SOLVER_TIME_LIMIT_SECONDS: float = 8.0 # Serverless function time constraint
    DEFAULT_P_MAX_GRID_KW: float = 25.0
    DEFAULT_GRID_EMISSION_FACTOR_KG_PER_KWH: float = 0.8200 # India CEA grid emission factor
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    STORAGE_MODE: str = "" # Optional override: "supabase", "local_file", "memory"
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    SESSION_SIGNING_SECRET: str = ""
    SESSION_TOKEN_TTL_SECONDS: int = 604800
    SESSION_ISSUANCE_MAX_REQUESTS: int = 10
    # Includes the initial visitor workspace created with the anonymous session.
    SITE_CREATION_LIMIT_PER_SESSION: int = Field(default=3, ge=1, le=100)

    model_config = SettingsConfigDict(env_file=".env", extra="allow")

settings = Settings()

def slot_to_time_str(slot: int) -> str:
    """Converts 0..95 slot index into 'HH:MM' string."""
    slot = max(0, min(95, slot))
    total_minutes = slot * 15
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}"

def time_str_to_slot(time_str: str) -> int:
    """Converts 'HH:MM' string into 0..95 slot index."""
    parts = time_str.strip().split(":")
    hours = int(parts[0])
    minutes = int(parts[1]) if len(parts) > 1 else 0
    return (hours * 60 + minutes) // 15
