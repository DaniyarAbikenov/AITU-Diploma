"""One server calculation behind the overview: needs, the spending limit and what could be set aside."""
from datetime import date, timedelta
from fractions import Fraction
from statistics import median

from app.insights.snapshot import Snapshot
from app.services.safe_to_spend import next_monthly

SET_ASIDE_DAYS = 35  # more than one month: covers both payouts and every monthly payment at least once
NOT_DAILY = {"housing", "credit"}


def suggested_daily_minor(s: Snapshot) -> int | None:
    """Median personal everyday spending per day over 60 days of statements; None with fewer than 30 covered days."""
    start = s.as_of - timedelta(days=60)
    ops = s.cashflow(start, s.as_of - timedelta(days=1))
    if not ops:
        return None
    first = max(start, min(s.day(t) for t in ops))
    n = (s.as_of - first).days
    if n < 30:
        return None
    per = {first + timedelta(days=i): 0 for i in range(n)}
    for t in ops:
        if s.amount(t) < 0 and t.category_id not in NOT_DAILY and s.day(t) in per:
            per[s.day(t)] -= s.amount(t)
    return int(median(per.values()))


def lowest_balance(s: Snapshot) -> int:
    """Lowest projected free money over SET_ASIDE_DAYS: payments and needs first, incomes by their lower bound."""
    flows: dict[date, int] = {}
    end = s.as_of + timedelta(days=SET_ASIDE_DAYS - 1)

    def add(d: date, v: int) -> None:
        flows[d] = flows.get(d, 0) + v

    for day, amount, _n, _r, ends, by_month in s.sts_monthly():
        d = next_monthly(s.as_of, day)
        while d <= end:
            key = f"{d.year}-{d.month:02d}"
            if not ends or key <= ends:
                v = (by_month or {}).get(key)
                add(d, -(amount if v is None else v))
            d = next_monthly(d + timedelta(days=1), day)
    for p in s.sts_one_off():
        if max(p.due, s.as_of) <= end:
            add(max(p.due, s.as_of), -p.amount_minor)
    for i in s.confirmed_incomes:
        d = next_monthly(s.as_of + timedelta(days=1), i.day_of_month)
        while d <= end:
            add(d + timedelta(days=1), i.amount_min_minor or i.amount_minor)  # spent before received on the same day
            d = next_monthly(d + timedelta(days=1), i.day_of_month)
    free = s.liquid_minor - s.protected_minor
    low, needs = free, Fraction(0)
    for k in range(SET_ASIDE_DAYS):
        d = s.as_of + timedelta(days=k)
        free += flows.get(d, 0)
        needs += s.need_on(d)
        low = min(low, free - round(needs))
    return low


def targets(s: Snapshot) -> list[dict]:
    """Where money is missing: reserve first (global policy), then goals by the closest deadline."""
    out = []
    if s.essential_minor and s.savings_total_minor is not None:
        goal = int(s.th.targetReserveMonths * s.essential_minor)
        if goal > s.savings_total_minor:
            out.append({"type": "reserve", "id": None, "name": "Резерв", "needMinor": goal - s.savings_total_minor})
    for g in sorted(s.goals, key=lambda x: (x.deadline, x.id)):
        if g.saved_minor < g.target_minor:
            out.append({"type": "goal", "id": str(g.id), "name": g.name, "needMinor": g.target_minor - g.saved_minor})
    return out


def distribute(pool: int, where: list[dict]) -> list[dict]:
    out = []
    for t in where:
        a = min(pool, t["needMinor"])
        if a > 0:
            out.append({**t, "amountMinor": a})
            pool -= a
    return out


def set_aside(s: Snapshot) -> dict:
    """Suggestion only. Not computed while an input is unknown: needs and a confirmed income are required."""
    missing = []
    if s.liquid_minor is None:
        missing.append("accounts")
    if not s.essential.everyday_known:
        missing.append("needs")
    if not s.confirmed_incomes:
        missing.append("income")
    if missing:
        return {"amountMinor": None, "missing": missing, "items": [], "freeMinor": None}
    free = max(0, lowest_balance(s))
    items = distribute(free, targets(s))
    return {"amountMinor": sum(x["amountMinor"] for x in items), "missing": [], "items": items, "freeMinor": free}
