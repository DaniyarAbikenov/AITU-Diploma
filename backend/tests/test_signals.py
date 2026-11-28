"""Control examples for every implemented signal (synthetic data only): boundaries for zero/unknown income,
unknown values, date boundaries and currency."""
import uuid
from datetime import date, timedelta

import pytest

from app.core.config import as_of
from app.core.db import SessionLocal
from app.insights.signals import REGISTRY
from app.insights.snapshot import Snapshot
from app.models import (
    Account,
    AccountCheckpoint,
    Goal,
    IncomeSource,
    Obligation,
    PlannedPayment,
    Transaction,
    User,
)
from app.services import fx

T = as_of()  # 2026-10-20 in tests
K = 100  # minor units per tenge


class World:
    """A user built directly in the database for one scenario."""

    def __init__(self, db, essential=None):
        self.db = db
        self.u = User(email=f"sig-{uuid.uuid4().hex[:8]}@example.com", name="Тест", password_hash="x",
                      essential_expenses_minor=None if essential is None else essential * K)
        db.add(self.u)
        db.flush()

    def account(self, name="Gold", kind="current", balance=100_000, currency="KZT", on=None, confirmed=True,
                frozen_until=None, source="manual"):
        a = Account(user_id=self.u.id, bank="Kaspi Bank", name=name, kind=kind, currency=currency,
                    balance_minor=balance * K, confirmed=confirmed, frozen_until=frozen_until)
        self.db.add(a)
        self.db.flush()
        self.db.add(AccountCheckpoint(user_id=self.u.id, account_id=a.id, balance_minor=balance * K,
                                      as_of=on or T, source=source))
        self.db.flush()
        return a

    def tx(self, acc, day, amount, cat="other", merchant="x", internal=False, review=False, currency=None, kind=None):
        t = Transaction(user_id=self.u.id, account_id=acc.id, booked_on=day, amount_minor=amount * K,
                        currency=currency or acc.currency, merchant=merchant, category_id=cat, internal=internal,
                        needs_review=review, user_kind=kind, dedup_key=uuid.uuid4().hex)
        self.db.add(t)
        self.db.flush()
        return t

    def income(self, day, amount, low=None):
        self.db.add(IncomeSource(user_id=self.u.id, name="Зарплата", amount_minor=amount * K, day_of_month=day,
                                 amount_min_minor=None if low is None else low * K, confirmed=True))
        self.db.flush()

    def obligation(self, day, amount, kind="rent", name="Аренда", debt_left=None, ends=None):
        o = Obligation(user_id=self.u.id, name=name, kind=kind, amount_minor=amount * K, day_of_month=day,
                       confirmed=True, debt_left_minor=debt_left, ends_at=ends)
        self.db.add(o)
        self.db.flush()
        return o

    def goal(self, target, saved, monthly, deadline):
        self.db.add(Goal(user_id=self.u.id, name="Магистратура", target_minor=target * K, saved_minor=saved * K,
                         monthly_minor=monthly * K, deadline=deadline))
        self.db.flush()

    def planned(self, due, amount, name="Взнос"):
        self.db.add(PlannedPayment(user_id=self.u.id, name=name, amount_minor=amount * K, due_on=due))
        self.db.flush()

    def sig(self, sid):
        self.db.commit()
        return REGISTRY[sid](Snapshot(self.db, self.u, T))


@pytest.fixture()
def w(client):
    with SessionLocal() as db:
        yield World(db)


@pytest.fixture()
def we(client):
    with SessionLocal() as db:
        yield World(db, essential=300_000)


def test_r001_completeness(w):
    s = w.sig("R001")
    assert s.ready and s.triggered and "остатки счетов" in s.summary
    w.account()
    w.income(5, 400_000)
    w.obligation(1, 100_000)
    w.u.essential_expenses_minor = 0  # an explicit 0 is known, not missing
    assert w.sig("R001").triggered is False


def test_r002_freshness_boundary(w):
    assert w.sig("R002").ready is False
    w.account(on=T - timedelta(days=7))
    assert w.sig("R002").triggered is False  # exactly 7 days: still fresh
    w.account(name="Old", on=T - timedelta(days=8))
    assert w.sig("R002").triggered and "8 дн." in w.sig("R002").summary


def test_r004_uncertain_share(w):
    a = w.account()
    assert w.sig("R004").ready is False
    w.tx(a, T - timedelta(days=1), -9_000)
    w.tx(a, T - timedelta(days=2), -1_000, review=True)
    s = w.sig("R004")
    assert s.triggered and s.values["share"] == 0.1 and "1 операция" in s.summary


