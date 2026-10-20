"""Loads a user's data into a plain, DB-free Context that the forecasting engines work on."""
import calendar
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import FIXED_CATEGORIES
from app.models import Account, Category, IncomeSource, MacroSeries, Obligation, Transaction, User

WINDOW_DAYS = 90


@dataclass
class Ob:
    name: str
    kind: str
    amount: float  # tenge
    day: int
    ends_at: str | None = None


@dataclass
class Inc:
    name: str
    amount: float
    day: int


@dataclass
class Tx:
    on: date
    amount: float  # tenge, negative = expense
    category: str


@dataclass
class Context:
    as_of: date
    balance: float
    obligations: list[Ob]
    incomes: list[Inc]
    txs: list[Tx]
    cat_names: dict[str, str]
    cat_fx: dict[str, float]
    cpi_now: float = 9.0  # headline inflation, %, y/y
    var_all: np.ndarray = field(default_factory=lambda: np.zeros(0))
    var_by_weekday: dict[int, np.ndarray] = field(default_factory=dict)
    var_by_category: dict[str, float] = field(default_factory=dict)  # tenge over the window

    @property
    def fx_weight(self) -> float:
        total = sum(self.var_by_category.values())
        if total <= 0:
            return 0.0
        return sum(v * self.cat_fx.get(c, 0.0) for c, v in self.var_by_category.items()) / total


def month_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


def add_months(d: date, n: int) -> date:
    idx = d.year * 12 + d.month - 1 + n
    return date(idx // 12, idx % 12 + 1, 1)


def clamp_day(year: int, month: int, day: int) -> int:
    return min(day, calendar.monthrange(year, month)[1])


def build_context(db: Session, user: User, as_of: date) -> Context:
    accounts = db.scalars(select(Account).where(Account.user_id == user.id, Account.currency == "KZT")).all()
    obligations = [
        Ob(o.name, o.kind, o.amount_minor / 100, o.day_of_month, o.ends_at)
        for o in db.scalars(select(Obligation).where(Obligation.user_id == user.id))
    ]
    incomes = [
        Inc(i.name, i.amount_minor / 100, i.day_of_month)
        for i in db.scalars(select(IncomeSource).where(IncomeSource.user_id == user.id))
    ]
    horizon_start = as_of - timedelta(days=400)
    rows = db.execute(
        select(Transaction.booked_on, Transaction.amount_minor, Transaction.category_id).where(
            Transaction.user_id == user.id, Transaction.internal.is_(False), Transaction.currency == "KZT",
            Transaction.booked_on >= horizon_start, Transaction.booked_on <= as_of)
    ).all()
    txs = [Tx(r[0], r[1] / 100, r[2]) for r in rows]
    cats = db.scalars(select(Category)).all()
    cpi = db.scalar(select(MacroSeries).where(MacroSeries.code == "cpi").order_by(MacroSeries.as_of.desc()))
    ctx = Context(
        as_of=as_of, balance=sum(a.balance_minor for a in accounts) / 100, obligations=obligations, incomes=incomes,
        txs=txs, cat_names={c.id: c.name for c in cats}, cat_fx={c.id: c.fx_sensitivity for c in cats},
        cpi_now=cpi.value if cpi else 9.0,
    )
    _fill_variable_spend(ctx)
    return ctx


def _fill_variable_spend(ctx: Context) -> None:
    """Daily variable spending over the last WINDOW_DAYS complete days (obligations are modelled separately)."""
    start = ctx.as_of - timedelta(days=WINDOW_DAYS)
    first = min((t.on for t in ctx.txs), default=ctx.as_of)
    start = max(start, first)
    per_day: dict[date, float] = defaultdict(float)
    by_cat: dict[str, float] = defaultdict(float)
    for t in ctx.txs:
        if start <= t.on < ctx.as_of and t.amount < 0 and t.category not in FIXED_CATEGORIES:
            per_day[t.on] += -t.amount
            by_cat[t.category] += -t.amount
    days = [start + timedelta(days=i) for i in range((ctx.as_of - start).days)]
    values = np.array([per_day.get(d, 0.0) for d in days], dtype=float)
    ctx.var_all = values
    ctx.var_by_category = dict(by_cat)
    for w in range(7):
        pool = np.array([v for d, v in zip(days, values, strict=True) if d.weekday() == w], dtype=float)
        ctx.var_by_weekday[w] = pool


def monthly_totals(ctx: Context, months: int) -> dict[str, dict[str, float]]:
    """Per completed month before as_of: {'2026-09': {'income': x, 'expense': y, 'debt': z}}."""
    cur = date(ctx.as_of.year, ctx.as_of.month, 1)
    out: dict[str, dict[str, float]] = {}
    for k in range(1, months + 1):
        out[month_key(add_months(cur, -k))] = {"income": 0.0, "expense": 0.0, "debt": 0.0}
    for t in ctx.txs:
        key = month_key(t.on)
        if key not in out:
            continue
        if t.amount > 0 and t.category == "income":
            out[key]["income"] += t.amount
        elif t.amount < 0:
            out[key]["expense"] += -t.amount
            if t.category == "credit":
                out[key]["debt"] += -t.amount
    return out


def month_has_data(ctx: Context, key: str) -> bool:
    return any(month_key(t.on) == key for t in ctx.txs)
