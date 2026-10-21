import os
from datetime import date


class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./data/app.db")
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-only-change-me-dev-only-change-me-32b")
    jwt_ttl_hours: int = int(os.getenv("JWT_TTL_HOURS", "12"))
    cors_origins: list[str] = [
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173,http://localhost:8080").split(",")
        if o.strip()
    ]
    seed_demo: bool = os.getenv("SEED_DEMO", "1") == "1"
    mc_paths: int = int(os.getenv("MC_PATHS", "2000"))
    # official USD/KZT from nationalbank.kz: loaded at startup and then every NBK_RATES_INTERVAL seconds
    nbk_rates: bool = os.getenv("NBK_RATES", "1") == "1"
    nbk_rates_interval: int = int(os.getenv("NBK_RATES_INTERVAL", "3600"))
    model_version: str = "fc-1.0-bootstrap"


settings = Settings()


def as_of() -> date:
    """'Today' for all calculations. APP_AS_OF pins it for reproducible demos and tests."""
    pinned = os.getenv("APP_AS_OF")
    return date.fromisoformat(pinned) if pinned else date.today()
