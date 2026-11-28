"""Safe-to-Spend (ТЗ BR-10–BR-13) on the server, integer minor units. Same rules as frontend/src/lib/safe-to-spend.ts;
both are pinned to the control example of the spec by tests (C=100 000, payment 90 000 on day 2, D=10 → 1 000).

Horizon: today (day 1) to the day before the nearest confirmed income after today, else to the month end.
F(d) = C − payments due on days 1..d; SafeDaily = floor(max(0, min F(d)/d)); deficit = max(0, −min F(d))."""
import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta


def monthly_date(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def next_monthly(start: date, day: int) -> date:
    y, m = start.year, start.month
    for _ in range(3):
        d = monthly_date(y, m, day)
        if d >= start:
            return d
        m += 1
        if m > 12:
            y, m = y + 1, 1
    raise AssertionError("unreachable")


@dataclass
class Payment:
    due: date
    amount_minor: int
    name: str = ""
    ref: str = ""


@dataclass
class SafeToSpend:
    days: int
    until: date
    horizon: str  # income | month-end
    next_income: date | None
    safe_daily_minor: int
    deficit_minor: int
    first_deficit_day: date | None
    payments: list[Payment] = field(default_factory=list)

    @property
    def committed_minor(self) -> int:
        return sum(p.amount_minor for p in self.payments)


def safe_daily(balance_minor: int, due_by_day: list[int]) -> tuple[int, int, int | None]:
    """(safe daily, deficit, index of the first day the running balance is below zero) — all in minor units."""
    if not due_by_day:
        return 0, 0, None
    f, min_ratio, min_f, first_neg = balance_minor, None, None, None
    for i, due in enumerate(due_by_day):
        f -= due
        min_f = f if min_f is None else min(min_f, f)
        ratio = f // (i + 1) if f >= 0 else -((-f) // (i + 1))
        min_ratio = ratio if min_ratio is None else min(min_ratio, ratio)
        if f < 0 and first_neg is None:
            first_neg = i
    # floor in tenge: the daily amount is a whole number of tenge
    daily = max(0, min_ratio) // 100 * 100
    return daily, max(0, -min_f), first_neg


def compute(today: date, balance_minor: int, income_days: list[int],
            monthly: list[tuple[int, int, str, str, str | None, dict[str, int | None] | None]],
            one_off: list[Payment] = ()) -> SafeToSpend:
    """monthly: (day of month, amount, name, ref, endsAt YYYY-MM or None, amounts by YYYY-MM from rules or None)."""
    incomes = sorted(next_monthly(today, d) for d in income_days)
    nxt = next((d for d in incomes if d > today), None)
    until = nxt - timedelta(days=1) if nxt else monthly_date(today.year, today.month, 31)
    days = (until - today).days + 1
    due = [0] * days
    inside: list[Payment] = []
    for day, amount, name, ref, ends_at, by_month in monthly:
        d = next_monthly(today, day)
        while d <= until:
            key = f"{d.year}-{d.month:02d}"
            if not ends_at or key <= ends_at:
                a = (by_month or {}).get(key)
                a = amount if a is None else a
                due[(d - today).days] += a
                inside.append(Payment(d, a, name, ref))
            d = next_monthly(d + timedelta(days=1), day)
    for p in one_off:
        d = max(p.due, today)
        if d <= until and p.amount_minor > 0:
            due[(d - today).days] += p.amount_minor
            inside.append(Payment(d, p.amount_minor, p.name, p.ref))
    daily, deficit, first_neg = safe_daily(balance_minor, due)
    return SafeToSpend(days, until, "income" if nxt else "month-end", nxt, daily, deficit,
                       today + timedelta(days=first_neg) if first_neg is not None else None,
                       sorted(inside, key=lambda p: p.due))
