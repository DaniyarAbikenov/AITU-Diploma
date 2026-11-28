"""Income and the month plan: K031, K038, K039, K041–K050 (R031–R050)."""
from datetime import date, timedelta

from app.insights.signals import Signal, money, needs, not_ready, signal, tenge
from app.insights.snapshot import Snapshot
from app.services.ledger import add_months, month_key
from app.services.safe_to_spend import monthly_date


def _plan(s: Snapshot):
    """(I_plan cautious, E_plan essential with obligations, savingsPlan) or None when income or essentials are unknown."""
    if s.income_floor_minor is None or s.essential_minor is None:
        return None
    return s.income_floor_minor, s.essential_minor, s.savings_plan_minor


@signal("R031")
def r031(s: Snapshot) -> Signal:
    """I_floor = sum(confirmedIncomeLowerBound[j]); triggered when planned spending > I_floor + spendable opening."""
    p = _plan(s)
    if p is None or s.liquid_minor is None:
        return not_ready("R031", "нужны подтверждённые выплаты дохода, обязательные расходы и остатки")
    i_floor, e_plan, _ = p
    short = e_plan - (i_floor + s.liquid_minor)
    return Signal("R031", ready=True, triggered=short > 0, evidence_valid=True,
                  values={"I_floor": money(i_floor), "E_plan": money(e_plan)},
                  evidence_ids=[f"income:{i.id}" for i in s.confirmed_incomes],
                  summary=f"Осторожный доход месяца {tenge(i_floor)} и доступные {tenge(s.liquid_minor)} меньше плана "
                          f"обязательных трат {tenge(e_plan)} на {tenge(short)}." if short > 0 else None,
                  entity="month", period=s.month, root_cause="plan_gap", impact_minor=max(0, short))


@signal("R038")
def r038(s: Snapshot) -> Signal:
    """unmatchedDue = sum(plannedIncome where dueDate < today - grace AND no linked receipt this month)."""
    inc = s.confirmed_incomes
    if not inc:
        return not_ready("R038", "нет подтверждённых выплат дохода")
    if not s.transactions:
        return not_ready("R038", "нет операций за период")
    grace = s.th.incomeGraceDays
    missing = []
    for i in inc:
        due = monthly_date(s.as_of.year, s.as_of.month, i.day_of_month)
        if due >= s.as_of - timedelta(days=grace):
            continue
        floor = (i.amount_min_minor or i.amount_minor) // 2
        got = [t for t in s.transactions if abs((s.day(t) - due).days) <= grace + 2 and s.amount(t) >= floor
               and t.category_id == "income" and not s.is_own_transfer(t)]
        if not got:
            missing.append((i, due))
    total = sum(i.amount_min_minor or i.amount_minor for i, _ in missing)
    return Signal("R038", ready=True, triggered=bool(missing), evidence_valid=True, values={"unmatchedDue": money(total)},
                  evidence_ids=[f"income:{i.id}" for i, _ in missing],
                  summary="Ожидаемая выплата не найдена в операциях: " + "; ".join(
                      f"«{i.name}» за {d.strftime('%d.%m.%Y')}" for i, d in missing) + "." if missing else None,
                  entity="income", period=s.month, root_cause="missing_income", impact_minor=total, urgency=0.7,
                  critical=bool(missing))


@signal("R039")
def r039(s: Snapshot) -> Signal:
    """breakEvenIncome = essentialPlan + debtDue + taxesDue + chosenSavings; triggered when I_floor < breakEven."""
    p = _plan(s)
    if p is None:
        return not_ready("R039", "нужны подтверждённые выплаты дохода и обязательные расходы")
    i_floor, e_plan, savings = p
    need = e_plan + savings
    return Signal("R039", ready=True, triggered=i_floor < need, evidence_valid=True,
                  values={"breakEven": money(need), "I_floor": money(i_floor)},
                  summary=f"Для текущего плана (обязательное {tenge(e_plan)} и взносы в цели {tenge(savings)}) нужен доход "
                          f"{tenge(need)} в месяц, осторожная оценка дохода — {tenge(i_floor)}." if i_floor < need else None,
                  entity="month", period=s.month, root_cause="plan_gap", impact_minor=max(0, need - i_floor))