def test_r007_deposit_unlock_conflict(w):
    w.account(kind="deposit", frozen_until=T + timedelta(days=10))
    assert w.sig("R007").triggered is False
    w.account(name="Старый депозит", kind="deposit", frozen_until=T)
    assert w.sig("R007").triggered


def test_r009_debt_principal(w):
    assert w.sig("R009").ready is False
    w.obligation(10, 50_000, kind="credit", name="Кредит", debt_left=1_000_000 * K)
    assert w.sig("R009").triggered is False
    w.obligation(15, 30_000, kind="installment", name="Рассрочка")
    assert w.sig("R009").triggered and "Рассрочка" in w.sig("R009").summary


def test_r011_balance_reconciliation(w):
    a = w.account(balance=100_000, on=T - timedelta(days=30), source="statement")
    w.db.add(AccountCheckpoint(user_id=w.u.id, account_id=a.id, balance_minor=80_000 * K, as_of=T, source="statement"))
    w.tx(a, T - timedelta(days=5), -20_000)
    assert w.sig("R011").triggered is False  # 100 000 − 20 000 = 80 000
    w.tx(a, T - timedelta(days=4), -500)
    s = w.sig("R011")
    assert s.triggered and s.values["residual"]["value_minor"] == 500 * K


def test_r012_unpaired_transfers(w):
    a, b = w.account(), w.account(name="Депозит", kind="deposit")
    w.tx(a, T - timedelta(days=3), -50_000, internal=True)
    w.tx(b, T - timedelta(days=3), 50_000, internal=True)
    assert w.sig("R012").triggered is False  # the pair exists
    w.tx(a, T - timedelta(days=1), -10_000, internal=True)
    assert w.sig("R012").triggered and w.sig("R012").values["unmatched"]["value_minor"] == 10_000 * K


def test_r018_and_r105_goal_backing(w):
    w.account(kind="savings", balance=100_000)
    w.goal(1_000_000, 150_000, 50_000, "2027-12")
    for sid in ("R018", "R105"):
        s = w.sig(sid)
        assert s.triggered and s.values["overallocated"]["value_minor"] == 50_000 * K


def test_r020_currency_mismatch(w):
    a = w.account()
    w.tx(a, T - timedelta(days=1), -10, currency="USD")
    assert w.sig("R020").triggered


def test_cashflow_r021_to_r025(w):
    assert w.sig("R021").ready is False  # unknown balance is not 0
    w.account(balance=100_000)
    assert w.sig("R021").values["C_free"]["value_minor"] == 100_000 * K and w.sig("R021").triggered is False
    w.income(1, 400_000)  # next pay on 1 Nov: horizon 20.10–31.10 (12 days)
    w.obligation(21, 90_000)
    s = w.sig("R025")
    assert s.values["extraPerDay"]["value_minor"] == 833 * K and s.triggered is False  # floor(10 000 / 12)
    assert w.sig("R022").triggered is False and w.sig("R024").triggered is False
    w.obligation(22, 20_000, name="Кредит", kind="credit")
    assert w.sig("R024").values["bridge"]["value_minor"] == 10_000 * K
    s = w.sig("R023")
    assert s.triggered and s.critical and s.values["firstDeficitDay"] == (T + timedelta(days=2)).isoformat()


def test_r027_nearest_payment_cover(w):
    w.account(balance=50_000)
    w.income(1, 400_000)
    w.obligation(25, 60_000)
    s = w.sig("R027")
    assert s.triggered and "Аренда" in s.summary


def test_r028_fx_liquidity(w):
    w.account(balance=10_000)
    usd = w.account(name="USD", currency="USD", balance=1_000)
    fx.store(w.db, T, {"USD": 470.0})
    w.income(1, 400_000)
    w.obligation(25, 60_000)
    try:
        s = w.sig("R028")
        assert s.triggered and s.values["gap"]["value_minor"] == 50_000 * K and "USD" in s.summary
        assert f"account:{usd.id}" in s.evidence_ids
    finally:
        from app.models import FxRate, FxRateHistory

        w.db.query(FxRateHistory).delete()
        w.db.query(FxRate).delete()
        w.db.commit()


def test_r030_runway(we):
    we.account(balance=100_000)  # 300 000 a month = 10 000 a day
    s = we.sig("R030")
    assert s.values["runwayDays"] == 10 and s.triggered


