"""Profile plan fields, accounts and checkpoints, user operation types, confirm/reject of regular events."""
from sqlalchemy import create_engine, inspect, text

from tests.conftest import API


def test_profile_unknown_is_null_not_zero(client, new_user):
    me = client.get(f"{API}/me", headers=new_user).json()
    assert me["timezone"] == "Asia/Almaty"
    assert me["plannedIncome"] is None and me["essentialExpenses"] is None and me["workHours"] is None
    r = client.patch(f"{API}/me", headers=new_user, json={"plannedIncome": 300000, "essentialExpenses": 0, "workHours": 160})
    assert r.status_code == 200
    assert r.json()["plannedIncome"] == 300000 and r.json()["essentialExpenses"] == 0  # an explicit 0 stays 0
    r = client.patch(f"{API}/me", headers=new_user, json={"city": "Астана"})
    assert r.json()["plannedIncome"] == 300000 and r.json()["city"] == "Астана"  # fields not sent are kept
    r = client.patch(f"{API}/me", headers=new_user, json={"essentialExpenses": None})
    assert r.json()["essentialExpenses"] is None
    assert client.patch(f"{API}/me", headers=new_user, json={"timezone": "Mars/Base"}).status_code == 422


def test_accounts_and_checkpoints(client, new_user):
    r = client.post(f"{API}/accounts", headers=new_user, json={"bank": "Наличные", "name": "Кошелёк", "kind": "cash"})
    assert r.status_code == 201
    acc = r.json()
    assert acc["confirmed"] is True and acc["balanceKnown"] is False and acc["balanceAsOf"] is None
    r = client.post(f"{API}/accounts/{acc['id']}/checkpoints", headers=new_user, json={"balance": 15000, "asOf": "2026-10-01"})
    assert r.status_code == 201
    assert r.json()["balance"] == 15000 and r.json()["balanceKnown"] and r.json()["balanceSource"] == "manual"
    # an older checkpoint is stored but does not replace the newer balance
    client.post(f"{API}/accounts/{acc['id']}/checkpoints", headers=new_user, json={"balance": 9000, "asOf": "2026-09-01"})
    assert client.get(f"{API}/accounts", headers=new_user).json()[0]["balance"] == 15000
    assert len(client.get(f"{API}/accounts/{acc['id']}/checkpoints", headers=new_user).json()) == 2
    future = client.post(f"{API}/accounts/{acc['id']}/checkpoints", headers=new_user, json={"balance": 1, "asOf": "2030-01-01"})
    assert future.status_code == 422
    r = client.patch(f"{API}/accounts/{acc['id']}", headers=new_user, json={"kind": "savings", "name": "Копилка"})
    assert r.json()["kind"] == "savings" and r.json()["name"] == "Копилка"


def test_import_proposes_accounts_with_statement_checkpoint(client, new_user):
    assert client.post(f"{API}/imports", headers=new_user, json={"bank": "kaspi"}).status_code == 201
    acc = client.get(f"{API}/accounts", headers=new_user).json()[0]
    assert acc["confirmed"] is False and acc["kind"] == "current"
    assert acc["balanceKnown"] and acc["balanceSource"] == "statement" and acc["balance"] == 486300
    client.post(f"{API}/imports", headers=new_user, json={"bank": "kaspi"})  # re-import: no duplicate checkpoint
    assert len(client.get(f"{API}/accounts/{acc['id']}/checkpoints", headers=new_user).json()) == 1


def test_user_kind_overrides_import_and_keeps_original(client, new_user):
    client.post(f"{API}/imports", headers=new_user, json={"bank": "kaspi"})
    txs = client.get(f"{API}/transactions", headers=new_user).json()
    rent = next(t for t in txs if t["merchant"] == "Аренда квартиры")
    assert rent["kind"] == "expense" and rent["kindSource"] == "auto"
    month = rent["date"][:7]
    before = client.get(f"{API}/dashboard/summary?month={month}", headers=new_user).json()["expense"]
    r = client.patch(f"{API}/transactions/{rent['id']}/kind", headers=new_user, json={"kind": "transfer_own", "saveRule": True})
    assert r.status_code == 200 and r.json()["kind"] == "transfer_own" and r.json()["kindSource"] == "user"
    assert r.json()["amount"] == rent["amount"] and r.json()["internal"] is False  # original untouched
    after = client.get(f"{API}/dashboard/summary?month={month}", headers=new_user).json()["expense"]
    assert after == before - abs(rent["amount"])
    same = [t for t in client.get(f"{API}/transactions?q=Аренда", headers=new_user).json() if t["merchant"] == "Аренда квартиры"]
    assert len(same) > 1 and all(t["kind"] == "transfer_own" for t in same)  # saved as a merchant rule
    r = client.patch(f"{API}/transactions/{rent['id']}/kind", headers=new_user, json={"kind": None})
    assert r.json()["kind"] == "expense" and r.json()["kindSource"] == "auto"
    assert client.patch(f"{API}/transactions/{rent['id']}/kind", headers=new_user, json={"kind": "gift"}).status_code == 422


