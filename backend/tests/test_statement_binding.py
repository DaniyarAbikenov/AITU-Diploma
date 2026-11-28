"""Which account a statement goes to: number mask from the header, name fallback, user's choice, moving operations."""
import uuid
from datetime import date

import pytest

from app.core.db import SessionLocal
from app.models import Account, Transaction, User
from app.parsers.base import ParsedRow, ParsedStatement, find_mask
from app.services import imports
from tests.conftest import API


def _user(client):
    email = f"bind-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/register", json={"email": email, "password": "secret12", "name": "Тест"})
    return {"Authorization": f"Bearer {r.json()['token']}"}, email


def _st(name="Kaspi Gold", mask=None, day=1, amount=-1000, bank="Kaspi Bank", balance=50000):
    return ParsedStatement(bank=bank, account_name=name, account_mask=mask, closing_balance_minor=balance * 100,
                           rows=[ParsedRow(date(2026, 9, day), amount * 100, f"Магазин {day}")],
                           period_from=date(2026, 9, 1), period_to=date(2026, 9, 30))


def _db_user(db, email):
    return db.query(User).filter(User.email == email).one()


def test_mask_from_header_keeps_only_the_last_digits():
    assert find_mask("Счёт KZ12722S000012345678") == "*5678"
    assert find_mask("Карта 4400 **** **** 9012") == "*9012"
    assert find_mask("Выписка по Kaspi Gold за период") is None


def test_number_link_survives_renaming_and_two_cards_do_not_merge(client):
    h, email = _user(client)
    with SessionLocal() as db:
        u = _db_user(db, email)
        a = imports.import_statement(db, u, _st(name="Halyk карта *1111", mask="*1111", bank="Halyk Bank"), "pdf")
        acc = db.get(Account, a.account_id)
        assert acc.number_mask == "*1111" and acc.statement_key == "Halyk Bank|*1111"
        acc.name = "Моя зарплатная"  # renamed in the profile
        db.commit()
        b = imports.import_statement(db, u, _st(name="Halyk карта *1111", mask="*1111", bank="Halyk Bank", day=2), "pdf")
        assert b.account_id == acc.id  # still found by the number
        c = imports.import_statement(db, u, _st(name="Halyk карта *2222", mask="*2222", bank="Halyk Bank"), "pdf")
        assert c.account_id != acc.id  # another card: another account
    accs = client.get(f"{API}/accounts", headers=h).json()
    assert sorted(a["numberMask"] for a in accs) == ["*1111", "*2222"]


def test_without_a_number_the_user_choice_wins(client):
    h, email = _user(client)
    own = client.post(f"{API}/accounts", headers=h, json={"bank": "Kaspi Bank", "name": "Мой Kaspi", "kind": "current"}).json()
    with SessionLocal() as db:
        u = _db_user(db, email)
        acc, how = imports.match_account(db, u, _st())
        assert acc is None and how is None  # name differs: nothing is glued silently
        b = imports.import_statement(db, u, _st(), "pdf", target=own["id"])
        assert b.account_id == int(own["id"])
        assert db.get(Account, b.account_id).statement_key == "Kaspi Bank|name:Kaspi Gold"
        acc, how = imports.match_account(db, u, _st(day=3))
        assert acc.id == int(own["id"]) and how == "name"  # remembered, but still marked as a name match
        new = imports.import_statement(db, u, _st(day=4), "pdf", target="new")
        assert new.account_id != int(own["id"])
        other, other_email = _user(client)
        with pytest.raises(LookupError):
            imports.import_statement(db, _db_user(db, other_email), _st(), "pdf", target=own["id"])


def test_existing_accounts_get_a_key_from_their_name_without_touching_operations(client):
    h, email = _user(client)
    client.post(f"{API}/imports", headers=h, json={"bank": "kaspi"})
    with SessionLocal() as db:
        u = _db_user(db, email)
        acc = db.query(Account).filter(Account.user_id == u.id).one()
        n_tx = db.query(Transaction).filter(Transaction.user_id == u.id).count()
        acc.statement_key = None  # as an account created before keys existed
        db.commit()
        assert imports.backfill_statement_keys(db) >= 1
        db.refresh(acc)
        assert acc.statement_key == "Kaspi Bank|name:Kaspi Gold"
        assert db.query(Transaction).filter(Transaction.user_id == u.id).count() == n_tx


def test_move_operations_to_another_account(client):
    h, _ = _user(client)
    client.post(f"{API}/imports", headers=h, json={"bank": "kaspi"})
    src = client.get(f"{API}/accounts", headers=h).json()[0]
    dst = client.post(f"{API}/accounts", headers=h, json={"bank": "Kaspi Bank", "name": "Правильный", "kind": "current"}).json()
    n = len(client.get(f"{API}/transactions?account={src['id']}", headers=h).json())
    assert client.post(f"{API}/accounts/{src['id']}/move-operations", headers=h, json={"targetAccountId": dst["id"]}).status_code == 200
    assert len(client.get(f"{API}/transactions?account={dst['id']}", headers=h).json()) == n
    assert client.get(f"{API}/transactions?account={src['id']}", headers=h).json() == []
    other, _ = _user(client)
    r = client.post(f"{API}/accounts/{dst['id']}/move-operations", headers=other, json={"targetAccountId": src["id"]})
    assert r.status_code == 404