def test_income_r031_r038_r039(we):
    a = we.account(balance=0)
    we.income(5, 400_000, low=300_000)
    we.obligation(1, 100_000)
    s = we.sig("R031")
    assert s.values["I_floor"]["value_minor"] == 300_000 * K and s.triggered  # 400 000 > 300 000 + 0
    assert we.sig("R038").ready is False  # no operations at all: a missing statement is not a missing salary
    we.tx(a, date(2026, 10, 7), -1_000)
    assert we.sig("R038").triggered  # 5 Oct passed (with grace), operations exist, no income found
    we.tx(a, date(2026, 10, 5), 320_000, cat="income")
    assert we.sig("R038").triggered is False
    assert we.sig("R039").triggered  # 300 000 < 300 000 + 100 000


def test_plan_r041_r042_r043_r045(we):
    a = we.account()
    we.tx(a, date(2026, 9, 5), 200_000, cat="income")
    we.tx(a, date(2026, 9, 10), -250_000)
    assert we.sig("R041").triggered and we.sig("R041").values["net"]["value_minor"] == -50_000 * K
    assert we.sig("R042").ready is False  # no confirmed income: not computed
    we.income(5, 450_000)
    we.obligation(1, 100_000)
    s = we.sig("R042")
    assert s.values["surplus"]["value_minor"] == 50_000 * K and s.triggered is False
    we.goal(1_000_000, 0, 80_000, "2027-12")
    assert we.sig("R042").triggered and we.sig("R045").values["cutNeed"]["value_minor"] == 30_000 * K
    we.tx(a, date(2026, 10, 3), -260_000)  # by the 20th the plan is 300 000 × 20/31 = 193 548
    assert we.sig("R043").triggered


def test_debts_r081_r082_r089(we):
    a = we.account()
    we.obligation(10, 40_000, kind="installment", name="Kaspi Рассрочка")
    assert we.sig("R081").ready is False  # no income in operations: no ratio from a zero denominator
    we.tx(a, date(2026, 9, 5), 3_000, cat="income")
    assert we.sig("R081").ready is False  # payments > income: check the data first
    we.tx(a, date(2026, 9, 6), 97_000, cat="income")
    s = we.sig("R081")
    assert s.ready and s.values["debtRatio"] == 0.4 and s.triggered is False  # cap 0.4: not above
    we.tx(a, date(2026, 10, 2), -15_000, cat="credit", merchant="Halyk Кредит наличными")
    assert we.sig("R082").triggered
    assert we.sig("R089").triggered  # due 10 Oct, no payment found
    we.tx(a, date(2026, 10, 10), -40_000, cat="credit", merchant="Kaspi Рассрочка")
    assert we.sig("R089").triggered is False


def test_reserve_r091_r092_r099(we):
    we.account(kind="savings", balance=600_000)
    s = we.sig("R091")
    assert s.values["reserveMonths"] == 2.0 and s.triggered  # target 3 months
    assert we.sig("R092").values["gap"]["value_minor"] == 300_000 * K
    assert we.sig("R099").triggered is False
    w2 = we
    w2.account(name="Депозит", kind="deposit", balance=500_000, frozen_until=T + timedelta(days=90))
    assert w2.sig("R091").values["reserveMonths"] == 2.0  # frozen money is not reserve (BR-14)


def test_r099_frozen_reserve(we):
    we.account(kind="savings", balance=100_000)
    we.account(name="Депозит", kind="deposit", balance=500_000, frozen_until=T + timedelta(days=90))
    assert we.sig("R099").triggered


def test_goals_r101_to_r104_r109(we):
    assert we.sig("R101").ready is False
    we.goal(1_200_000, 200_000, 50_000, "2027-10")  # 12 months, gap 1 000 000
    assert we.sig("R101").values["goalGap"]["value_minor"] == 1_000_000 * K
    s = we.sig("R102")
    assert s.triggered and s.values["required"]["value_minor"] == 8_333_334  # ceil to tiyn: 83 333,34 ₸
    assert we.sig("R103").triggered  # 20 months at 50 000
    we.income(5, 450_000)
    we.obligation(1, 100_000)  # affordable 50 000
    assert we.sig("R104").triggered
    assert we.sig("R109").triggered is False  # 50 000 asked, 50 000 free
    we.goal(500_000, 0, 30_000, "2027-06")
    assert we.sig("R109").triggered


def test_planned_r111_r119_r186(w):
    assert w.sig("R111").ready is False
    w.planned(date(2027, 1, 20), 300_000)
    s = w.sig("R111")
    assert s.triggered and s.values["setAside"]["value_minor"] == 100_000 * K  # 3 months
    assert w.sig("R119").triggered is False
    w.planned(date(2026, 10, 1), 20_000, name="Курсы")
    s = w.sig("R186")
    assert s.triggered and s.critical and "Курсы" in s.summary


