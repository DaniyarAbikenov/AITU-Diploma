"""Foreign-currency accounts: official NBK rates, tenge equivalents, revaluation, stale rates."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.core.config import as_of
from app.core.db import SessionLocal
from app.models import FxRate, User
from app.parsers.base import ParsedRow, ParsedStatement
from app.services import fx
from app.services.imports import statement_currency
from app.services.ledger import build_context
from tests.conftest import API


def _user(client):
    email = f"fx-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/register", json={"email": email, "password": "secret12", "name": "Тест"})
    return {"Authorization": f"Bearer {r.json()['token']}"}, email


@pytest.fixture()
def rates():
    """Official rates as the NBK feed would store them: 470 today, 450 on 1 October."""
    with SessionLocal() as db:
        fx.store(db, date(2026, 10, 1), {"USD": 450.0, "EUR": 500.0})
        fx.store(db, as_of(), {"USD": 470.0, "EUR": 520.0})
        db.commit()
    yield
    with SessionLocal() as db:
        for c in ("USD", "EUR"):
            row = db.get(FxRate, c)
            if row:
                db.delete(row)
        db.commit()


def test_rates_endpoint_reports_date_source_and_freshness(client, rates):
    body = client.get(f"{API}/rates").json()
    usd = next(r for r in body["rates"] if r["currency"] == "USD")
    assert body["base"] == "KZT" and "nationalbank.kz" in body["source"]
    assert usd == {**usd, "rate": 470.0, "rateDate": as_of().isoformat(), "source": "nbk", "stale": False}
    with SessionLocal() as db:
        db.get(FxRate, "USD").fetched_at = datetime.now(timezone.utc) - timedelta(days=2)
        db.commit()
    usd = next(r for r in client.get(f"{API}/rates").json()["rates"] if r["currency"] == "USD")
    assert usd["stale"] is True and usd["rate"] == 470.0  # last known value, flagged


def test_without_feed_usd_falls_back_to_the_marked_series_value(client):
    with SessionLocal() as db:
        assert db.get(FxRate, "USD") is None
    usd = next(r for r in client.get(f"{API}/rates").json()["rates"] if r["currency"] == "USD")
    assert usd["stale"] is True and usd["source"] in ("demo-seed", "nbk") and usd["fetchedAt"] is None


def test_usd_account_keeps_its_currency_and_shows_tenge_equivalent(client, rates):
    h, email = _user(client)
    acc = client.post(f"{API}/accounts", headers=h, json={"bank": "Freedom Bank", "name": "USD", "kind": "savings",
                                                       "currency": "USD", "balance": 1000, "balanceAsOf": "2026-10-01"}).json()
    assert acc["currency"] == "USD" and acc["balance"] == 1000
    assert acc["rate"] == 470.0 and acc["balanceKzt"] == 470000
    assert acc["revaluationKzt"] == 20000  # (470 - 450) * 1000: rate only, not income
    client.post(f"{API}/transactions", headers=h, json={"accountId": acc["id"], "date": "2026-10-10", "amount": -100,
                                                       "merchant": "Покупка в $"})
    a = client.get(f"{API}/accounts", headers=h).json()[0]
    assert a["currentBalance"] == 900 and a["currentBalanceKzt"] == 423000
    tx = client.get(f"{API}/transactions", headers=h).json()[0]
    assert tx["currency"] == "USD" and tx["amount"] == -100
    kzt = client.post(f"{API}/accounts", headers=h, json={"bank": "Kaspi Bank", "name": "Gold", "kind": "current",
                                                       "balance": 30000}).json()
    assert kzt["rate"] is None and kzt["balanceKzt"] == 30000
    with SessionLocal() as db:  # totals for the engines are in tenge, the USD account converted
        user = db.query(User).filter(User.email == email).one()
        assert build_context(db, user, as_of()).balance == 470000 + 30000
    assert client.patch(f"{API}/accounts/{kzt['id']}", headers=h, json={"currency": "EUR"}).json()["rate"] == 520.0
    assert client.post(f"{API}/accounts", headers=h, json={"bank": "x", "name": "x", "kind": "cash",
                                                        "currency": "GBP"}).status_code == 422
    other, _ = _user(client)
    assert client.patch(f"{API}/accounts/{acc['id']}", headers=other, json={"currency": "KZT"}).status_code == 404


def test_statement_currency_comes_from_the_operations():
    rows = [ParsedRow(date(2026, 10, 1), -100, "a", "USD"), ParsedRow(date(2026, 10, 2), -200, "b", "USD"),
            ParsedRow(date(2026, 10, 3), -300, "c", "KZT")]
    assert statement_currency(ParsedStatement("Freedom Bank", "USD", rows)) == "USD"
    assert statement_currency(ParsedStatement("Kaspi Bank", "Gold", [])) == "KZT"
    assert statement_currency(ParsedStatement("x", "y", [ParsedRow(date(2026, 10, 1), -1, "a", "GBP")])) == "KZT"
