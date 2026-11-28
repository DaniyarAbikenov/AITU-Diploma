"""Goals and planned events: K101–K105, K109, K110, K111, K112, K118, K119."""
import math
from datetime import date

from app.insights.signals import Signal, money, needs, not_ready, signal, tenge
from app.insights.snapshot import Snapshot


def _months_to(s: Snapshot, ym: str) -> int:
    y, m = (int(x) for x in ym.split("-"))
    return (y - s.as_of.year) * 12 + (m - s.as_of.month)


def _open_goals(s: Snapshot):
    return [g for g in s.goals if g.saved_minor < g.target_minor]


@signal("R101")
def r101(s: Snapshot) -> Signal:
    """goalGap = max(0, targetAmount - verifiedAllocated) — for the goal closest to its deadline."""
    goals = _open_goals(s)
    if not goals:
        return not_ready("R101", "нет незавершённых целей")
    g = min(goals, key=lambda x: x.deadline)
    gap = g.target_minor - g.saved_minor
    return Signal("R101", ready=True, triggered=gap > 0, evidence_valid=True, values={"goalGap": money(gap)},
                  evidence_ids=[f"goal:{g.id}"],
                  summary=f"До цели «{g.name}» не хватает {tenge(gap)} (накоплено {tenge(g.saved_minor)} из "
                          f"{tenge(g.target_minor)}).",
                  entity=f"goal:{g.id}", period=s.month, root_cause="goal_gap", impact_minor=gap, effort=0.6,
                  urgency=0.2)


@signal("R102")
def r102(s: Snapshot) -> Signal:
    """requiredContribution = goalGap / remainingContributionDates (months until the deadline)."""
    goals = _open_goals(s)
    if not goals:
        return not_ready("R102", "нет незавершённых целей")
    worst = None
    for g in goals:
        months = _months_to(s, g.deadline)
        if months <= 0:
            continue
        need = math.ceil((g.target_minor - g.saved_minor) / months)
        if need > g.monthly_minor and (worst is None or need - g.monthly_minor > worst[1] - worst[0].monthly_minor):
            worst = (g, need, months)
    if worst is None:
        return Signal("R102", ready=True, triggered=False, evidence_valid=True, period=s.month, root_cause="goal_pace")
    g, need, months = worst
    return Signal("R102", ready=True, triggered=True, evidence_valid=True,
                  values={"required": money(need), "current": money(g.monthly_minor)}, evidence_ids=[f"goal:{g.id}"],
                  summary=f"Чтобы успеть к цели «{g.name}» к {g.deadline} ({months} мес.), нужно {tenge(need)} в месяц, "
                          f"сейчас в плане {tenge(g.monthly_minor)}.",
                  entity=f"goal:{g.id}", period=s.month, root_cause="goal_pace", impact_minor=need - g.monthly_minor)


@signal("R103")
def r103(s: Snapshot) -> Signal:
    """contributionsNeeded = ceil(goalGap / currentContribution); triggered when the date is after the deadline."""
    goals = [g for g in _open_goals(s) if g.monthly_minor > 0]
    if not goals:
        return not_ready("R103", "у целей не указан ежемесячный взнос")
    late = []
    for g in goals:
        n = math.ceil((g.target_minor - g.saved_minor) / g.monthly_minor)
        y, m = divmod(s.as_of.year * 12 + s.as_of.month - 1 + n, 12)
        eta = f"{y}-{m + 1:02d}"
        if eta > g.deadline:
            late.append((g, eta))
    if not late:
        return Signal("R103", ready=True, triggered=False, evidence_valid=True, period=s.month, root_cause="goal_pace")
    g, eta = late[0]
    return Signal("R103", ready=True, triggered=True, evidence_valid=True, values={"eta": eta, "deadline": g.deadline},
                  evidence_ids=[f"goal:{g.id}"],
                  summary=f"При взносе {tenge(g.monthly_minor)} в месяц цель «{g.name}» будет достигнута к {eta}, "
                          f"а желаемый срок — {g.deadline}. Расчёт без доходности.",
                  entity=f"goal:{g.id}", period=s.month, root_cause="goal_pace")


def _affordable(s: Snapshot) -> int | None:
    if s.income_floor_minor is None or s.essential_minor is None:
        return None
    return s.income_floor_minor - s.essential_minor - s.obligations_month_minor


