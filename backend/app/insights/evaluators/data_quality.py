"""Onboarding and data quality: K001–K010 (R001–R010)."""
from datetime import timedelta

from app.insights.signals import Signal, money, needs, not_ready, ops, signal, tenge
from app.insights.snapshot import Snapshot

STALE_DAYS = 7  # a balance older than this is not fresh enough for daily numbers (user setting later)


@signal("R001")
def r001(s: Snapshot) -> Signal:
    """q = count(known requiredFields) / count(requiredFields): balances, income status, obligations, essential spend."""
    fields = {
        "остатки счетов": bool(s.usable_accounts),
        "подтверждённый доход": bool(s.confirmed_incomes),
        "обязательные платежи": any(o.confirmed for o in s.obligations),
        "ежедневные потребности или обязательные расходы": s.essential_minor is not None,
    }
    known = sum(fields.values())
    missing = [k for k, v in fields.items() if not v]
    q = known / len(fields)
    return Signal("R001", ready=True, triggered=q < 1, evidence_valid=True, values={"q": round(q, 2), "missing": missing},
                  summary=f"Заполнено {known} из {len(fields)}: не хватает — {', '.join(missing)}." if missing else None,
                  entity="profile", period=s.month, root_cause="missing_inputs", effort=0.2,
                  impact_minor=0, urgency=0.6)


@signal("R002")
def r002(s: Snapshot) -> Signal:
    """age = max(today - reconciledAt[a]) over accounts used in daily numbers."""
    accs = s.usable_accounts
    if not accs:
        return not_ready("R002", "нет подтверждённых счетов")
    ages = []
    for a in accs:
        cp = s.checkpoints.get(a.id)
        v = s.account_views[a.id]
        when = cp.as_of if cp else None
        if when is None and v.balanceAsOf:
            from datetime import date

            when = date.fromisoformat(v.balanceAsOf)
        if when is None:
            return not_ready("R002", f"нет даты остатка у счёта {a.name}")
        ages.append(((s.as_of - when).days, a))
    age, acc = max(ages, key=lambda x: x[0])
    return Signal("R002", ready=True, triggered=age > STALE_DAYS, evidence_valid=True, values={"ageDays": age},
                  evidence_ids=[f"account:{acc.id}"],
                  summary=f"Остаток счёта «{acc.name}» известен на {(s.as_of - timedelta(days=age)).strftime('%d.%m.%Y')} — "
                          f"{age} дн. назад.",
                  entity=f"account:{acc.id}", period=s.month, root_cause="stale_balance", urgency=min(1, age / 30),
                  effort=0.2)


@signal("R004")
def r004(s: Snapshot) -> Signal:
    """share = sum(abs(x) for uncertain expense) / sum(abs(x) for expense), last 30 days, tenge."""
    start = s.as_of - timedelta(days=30)
    exp = [t for t in s.transactions if (t.user_booked_on or t.booked_on) >= start and t.currency == "KZT"
           and (t.user_amount_minor or t.amount_minor) < 0 and not s.is_own_transfer(t)]
    if not exp:
        return not_ready("R004", "нет расходов за 30 дней")
    total = sum(-(t.user_amount_minor or t.amount_minor) for t in exp)
    unsure = [t for t in exp if t.needs_review]
    amount = sum(-(t.user_amount_minor or t.amount_minor) for t in unsure)
    share = amount / total if total else 0
    return Signal("R004", ready=True, triggered=share >= 0.1, evidence_valid=True,
                  values={"share": round(share, 3), "uncertain": money(amount), "total": money(total)},
                  evidence_ids=[f"transaction:{t.id}" for t in unsure[:20]],
                  summary=f"За 30 дней {ops(len(unsure))} на {tenge(amount)} ({round(share * 100)} % расходов) "
                          f"с неуверенной категорией.",
                  entity="categories", period=s.month, root_cause="uncertain_categories", impact_minor=amount,
                  effort=0.3)


@signal("R007")
def r007(s: Snapshot) -> Signal:
    """conflict = 1[unlockDate <= today AND lockedAmount > 0 AND unlockStatus != verified]."""
    deposits = [a for a in s.accounts if a.kind == "deposit" or a.frozen_until is not None]
    if not deposits:
        return not_ready("R007", "нет депозитов")
    stale = [a for a in deposits if a.frozen_until is not None and a.frozen_until <= s.as_of]
    acc = stale[0] if stale else deposits[0]
    return Signal("R007", ready=True, triggered=bool(stale), evidence_valid=True,
                  values={"accounts": [a.id for a in stale]}, evidence_ids=[f"account:{a.id}" for a in stale],
                  summary=(f"Дата разблокировки депозита «{acc.name}» ({acc.frozen_until.strftime('%d.%m.%Y')}) прошла, "
                           f"но заморозка не снята.") if stale else None,
                  entity=f"account:{acc.id}", period=s.month, root_cause="deposit_unlock", effort=0.1, urgency=0.5)


@signal("R009")
def r009(s: Snapshot) -> Signal:
    """missing = count(active debts with principal = unknown)."""
    debts = [o for o in s.obligations if o.kind in ("credit", "installment") and o.confirmed
             and (not o.ends_at or o.ends_at >= s.month)]
    if not debts:
        return not_ready("R009", "нет подтверждённых кредитов")
    missing = [o for o in debts if o.debt_left_minor is None]
    return Signal("R009", ready=True, triggered=bool(missing), evidence_valid=True, values={"missing": len(missing)},
                  evidence_ids=[f"obligation:{o.id}" for o in missing],
                  summary=f"Остаток долга не указан у {len(missing)} из {len(debts)} кредитов: "
                          f"{', '.join(o.name for o in missing[:3])}." if missing else None,
                  entity="debts", period=s.month, root_cause="debt_principal", effort=0.3)


needs("нужны данные: сверка источников дохода (план и факт) за полный месяц", "R008")
needs("нужны данные: покрытие истории по каждому счёту (даты начала и конца выписок)", "R003")
needs("нужны данные: связь получателей с неуверенными категориями", "R005")
needs("нужны данные: время последнего изменения данных прогноза", "R006")
needs("нужны данные: правила «в день» с явным числом дней месяца", "R010")
