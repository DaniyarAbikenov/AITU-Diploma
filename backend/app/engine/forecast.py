"""Month-end spending forecast and balance forecast on top of the Monte Carlo engine."""
import calendar
from dataclasses import dataclass
from datetime import timedelta

import numpy as np

from app.catalog import FIXED_CATEGORIES
from app.engine import montecarlo as mc
from app.services.ledger import Context, add_months, clamp_day, month_key


def seed_for(user_id: int, ctx: Context) -> int:
    return user_id * 100003 + ctx.as_of.toordinal()


@dataclass
class MonthEnd:
    month: str
    spent_so_far: float
    median: float
    low: float
    high: float
    prev_month: float
    pace_per_day: float
    drivers: list[tuple[str, float]]
    naive: float  # baseline: spent_so_far / elapsed days * days in month


def _month_expense(ctx: Context, key: str, category: str | None = None) -> float:
    return sum(-t.amount for t in ctx.txs if t.amount < 0 and month_key(t.on) == key and (category is None or t.category == category))


def month_end(ctx: Context, user_id: int, n: int) -> MonthEnd:
    today = ctx.as_of
    key = month_key(today)
    dim = calendar.monthrange(today.year, today.month)[1]
    spent = _month_expense(ctx, key)
    # obligations still due later this month (not yet visible in the statement)
    remaining_obl = sum(
        ob.amount for ob in ctx.obligations
        if clamp_day(today.year, today.month, ob.day) > today.day and not (ob.ends_at and key > ob.ends_at)
    )
    left = dim - today.day
    draws = mc.draw_spend(ctx, left, n, seed_for(user_id, ctx)) if left > 0 else np.zeros((n, 0))
    totals = spent + remaining_obl + draws.sum(axis=1)
    rnd = lambda v: float(round(v / 1000.0) * 1000)  # noqa: E731
    prev_key = month_key(add_months(today.replace(day=1), -1))
    prev_total = _month_expense(ctx, prev_key)
    drivers = _drivers(ctx, key, prev_key, today.day, dim)
    return MonthEnd(
        month=key, spent_so_far=spent, median=rnd(np.percentile(totals, 50)), low=rnd(np.percentile(totals, 10)),
        high=rnd(np.percentile(totals, 90)), prev_month=prev_total, pace_per_day=spent / max(today.day, 1),
        drivers=drivers, naive=spent / max(today.day, 1) * dim,
    )


def _drivers(ctx: Context, key: str, prev_key: str, day: int, dim: int) -> list[tuple[str, float]]:
    """Categories whose projected month total differs most from last month (variable categories only)."""
    out = []
    for cat, name in ctx.cat_names.items():
        if cat in FIXED_CATEGORIES or cat in ("income", "transfers"):
            continue
        now = _month_expense(ctx, key, cat) / max(day, 1) * dim
        prev = _month_expense(ctx, prev_key, cat)
        if now or prev:
            out.append((name, round((now - prev) / 1000) * 1000.0))
    out.sort(key=lambda x: -abs(x[1]))
    return [d for d in out if d[1] != 0][:3]


def balance_forecast(ctx: Context, user_id: int, days: int, n: int) -> dict:
    paths = mc.simulate(ctx, days, n, seed_for(user_id, ctx))
    points = mc.percentile_points(ctx, paths)
    below = mc.p_below_zero_by_day(paths)
    payments = []
    for i in range(1, days + 1):
        d = ctx.as_of + timedelta(days=i)
        for ob in ctx.obligations:
            if (not (ob.ends_at and month_key(d) > ob.ends_at)) and d.day == clamp_day(d.year, d.month, ob.day):
                payments.append({"date": d.isoformat(), "name": ob.name, "amount": ob.amount})
    risk_days = []
    for i in range(1, days + 1):
        if below[i] >= 0.05 and len(risk_days) < 6:
            d = ctx.as_of + timedelta(days=i)
            due = [p["name"] for p in payments if p["date"] == d.isoformat()]
            reason = f"Платёж «{due[0]}» до поступления дохода" if due else "Остаток может уйти в минус из-за ежедневных трат"
            risk_days.append({"date": d.isoformat(), "reason": reason, "pBelowZero": round(float(below[i]), 2)})
    return {"points": points, "risk_days": risk_days, "payments": payments, "paths": paths}