@signal("R104")
def r104(s: Snapshot) -> Signal:
    """goalsLoad = sum(requiredContribution[g]) / affordableSavings."""
    goals = _open_goals(s)
    aff = _affordable(s)
    if not goals or aff is None:
        return not_ready("R104", "нужны цели, подтверждённый доход и обязательные расходы")
    req = 0
    for g in goals:
        months = max(1, _months_to(s, g.deadline))
        req += math.ceil((g.target_minor - g.saved_minor) / months)
    load = req / aff if aff > 0 else math.inf
    return Signal("R104", ready=True, triggered=load > 1, evidence_valid=True,
                  values={"required": money(req), "affordable": money(aff)},
                  evidence_ids=[f"goal:{g.id}" for g in goals],
                  summary=f"Чтобы успеть ко всем целям в срок, нужно {tenge(req)} в месяц, а после обязательных трат "
                          f"остаётся {tenge(max(0, aff))}." if load > 1 else None,
                  entity="goals", period=s.month, root_cause="goals_load", impact_minor=max(0, req - max(0, aff)))


@signal("R105")
def r105(s: Snapshot) -> Signal:
    """unbacked = max(0, reportedGoalSavings - sum(verifiedAllocations)) — same check as R018, one root cause."""
    from app.insights.evaluators.transactions import r018

    sig = r018(s)
    sig.id = "R105"
    return sig


@signal("R109")
def r109(s: Snapshot) -> Signal:
    """allocation[g] = min(remainingNeed[g], remainingPool) by priority (closest deadline first)."""
    goals = sorted(_open_goals(s), key=lambda g: g.deadline)
    aff = _affordable(s)
    if not goals or aff is None:
        return not_ready("R109", "нужны цели, подтверждённый доход и обязательные расходы")
    ask = sum(g.monthly_minor for g in goals)
    pool = max(0, aff)
    alloc = []
    for g in goals:
        a = min(g.monthly_minor, pool)
        alloc.append((g, a))
        pool -= a
    over = ask > max(0, aff)
    return Signal("R109", ready=True, triggered=over, evidence_valid=True,
                  values={"ask": money(ask), "pool": money(max(0, aff)),
                          "allocation": {f"goal:{g.id}": a for g, a in alloc}},
                  evidence_ids=[f"goal:{g.id}" for g in goals],
                  summary=f"Взносы в цели {tenge(ask)} в месяц больше свободного остатка {tenge(max(0, aff))}. "
                          f"По порядку сроков хватает на: " + ", ".join(f"«{g.name}» {tenge(a)}" for g, a in alloc) + "."
                  if over else None,
                  entity="goals", period=s.month, root_cause="goals_load", impact_minor=max(0, ask - max(0, aff)))


@signal("R111")
def r111(s: Snapshot) -> Signal:
    """periodicSetAside = max(0, eventCost - eventFunded) / remainingFundingDates (months before the due date)."""
    items = [p for p in s.planned if p.direction == "expense" and p.due_on > s.as_of]
    if not items:
        return not_ready("R111", "нет будущих плановых расходов")
    best = None
    for p in items:
        left = s.planned_left_minor(p)
        months = max(1, (p.due_on.year - s.as_of.year) * 12 + p.due_on.month - s.as_of.month)
        per = math.ceil(left / months)
        if left > 0 and months >= 1 and (best is None or p.due_on < best[0].due_on):
            best = (p, left, months, per)
    if best is None:
        return Signal("R111", ready=True, triggered=False, evidence_valid=True, period=s.month, root_cause="event_fund")
    p, left, months, per = best
    return Signal("R111", ready=True, triggered=months >= 2, evidence_valid=True,
                  values={"setAside": money(per), "left": money(left), "due": p.due_on.isoformat()},
                  evidence_ids=[f"planned:{p.id}"],
                  summary=f"Чтобы к {p.due_on.strftime('%d.%m.%Y')} собрать {tenge(left)} на «{p.name}», откладывайте "
                          f"примерно {tenge(per)} в месяц ({months} мес.)." if months >= 2 else None,
                  entity=f"planned:{p.id}", period=s.month, root_cause="event_fund", impact_minor=left)


@signal("R119")
def r119(s: Snapshot) -> Signal:
    """eventRemaining = max(0, total - linked payments): the plan already uses the unpaid part, so no gap remains."""
    items = [p for p in s.planned if p.direction == "expense"]
    if not items:
        return not_ready("R119", "нет плановых расходов")
    return Signal("R119", ready=True, triggered=False, evidence_valid=True, period=s.month, root_cause="event_paid")


needs("нужны данные: график распределений цели по датам (версии)", "R110")
needs("нужны данные: подарки и праздничный конверт как отдельные статьи", "R112")
needs("нужны данные: подтверждённая итоговая цена события", "R118")
_ = date
