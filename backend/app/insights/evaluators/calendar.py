"""Calendar: K181–K188 (two payouts a month is the main case)."""
from datetime import timedelta

from app.insights.signals import Signal, money, needs, not_ready, signal, tenge
from app.insights.snapshot import Snapshot
from app.services.ledger import add_months, month_key
from app.services.safe_to_spend import monthly_date, next_monthly


def _paydays(s: Snapshot):
    return sorted((next_monthly(s.as_of + timedelta(days=1), i.day_of_month), i) for i in s.confirmed_incomes)


@signal("R181")
def r181(s: Snapshot) -> Signal:
    """firstPayGap = max(0, outflows before the first pay - opening spendable)."""
    if s.sts is None or not s.confirmed_incomes:
        return not_ready("R181", "нужны остатки и подтверждённые выплаты дохода")
    first = _paydays(s)[0][0]
    out = sum(p.amount_minor for p in s.sts.payments if p.due < first)
    gap = max(0, out - s.liquid_minor)
    return Signal("R181", ready=True, triggered=gap > 0, evidence_valid=True, values={"gap": money(gap)},
                  evidence_ids=[p.ref for p in s.sts.payments if p.ref and p.due < first],
                  summary=f"До выплаты {first.strftime('%d.%m.%Y')} платежей на {tenge(out)}, доступно {tenge(s.liquid_minor)}: "
                          f"не хватает {tenge(gap)}." if gap else None,
                  entity="payday1", period=s.month, root_cause="cash_gap", critical=gap > 0, impact_minor=gap,
                  urgency=0.9)


@signal("R182")
def r182(s: Snapshot) -> Signal:
    """firstPayReserve = max(0, obligations and daily needs until the second pay - money after the first pay)."""
    pays = _paydays(s)
    if s.sts is None or len(pays) < 2 or s.essential_minor is None:
        return not_ready("R182", "нужны две подтверждённые выплаты в месяц, остатки и обязательные расходы")
    (d1, i1), (d2, _i2) = pays[0], pays[1]
    from app.services import safe_to_spend as sts_svc

    monthly = [(o.day_of_month, s.obligation_month_minor(o, month_key(d1)), o.name, f"ob_{o.id}", o.ends_at, None)
               for o in s.obligations if o.confirmed]
    before = sum(p.amount_minor for p in s.sts.payments if p.due < d1)
    after_first = s.liquid_minor - before + (i1.amount_min_minor or i1.amount_minor)
    between = sts_svc.compute(d1, after_first, [d2.day], monthly)
    daily = s.essential_minor * (d2 - d1).days // 30
    need = between.committed_minor + daily
    gap = max(0, need - after_first)
    return Signal("R182", ready=True, triggered=gap > 0, evidence_valid=True,
                  values={"gap": money(gap), "afterFirst": money(after_first)},
                  evidence_ids=[f"income:{i1.id}"],
                  summary=f"Между выплатами {d1.strftime('%d.%m')} и {d2.strftime('%d.%m')} нужно {tenge(need)} (платежи и "
                          f"повседневные расходы), а после первой выплаты (по нижней границе) будет {tenge(after_first)}."
                  if gap else None,
                  entity="payday2", period=s.month, root_cause="cash_gap", impact_minor=gap, urgency=0.6)


@signal("R183")
def r183(s: Snapshot) -> Signal:
    """peakDayLoad = sum(due payments on a day) / spendable before that day."""
    if s.sts is None or not s.sts.payments:
        return not_ready("R183", "нет подтверждённых платежей в горизонте")
    by_day: dict = {}
    for p in s.sts.payments:
        by_day.setdefault(p.due, []).append(p)
    spent = 0
    for day in sorted(by_day):
        due = sum(p.amount_minor for p in by_day[day])
        spendable = s.liquid_minor - spent
        if len(by_day[day]) > 1 and spendable > 0 and due / spendable > 1:
            return Signal("R183", ready=True, triggered=True, evidence_valid=True,
                          values={"load": round(due / spendable, 2), "day": day.isoformat()},
                          evidence_ids=[p.ref for p in by_day[day] if p.ref],
                          summary=f"{day.strftime('%d.%m.%Y')} сходятся платежи на {tenge(due)} ("
                                  + ", ".join(p.name for p in by_day[day]) + f"), а доступно {tenge(spendable)}.",
                          entity=day.isoformat(), period=s.month, root_cause="cash_gap", critical=True,
                          impact_minor=due - spendable)
        spent += due
    return Signal("R183", ready=True, triggered=False, evidence_valid=True, period=s.month, root_cause="cash_gap")


