"""Cash flow: K021–K030 (R021–R030). The daily path is the server Safe-to-Spend (services/safe_to_spend.py)."""
from datetime import timedelta

from app.insights.signals import Signal, money, needs, not_ready, signal, tenge
from app.insights.snapshot import Snapshot


def _sts(s: Snapshot, sid: str):
    if s.sts is None:
        return None, not_ready(sid, "нет подтверждённых текущих счетов с известным остатком")
    return s.sts, None


@signal("R021")
def r021(s: Snapshot) -> Signal:
    """C_free = C_liquid - protectedAllocations - holds (frozen deposits are already excluded)."""
    if s.liquid_minor is None:
        return not_ready("R021", "нет подтверждённых текущих счетов с известным остатком")
    c = s.liquid_minor
    return Signal("R021", ready=True, triggered=c < 0, evidence_valid=True, values={"C_free": money(c)},
                  evidence_ids=[f"account:{a.id}" for a in s.usable_accounts],
                  summary=f"Доступно на текущих счетах и наличными {tenge(c)} на {s.as_of.strftime('%d.%m.%Y')}.",
                  entity="liquid", period=s.month, root_cause="cash_gap", critical=c < 0, impact_minor=abs(c))


@signal("R022")
def r022(s: Snapshot) -> Signal:
    """B[d] = C_free + sum(I[t]-O[t] for t<=d); triggered when min(B[d]) < 0 inside the horizon."""
    st, nr = _sts(s, "R022")
    if nr:
        return nr
    return Signal("R022", ready=True, triggered=st.deficit_minor > 0, evidence_valid=True,
                  values={"minBalance": money(-st.deficit_minor), "until": st.until.isoformat()},
                  evidence_ids=[p.ref for p in st.payments if p.ref],
                  summary=f"До {st.until.strftime('%d.%m.%Y')} остаток после подтверждённых платежей опускается ниже нуля на "
                          f"{tenge(st.deficit_minor)}." if st.deficit_minor else None,
                  entity="liquid", period=s.month, root_cause="cash_gap", critical=st.deficit_minor > 0,
                  impact_minor=st.deficit_minor)


@signal("R023")
def r023(s: Snapshot) -> Signal:
    """d_star = min({d: B[d] < 0})."""
    st, nr = _sts(s, "R023")
    if nr:
        return nr
    d = st.first_deficit_day
    days = (d - s.as_of).days if d else None
    return Signal("R023", ready=True, triggered=d is not None, evidence_valid=True,
                  values={"firstDeficitDay": d.isoformat() if d else None},
                  evidence_ids=[p.ref for p in st.payments if p.ref and d and p.due <= d],
                  summary=f"Первый день, когда денег не хватит на подтверждённые платежи: {d.strftime('%d.%m.%Y')}."
                  if d else None,
                  entity="liquid", period=s.month, root_cause="cash_gap", critical=d is not None,
                  urgency=max(0.0, 1 - (days or 0) / s.th.urgencyHorizonDays) if d else 0.0,
                  impact_minor=st.deficit_minor)


@signal("R024")
def r024(s: Snapshot) -> Signal:
    """bridge = max(0, -min(B[d]))."""
    st, nr = _sts(s, "R024")
    if nr:
        return nr
    return Signal("R024", ready=True, triggered=st.deficit_minor > 0, evidence_valid=True,
                  values={"bridge": money(st.deficit_minor)}, evidence_ids=[p.ref for p in st.payments if p.ref],
                  summary=f"Чтобы покрыть подтверждённые платежи до {st.until.strftime('%d.%m.%Y')}, не хватает "
                          f"{tenge(st.deficit_minor)}." if st.deficit_minor else None,
                  entity="liquid", period=s.month, root_cause="cash_gap", critical=st.deficit_minor > 0,
                  impact_minor=st.deficit_minor, urgency=0.8)


@signal("R025")
def r025(s: Snapshot) -> Signal:
    """extraPerDay = floor(max(0, min(B[d]/d))) — the ceiling per day; triggered only when the user asks (a scenario),
    so it never becomes a card by itself."""
    st, nr = _sts(s, "R025")
    if nr:
        return nr
    return Signal("R025", ready=True, triggered=False, evidence_valid=True,
                  values={"extraPerDay": money(st.safe_daily_minor), "days": st.days},
                  summary=f"Потолок трат: не больше {tenge(st.safe_daily_minor)} в день до {st.until.strftime('%d.%m.%Y')}.",
                  entity="liquid", period=s.month, root_cause="ceiling")


