import os
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo


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


DEMO_EMAIL = "demo@zapas.kz"
DEFAULT_TZ = "Asia/Almaty"


def today_in(tz: str | None, now: datetime | None = None) -> date:
    """Calendar date in a time zone; the server clock (UTC in a container) is never used as the user's date."""
    return (now or datetime.now(timezone.utc)).astimezone(ZoneInfo(tz or DEFAULT_TZ)).date()


def pinned_today(user=None) -> date | None:
    """APP_AS_OF pins everyone (tests only). DEMO_AS_OF pins the demo account, whose data ends on that date."""
    pin = os.getenv("APP_AS_OF") or (os.getenv("DEMO_AS_OF") if user is not None and user.email == DEMO_EMAIL else None)
    return date.fromisoformat(pin) if pin else None


def as_of(user=None) -> date:
    """"Today" for all calculations: in the user's time zone (BR-06)."""
    return pinned_today(user) or today_in(user.timezone if user is not None else None)
