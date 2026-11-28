"""Data model (see docs/architecture.md section 3). Money columns are integer minor units."""
from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    false,
)
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
    # Personal plan. NULL means "not provided yet" and is never treated as zero (FR-04, FR-25).
    timezone: Mapped[str] = mapped_column(String(40), default="Asia/Almaty", server_default="Asia/Almaty")
    planned_income_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    essential_expenses_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    work_hours_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    bank: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(120))
    currency: Mapped[str] = mapped_column(String(3), default="KZT")
    balance_minor: Mapped[int] = mapped_column(BigInteger, default=0)
    kind: Mapped[str | None] = mapped_column(String(20), nullable=True)  # current | savings | deposit | cash; NULL = not set
    # availability: money until `frozen_until` is the user's (counts in capital) but not available (not in the liquid
    # pool, Safe-to-Spend or reserve days). frozen_minor = the blocked part; NULL with a date = the whole balance.
    # stable link to bank statements, independent of the display name: "<bank>|*1234" (last digits of the card or
    # account number from the statement header, never the full number) or "<bank>|name:<header name>" when the
    # header has no number. number_mask keeps only the last 4 digits.
    statement_key: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    number_mask: Mapped[str | None] = mapped_column(String(8), nullable=True)
    frozen_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    frozen_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    interest_rate: Mapped[float | None] = mapped_column(Float, nullable=True)  # % a year, for information
    early_withdrawal: Mapped[str | None] = mapped_column(String(20), nullable=True)  # yes | no | lose_interest
    # accounts created by an import are proposals until the user confirms them in the UI
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())


class AccountCheckpoint(Base):
    """A known balance on a date: entered by the user or taken from a statement header (closing balance).
    The account balance is the latest checkpoint, never a sum of operations (FR-12)."""
    __tablename__ = "account_checkpoints"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    balance_minor: Mapped[int] = mapped_column(BigInteger)
    as_of: Mapped[date] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | statement
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class FxRate(Base):
    """Latest official rate per currency: tenge for 1 unit (nationalbank.kz). rate_date is the NBK publication date,
    fetched_at the moment it was received; source 'demo-seed' means no official rate was received yet."""
    __tablename__ = "fx_rates"
    currency: Mapped[str] = mapped_column(String(3), primary_key=True)
    rate: Mapped[float] = mapped_column(Float)
    rate_date: Mapped[date] = mapped_column(Date)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="nbk")


class FxRateHistory(Base):
    """One official rate per currency and publication date, kept for revaluation of foreign-currency accounts."""
    __tablename__ = "fx_rate_history"
    __table_args__ = (UniqueConstraint("currency", "rate_date", name="uq_fx_history"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    currency: Mapped[str] = mapped_column(String(3), index=True)
    rate_date: Mapped[date] = mapped_column(Date)
    rate: Mapped[float] = mapped_column(Float)


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
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
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
    # The user's own decision about the operation type. It overrides the imported `internal` flag and the
    # amount sign; the imported original is kept untouched (FR-10, FR-17).
    user_kind: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # import = from a bank statement (only type and category may be changed), manual = entered by the user
    source: Mapped[str] = mapped_column(String(10), default="import", server_default="import")
    # user corrections over an imported operation (NULL = keep the imported value)
    user_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    user_booked_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    user_note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # cancelled by the user: kept for history, excluded from every calculation
    voided: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # both legs of a move between the user's own accounts share this id (manual transfer or confirmed pair)
    transfer_group: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    dedup_key: Mapped[str] = mapped_column(String(64))


class MerchantRule(Base):
    __tablename__ = "merchant_rules"
    __table_args__ = (UniqueConstraint("user_id", "merchant", name="uq_rule"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    merchant: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"))
    kind: Mapped[str | None] = mapped_column(String(30), nullable=True)  # operation type for future imports


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
    rejected: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    category_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    debt_left_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # remaining loan, if known


class IncomeSource(Base):
    __tablename__ = "income_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    day_of_month: Mapped[int] = mapped_column(Integer)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    detected: Mapped[bool] = mapped_column(Boolean, default=False)
    rejected: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # The amount varies from payout to payout: cautious plans use the lower bound (FR-29).
    amount_min_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    amount_max_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class PlannedPayment(Base):
    """A planned item that is not a monthly obligation: a one-off or yearly expense or income on a date
    (optionally a window due_on..due_to). Payment is recorded by linking actual operations (settlements)."""
    __tablename__ = "planned_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    direction: Mapped[str] = mapped_column(String(10), default="expense")  # expense | income
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    due_on: Mapped[date] = mapped_column(Date)
    due_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    repeat: Mapped[str] = mapped_column(String(10), default="once")  # once | yearly
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    mandatory: Mapped[bool] = mapped_column(Boolean, default=True)
    movable: Mapped[bool] = mapped_column(Boolean, default=False)
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PlannedSettlement(Base):
    """Links an actual operation to a planned item (partial payments allowed). `period` is the due date of the
    occurrence it pays, so a yearly item keeps its history."""
    __tablename__ = "planned_settlements"
    __table_args__ = (UniqueConstraint("planned_id", "transaction_id", name="uq_settlement"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    planned_id: Mapped[int] = mapped_column(ForeignKey("planned_payments.id"), index=True)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transactions.id"), index=True)
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    period: Mapped[date] = mapped_column(Date)


class TransactionEdit(Base):
    """Audit of user corrections: what changed, before and after. Imported originals are never overwritten."""
    __tablename__ = "transaction_edits"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    transaction_id: Mapped[int] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(12))  # create | update | void | restore | delete
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


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
