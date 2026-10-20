"""Data model (see docs/architecture.md section 3). Money columns are integer minor units."""
from datetime import date, datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    city: Mapped[str] = mapped_column(String(80), default="Алматы")
    currency: Mapped[str] = mapped_column(String(3), default="KZT")
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    bank: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(120))
    currency: Mapped[str] = mapped_column(String(3), default="KZT")
    balance_minor: Mapped[int] = mapped_column(BigInteger, default=0)


class Category(Base):
    """Global categories. `cpi_group` links a category to a CPI series, `fx_sensitivity` is the share of
    the category price that follows the exchange rate (expert estimate, see docs/decisions.md)."""
    __tablename__ = "categories"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    color: Mapped[str] = mapped_column(String(20))
    cpi_group: Mapped[str | None] = mapped_column(String(40), nullable=True)
    fx_sensitivity: Mapped[float] = mapped_column(Float, default=0.0)


class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    bank: Mapped[str] = mapped_column(String(80))
    source: Mapped[str] = mapped_column(String(20), default="synthetic")  # synthetic | pdf
    status: Mapped[str] = mapped_column(String(20), default="done")
    parsed: Mapped[int] = mapped_column(Integer, default=0)
    needs_review: Mapped[int] = mapped_column(Integer, default=0)
    period_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (UniqueConstraint("user_id", "dedup_key", name="uq_tx_dedup"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id"), nullable=True)
    booked_on: Mapped[date] = mapped_column(Date, index=True)
    amount_minor: Mapped[int] = mapped_column(BigInteger)  # negative = expense
    currency: Mapped[str] = mapped_column(String(3), default="KZT")
    merchant: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"))
    category_source: Mapped[str] = mapped_column(String(10), default="rule")  # rule | model | user
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    internal: Mapped[bool] = mapped_column(Boolean, default=False)
    dedup_key: Mapped[str] = mapped_column(String(64))


class MerchantRule(Base):
    __tablename__ = "merchant_rules"
    __table_args__ = (UniqueConstraint("user_id", "merchant", name="uq_rule"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    merchant: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"))


class Obligation(Base):
    __tablename__ = "obligations"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))  # credit | installment | rent | subscription | utility
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    day_of_month: Mapped[int] = mapped_column(Integer)
    ends_at: Mapped[str | None] = mapped_column(String(7), nullable=True)  # YYYY-MM
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    detected: Mapped[bool] = mapped_column(Boolean, default=False)


class IncomeSource(Base):
    __tablename__ = "income_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    day_of_month: Mapped[int] = mapped_column(Integer)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    detected: Mapped[bool] = mapped_column(Boolean, default=False)


class Goal(Base):
    __tablename__ = "goals"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    target_minor: Mapped[int] = mapped_column(BigInteger)
    saved_minor: Mapped[int] = mapped_column(BigInteger, default=0)
    monthly_minor: Mapped[int] = mapped_column(BigInteger, default=0)
    deadline: Mapped[str] = mapped_column(String(7))  # YYYY-MM


class SavedScenario(Base):
    __tablename__ = "scenarios"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    shocks: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[date] = mapped_column(Date)


class InsightDismissal(Base):
    __tablename__ = "insight_dismissals"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    key: Mapped[str] = mapped_column(String(80), primary_key=True)


class MacroSeries(Base):
    """Monthly macro series. `source` is 'nbk' / 'bns' for ingested official data and 'demo-seed' for demo values."""
    __tablename__ = "macro_series"
    __table_args__ = (UniqueConstraint("code", "as_of", name="uq_macro"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), index=True)
    as_of: Mapped[date] = mapped_column(Date)
    value: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(20), default="demo-seed")


class CityPrice(Base):
    __tablename__ = "city_prices"
    id: Mapped[int] = mapped_column(primary_key=True)
    city: Mapped[str] = mapped_column(String(80), index=True)
    item: Mapped[str] = mapped_column(String(80))
    unit: Mapped[str] = mapped_column(String(20))
    price: Mapped[float] = mapped_column(Float)
    change: Mapped[float] = mapped_column(Float)  # share, e.g. 0.12 = +12% y/y
    as_of: Mapped[date] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(20), default="demo-seed")


class ResilienceSnapshot(Base):
    __tablename__ = "resilience_snapshots"
    __table_args__ = (UniqueConstraint("user_id", "month", name="uq_snapshot"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    month: Mapped[str] = mapped_column(String(7))
    score: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(10), default="computed")  # computed | demo-seed


class ForecastRun(Base):
    """Reproducibility log: every forecast stores model version, parameters and the headline result."""
    __tablename__ = "forecast_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    model_version: Mapped[str] = mapped_column(String(40))
    as_of: Mapped[date] = mapped_column(Date)
    params: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
