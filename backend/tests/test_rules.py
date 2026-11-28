"""Amount rules: safe formulas, per-day by month length, percent of income, overrides, versions, ownership."""
import uuid
from decimal import Decimal

import pytest

from app.engine.formula import FormulaError, MissingInput, evaluate
from tests.conftest import API


def _user(client):
    r = client.post(f"{API}/auth/register", json={"email": f"rule-{uuid.uuid4().hex[:8]}@example.com",
                                                 "password": "secret12", "name": "Тест"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.mark.parametrize("src", ['__import__("os")', "x.__class__", "2**10", "2 ** 1000", "open(1)", "a[0]",
                                 "lambda: 1", "1e999", "9" * 20 + " * " + "9" * 20, "(" * 40 + "1" + ")" * 40, "1+" * 200])
def test_parser_rejects_anything_outside_the_whitelist(src):
    with pytest.raises(FormulaError):
        evaluate(src, {"x": Decimal(1), "a": Decimal(1)})


def test_parser_arithmetic_rounding_and_missing_input():
    assert evaluate("5000 × days_in_month", {"days_in_month": Decimal(31)}) == Decimal("155000.00")
    assert evaluate("round(10 / 3; 2) + min(1, 2) + max(0,5; 0,25)", {}) == Decimal("4.83")
    assert evaluate("1 / 3", {}) == Decimal("0.33")  # HALF_UP to tiyn at the end
    with pytest.raises(FormulaError) as e:
        evaluate("5000 * dayz", {"days_in_month": Decimal(30)})
    assert "dayz" in str(e.value) and e.value.pos == 7
    with pytest.raises(MissingInput):
        evaluate("0.03 * income_month", {"income_month": None})


@pytest.mark.parametrize("month,days", [("2027-02", 28), ("2028-02", 29), ("2026-11", 30), ("2026-12", 31)])
def test_food_per_day_follows_month_length(client, month, days):
    h = _user(client)
    p = client.post(f"{API}/rules/preview", headers=h, json={"kind": "per_day", "params": {"perDay": 5000}, "month": month}).json()
    total = f"{5000 * days:,}".replace(",", " ")
    assert p["amount"] == 5000 * days and p["explanation"] == f"5 000 ₸ × {days} дн. = {total} ₸"


def test_tax_percent_of_income_with_a_range_and_unknown_income(client):
    h = _user(client)
    body = {"kind": "percent_income", "params": {"percent": 3, "base": "income_min"}}
    none = client.post(f"{API}/rules/preview", headers=h, json=body).json()
    assert none["amount"] is None and none["missing"] == "income_min" and "доход" in none["explanation"]
    client.post(f"{API}/income-sources", headers=h, json={"name": "Зарплата 1", "amount": 400000, "amountMin": 300000,
                                                         "amountMax": 500000, "dayOfMonth": 5})
    client.post(f"{API}/income-sources", headers=h, json={"name": "Зарплата 2", "amount": 100000, "dayOfMonth": 20})
    low = client.post(f"{API}/rules/preview", headers=h, json=body).json()
    assert low["amount"] == 12000 and low["explanation"] == "3 % × 400 000 ₸ = 12 000 ₸" and low["estimate"]
    exp = client.post(f"{API}/rules/preview", headers=h, json={**body, "params": {"percent": 3, "base": "income_month"}}).json()
    assert exp["amount"] == 15000


def test_rule_on_an_obligation_overrides_and_versions(client):
    h = _user(client)
    o = client.post(f"{API}/obligations", headers=h, json={"name": "Питание", "kind": "utility", "amount": 100000,
                                                          "dayOfMonth": 1}).json()
    r = client.put(f"{API}/rules/obligation/{o['id']}", headers=h, json={"kind": "per_day", "params": {"perDay": 5000}})
    assert r.status_code == 200, r.text
    info = r.json()
    assert info["amountThisMonth"] == 155000  # October 2026 (tests run on 2026-10-20): 31 days
    assert info["amountsByMonth"] == {"2026-10": 155000, "2026-11": 150000, "2026-12": 155000}
    ob = next(x for x in client.get(f"{API}/obligations", headers=h).json() if x["id"] == o["id"])
    assert ob["amount"] == 100000 and ob["rule"]["explanation"] == "5 000 ₸ × 31 дн. = 155 000 ₸"
    # one month set by hand
    assert client.put(f"{API}/overrides/obligation/{o['id']}/2026-11", headers=h, json={"amount": 120000}).status_code == 200
    ob = next(x for x in client.get(f"{API}/obligations", headers=h).json() if x["id"] == o["id"])
    assert ob["rule"]["amountsByMonth"]["2026-11"] == 120000
    client.put(f"{API}/overrides/obligation/{o['id']}/2026-11", headers=h, json={"amount": None})
    # the rule exists from this month on: the past month keeps the entered amount
    p = client.post(f"{API}/rules/preview", headers=h, json={"kind": "per_day", "params": {"perDay": 5000}, "month": "2026-09"}).json()
    assert p["amount"] == 150000  # preview itself works for any month
    from app.core.db import SessionLocal
    from app.models import User
    from app.services import rules

    with SessionLocal() as db:
        u = db.query(User).order_by(User.id.desc()).first()
        assert rules.compute(db, u, "obligation", int(o["id"]), "2026-09", __import__("datetime").date(2026, 10, 20)) is None
    # removing the rule: the entered amount applies again
    assert client.delete(f"{API}/rules/obligation/{o['id']}", headers=h).status_code == 200
    ob = next(x for x in client.get(f"{API}/obligations", headers=h).json() if x["id"] == o["id"])
    assert ob["rule"] is None


def test_percent_of_another_item_bad_formulas_and_ownership(client):
    h = _user(client)
    rent = client.post(f"{API}/obligations", headers=h, json={"name": "Аренда", "kind": "rent", "amount": 200000, "dayOfMonth": 1}).json()
    fee = client.post(f"{API}/obligations", headers=h, json={"name": "Комиссия", "kind": "utility", "amount": 1, "dayOfMonth": 1}).json()
    r = client.put(f"{API}/rules/obligation/{fee['id']}", headers=h,
                   json={"kind": "percent_of", "params": {"percent": 1.5, "ref": f"ob_{rent['id']}"}})
    assert r.json()["amountThisMonth"] == 3000
    self_ref = client.put(f"{API}/rules/obligation/{fee['id']}", headers=h, json={"kind": "formula", "expression": f"ob_{fee['id']} * 2"})
    assert self_ref.status_code == 422
    bad = client.post(f"{API}/rules/preview", headers=h, json={"kind": "formula", "expression": "5000 * (days_in_month"}).json()
    assert bad["error"] and bad["errorPos"] == 21
    assert client.put(f"{API}/rules/obligation/{fee['id']}", headers=h, json={"kind": "formula", "expression": "import os"}).status_code == 422
    plan = client.post(f"{API}/planned-payments", headers=h, json={"name": "Налог", "amount": 1, "dueOn": "2026-12-25"}).json()
    client.post(f"{API}/income-sources", headers=h, json={"name": "ЗП", "amount": 420000, "dayOfMonth": 5})
    client.put(f"{API}/rules/planned/{plan['id']}", headers=h, json={"kind": "percent_income", "params": {"percent": 3, "base": "income_month"}})
    item = next(p for p in client.get(f"{API}/planned-payments", headers=h).json() if p["id"] == plan["id"])
    assert item["amount"] == 12600 and item["left"] == 12600 and item["baseAmount"] == 1 and item["rule"]["estimate"]
    other = _user(client)
    assert client.put(f"{API}/rules/obligation/{fee['id']}", headers=other, json={"kind": "per_day", "params": {"perDay": 1}}).status_code == 404
    assert client.put(f"{API}/overrides/obligation/{fee['id']}/2026-11", headers=other, json={"amount": 1}).status_code == 404
    assert client.delete(f"{API}/rules/obligation/{fee['id']}", headers=other).status_code == 404
