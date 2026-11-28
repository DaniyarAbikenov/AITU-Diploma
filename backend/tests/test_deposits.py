"""Deposits and frozen money, transfers between own accounts, interest."""
import uuid
from datetime import date

from app.core.config import as_of
from app.core.db import SessionLocal
from app.models import Account, Transaction, User
from app.services.imports import mark_internal_transfers
from app.services.ledger import build_context
from tests.conftest import API


def _user(client):
    email = f"dep-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/register", json={"email": email, "password": "secret12", "name": "Тест"})
    return {"Authorization": f"Bearer {r.json()['token']}"}, email


def _acc(client, h, **kw):
    body = {"bank": "Kaspi Bank", "name": "Gold", "kind": "current", "balance": 200000, "balanceAsOf": "2026-10-01", **kw}
    r = client.post(f"{API}/accounts", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_frozen_deposit_counts_in_capital_but_not_in_available_money(client):
    h, email = _user(client)
    cur = _acc(client, h)
    dep = _acc(client, h, name="Kaspi Депозит", kind="deposit", balance=500000, frozenUntil="2027-03-01",
               interestRate=14.5, earlyWithdrawal="lose_interest")
    assert dep["frozenAmount"] == 500000 and dep["availableBalance"] == 0 and dep["frozenKzt"] == 500000
    assert dep["interestRate"] == 14.5 and dep["earlyWithdrawal"] == "lose_interest"
    part = _acc(client, h, name="Halyk", balance=100000, frozenUntil="2027-01-01", frozenAmount=30000)
    assert part["frozenAmount"] == 30000 and part["availableBalance"] == 70000
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        assert build_context(db, user, as_of()).balance == 200000 + 0 + 70000  # spendable money only
    gone = client.patch(f"{API}/accounts/{dep['id']}", headers=h, json={"frozenUntil": "2026-10-01"}).json()
    assert gone["frozenAmount"] == 0 and gone["availableBalance"] == 500000  # unlock date passed: available
    cleared = client.patch(f"{API}/accounts/{part['id']}", headers=h, json={"frozenUntil": None}).json()
    assert cleared["frozenUntil"] is None and cleared["availableBalance"] == 100000
    assert cur["frozenAmount"] == 0


def test_transfer_to_a_deposit_is_two_linked_operations_and_not_spending(client):
    h, _ = _user(client)
    cur, dep = _acc(client, h), _acc(client, h, name="Депозит", kind="deposit", balance=0)
    month = as_of().isoformat()[:7]
    before = client.get(f"{API}/dashboard/summary?month={month}", headers=h).json()
    body = {"fromAccountId": cur["id"], "toAccountId": dep["id"], "amount": 50000, "date": as_of().isoformat(),
            "requestId": "req-12345678"}
    legs = client.post(f"{API}/transfers", headers=h, json=body).json()
    assert [t["amount"] for t in sorted(legs, key=lambda t: t["amount"])] == [-50000, 50000]
    assert all(t["kind"] == "transfer_own" and t["transferGroup"] for t in legs)
    again = client.post(f"{API}/transfers", headers=h, json=body).json()  # repeated submit: no duplicate
    assert {t["id"] for t in again} == {t["id"] for t in legs}
    after = client.get(f"{API}/dashboard/summary?month={month}", headers=h).json()
    assert after["expense"] == before["expense"] and after["income"] == before["income"]
    accs = {a["id"]: a for a in client.get(f"{API}/accounts", headers=h).json()}
    assert accs[cur["id"]]["currentBalance"] == 150000 and accs[dep["id"]]["currentBalance"] == 50000  # capital same
    too_much = {**body, "amount": 1_000_000, "requestId": "req-87654321"}
    assert client.post(f"{API}/transfers", headers=h, json=too_much).status_code == 422
    future = {**body, "date": "2030-01-01", "requestId": "req-future-1"}
    assert client.post(f"{API}/transfers", headers=h, json=future).status_code == 422
    usd = _acc(client, h, name="USD", currency="USD", balance=100)
    cross = {**body, "toAccountId": usd["id"], "requestId": "req-cross-1"}
    assert client.post(f"{API}/transfers", headers=h, json=cross).status_code == 422  # needs toAmount
    assert client.delete(f"{API}/transactions/{legs[0]['id']}", headers=h).status_code == 200
    assert client.get(f"{API}/transactions", headers=h).json() == []  # both legs removed together
    other, _ = _user(client)
    assert client.post(f"{API}/transfers", headers=other, json={**body, "requestId": "req-other-1"}).status_code == 404


def test_deposit_interest_is_income(client):
    h, _ = _user(client)
    dep = _acc(client, h, name="Депозит", kind="deposit", frozenUntil="2027-03-01")
    month = as_of().isoformat()[:7]
    r = client.post(f"{API}/transactions", headers=h, json={"accountId": dep["id"], "date": as_of().isoformat(),
                                                          "amount": 6000, "merchant": "Проценты по депозиту",
                                                          "kind": "income_interest"})
    assert r.json()["kind"] == "income_interest" and r.json()["categoryId"] == "income"
    assert client.get(f"{API}/dashboard/summary?month={month}", headers=h).json()["income"] == 6000


def test_ambiguous_pairs_wait_for_confirmation(client):
    h, email = _user(client)
    a, b, c = (_acc(client, h, name=n) for n in ("A", "B", "C"))
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()

        def tx(acc, amount, day):
            db.add(Transaction(user_id=user.id, account_id=int(acc["id"]), booked_on=day, amount_minor=amount * 100,
                               merchant="Перевод", category_id="transfers", dedup_key=uuid.uuid4().hex))

        tx(a, -1000, date(2026, 10, 5))
        tx(b, 1000, date(2026, 10, 5))
        tx(c, 1000, date(2026, 10, 6))  # two possible twins: not linked automatically
        tx(a, -2000, date(2026, 10, 7))
        tx(b, 2000, date(2026, 10, 7))  # one twin: linked
        db.flush()
        assert mark_internal_transfers(db, user) == 2
        db.commit()
    cands = client.get(f"{API}/transfers/candidates", headers=h).json()
    assert len(cands) == 1 and len(cands[0]["inIds"]) == 2
    linked = client.post(f"{API}/transfers/link", headers=h, json={"outId": cands[0]["outId"], "inId": cands[0]["inIds"][0]}).json()
    assert all(t["kind"] == "transfer_own" for t in linked) and linked[0]["transferGroup"] == linked[1]["transferGroup"]
    assert client.get(f"{API}/transfers/candidates", headers=h).json() == []
    with SessionLocal() as db:
        assert db.query(Account).filter(Account.id == int(a["id"])).one().user_id