@signal("R185")
def r185(s: Snapshot) -> Signal:
    """dateConflict = 1[a payment date in 31 days falls on Saturday/Sunday AND the settlement rule is unknown]."""
    obs = [o for o in s.obligations if o.confirmed]
    if not obs:
        return not_ready("R185", "нет подтверждённых платежей")
    hits = []
    for o in obs:
        d = next_monthly(s.as_of, o.day_of_month)
        if (d - s.as_of).days <= 31 and d.weekday() >= 5:
            hits.append((o, d))
    return Signal("R185", ready=True, triggered=bool(hits), evidence_valid=True, values={"count": len(hits)},
                  evidence_ids=[f"obligation:{o.id}" for o, _ in hits],
                  summary="Платёж выпадает на выходной: " + "; ".join(f"«{o.name}» {d.strftime('%d.%m.%Y')}" for o, d in hits)
                          + ". Как его проведёт банк или получатель, неизвестно." if hits else None,
                  entity="calendar", period=s.month, root_cause="weekend_payment", effort=0.2, urgency=0.4)


@signal("R186")
def r186(s: Snapshot) -> Signal:
    """pastDuePlans = sum(unpaidAmount where dueDate < today AND status = active)."""
    items = [p for p in s.planned if p.direction == "expense"]
    if not items:
        return not_ready("R186", "нет плановых расходов")
    late = [(p, s.planned_left_minor(p)) for p in items if (p.due_to or p.due_on) < s.as_of]
    late = [(p, x) for p, x in late if x > 0]
    total = sum(x for _, x in late)
    return Signal("R186", ready=True, triggered=total > 0, evidence_valid=True, values={"pastDue": money(total)},
                  evidence_ids=[f"planned:{p.id}" for p, _ in late],
                  summary="Срок прошёл, оплата не отмечена: " + "; ".join(
                      f"«{p.name}» {tenge(x)} ({p.due_on.strftime('%d.%m.%Y')})" for p, x in late) + "." if late else None,
                  entity="planned", period=s.month, root_cause="overdue", critical=total > 0, impact_minor=total,
                  urgency=1.0)


@signal("R188")
def r188(s: Snapshot) -> Signal:
    """carryRequired = max(0, -min cumulative next-month flows before the first reliable income); compared with the
    money expected to be left at the end of this month."""
    if s.sts is None or s.essential_minor is None or not s.confirmed_incomes:
        return not_ready("R188", "нужны остатки, обязательные расходы и подтверждённые выплаты")
    nxt = add_months(s.as_of.replace(day=1), 1)
    nkey = month_key(nxt)
    first_pay = min(monthly_date(nxt.year, nxt.month, i.day_of_month) for i in s.confirmed_incomes)
    carry = sum(s.obligation_month_minor(o, nkey) for o in s.obligations if o.confirmed
                and monthly_date(nxt.year, nxt.month, o.day_of_month) < first_pay and (not o.ends_at or o.ends_at >= nkey))
    carry += s.essential_minor * (first_pay - nxt).days // 30
    month_end = monthly_date(s.as_of.year, s.as_of.month, 31)
    rest_days = (month_end - s.as_of).days + 1
    # every payment to the month end, also those after the next payout (the spending horizon stops before it)
    this_month_pay = sum(s.obligation_month_minor(o, s.month) for o in s.obligations if o.confirmed
                         and s.as_of <= monthly_date(s.as_of.year, s.as_of.month, o.day_of_month)
                         and (not o.ends_at or o.ends_at >= s.month))
    this_month_pay += sum(p.amount_minor for p in s.sts_one_off() if p.due <= month_end)
    income_left = sum(i.amount_min_minor or i.amount_minor for i in s.confirmed_incomes
                      if s.as_of < monthly_date(s.as_of.year, s.as_of.month, i.day_of_month) <= month_end)
    end_free = s.liquid_minor + income_left - this_month_pay - s.essential_minor * rest_days // 30
    return Signal("R188", ready=True, triggered=end_free < carry, evidence_valid=True,
                  values={"carryRequired": money(carry), "projectedEnd": money(end_free)},
                  summary=f"До первой выплаты {first_pay.strftime('%d.%m.%Y')} в следующем месяце нужно {tenge(carry)}, "
                          f"а к концу этого месяца ожидается {tenge(max(0, end_free))}." if end_free < carry else None,
                  entity="month_end", period=s.month, root_cause="carry", impact_minor=max(0, carry - end_free))


needs("нужны данные: фонды под крупные платежи по датам выплат", "R184")
needs("нужны данные: связь даты разблокировки и выплат", "R187")
