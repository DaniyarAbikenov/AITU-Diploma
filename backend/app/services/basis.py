"""Monthly essential expenses and planned income derived from the user's own data: the single source for the reserve,
the resilience index, the month plan and the smart insights (FR-04, FR-05, BR-14).

Essential = confirmed monthly payments (with their rules, loans by the monthly payment) + 1/12 of mandatory yearly items
and of mandatory one-off items due within 12 months + everyday needs × days of the month. A need that is already one
of these payments is not added again. Unknown is never zero: while everyday spending is unknown the sum is shown as
partial and not used in calculations."""
import calendar
from dataclasses import dataclass, field
from datetime import date
from fractions import Fraction

from app.models import DailyNeed, User
from app.services import rules as rule_svc
from app.services.ledger import add_months

EVERYDAY = {"food", "cafe", "transport", "health"}


@dataclass
class Essential:
    month: str
    items: list[dict] = field(default_factory=list)  # type payment | planned | need, name, amountMinor, note
    needs: list[DailyNeed] = field(default_factory=list)  # needs counted on top of the payments
    everyday_known: bool = False
    auto_minor: int | None = None  # None: nothing to add up
    source: str = "none"  # manual (override) | auto | fallback (entered, automatic is incomplete) | partial | none
    value_minor: int | None = None  # used in calculations; None while unknown or partial
    living_minor: int | None = None  # the part that is not a dated payment


def month_days(month: str) -> int:
    y, m = (int(x) for x in month.split("-"))
    return calendar.monthrange(y, m)[1]


def _planned_items(s, month: str) -> list[dict]:
    first = date.fromisoformat(month + "-01")
    until = add_months(first, 12)
    out = []
    for p in s.planned:
        if p.direction != "expense" or not p.mandatory:
            continue
        if p.repeat == "yearly":
            amount, note = s.planned_amount_minor(p), "раз в год ÷ 12"
        else:
            if p.due_on >= until or (p.due_on < first and month != s.month):
                continue
            amount, note = s.planned_left_minor(p), "разово, остаток ÷ 12"
        share = round(Fraction(amount, 12))
        if share > 0:
            out.append({"type": "planned", "ref": f"pl_{p.id}", "name": p.name, "amountMinor": share, "note": note})
    return out


def essential(s, month: str | None = None) -> Essential:
    month = month or s.month
    e = Essential(month)
    pays = [o for o in s.obligations if o.confirmed and (not o.ends_at or o.ends_at >= month)]
    for o in pays:
        e.items.append({"type": "payment", "ref": f"ob_{o.id}", "name": o.name,
                        "amountMinor": s.obligation_month_minor(o, month), "note": "в месяц"})
    e.items += _planned_items(s, month)
    refs = {x["ref"] for x in e.items}
    payments_minor = sum(x["amountMinor"] for x in e.items)
    days = month_days(month)
    e.needs = [n for n in s.needs if n.covered_by not in refs]
    for n in e.needs:
        per_day = n.period == "day"
        e.items.append({"type": "need", "ref": f"need_{n.id}", "name": n.name,
                        "amountMinor": n.amount_minor * (days if per_day else 1),
                        "perDayMinor": n.amount_minor if per_day else None, "days": days if per_day else None,
                        "note": "в месяц"})
    e.everyday_known = bool(s.needs) or any(
        o.category_id in EVERYDAY
        or ((r := rule_svc.rule_for(s.db, s.user, "obligation", o.id, month)) is not None and r.kind == "per_day")
        for o in pays)
    e.auto_minor = sum(x["amountMinor"] for x in e.items) if e.items else None
    u: User = s.user
    manual, complete = u.essential_expenses_minor, e.auto_minor is not None and e.everyday_known
    if manual is not None and u.essential_override:
        e.source, e.value_minor = "manual", manual
    elif complete:
        e.source, e.value_minor = "auto", e.auto_minor
    elif manual is not None:
        e.source, e.value_minor = "fallback", manual
    elif e.auto_minor is not None:
        e.source = "partial"
    if e.source == "auto":
        e.living_minor = e.auto_minor - payments_minor
    elif e.value_minor is not None:
        e.living_minor = max(0, e.value_minor - payments_minor)
    return e


def living_on(s, e: Essential, day: date) -> Fraction:
    """Everyday essential spending on one day (dated payments excluded)."""
    if e.source == "auto":
        return sum((s.need_per_day(n, day) for n in e.needs), Fraction(0))
    return Fraction(e.living_minor or 0, calendar.monthrange(day.year, day.month)[1])


def income(s) -> dict:
    """Expected monthly income from confirmed payouts with its range; a typed value is an override or a fallback."""
    inc = s.confirmed_incomes
    auto = sum(i.amount_minor for i in inc) if inc else None
    u: User = s.user
    manual = u.planned_income_minor
    if manual is not None and u.planned_income_override:
        source, value = "manual", manual
    elif auto is not None:
        source, value = "auto", auto
    elif manual is not None:
        source, value = "fallback", manual
    else:
        source, value = "none", None
    return {"source": source, "valueMinor": value, "autoMinor": auto,
            "lowMinor": sum(i.amount_min_minor or i.amount_minor for i in inc) if inc else None,
            "highMinor": sum(i.amount_max_minor or i.amount_minor for i in inc) if inc else None,
            "items": [{"name": i.name, "amountMinor": i.amount_minor, "day": i.day_of_month} for i in inc]}
