"""Balance simulation: known flows (income, obligations) + bootstrap-resampled variable spending.

Each simulated day draws the variable spend from the user's own history for the same weekday (falling back to all
days when a weekday has too few observations). Scenarios reuse the same random numbers as the base run (common
random numbers), so differences between base and scenario come from the shocks, not from sampling noise."""
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from app.services.ledger import Context, clamp_day, month_key

MIN_WEEKDAY_SAMPLES = 6
PERCENTILES = (10, 25, 50, 75, 90)


@dataclass(frozen=True)
class Shocks:
    fx: float = 0.0  # % depreciation of the tenge
    inflation: float = 0.0  # target annual inflation, %
    income_cut: float = 0.0  # % drop of income
    job_loss_months: float = 0.0

    @property
    def any(self) -> bool:
        return bool(self.fx or self.inflation or self.income_cut or self.job_loss_months)


def fixed_flow(ctx: Context, d: date, income_mult: float = 1.0, job_loss: bool = False) -> float:
    total = 0.0
    for inc in ctx.incomes:
        if d.day == clamp_day(d.year, d.month, inc.day):
            total += 0.0 if job_loss else inc.amount * income_mult
    for ob in ctx.obligations:
        if ob.ends_at and month_key(d) > ob.ends_at:
            continue
        if d.day == clamp_day(d.year, d.month, ob.day):
            total -= ob.amount
    return total


def var_multiplier(ctx: Context, shocks: Shocks, day_idx: int) -> float:
    fx = shocks.fx / 100 * ctx.fx_weight
    infl = max(0.0, shocks.inflation - ctx.cpi_now) / 100 * day_idx / 365
    return 1.0 + fx + infl


def _pool(ctx: Context, d: date) -> np.ndarray:
    pool = ctx.var_by_weekday.get(d.weekday())
    if pool is None or len(pool) < MIN_WEEKDAY_SAMPLES:
        pool = ctx.var_all
    return pool


def draw_spend(ctx: Context, days: int, n: int, seed: int) -> np.ndarray:
    """(n, days) matrix of bootstrap draws of variable spend; column i is day as_of + i + 1."""
    u = np.random.default_rng(seed).random((n, days))
    out = np.zeros((n, days))
    for i in range(days):
        pool = _pool(ctx, ctx.as_of + timedelta(days=i + 1))
        if len(pool):
            out[:, i] = pool[np.minimum((u[:, i] * len(pool)).astype(int), len(pool) - 1)]
    return out


def simulate(ctx: Context, days: int, n: int, seed: int, shocks: Shocks | None = None) -> np.ndarray:
    """Return (n, days + 1) balance paths; column 0 is today's balance."""
    shocks = shocks or Shocks()
    spend = draw_spend(ctx, days, n, seed)
    paths = np.empty((n, days + 1))
    paths[:, 0] = ctx.balance
    income_mult = 1.0 - shocks.income_cut / 100
    job_days = int(round(shocks.job_loss_months * 30))
    bal = np.full(n, ctx.balance)
    for i in range(1, days + 1):
        d = ctx.as_of + timedelta(days=i)
        flow = fixed_flow(ctx, d, income_mult, job_loss=i <= job_days)
        bal = bal + flow - spend[:, i - 1] * var_multiplier(ctx, shocks, i)
        paths[:, i] = bal
    return paths


def percentile_points(ctx: Context, paths: np.ndarray) -> list[dict]:
    pct = np.percentile(paths, PERCENTILES, axis=0)
    out = []
    for i in range(paths.shape[1]):
        d = ctx.as_of + timedelta(days=i)
        out.append({"date": d.isoformat(), **{f"p{p}": int(round(pct[k, i] / 100.0) * 100) for k, p in enumerate(PERCENTILES)}})
    return out


def p_shortfall(paths: np.ndarray) -> float:
    return float((paths.min(axis=1) < 0).mean())


def p_below_zero_by_day(paths: np.ndarray) -> np.ndarray:
    return (paths < 0).mean(axis=0)
