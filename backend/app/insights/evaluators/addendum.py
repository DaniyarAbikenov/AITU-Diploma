"""Signals of the addendum 1.1.0 (K201–K204), see docs/insights/review-notes.md."""
from datetime import timedelta

from app.insights.signals import Signal, money, not_ready, signal, tenge
from app.insights.snapshot import Snapshot
from app.models import AmountRule
from app.services.ledger import add_months, month_key


@signal("A001")
def a001(s: Snapshot) -> Signal:
    """pace7 = variable spending of the last 7 days / 7; the ceiling is not a target (BR-13)."""
    if s.sts is None:
        return not_ready("A001", "нет подтверждённых текущих счетов")
    if s.sts.safe_daily_minor <= 0:
        return Signal("A001", ready=True, triggered=False, evidence_valid=True, period=s.month, root_cause="ceiling")
    ops = [t for t in s.cashflow(s.as_of - timedelta(days=7), s.as_of - timedelta(days=1))
           if s.amount(t) < 0 and t.category_id not in ("housing", "credit")]
    if not ops:
        return not_ready("A001", "нет трат за 7 дней")
    pace = -sum(s.amount(t) for t in ops) // 7
    hit = pace >= 0.9 * s.sts.safe_daily_minor
    return Signal("A001", ready=True, triggered=hit, evidence_valid=True,
                  values={"pace7": money(pace), "ceiling": money(s.sts.safe_daily_minor)},
                  summary=f"За последние 7 дней в среднем {tenge(pace)} в день при потолке {tenge(s.sts.safe_daily_minor)} "
                          f"до {s.sts.until.strftime('%d.%m.%Y')}." if hit else None,
                  entity="liquid", period=s.month, root_cause="ceiling", effort=0.1, urgency=0.3)


@signal("A002")
def a002(s: Snapshot) -> Signal:
    """amount = min(plan surplus, unfunded need of the goals or the reserve) — one source with R042/R109/R092."""
    from app.insights.evaluators.debts_reserve import r092
    from app.insights.evaluators.goals_events import r102
    from app.insights.evaluators.plan import r042
    from app.services.money_plan import set_aside

    if set_aside(s)["amountMinor"] is not None:  # the overview already offers the same free money
        return Signal("A002", ready=True, triggered=False, evidence_valid=True, period=s.month, root_cause="surplus_use")

    plan = r042(s)
    if not plan.ready:
        return not_ready("A002", plan.values.get("notReady", "нет плана месяца"))
    surplus = plan.values["surplus"]["value_minor"]
    goal, reserve = r102(s), r092(s)
    needs = []
    if goal.ready and goal.triggered:
        needs.append(("цель", goal.values["required"]["value_minor"] - goal.values["current"]["value_minor"], goal))
    if reserve.ready and reserve.triggered:
        needs.append(("резерв", reserve.values["gap"]["value_minor"], reserve))
    if surplus <= 0 or not needs:
        return Signal("A002", ready=True, triggered=False, evidence_valid=True, period=s.month, root_cause="surplus_use")
    what, need, src = max(needs, key=lambda x: x[1])
    amount = min(surplus, need)
    hit = amount >= s.th.materialityMinor
    target = "в резерв" if what == "резерв" else "в цель"
    return Signal("A002", ready=True, triggered=hit, evidence_valid=True,
                  values={"amount": money(amount), "surplus": money(surplus)}, evidence_ids=src.evidence_ids,
                  summary=f"По плану месяца свободно {tenge(surplus)}; {target} не хватает — можно направить до {tenge(amount)}."
                  if hit else None,
                  entity="month", period=s.month, root_cause="surplus_use", impact_minor=amount, effort=0.3)


@signal("A003")
def a003(s: Snapshot) -> Signal:
    """Items with a «percent of income» rule: income came this month, the amount for the month is not paid yet."""
    from sqlalchemy import select

    rules = list(s.db.scalars(select(AmountRule).where(AmountRule.user_id == s.user.id,
                                                       AmountRule.kind == "percent_income")))
    if not rules:
        return not_ready("A003", "нет правил «процент от дохода»")
    first = s.as_of.replace(day=1)
    income = sum(s.amount(t) for t in s.cashflow(first, s.as_of) if s.amount(t) > 0 and t.category_id == "income")
    if income <= 0:
        return Signal("A003", ready=True, triggered=False, evidence_valid=True, period=s.month, root_cause="tax_set_aside")
    due = []
    for r in {(x.target_type, x.target_id) for x in rules}:
        tt, tid = r
        if tt == "planned":
            p = next((x for x in s.planned if x.id == tid), None)
            if p is not None and p.due_on <= add_months(first, 2) and s.planned_left_minor(p) > 0:
                due.append((p.name, s.planned_left_minor(p), f"planned:{p.id}"))
        else:
            o = next((x for x in s.obligations if x.id == tid and x.confirmed), None)
            amt = s.rule_amount_minor("obligation", tid, s.month) if o else None
            if o and amt:
                due.append((o.name, amt, f"obligation:{o.id}"))
    if not due:
        return Signal("A003", ready=True, triggered=False, evidence_valid=True, period=s.month, root_cause="tax_set_aside")
    total = sum(a for _, a, _ in due)
    return Signal("A003", ready=True, triggered=True, evidence_valid=True,
                  values={"setAside": money(total), "incomeMonth": money(income)}, evidence_ids=[e for *_, e in due],
                  summary=f"В {month_key(first)} пришло {tenge(income)}; по вашему правилу к оплате: "
                          + "; ".join(f"«{n}» {tenge(a)}" for n, a, _ in due) + ".",
                  entity="tax", period=s.month, root_cause="tax_set_aside", impact_minor=total, urgency=0.5)


@signal("A004")
def a004(s: Snapshot) -> Signal:
    """Guard for debt advice: income of the last month missing, < 50 % of the confirmed expected, or below payments.
    Same thresholds as /obligations/dti-history."""
    from app.insights.evaluators.debts_reserve import INCOMPLETE_SHARE, _debts

    debts = _debts(s)
    if not debts:
        return not_ready("A004", "нет подтверждённых кредитов")
    first = add_months(s.as_of.replace(day=1), -1)
    last = s.as_of.replace(day=1) - timedelta(days=1)
    ops = s.cashflow(first, last)
    if not ops:
        return not_ready("A004", "нет операций за прошлый месяц")
    income = sum(s.amount(t) for t in ops if s.amount(t) > 0 and t.category_id == "income")
    payments = sum(s.obligation_month_minor(o, s.month) for o in debts)
    expected = s.income_floor_minor
    bad = income <= 0 or (expected and income < INCOMPLETE_SHARE * expected) or payments > income
    return Signal("A004", ready=True, triggered=bool(bad), evidence_valid=True,
                  values={"income": money(income), "payments": money(payments),
                          "expected": money(expected) if expected else None},
                  summary=(f"За {month_key(first)} в операциях дохода {tenge(income)}"
                           + (f" при ожидаемом {tenge(expected)}" if expected else "")
                           + f", а платежи по кредитам {tenge(payments)}. Часть поступлений может быть помечена как переводы "
                             f"между своими счетами или не загружена.") if bad else None,
                  entity="debts", period=s.month, root_cause="debt_income_check", effort=0.3, urgency=0.4)