@signal("R041")
def r041(s: Snapshot) -> Signal:
    """netFlow = I_month - E_month for the last complete month (own transfers excluded)."""
    first = add_months(s.as_of.replace(day=1), -1)
    last = s.as_of.replace(day=1) - timedelta(days=1)
    ops = s.cashflow(first, last)
    if not ops:
        return not_ready("R041", "нет операций за прошлый месяц")
    inc = sum(s.amount(t) for t in ops if s.amount(t) > 0)
    exp = -sum(s.amount(t) for t in ops if s.amount(t) < 0)
    net = inc - exp
    return Signal("R041", ready=True, triggered=net < 0, evidence_valid=True,
                  values={"income": money(inc), "expense": money(exp), "net": money(net)},
                  summary=f"За {month_key(first)} поступило {tenge(inc)}, потрачено {tenge(exp)}: минус {tenge(-net)}."
                  if net < 0 else None,
                  entity="month", period=month_key(first), root_cause="negative_month", impact_minor=max(0, -net))


@signal("R042")
def r042(s: Snapshot) -> Signal:
    """surplus = I_plan - E_plan - savingsPlan."""
    p = _plan(s)
    if p is None:
        return not_ready("R042", "нужны подтверждённые выплаты дохода и обязательные расходы")
    i, e, sv = p
    surplus = i - e - sv
    return Signal("R042", ready=True, triggered=surplus < 0, evidence_valid=True,
                  values={"surplus": money(surplus), "I_plan": money(i), "E_plan": money(e), "savingsPlan": money(sv)},
                  summary=(f"План месяца: осторожный доход {tenge(i)} − обязательное {tenge(e)} − взносы в цели {tenge(sv)} "
                           f"= {'−' if surplus < 0 else ''}{tenge(abs(surplus))}."),
                  entity="month", period=s.month, root_cause="plan_gap", impact_minor=max(0, -surplus))


@signal("R043")
def r043(s: Snapshot) -> Signal:
    """variance = E_actual - E_plannedToDate for variable spending of this month (plan = everyday essentials
    spread over the days; obligations are planned separately)."""
    if not s.living_minor:
        return not_ready("R043", "нужны ежедневные потребности или обязательные расходы")
    first = s.as_of.replace(day=1)
    ops = s.cashflow(first, s.as_of)
    if not ops:
        return not_ready("R043", "нет операций в этом месяце")
    fixed = {"housing", "credit"}
    actual = -sum(s.amount(t) for t in ops if s.amount(t) < 0 and t.category_id not in fixed)
    days = (monthly_date(first.year, first.month, 31) - first).days + 1
    planned = s.living_minor * s.as_of.day // days
    variance = actual - planned
    material = max(s.th.materialityMinor, int(s.living_minor * s.th.relativeMin))
    return Signal("R043", ready=True, triggered=variance > material, evidence_valid=True,
                  values={"variance": money(variance), "actual": money(actual), "planned": money(planned)},
                  summary=f"С начала месяца переменные траты {tenge(actual)} при плане к этому дню {tenge(planned)}: "
                          f"больше на {tenge(variance)}." if variance > material else None,
                  entity="month", period=s.month, root_cause="overspend", impact_minor=max(0, variance))


@signal("R045")
def r045(s: Snapshot) -> Signal:
    """cutNeed = max(0, E_plan + savingsPlan - I_plan - openingAllowed); openingAllowed = 0 (not chosen by the user)."""
    p = _plan(s)
    if p is None:
        return not_ready("R045", "нужны подтверждённые выплаты дохода и обязательные расходы")
    i, e, sv = p
    cut = max(0, e + sv - i)
    return Signal("R045", ready=True, triggered=cut > 0, evidence_valid=True, values={"cutNeed": money(cut)},
                  summary=f"Чтобы план сошёлся с осторожным доходом, нужно сократить траты или взносы на {tenge(cut)} в месяц."
                  if cut else None,
                  entity="month", period=s.month, root_cause="plan_gap", impact_minor=cut)


needs("нужны данные: нижние границы трат по категориям, заданные пользователем", "R046", "R050")
needs("нужны данные: бюджеты категорий месяца", "R048")
needs("нужны данные: сохранённые версии плана месяца", "R049")
_ = date
