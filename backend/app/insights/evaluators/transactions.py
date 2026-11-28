"""Operations: K011–K020 (R011–R020)."""
from app.insights.signals import Signal, money, needs, not_ready, ops, plural, signal, tenge
from app.insights.snapshot import Snapshot


@signal("R011")
def r011(s: Snapshot) -> Signal:
    """residual = B_end - (B_start + sum(credits) - sum(debits)) between two statement balances of one account."""
    from sqlalchemy import select

    from app.models import AccountCheckpoint

    for a in s.accounts:
        cps = list(s.db.scalars(select(AccountCheckpoint).where(AccountCheckpoint.account_id == a.id,
                                                               AccountCheckpoint.source == "statement")
                                .order_by(AccountCheckpoint.as_of)))
        if len(cps) < 2:
            continue
        start, end = cps[-2], cps[-1]
        flows = [t for t in s.transactions if t.account_id == a.id and start.as_of < s.day(t) <= end.as_of]
        residual = end.balance_minor - (start.balance_minor + sum(s.amount(t) for t in flows))
        return Signal("R011", ready=True, triggered=abs(residual) > s.th.toleranceMinor, evidence_valid=True,
                      values={"residual": money(residual, a.currency)},
                      evidence_ids=[f"account:{a.id}", f"checkpoint:{start.id}", f"checkpoint:{end.id}"],
                      summary=f"Счёт «{a.name}»: остаток на {end.as_of.strftime('%d.%m.%Y')} расходится с суммой "
                              f"операций с {start.as_of.strftime('%d.%m.%Y')} на {tenge(abs(residual))}.",
                      entity=f"account:{a.id}", period=s.month, root_cause="balance_reconciliation",
                      impact_minor=abs(residual), effort=0.4)
    return not_ready("R011", "нет двух остатков из выписок одного счёта")


@signal("R012")
def r012(s: Snapshot) -> Signal:
    """unmatched = sum(abs(x) for ownTransfer with counterpart = missing)."""
    own = [t for t in s.transactions if s.is_own_transfer(t) and t.currency == "KZT"]
    if not own:
        return not_ready("R012", "нет переводов между своими счетами")
    def has_pair(t) -> bool:
        return any(o is not t and o.account_id != t.account_id and s.amount(o) == -s.amount(t)
                   and abs((s.day(o) - s.day(t)).days) <= 1 for o in own)

    lone = [t for t in own if not t.transfer_group and not has_pair(t)]
    total = sum(abs(s.amount(t)) for t in lone)
    return Signal("R012", ready=True, triggered=total > 0, evidence_valid=True, values={"unmatched": money(total)},
                  evidence_ids=[f"transaction:{t.id}" for t in lone[:20]],
                  summary=f"{plural(len(lone), 'перевод', 'перевода', 'переводов')} «себе» на {tenge(total)} без второй половины на другом вашем счёте."
                  if lone else None,
                  entity="transfers", period=s.month, root_cause="unpaired_transfers", impact_minor=total, effort=0.4)


@signal("R018")
def r018(s: Snapshot) -> Signal:
    """overallocated = max(0, sum(goalAllocations) - eligibleBalance) — goals are not linked to accounts yet, so the
    check is for all savings and deposit accounts together."""
    saved = sum(g.saved_minor for g in s.goals)
    if not s.goals or s.savings_total_minor is None:
        return not_ready("R018", "нет целей или подтверждённых накопительных счетов")
    over = max(0, saved - s.savings_total_minor)
    return Signal("R018", ready=True, triggered=over > 0, evidence_valid=True,
                  values={"overallocated": money(over), "goalsSaved": money(saved),
                          "savings": money(s.savings_total_minor)},
                  evidence_ids=[f"goal:{g.id}" for g in s.goals],
                  summary=f"В целях записано {tenge(saved)}, а на накопительных счетах и депозитах {tenge(s.savings_total_minor)}: "
                          f"не обеспечено {tenge(over)}." if over else None,
                  entity="goals", period=s.month, root_cause="goal_backing", impact_minor=over, effort=0.3)


@signal("R020")
def r020(s: Snapshot) -> Signal:
    """mismatch = count(rows where amountCurrency != declaredCurrency OR conversionMissing)."""
    if not s.accounts:
        return not_ready("R020", "нет счетов")
    cur = {a.id: a.currency for a in s.accounts}
    bad = [t for t in s.transactions if t.currency != cur.get(t.account_id) and not s.is_own_transfer(t)]
    return Signal("R020", ready=True, triggered=bool(bad), evidence_valid=True, values={"mismatch": len(bad)},
                  evidence_ids=[f"transaction:{t.id}" for t in bad[:20]],
                  summary=f"{ops(len(bad))} в валюте, отличной от валюты своего счёта: они не входят в итоги в тенге."
                  if bad else None,
                  entity="currencies", period=s.month, root_cause="currency_mismatch", effort=0.3)


needs("нужны данные: связи возвратов с исходными покупками", "R013", "R016")
needs("нужны данные: разметка подарков, займов и возвратов среди зачислений", "R014")
needs("нужны данные: устойчивый банковский ID операций в выписках", "R015")
needs("нужны данные: история чистого капитала по дням", "R017")
needs("нужны данные: связи плановых статей с оплатами в обоих планах", "R019")
