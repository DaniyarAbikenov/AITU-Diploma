"""Debts and reserve: K081–K083, K089, K091, K092, K098, K099."""
from datetime import timedelta

from app.insights.signals import Signal, money, needs, not_ready, plural, signal, tenge
from app.insights.snapshot import Snapshot
from app.services.ledger import add_months, month_key
from app.services.safe_to_spend import monthly_date

INCOMPLETE_SHARE = 0.5  # same threshold as /obligations/dti-history


def _debts(s: Snapshot):
    return [o for o in s.obligations if o.kind in ("credit", "installment") and o.confirmed
            and (not o.ends_at or o.ends_at >= s.month)]


@signal("R081")
def r081(s: Snapshot) -> Signal:
    """debtRatio = requiredDebtPayments / verifiedNetIncome (last complete month). With income missing or far below
    the confirmed expected income the ratio is not computed (no advice on debt load from a near-zero denominator)."""
    debts = _debts(s)
    if not debts:
        return not_ready("R081", "нет подтверждённых кредитов")
    first = add_months(s.as_of.replace(day=1), -1)
    last = s.as_of.replace(day=1) - timedelta(days=1)
    income = sum(s.amount(t) for t in s.cashflow(first, last) if s.amount(t) > 0 and t.category_id == "income")
    expected = s.income_floor_minor
    if income <= 0 or (expected and income < INCOMPLETE_SHARE * expected):
        return not_ready("R081", "доход месяца в операциях неполный или неизвестен")
    payments = sum(s.obligation_month_minor(o, s.month) for o in debts)
    ratio = payments / income
    if ratio > 1:
        return not_ready("R081", "платежи больше дохода месяца — сначала проверьте данные")
    return Signal("R081", ready=True, triggered=ratio > s.th.debtCap, evidence_valid=True,
                  values={"debtRatio": round(ratio, 3), "payments": money(payments), "income": money(income)},
                  evidence_ids=[f"obligation:{o.id}" for o in debts],
                  summary=f"Платежи по кредитам {tenge(payments)} в месяц — {round(ratio * 100)} % дохода "
                          f"за {month_key(first)} ({tenge(income)})." if ratio > s.th.debtCap else None,
                  entity="debts", period=s.month, root_cause="debt_load", impact_minor=payments)


@signal("R082")
def r082(s: Snapshot) -> Signal:
    """unmappedDebt = sum(debt operations of 60 days that match no confirmed loan or installment)."""
    start = s.as_of - timedelta(days=60)
    ops = [t for t in s.cashflow(start, s.as_of) if t.category_id == "credit" and s.amount(t) < 0]
    if not ops:
        return not_ready("R082", "нет платежей по кредитам за 60 дней")
    names = [o.name.lower() for o in _debts(s)]
    lone = [t for t in ops if not any(n in t.merchant.lower() or t.merchant.lower() in n for n in names)]
    total = -sum(s.amount(t) for t in lone)
    return Signal("R082", ready=True, triggered=total > 0, evidence_valid=True, values={"unmapped": money(total)},
                  evidence_ids=[f"transaction:{t.id}" for t in lone[:20]],
                  summary=f"{plural(len(lone), 'платёж', 'платежа', 'платежей')} по кредитам на {tenge(total)} за 60 дней не связаны ни с одним "
                          f"подтверждённым кредитом." if lone else None,
                  entity="debts", period=s.month, root_cause="unmapped_debt", impact_minor=total, effort=0.4)


