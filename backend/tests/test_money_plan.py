"""Everyday needs, the set-aside suggestion and payout rules (synthetic data, tests run on 2026-10-20)."""
import uuid

import pytest

from app.core.db import SessionLocal
from app.models import Account, AllocationRule, AmountRule, DailyNeed, IncomeAllocation, InsightState, User
from tests.conftest import API


@pytest.fixture()
def h(client):
    r = client.post(f"{API}/auth/register", json={"email": f"mp-{uuid.uuid4().hex[:8]}@example.com",
                                                 "password": "secret12", "name": "Тест"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def acc(client, h, name="Gold", balance=100_000, **kw):
    r = client.post(f"{API}/accounts", headers=h, json={"bank": "Kaspi Bank", "name": name, "kind": "current",
                                                       "balance": balance, "balanceAsOf": "2026-10-19", **kw})
    assert r.status_code == 201, r.text
    return r.json()


def income(client, h, day, amount, low=None):
    client.post(f"{API}/income-sources", headers=h, json={"name": "Зарплата", "amount": amount, "amountMin": low, "dayOfMonth": day})


def need(client, h, amount=5000, **kw):
    assert client.post(f"{API}/daily-needs", headers=h, json={"name": "Еда", "amount": amount, **kw}).status_code == 201


def plan(client, h):
    return client.get(f"{API}/money-plan", headers=h).json()


def test_account_named_as_a_sole_proprietor_is_an_ordinary_personal_account(client, h):
    """The product is for individuals: nothing is excluded by the account name."""
    acc(client, h)
    ip = acc(client, h, "ИП Тест", 900_000)
    assert "perimeter" not in ip and plan(client, h)["liquid"] == 1_000_000
    client.patch(f"{API}/accounts/{ip['id']}", headers=h, json={"perimeter": "business"})  # unknown field: ignored
    assert plan(client, h)["liquid"] == 1_000_000
    legs = client.post(f"{API}/transfers", headers=h, json={"fromAccountId": ip["id"], "toAccountId": acc(client, h, "Мой", 0)["id"],
                       "amount": 50_000, "date": "2026-10-20", "requestId": "own-000001"}).json()
    assert {t["kind"] for t in legs} == {"transfer_own"}


def test_need_per_day_and_per_month_convert_by_the_days_of_the_month(client, h):
    need(client, h, 5000)
    need(client, h, 62_000, period="month")
    assert [(n["perDay"], n["perMonth"]) for n in plan(client, h)["needs"]] == [(5000, 155_000), (2000, 62_000)]  # 31 days


def test_database_with_the_former_perimeter_column_still_works():
    """The column was shipped once and is left in place: inserting without it must not fail."""
    from sqlalchemy import create_engine, text

    from app.core.db import Base
    from app.core.migrate import add_missing_columns
    e = create_engine("sqlite://")
    Base.metadata.create_all(e)
    with e.begin() as c:
        c.execute(text("ALTER TABLE accounts ADD COLUMN perimeter VARCHAR(10) DEFAULT 'personal' NOT NULL"))
    assert add_missing_columns(e) == []
    with e.begin() as c:
        c.execute(Account.__table__.insert().values(user_id=1, bank="Kaspi", name="ИП", currency="KZT"))
        assert c.execute(text("SELECT count(*) FROM accounts")).scalar() == 1


def test_needs_reduce_the_limit_and_are_not_deducted_twice(client, h):
    acc(client, h, balance=240_000)
    income(client, h, 1, 400_000)  # horizon 20–31 October: 12 days
    assert plan(client, h)["plan"]["safeDaily"] == 20_000 and plan(client, h)["needToday"] is None
    need(client, h)
    p = plan(client, h)["plan"]
    assert p["needs"] == 60_000 and p["safeDaily"] == 15_000
    need(client, h, 31_000, period="month")  # 1 000 a day in October
    assert plan(client, h)["plan"]["needs"] == 72_000
    ob = client.post(f"{API}/obligations", headers=h, json={"name": "Питание", "kind": "utility", "amount": 100_000, "dayOfMonth": 25}).json()
    n = plan(client, h)["needs"][0]
    client.put(f"{API}/daily-needs/{n['id']}", headers=h, json={"name": "Еда", "amount": 5000, "coveredBy": f"ob_{ob['id']}"})
    assert plan(client, h)["plan"]["needs"] == 12_000  # food is already that payment
    client.delete(f"{API}/obligations/{ob['id']}", headers=h)
    assert plan(client, h)["plan"]["needs"] == 72_000  # the payment is gone: the need counts again


def test_deficit_is_shown_and_the_limit_is_zero(client, h):
    acc(client, h, balance=30_000)
    income(client, h, 1, 400_000)
    need(client, h)
    p = plan(client, h)["plan"]
    assert p["safeDaily"] == 0 and p["deficit"] == 30_000


def test_set_aside_needs_inputs_and_never_exceeds_the_lowest_balance(client, h):
    acc(client, h, balance=500_000)
    assert plan(client, h)["setAside"]["amount"] is None
    assert plan(client, h)["setAside"]["missing"] == ["needs", "income"]
    need(client, h, 10_000)
    income(client, h, 1, 400_000, low=300_000)
    a = plan(client, h)["setAside"]  # 20 Oct–1 Nov, 13 days before the money can be used: 500 000 − 130 000
    assert a["free"] == 370_000 and a["amount"] == 0 and a["hasTargets"] is False
    client.post(f"{API}/goals", headers=h, json={"name": "Машина", "target": 300_000, "saved": 0, "monthly": 0, "deadline": "2028-01"})
    client.post(f"{API}/goals", headers=h, json={"name": "Магистратура", "target": 200_000, "saved": 50_000, "monthly": 0, "deadline": "2027-09"})
    a = plan(client, h)["setAside"]
    assert [(x["name"], x["amount"]) for x in a["items"]] == [("Магистратура", 150_000), ("Машина", 220_000)]
    assert a["amount"] == 370_000  # goals ask 450 000: not more than is free
    client.post(f"{API}/planned-payments", headers=h, json={"name": "Курс", "amount": 400_000, "dueOn": "2026-10-25"})
    assert plan(client, h)["setAside"]["amount"] == 0


def test_payout_rules_proposal_confirm_protects_done_releases(client, h):
    a = acc(client, h, balance=100_000)
    client.post(f"{API}/goals", headers=h, json={"name": "Машина", "target": 30_000, "saved": 0, "monthly": 0, "deadline": "2028-01"})
    assert client.get(f"{API}/allocation-rules", headers=h).json() == []  # no imposed defaults
    tx = client.post(f"{API}/transactions", headers=h, json={"accountId": a["id"], "date": "2026-10-20", "amount": 400_000,
                                                            "merchant": "ЗП", "kind": "income_salary"}).json()
    assert client.get(f"{API}/income-allocations", headers=h).json()["proposals"] == []
    rules = [{"name": "Налог", "kind": "tax", "mode": "percent", "value": 3}, {"name": "Цели", "kind": "goals", "mode": "fixed", "value": 50_000}]
    assert client.put(f"{API}/allocation-rules", headers=h, json=rules).json() == rules
    p = client.get(f"{API}/income-allocations", headers=h).json()["proposals"][0]
    assert [(x["name"], x["amount"]) for x in p["items"]] == [("Налог", 12_000), ("Машина", 30_000)]  # the goal needs only 30 000
    assert p["left"] == 358_000 and plan(client, h)["protected"] == 0
    url = f"{API}/income-allocations/{tx['id']}"
    assert client.post(url, headers=h, json={"action": "confirm"}).status_code == 200
    assert client.post(url, headers=h, json={"action": "confirm"}).status_code == 409
    assert plan(client, h)["protected"] == 42_000
    assert len(client.get(f"{API}/transactions", headers=h).json()) == 1  # nothing was moved
    client.post(url, headers=h, json={"action": "done"})
    assert plan(client, h)["protected"] == 0
    bad = [{"name": "x", "kind": "tax", "mode": "percent", "value": 60}] * 2
    assert client.put(f"{API}/allocation-rules", headers=h, json=bad).status_code == 422


def test_other_users_are_not_reachable(client, h):
    need(client, h)
    nid = plan(client, h)["needs"][0]["id"]
    r = client.post(f"{API}/auth/register", json={"email": f"mp-{uuid.uuid4().hex[:8]}@example.com", "password": "secret12", "name": "x"})
    o = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.delete(f"{API}/daily-needs/{nid}", headers=o).status_code == 404
    assert client.put(f"{API}/daily-needs/{nid}", headers=o, json={"name": "x", "amount": 1}).status_code == 404


def test_erasure_removes_rules_needs_and_insight_states(client, h):
    uid = int(client.get(f"{API}/me", headers=h).json()["id"])
    need(client, h)
    client.put(f"{API}/allocation-rules", headers=h, json=[{"name": "x", "kind": "tax", "mode": "percent", "value": 3}])
    ob = client.post(f"{API}/obligations", headers=h, json={"name": "Еда", "kind": "utility", "amount": 1, "dayOfMonth": 1}).json()
    client.put(f"{API}/rules/obligation/{ob['id']}", headers=h, json={"kind": "per_day", "params": {"perDay": 5000}})
    key = client.get(f"{API}/insights/smart?surface=all", headers=h).json()[0]["key"]
    client.post(f"{API}/insights/smart/hide", headers=h, json={"key": key})
    with SessionLocal() as db:
        assert db.query(AmountRule).filter(AmountRule.user_id == uid).count() == 1
    client.delete(f"{API}/me", headers=h)
    with SessionLocal() as db:
        assert db.get(User, uid) is not None
        for m in (DailyNeed, AllocationRule, AmountRule, InsightState, IncomeAllocation):
            assert db.query(m).filter(m.user_id == uid).count() == 0, m
