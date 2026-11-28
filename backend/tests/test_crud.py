"""CRUD of the working mode: manual operations, corrections of imported ones, obligations, planned items."""
import uuid

import pytest

from tests.conftest import API


def _user(client):
    email = f"crud-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/register", json={"email": email, "password": "secret12", "name": "Тест"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def me(client):
    h = _user(client)
    acc = client.post(f"{API}/accounts", headers=h, json={"bank": "Kaspi Bank", "name": "Kaspi Gold", "kind": "current",
                                                       "balance": 100000, "balanceAsOf": "2026-10-01"}).json()
    return h, acc


def test_manual_operation_moves_the_balance_and_can_be_edited_and_deleted(client, me):
    h, acc = me
    r = client.post(f"{API}/transactions", headers=h, json={"accountId": acc["id"], "date": "2026-10-10", "amount": -2500,
                                                          "merchant": "Кофе", "category": "cafe", "kind": "expense",
                                                          "note": "с коллегами"})
    assert r.status_code == 201, r.text
    tx = r.json()
    assert tx["source"] == "manual" and tx["amount"] == -2500 and tx["note"] == "с коллегами"
    a = client.get(f"{API}/accounts", headers=h).json()[0]
    assert a["balance"] == 100000 and a["currentBalance"] == 97500  # checkpoint stays, current follows the operation
    r = client.patch(f"{API}/transactions/{tx['id']}", headers=h, json={"amount": -3000, "merchant": "Кофейня"})
    assert r.json()["amount"] == -3000 and r.json()["merchant"] == "Кофейня"
    assert client.get(f"{API}/accounts", headers=h).json()[0]["currentBalance"] == 97000
    hist = client.get(f"{API}/transactions/{tx['id']}/history", headers=h).json()
    assert [e["action"] for e in hist] == ["create", "update"] and hist[1]["before"]["amount"] == -2500
    assert client.delete(f"{API}/transactions/{tx['id']}", headers=h).status_code == 200
    assert client.get(f"{API}/accounts", headers=h).json()[0]["currentBalance"] == 100000


def test_manual_operation_validation(client, me):
    h, acc = me
    base = {"accountId": acc["id"], "date": "2026-10-10", "merchant": "x"}
    assert client.post(f"{API}/transactions", headers=h, json={**base, "amount": 0}).status_code == 422
    assert client.post(f"{API}/transactions", headers=h, json={**base, "amount": -1, "date": "2030-01-01"}).status_code == 422
    assert client.post(f"{API}/transactions", headers=h, json={**base, "amount": -1, "merchant": "x" * 201}).status_code == 422
    assert client.post(f"{API}/transactions", headers=h, json={**base, "amount": -1, "category": "nope"}).status_code == 422


def test_owner_checks(client, me):
    h, acc = me
    tx = client.post(f"{API}/transactions", headers=h, json={"accountId": acc["id"], "date": "2026-10-10", "amount": -100,
                                                           "merchant": "x"}).json()
    plan = client.post(f"{API}/planned-payments", headers=h, json={"name": "Курс", "amount": 1000, "dueOn": "2026-12-01"}).json()
    other = _user(client)
    assert client.post(f"{API}/transactions", headers=other, json={"accountId": acc["id"], "date": "2026-10-10",
                                                                 "amount": -1, "merchant": "x"}).status_code == 404
    for method, path in (("patch", f"/transactions/{tx['id']}"), ("delete", f"/transactions/{tx['id']}"),
                         ("post", f"/transactions/{tx['id']}/void"), ("get", f"/transactions/{tx['id']}/history"),
                         ("patch", f"/planned-payments/{plan['id']}"), ("delete", f"/planned-payments/{plan['id']}"),
                         ("patch", f"/accounts/{acc['id']}")):
        kwargs = {"json": {}} if method in ("patch", "post") else {}
        assert getattr(client, method)(API + path, headers=other, **kwargs).status_code == 404, path
    r = client.post(f"{API}/planned-payments/{plan['id']}/settle", headers=other, json={"transactionId": tx["id"]})
    assert r.status_code == 404


def test_imported_operation_is_corrected_not_overwritten(client):
    h = _user(client)
    client.post(f"{API}/imports", headers=h, json={"bank": "kaspi"})
    rent = next(t for t in client.get(f"{API}/transactions?q=Аренда", headers=h).json())
    month = rent["date"][:7]
    exp = client.get(f"{API}/dashboard/summary?month={month}", headers=h).json()["expense"]
    r = client.patch(f"{API}/transactions/{rent['id']}", headers=h, json={"amount": -200000, "note": "скидка"})
    body = r.json()
    assert body["amount"] == -200000 and body["original"] == {"amount": rent["amount"], "date": rent["date"]}
    assert body["note"] == "скидка" and body["merchant"] == rent["merchant"]
    assert client.get(f"{API}/dashboard/summary?month={month}", headers=h).json()["expense"] == exp - 20000
    assert client.delete(f"{API}/transactions/{rent['id']}", headers=h).status_code == 409
    v = client.post(f"{API}/transactions/{rent['id']}/void", headers=h).json()
    assert v["voided"] is True
    assert client.get(f"{API}/dashboard/summary?month={month}", headers=h).json()["expense"] == exp - 220000
    client.post(f"{API}/transactions/{rent['id']}/restore", headers=h)
    assert client.get(f"{API}/dashboard/summary?month={month}", headers=h).json()["expense"] == exp - 20000
    actions = [e["action"] for e in client.get(f"{API}/transactions/{rent['id']}/history", headers=h).json()]
    assert actions == ["update", "void", "restore"]


def test_obligation_crud(client, me):
    h, _ = me
    r = client.post(f"{API}/obligations", headers=h, json={"name": "Аренда", "kind": "rent", "amount": 150000,
                                                         "dayOfMonth": 31, "category": "housing"})
    o = r.json()
    assert r.status_code == 201 and o["confirmed"] and o["categoryId"] == "housing" and o["debtLeft"] is None
    r = client.patch(f"{API}/obligations/{o['id']}", headers=h, json={"amount": 160000, "kind": "credit",
                                                                    "endsAt": "2027-06", "debtLeft": 900000})
    assert r.json()["amount"] == 160000 and r.json()["debtLeft"] == 900000 and r.json()["endsAt"] == "2027-06"
    r = client.patch(f"{API}/obligations/{o['id']}", headers=h, json={"endsAt": None})
    assert r.json()["endsAt"] is None and r.json()["debtLeft"] == 900000
    assert client.delete(f"{API}/obligations/{o['id']}", headers=h).status_code == 200
    assert client.get(f"{API}/obligations", headers=h).json() == []


def test_planned_item_partial_and_linked_payment_without_double_booking(client, me):
    h, acc = me
    p = client.post(f"{API}/planned-payments", headers=h, json={
        "name": "Взнос за магистратуру", "amount": 300000, "dueOn": "2026-12-10", "dueTo": "2026-12-20",
        "category": "other", "accountId": acc["id"], "mandatory": True, "movable": False}).json()
    assert p["status"] == "planned" and p["left"] == 300000
    r = client.post(f"{API}/planned-payments/{p['id']}/settle", headers=h, json={"amount": 100000, "date": "2026-10-15"})
    assert r.json()["status"] == "partial" and r.json()["left"] == 200000
    n_before = len(client.get(f"{API}/transactions", headers=h).json())
    tx = client.post(f"{API}/transactions", headers=h, json={"accountId": acc["id"], "date": "2026-10-16",
                                                           "amount": -200000, "merchant": "Университет"}).json()
    r = client.post(f"{API}/planned-payments/{p['id']}/settle", headers=h, json={"transactionId": tx["id"]})
    assert r.json()["status"] == "paid" and r.json()["left"] == 0 and len(r.json()["settlements"]) == 2
    assert len(client.get(f"{API}/transactions", headers=h).json()) == n_before + 1  # linking booked nothing new
    assert client.post(f"{API}/planned-payments/{p['id']}/settle", headers=h, json={"amount": 1}).status_code == 409
    other = client.post(f"{API}/planned-payments", headers=h, json={"name": "x", "amount": 10, "dueOn": "2026-12-01"}).json()
    dup = client.post(f"{API}/planned-payments/{other['id']}/settle", headers=h, json={"transactionId": tx["id"]})
    assert dup.status_code == 409
    assert client.get(f"{API}/accounts", headers=h).json()[0]["currentBalance"] == 100000 - 300000


def test_planned_validation_yearly_and_cancel(client, me):
    h, acc = me
    bad = client.post(f"{API}/planned-payments", headers=h, json={"name": "x", "amount": 1, "dueOn": "2026-12-10",
                                                                "dueTo": "2026-12-01"})
    assert bad.status_code == 422
    assert client.post(f"{API}/planned-payments", headers=h, json={"name": "x", "amount": 0, "dueOn": "2026-12-10"}).status_code == 422
    y = client.post(f"{API}/planned-payments", headers=h, json={"name": "Страховка авто", "amount": 60000,
                                                              "dueOn": "2026-11-15", "repeat": "yearly"}).json()
    r = client.post(f"{API}/planned-payments/{y['id']}/settle", headers=h, json={"accountId": acc["id"], "date": "2026-10-20"})
    assert r.json()["dueOn"] == "2027-11-15" and r.json()["status"] == "planned"  # next occurrence starts unpaid
    c = client.patch(f"{API}/planned-payments/{y['id']}", headers=h, json={"cancelled": True}).json()
    assert c["status"] == "cancelled"
    assert client.delete(f"{API}/planned-payments/{y['id']}", headers=h).status_code == 200