@signal("R089")
def r089(s: Snapshot) -> Signal:
    """overdue = max(0, scheduledDueToDate - linkedPaymentsToDate) for this month's loan payments."""
    debts = _debts(s)
    if not debts:
        return not_ready("R089", "нет подтверждённых кредитов")
    grace = s.th.incomeGraceDays
    overdue = []
    for o in debts:
        due = monthly_date(s.as_of.year, s.as_of.month, o.day_of_month)
        if due >= s.as_of - timedelta(days=grace):
            continue
        amount = s.obligation_month_minor(o, s.month)
        paid = [t for t in s.transactions if t.category_id == "credit" and -s.amount(t) >= amount * 0.9
                and abs((s.day(t) - due).days) <= grace + 3]
        if not paid:
            overdue.append((o, due, amount))
    total = sum(a for *_, a in overdue)
    return Signal("R089", ready=True, triggered=bool(overdue), evidence_valid=True, values={"overdue": money(total)},
                  evidence_ids=[f"obligation:{o.id}" for o, *_ in overdue],
                  summary="Не найдена оплата: " + "; ".join(f"«{o.name}» {tenge(a)} за {d.strftime('%d.%m.%Y')}"
                                                           for o, d, a in overdue) + "." if overdue else None,
                  entity="debts", period=s.month, root_cause="overdue", critical=bool(overdue), impact_minor=total,
                  urgency=1.0)


def _reserve(s: Snapshot, sid: str):
    if s.essential_minor is None or s.essential_minor <= 0:
        return None, not_ready(sid, "нужны обязательные расходы в профиле")
    if s.savings_available_minor is None:
        return None, not_ready(sid, "нет подтверждённых накопительных счетов или депозитов")
    return s.savings_available_minor, None


@signal("R091")
def r091(s: Snapshot) -> Signal:
    """reserveMonths = emergencyLiquid / monthlyEssential (frozen deposits are not available, BR-14)."""
    res, nr = _reserve(s, "R091")
    if nr:
        return nr
    months = res / s.essential_minor
    target = s.th.targetReserveMonths
    return Signal("R091", ready=True, triggered=months < target, evidence_valid=True,
                  values={"reserveMonths": round(months, 2), "reserve": money(res)},
                  summary=f"Доступный резерв {tenge(res)} — это {str(round(months, 1)).replace('.', ',')} мес. обязательных "
                          f"расходов при цели {target} мес. (настройка в профиле)." if months < target else None,
                  entity="reserve", period=s.month, root_cause="reserve", impact_minor=int(target * s.essential_minor - res))


@signal("R092")
def r092(s: Snapshot) -> Signal:
    """reserveTarget = userTargetMonths * monthlyEssential; triggered when the available reserve is below it."""
    res, nr = _reserve(s, "R092")
    if nr:
        return nr
    target = s.th.targetReserveMonths * s.essential_minor
    gap = target - res
    return Signal("R092", ready=True, triggered=gap > 0, evidence_valid=True,
                  values={"reserveTarget": money(target), "gap": money(max(0, gap))},
                  summary=f"До целевого резерва {tenge(target)} не хватает {tenge(gap)}." if gap > 0 else None,
                  entity="reserve", period=s.month, root_cause="reserve", impact_minor=max(0, gap))


@signal("R099")
def r099(s: Snapshot) -> Signal:
    """accessibleReserve = reserve available by the need date; triggered when the whole reserve would cover a month
    of essentials but the frozen part makes the accessible one fall short."""
    res, nr = _reserve(s, "R099")
    if nr:
        return nr
    total = s.savings_total_minor or 0
    need = s.essential_minor
    blocked = total >= need > res
    return Signal("R099", ready=True, triggered=blocked, evidence_valid=True,
                  values={"accessible": money(res), "total": money(total)},
                  summary=f"Накоплений {tenge(total)}, но сейчас доступно только {tenge(res)}: остальное заморожено на "
                          f"депозитах, а месяц обязательных расходов — {tenge(need)}." if blocked else None,
                  entity="reserve", period=s.month, root_cause="reserve_access", impact_minor=need - res if blocked else 0)


needs("нужны данные: номера договоров кредитов в операциях и графики платежей", "R083")
needs("нужны данные: история задержек дохода (R037, этап P1)", "R098")
_ = month_key
