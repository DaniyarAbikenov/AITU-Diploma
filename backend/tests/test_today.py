"""What "today" is and where the spending horizon ends (the server was pinned to 2026-10-20 for real users once)."""
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from app.core import config
from app.services.safe_to_spend import compute
from tests.conftest import API


def plan(today, incomes):
    return compute(date.fromisoformat(today), 100_000_00, incomes, [])


@pytest.mark.parametrize("today,incomes,until,horizon", [
    ("2026-11-29", [1, 15], "2026-11-30", "income"),       # next payout 1 December
    ("2026-11-29", [15, 20], "2026-12-14", "income"),      # both November payouts are in the past
    ("2026-11-29", [], "2026-11-30", "month-end"),
    ("2026-11-29", [29], "2026-12-28", "income"),          # payout today: the next one is in December
    ("2026-11-15", [1, 15], "2026-11-30", "income"),       # payout today and another one later
    ("2026-11-30", [1], "2026-11-30", "income"),           # one day
    ("2026-11-30", [], "2026-11-30", "month-end"),
    ("2026-12-31", [1], "2026-12-31", "income"),           # across the year
    ("2026-02-27", [31], "2026-02-27", "income"),          # 31st is 28 February
    ("2026-02-28", [31], "2026-03-30", "income"),          # payout today, next on 31 March
    ("2028-02-28", [30], "2028-02-28", "income"),          # leap year: 29 February
    ("2026-02-10", [], "2026-02-28", "month-end"),
])
def test_horizon_starts_today_and_ends_before_the_next_future_payout(today, incomes, until, horizon):
    r = plan(today, incomes)
    assert (r.until.isoformat(), r.horizon) == (until, horizon)
    assert r.days >= 1 and r.until >= date.fromisoformat(today)
    assert r.next_income is None or r.next_income > date.fromisoformat(today)


def test_horizon_is_never_in_the_past_for_any_day_of_two_years():
    for n in range(date(2027, 1, 1).toordinal(), date(2029, 1, 1).toordinal()):
        d = date.fromordinal(n)
        for incomes in ([], [1], [15], [1, 15], [29], [30], [31], [d.day]):
            r = compute(d, 1, incomes, [])
            assert r.until >= d and r.days >= 1


def test_midnight_in_almaty_is_not_midnight_in_utc():
    at = lambda h, m: datetime(2026, 11, 28, h, m, tzinfo=timezone.utc)  # noqa: E731
    assert config.today_in("Asia/Almaty", at(18, 59)) == date(2026, 11, 28)
    assert config.today_in("Asia/Almaty", at(19, 0)) == date(2026, 11, 29)
    assert config.today_in(None, at(19, 45)) == date(2026, 11, 29)  # the profile default
    assert config.today_in("UTC", at(19, 45)) == date(2026, 11, 28)


def test_demo_date_pins_only_the_demo_account(monkeypatch):
    monkeypatch.delenv("APP_AS_OF")
    monkeypatch.setenv("DEMO_AS_OF", "2026-10-20")
    demo = SimpleNamespace(email=config.DEMO_EMAIL, timezone="Asia/Almaty")
    real = SimpleNamespace(email="someone@example.com", timezone="Asia/Almaty")
    assert config.as_of(demo) == date(2026, 10, 20)
    assert config.as_of(real) == config.today_in("Asia/Almaty") and config.pinned_today(real) is None
    assert config.as_of() == config.today_in(None)


def test_money_plan_calendar_and_forecast_use_the_real_date_of_a_real_user(client, monkeypatch):
    r = client.post(f"{API}/auth/register", json={"email": f"t-{uuid.uuid4().hex[:8]}@example.com", "password": "secret12", "name": "Т"})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    monkeypatch.delenv("APP_AS_OF")
    monkeypatch.setenv("DEMO_AS_OF", "2026-10-20")
    monkeypatch.setattr(config, "today_in", lambda tz, now=None: date(2026, 11, 29))
    a = client.post(f"{API}/accounts", headers=h, json={"bank": "Kaspi", "name": "Gold", "kind": "current", "balance": 100_000,
                                                       "balanceAsOf": "2026-11-29"})
    assert a.status_code == 201
    assert client.post(f"{API}/accounts/{a.json()['id']}/checkpoints", headers=h,
                       json={"balance": 100_000, "asOf": "2026-11-29", "source": "manual"}).status_code == 201
    client.post(f"{API}/daily-needs", headers=h, json={"name": "Еда", "amount": 1000})
    p = client.get(f"{API}/money-plan", headers=h).json()
    assert p["asOf"] == "2026-11-29" and p["plan"]["until"] == "2026-11-30" and p["plan"]["needs"] == 2000
    for d in (1, 15):
        client.post(f"{API}/income-sources", headers=h, json={"name": f"ЗП{d}", "amount": 300_000, "dayOfMonth": d})
    p = client.get(f"{API}/money-plan", headers=h).json()
    assert p["plan"]["until"] == "2026-11-30" and p["plan"]["horizon"] == "income"
    # 1 000 a day on 29 and 30 November and on 1 December: a payout of the 1st is usable from the 2nd
    assert p["setAside"]["free"] == 97_000
    cal = client.get(f"{API}/obligations/calendar?months=1", headers=h).json()
    assert cal["months"][0]["month"] == "2026-12"
    client.post(f"{API}/transactions", headers=h, json={"accountId": a.json()["id"], "date": "2026-11-28", "amount": -500,
                                                       "merchant": "x", "kind": "expense"})
    f = client.get(f"{API}/forecast/month-end", headers=h).json()
    assert f["as_of"] == "2026-11-29" and f["month"] == "2026-11"
    assert client.get(f"{API}/forecast/balance", headers=h).json()["days"][0]["date"] >= "2026-11-29"