def test_calendar_r181_r182_r183_r185_r188(we):
    we.account(balance=50_000)
    we.income(25, 300_000, low=250_000)
    we.income(10, 200_000)
    we.obligation(22, 60_000)
    assert we.sig("R181").triggered  # 60 000 due before the 25th, 50 000 available
    s = we.sig("R182")  # pays on 25 Oct and 10 Nov: after the first 50 000 − 60 000 + 250 000; needs 300 000 × 16 / 30
    assert s.values["afterFirst"]["value_minor"] == 240_000 * K and s.triggered is False
    we.obligation(22, 30_000, name="ЖКУ", kind="utility")
    assert we.sig("R183").triggered  # two payments on one day above the money
    weekend = next(T + timedelta(days=i) for i in range(1, 8) if (T + timedelta(days=i)).weekday() >= 5)
    we.obligation(weekend.day, 5_000, name="Интернет", kind="utility")
    hits = we.sig("R185")
    assert hits.triggered and "Интернет" in hits.summary
    # carry until 10 Nov: 300 000 × 9 / 30 = 90 000; the weekend payment is added by its own date below
    s = we.sig("R188")
    extra = 5_000 if weekend.day < 10 else 0
    assert s.values["carryRequired"]["value_minor"] == (90_000 + extra) * K
    paid = 90_000 + (5_000 if weekend.month == 10 and weekend.day < 25 else 0)
    assert s.values["projectedEnd"]["value_minor"] == (50_000 + 250_000 - paid - 120_000) * K and s.triggered  # 85 000 < 90 000
    we.obligation(28, 20_000, name="Связь", kind="utility")  # after the payout on the 25th, still this month
    assert we.sig("R188").values["projectedEnd"]["value_minor"] == (50_000 + 250_000 - paid - 20_000 - 120_000) * K


def test_every_implemented_signal_is_named_here():
    import inspect

    src = inspect.getsource(inspect.getmodule(test_every_implemented_signal_is_named_here))
    missing = [sid for sid in REGISTRY if sid not in src]
    assert missing == [], missing


def test_a001_ceiling_is_not_a_target(w):
    a = w.account(balance=120_000)
    w.income(1, 400_000)  # horizon 12 days: ceiling 10 000 a day
    for i in range(1, 8):
        w.tx(a, T - timedelta(days=i), -8_000)
    assert w.sig("A001").triggered is False  # 8 000 < 9 000 (90 % of the ceiling)
    w.tx(a, T - timedelta(days=1), -10_000)
    s = w.sig("A001")
    assert s.triggered and "потолке 10 000 ₸" in s.summary


def test_a002_surplus_to_goal_or_reserve(we):
    we.account(kind="savings", balance=100_000)
    assert we.sig("A002").ready is False  # no plan without confirmed income
    we.income(5, 500_000)
    we.obligation(1, 100_000)  # surplus 100 000, reserve gap 800 000
    s = we.sig("A002")
    assert s.triggered and s.values["amount"]["value_minor"] == 100_000 * K and "в резерв" in s.summary


def test_a003_tax_from_income(w):
    from app.models import AmountRule

    a = w.account()
    w.planned(date(2026, 10, 28), 1, name="Налог ИП")
    p = w.db.query(PlannedPayment).filter(PlannedPayment.user_id == w.u.id).one()
    w.db.add(AmountRule(user_id=w.u.id, target_type="planned", target_id=p.id, kind="percent_income",
                        params={"percent": 3, "base": "income_confirmed"}, expression="3 / 100 * income_confirmed",
                        valid_from="2026-10"))
    assert w.sig("A003").triggered is False  # no income this month yet
    w.tx(a, date(2026, 10, 5), 400_000, cat="income")
    s = w.sig("A003")
    assert s.triggered and "Налог ИП" in s.summary and "12 000 ₸" in s.summary


def test_a004_debt_income_guard(we):
    a = we.account()
    we.obligation(10, 40_000, kind="installment", name="Рассрочка")
    we.tx(a, date(2026, 9, 5), 3_000, cat="income")
    s = we.sig("A004")
    assert s.triggered and "3 000 ₸" in s.summary
    assert we.sig("R081").ready is False  # the debt-load advice itself stays hidden
    we.tx(a, date(2026, 9, 6), 297_000, cat="income")
    assert we.sig("A004").triggered is False
