"""Official exchange rates (nationalbank.kz) and conversion of foreign-currency money to tenge.

Money of every account stays in its own currency (integer minor units of that currency). Tenge equivalents are
derived at read time from the latest official rate and are never stored back; see docs/decisions.md."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import FxRate, FxRateHistory, MacroSeries

SUPPORTED = ("KZT", "USD", "EUR", "RUB")


@dataclass
class Rate:
    currency: str
    rate: float  # tenge per 1 unit
    rate_date: date
    fetched_at: datetime | None
    source: str

    @property
    def stale(self) -> bool:
        """True when the official feed has not been received recently (or never): the value is the last known one."""
        if self.source != "nbk" or self.fetched_at is None:
            return True
        fetched = self.fetched_at if self.fetched_at.tzinfo else self.fetched_at.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - fetched > timedelta(seconds=3 * settings.nbk_rates_interval)


def store(db: Session, published: date, rates: dict[str, float]) -> None:
    now = datetime.now(timezone.utc)
    for cur, value in rates.items():
        row = db.get(FxRate, cur)
        if row is None:
            db.add(FxRate(currency=cur, rate=value, rate_date=published, fetched_at=now, source="nbk"))
        else:
            row.rate, row.rate_date, row.fetched_at, row.source = value, published, now, "nbk"
        if not db.scalar(select(FxRateHistory.id).where(FxRateHistory.currency == cur, FxRateHistory.rate_date == published)):
            db.add(FxRateHistory(currency=cur, rate_date=published, rate=value))
    db.flush()


def latest(db: Session, currency: str) -> Rate | None:
    if currency == "KZT":
        return Rate("KZT", 1.0, date.today(), None, "fixed")
    row = db.get(FxRate, currency)
    if row is not None:
        return Rate(row.currency, row.rate, row.rate_date, row.fetched_at, row.source)
    if currency == "USD":  # no official feed yet: the last point of the USD/KZT macro series, clearly marked
        m = db.scalar(select(MacroSeries).where(MacroSeries.code == "usdkzt").order_by(MacroSeries.as_of.desc()))
        if m is not None:
            return Rate("USD", m.value, m.as_of, None, m.source)
    return None


def all_rates(db: Session) -> list[Rate]:
    return [r for c in SUPPORTED if c != "KZT" and (r := latest(db, c)) is not None]


def rate_on(db: Session, currency: str, day: date) -> float | None:
    """Official rate on a day (the last publication on or before it), or None when history does not reach back."""
    if currency == "KZT":
        return 1.0
    row = db.scalar(select(FxRateHistory).where(FxRateHistory.currency == currency, FxRateHistory.rate_date <= day)
                    .order_by(FxRateHistory.rate_date.desc()))
    return row.rate if row else None


def to_kzt_minor(amount_minor: int, rate: Rate | None) -> int | None:
    return None if rate is None else round(amount_minor * rate.rate)
