"""Essential expenses and planned income are computed from the user's data (synthetic data, tests run on 2026-10-20)."""
import uuid

import pytest

from tests.conftest import API


@pytest.fixture()
def h(client):
    r = client.post(f"{API}/auth/register", json={"email": f"b-{uuid.uuid4().hex[:8]}@example.com", "password": "secret12", "name": "Т"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def basis(client, h, month=None):
    return client.get(f"{API}/profile/basis" + (f"?month={month}" if month else ""), headers=h).json()


def ob(client, h, name, amount, kind="rent", **kw):
    r = client.post(f"{API}/obligations", headers=h, json={"name": name, "kind": kind, "amount": amount, "dayOfMonth": 5, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def need(client, h, name="Питание", amount=5000, **kw):
    assert client.post(f"{API}/daily-needs", headers=h, json={"name": name, "amount": amount, **kw}).status_code == 201


def planned(client, h, name, amount, due, **kw):
    r = client.post(f"{API}/planned-payments", headers=h, json={"name": name, "amount": amount, "dueOn": due, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def essential(client, h, month=None):
    return basis(client, h, month)["essential"]


def test_nothing_is_not_zero(client, h):
    e = essential(client, h)
    assert e["value"] is None and e["auto"] is None and e["source"] == "none" and e["items"] == []
    assert basis(client, h)["income"]["value"] is None
    assert client.get(f"{API}/me", headers=h).json()["essentialExpenses"] is None


@pytest.mark.parametrize("month,days", [("2026-10", 31), ("2026-11", 30), ("2027-02", 28), ("2028-02", 29)])
def test_items_and_days_of_the_month(client, h, month, days):
    ob(client, h, "Аренда", 200_000)
    ob(client, h, "Кредит", 50_000, kind="credit")
    need(client, h)
    need(client, h, "Связь", 6_000, period="month")
    e = essential(client, h, month)
    assert e["value"] == e["auto"] == 200_000 + 50_000 + 5_000 * days + 6_000 and e["source"] == "auto"
    assert {x["name"]: x["amount"] for x in e["items"]}["Питание"] == 5_000 * days
    assert next(x for x in e["items"] if x["name"] == "Питание")["days"] == days


def test_yearly_one_off_optional_and_cancelled_items(client, h):
    need(client, h, amount=1_000)  # 31 000 in October
    planned(client, h, "Страховка", 120_000, "2027-03-01", repeat="yearly")
    one = planned(client, h, "Налог", 60_000, "2026-12-15")
    planned(client, h, "Через два года", 600_000, "2028-12-15")
    planned(client, h, "Концерт", 24_000, "2026-12-20", mandatory=False)
    gone = planned(client, h, "Отменено", 24_000, "2026-12-20")
    client.patch(f"{API}/planned-payments/{gone['id']}", headers=h, json={"cancelled": True})
    planned(client, h, "Премия", 240_000, "2026-12-20", direction="income")
    assert essential(client, h)["value"] == 31_000 + 10_000 + 5_000
    acc = client.post(f"{API}/accounts", headers=h, json={"bank": "K", "name": "G", "kind": "current", "balance": 100_000}).json()
    client.post(f"{API}/planned-payments/{one['id']}/settle", headers=h, json={"accountId": acc["id"], "amount": 24_000})
    assert essential(client, h)["value"] == 31_000 + 10_000 + 3_000  # what is left of the one-off
    assert "Налог" not in [x["name"] for x in essential(client, h, "2027-01")["items"]]  # due before that month


def test_rejected_unconfirmed_and_ended_payments_are_left_out(client, h):
    need(client, h, amount=1_000)
    a = ob(client, h, "Аренда", 200_000)
    ob(client, h, "Рассрочка", 30_000, kind="installment", endsAt="2026-11")
    assert essential(client, h)["value"] == 31_000 + 230_000
    assert essential(client, h, "2026-12")["value"] == 31_000 + 200_000
    client.patch(f"{API}/obligations/{a['id']}", headers=h, json={"rejected": True})
    assert essential(client, h)["value"] == 31_000 + 30_000


def test_rule_amounts_and_no_double_count_with_needs(client, h):
    food = ob(client, h, "Питание", 1, kind="utility")
    client.put(f"{API}/rules/obligation/{food['id']}", headers=h, json={"kind": "per_day", "params": {"perDay": 5000}})
    e = essential(client, h)
    assert e["value"] == 155_000 and e["everydayKnown"]  # a per-day payment is the everyday spending
    assert essential(client, h, "2026-11")["value"] == 150_000
    need(client, h, "Еда", 5000, coveredBy=f"ob_{food['id']}")
    assert essential(client, h)["value"] == 155_000
    client.patch(f"{API}/obligations/{food['id']}", headers=h, json={"rejected": True})
    assert essential(client, h)["value"] == 155_000  # now counted as the need


def test_need_covered_by_an_optional_item_is_still_essential(client, h):
    p = planned(client, h, "Отпуск", 300_000, "2026-12-01", mandatory=False)
    need(client, h, "Еда", 1000, coveredBy=f"pl_{p['id']}")
    assert essential(client, h)["value"] == 31_000


def test_only_payments_is_a_partial_sum_and_is_not_used(client, h):
    ob(client, h, "Аренда", 200_000)
    e = essential(client, h)
    assert e["source"] == "partial" and e["auto"] == 200_000 and e["value"] is None
    client.patch(f"{API}/me", headers=h, json={"essentialExpenses": 350_000})  # only fills the gap
    e = essential(client, h)
    assert e["source"] == "fallback" and e["value"] == 350_000 and e["manualOn"] == "2026-10-20"
    need(client, h)
    e = essential(client, h)
    assert e["source"] == "auto" and e["value"] == 355_000


def test_override_and_return(client, h):
    need(client, h)
    r = client.patch(f"{API}/me", headers=h, json={"essentialExpenses": 400_000})
    assert r.json()["essentialExpenses"] == 400_000
    e = essential(client, h)
    assert (e["source"], e["value"], e["auto"], e["manualOn"]) == ("manual", 400_000, 155_000, "2026-10-20")
    client.patch(f"{API}/me", headers=h, json={"name": "Другое имя"})  # saving the profile keeps the override
    assert essential(client, h)["source"] == "manual"
    r = client.patch(f"{API}/me", headers=h, json={"essentialExpenses": None})
    assert r.json()["essentialExpenses"] == 155_000 and essential(client, h)["source"] == "auto"


def test_a_value_typed_before_this_version_is_only_a_fallback(client, h):
    from app.core.db import SessionLocal
    from app.models import User

    uid = int(client.get(f"{API}/me", headers=h).json()["id"])
    with SessionLocal() as db:
        db.get(User, uid).essential_expenses_minor = 100_000_00
        db.commit()
    assert essential(client, h)["source"] == "fallback" and essential(client, h)["value"] == 100_000
    need(client, h)
    assert essential(client, h)["value"] == 155_000


def test_income_is_computed_with_its_range(client, h):
    for day, amount, low, high in ((1, 400_000, 300_000, 500_000), (15, 350_000, None, None)):
        client.post(f"{API}/income-sources", headers=h, json={"name": f"ЗП {day}", "amount": amount, "amountMin": low,
                                                              "amountMax": high, "dayOfMonth": day})
    i = basis(client, h)["income"]
    assert (i["value"], i["low"], i["high"], i["source"]) == (750_000, 650_000, 850_000, "auto")
    client.patch(f"{API}/me", headers=h, json={"plannedIncome": 600_000})
    assert basis(client, h)["income"]["source"] == "manual" and client.get(f"{API}/me", headers=h).json()["plannedIncome"] == 600_000
    client.patch(f"{API}/me", headers=h, json={"plannedIncome": None})
    assert basis(client, h)["income"]["value"] == 750_000


def test_one_source_for_reserve_index_and_insights(client, h):
    from app.core.db import SessionLocal
    from app.insights.signals import REGISTRY
    from app.insights.snapshot import Snapshot
    from app.models import User
    from app.services.ledger import build_context

    ob(client, h, "Аренда", 145_000)
    need(client, h)  # 300 000 a month
    for kind, balance in (("current", 600_000), ("savings", 900_000)):
        client.post(f"{API}/accounts", headers=h, json={"bank": "K", "name": kind, "kind": kind, "balance": balance})
    me = client.get(f"{API}/me", headers=h).json()
    with SessionLocal() as db:
        s = Snapshot(db, db.get(User, int(me["id"])))
        assert REGISTRY["R091"](s).values["reserveMonths"] == 3.0 and s.essential_minor == 300_000_00
        ctx = build_context(db, s.user, s.as_of)
        assert ctx.essential == me["essentialExpenses"] == essential(client, h)["value"] == 300_000
        assert ctx.living == 155_000
    r = client.get(f"{API}/resilience", headers=h)
    assert r.status_code == 200 and r.json()["runwayMonths"] == 5.0  # 1 500 000 / 300 000


def test_month_is_validated_and_private(client, h):
    assert client.get(f"{API}/profile/basis?month=2026-13", headers=h).status_code == 422
    assert client.get(f"{API}/profile/basis").status_code == 401


def test_erasure_clears_the_plan(client, h):
    need(client, h)
    client.patch(f"{API}/me", headers=h, json={"essentialExpenses": 1, "plannedIncome": 2, "workHours": 3})
    client.delete(f"{API}/me", headers=h)
    me = client.get(f"{API}/me", headers=h).json()
    assert me["essentialExpenses"] is None and me["plannedIncome"] is None and me["workHours"] is None