def test_confirm_and_reject_regular_events(client, new_user):
    client.post(f"{API}/imports", headers=new_user, json={"bank": "kaspi"})
    obs = client.get(f"{API}/obligations", headers=new_user).json()
    assert obs and all(o["rejected"] is False for o in obs)
    r = client.patch(f"{API}/obligations/{obs[0]['id']}", headers=new_user, json={"rejected": True})
    assert r.json()["rejected"] and not r.json()["confirmed"]
    r = client.patch(f"{API}/obligations/{obs[0]['id']}", headers=new_user, json={"confirmed": True})
    assert r.json()["confirmed"] and not r.json()["rejected"]
    # two salary payouts a month with a varying amount
    r = client.post(f"{API}/income-sources", headers=new_user,
                    json={"name": "Зарплата, вторая часть", "amount": 300000, "amountMin": 300000, "amountMax": 500000, "dayOfMonth": 20})
    assert r.status_code == 201 and r.json()["confirmed"] and r.json()["amountMax"] == 500000
    bad = client.patch(f"{API}/income-sources/{r.json()['id']}", headers=new_user, json={"amountMin": 600000})
    assert bad.status_code == 422
    r = client.patch(f"{API}/income-sources/{r.json()['id']}", headers=new_user, json={"rejected": True})
    assert r.json()["rejected"]


def test_add_missing_columns_upgrades_an_old_database(tmp_path):
    from app.core.migrate import add_missing_columns

    eng = create_engine(f"sqlite:///{tmp_path}/old.db")
    with eng.begin() as c:
        c.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(255), name VARCHAR(120), city VARCHAR(80),"
                       " currency VARCHAR(3), password_hash VARCHAR(255), created_at DATETIME)"))
        c.execute(text("INSERT INTO users (id, email, name, city, currency, password_hash) VALUES (1, 'a@b.c', 'A', 'X', 'KZT', 'h')"))
        c.execute(text("CREATE TABLE income_sources (id INTEGER PRIMARY KEY, user_id INTEGER, name VARCHAR(200),"
                       " amount_minor BIGINT, day_of_month INTEGER, confirmed BOOLEAN, detected BOOLEAN)"))
        c.execute(text("INSERT INTO income_sources VALUES (1, 1, 'Salary', 100, 5, 1, 1)"))
    added = add_missing_columns(eng)
    assert "users.planned_income_minor" in added and "income_sources.rejected" in added
    cols = {c["name"] for c in inspect(eng).get_columns("users")}
    assert {"timezone", "planned_income_minor", "essential_expenses_minor", "work_hours_month"} <= cols
    with eng.connect() as c:
        row = c.execute(text("SELECT timezone, planned_income_minor FROM users")).one()
        assert row == ("Asia/Almaty", None)
        assert c.execute(text("SELECT rejected FROM income_sources")).scalar() in (0, False)
    assert add_missing_columns(eng) == []  # idempotent


def test_dev_user_is_synthetic_and_isolated(client):
    from app.core.db import SessionLocal
    from app.dev_user import TEST_EMAIL, TEST_PASSWORD, ensure_test_user

    with SessionLocal() as db:
        ensure_test_user(db)
        ensure_test_user(db, reset=True)  # reset regenerates the same history
    r = client.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert len(client.get(f"{API}/accounts", headers=h).json()) == 2
    assert client.get(f"{API}/me", headers=h).json()["plannedIncome"] is None
    demo = client.post(f"{API}/auth/login", json={"email": "demo@zapas.kz", "password": "demo1234"}).json()
    assert demo["user"]["email"] == "demo@zapas.kz" and demo["onboarded"]