@signal("R027")
def r027(s: Snapshot) -> Signal:
    """cover = spendable before due / nearest unpaid payment (accounts are not linked to payments yet: all current
    accounts and cash together, said so in the text)."""
    st, nr = _sts(s, "R027")
    if nr:
        return nr
    if not st.payments:
        return not_ready("R027", "нет подтверждённых платежей в горизонте")
    p = st.payments[0]
    before = sum(x.amount_minor for x in st.payments if x.due < p.due)
    spendable = s.liquid_minor - before
    cover = spendable / p.amount_minor if p.amount_minor else 1
    return Signal("R027", ready=True, triggered=cover < 1, evidence_valid=True,
                  values={"cover": round(cover, 2), "payment": money(p.amount_minor), "due": p.due.isoformat()},
                  evidence_ids=[p.ref] if p.ref else [],
                  summary=f"На {p.due.strftime('%d.%m.%Y')} платёж «{p.name}» {tenge(p.amount_minor)}, а на текущих счетах и "
                          f"наличными к этому дню останется {tenge(max(0, spendable))}." if cover < 1 else None,
                  entity=p.ref or "payment", period=s.month, root_cause="cash_gap", critical=cover < 1,
                  impact_minor=max(0, p.amount_minor - spendable),
                  urgency=max(0.0, 1 - (p.due - s.as_of).days / s.th.urgencyHorizonDays))


@signal("R028")
def r028(s: Snapshot) -> Signal:
    """fxLiquidityGap = max(0, KZT due before settlement - KZT available) while money sits in a foreign currency."""
    st, nr = _sts(s, "R028")
    if nr:
        return nr
    kzt = [a for a in s.usable_accounts if a.kind in ("current", "cash") and a.currency == "KZT"]
    foreign = [a for a in s.usable_accounts if a.currency != "KZT" and s.available_kzt_minor(a) > 0]
    if not foreign:
        return not_ready("R028", "нет денег в иностранной валюте")
    kzt_available = sum(s.available_kzt_minor(a) for a in kzt)
    gap = max(0, st.committed_minor - kzt_available)
    return Signal("R028", ready=True, triggered=gap > 0, evidence_valid=True, values={"gap": money(gap)},
                  evidence_ids=[f"account:{a.id}" for a in foreign],
                  summary=f"До {st.until.strftime('%d.%m.%Y')} платежей в тенге на {tenge(st.committed_minor)}, а тенге на "
                          f"текущих счетах {tenge(kzt_available)}; остальное в валюте ({', '.join(a.currency for a in foreign)})."
                  if gap else None,
                  entity="fx", period=s.month, root_cause="fx_liquidity", impact_minor=gap, urgency=0.6)


@signal("R030")
def r030(s: Snapshot) -> Signal:
    """runway = max{k: C_free - essential spending and dated payments up to day k >= 0}, at most 120 days."""
    if s.liquid_minor is None or s.essential_minor is None:
        return not_ready("R030", "нужны остатки и обязательные расходы в профиле")
    st = s.sts
    left, k = s.liquid_minor, 0
    pay = {}
    for p in (st.payments if st else []):
        pay[p.due] = pay.get(p.due, 0) + p.amount_minor
    while k < 120:
        day = s.as_of + timedelta(days=k)
        left -= s.living_between(day, day) + pay.get(day, 0)
        if left < 0:
            break
        k += 1
    target = s.th.targetRunwayDays
    return Signal("R030", ready=True, triggered=k < target, evidence_valid=True, values={"runwayDays": k},
                  summary=f"Без новых поступлений доступных денег хватит примерно на {k} дн. "
                          f"(обязательные расходы {tenge(s.essential_minor)} в месяц и подтверждённые платежи)."
                  if k < target else None,
                  entity="liquid", period=s.month, root_cause="runway", impact_minor=s.living_between(s.as_of + timedelta(days=k), s.as_of + timedelta(days=target - 1)))


needs("нужны данные: план повседневного бюджета по категориям", "R026")
needs("нужны данные: сценарий переноса покупки", "R029")
