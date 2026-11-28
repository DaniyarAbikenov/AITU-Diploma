"""Debt-to-income: payments over income of the month; no percentage from almost-zero or incomplete income."""
import uuid
from datetime import date

from app.core.db import SessionLocal
from app.models import Account, Transaction, User
from tests.conftest import API


def _user(client):
    email = f"dti-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/register", json={"email": email, "password": "secret12", "name": "Тест"})
    return {"Authorization": f"Bearer {r.json()['token']}"}, email


def _ops(email, rows):
    with SessionLocal() as db:
        u = db.query(User).filter(User.email == email).one()
        a, b = (Account(user_id=u.id, bank="Kaspi Bank", name=n, currency="KZT") for n in ("Gold", "Депозит"))
        db.add_all([a, b])
        db.flush()
        for day, amount, cat, merchant, internal, own_acc in rows:
            db.add(Transaction(user_id=u.id, account_id=(b if own_acc else a).id, booked_on=day, amount_minor=amount * 100,
                               merchant=merchant, category_id=cat, internal=internal, dedup_key=uuid.uuid4().hex))
        db.commit()


def test_month_with_almost_no_income_gets_no_percentage(client):
    h, email = _user(client)
    _ops(email, [
        (date(2026, 8, 5), 400_000, "income", "Зарплата", False, False),
        (date(2026, 8, 10), -40_000, "credit", "Kaspi Рассрочка", False, False),
        # September: the salary came in as a transfer between own accounts (not income), a tiny income remains
        (date(2026, 9, 5), 300_000, "transfers", "Со своего счёта", True, False),
        (date(2026, 9, 6), 3_000, "income", "Кэшбэк", False, False),
        (date(2026, 9, 10), -37_800, "credit", "Kaspi Рассрочка", False, False),
        (date(2026, 9, 12), -100_000, "transfers", "На депозит", True, False),  # own transfer is not a debt
    ])
    pts = {p["month"]: p for p in client.get(f"{API}/obligations/dti-history", headers=h).json()}
    assert pts["2026-08"]["dti"] == 0.1 and pts["2026-08"]["status"] == "ok"
    sep = pts["2026-09"]
    assert sep["debt"] == 37_800 and sep["income"] == 3_000
    assert sep["status"] == "check" and sep["dti"] > 1  # no expected income known: shown, but flagged
    client.post(f"{API}/income-sources", headers=h, json={"name": "Зарплата", "amount": 400_000, "dayOfMonth": 5})
    sep = {p["month"]: p for p in client.get(f"{API}/obligations/dti-history", headers=h).json()}["2026-09"]
    assert sep["dti"] is None and sep["status"] == "incomplete_income" and sep["expectedIncome"] == 400_000
    assert "2026-07" not in pts  # months without any data are gaps, not 0 %
    pays = client.get(f"{API}/obligations/dti-payments?month=2026-09", headers=h).json()
    assert [p["amount"] for p in pays] == [37_800]  # the own transfer is not in the list


def test_payments_without_income_and_installments(client):
    h, email = _user(client)
    _ops(email, [(date(2026, 9, 10), -54_300, "credit", "Kaspi Рассрочка — iPhone", False, False)])
    sep = {p["month"]: p for p in client.get(f"{API}/obligations/dti-history", headers=h).json()}["2026-09"]
    assert sep["dti"] is None and sep["status"] == "no_income" and sep["payments"] == 1
