import pytest

from tests.conftest import API

BALANCE_KEYS = {"as_of", "model_version", "days", "riskDays", "payments"}


def get(client, auth, path):
    r = client.get(API + path, headers=auth)
    assert r.status_code == 200, (path, r.text)
    return r.json()


def test_healthz(client):
    assert client.get("/healthz").json()["status"] == "ok"


def test_login_and_wrong_password(client):
    assert client.post(f"{API}/auth/login", json={"email": "demo@zapas.kz", "password": "nope"}).status_code == 401
    r = client.post(f"{API}/auth/login", json={"email": "demo@zapas.kz", "password": "demo1234"})
    assert r.json()["onboarded"] is True and r.json()["user"]["city"] == "Алматы"


def test_register_conflict_and_validation(client, new_user):
    r = client.post(f"{API}/auth/register", json={"email": "bad", "password": "x", "name": ""})
    assert r.status_code == 422 and r.headers["content-type"].startswith("application/problem+json")
    me = client.get(f"{API}/me", headers=new_user).json()
    dup = client.post(f"{API}/auth/register", json={"email": me["email"], "password": "secret12", "name": "x"})
    assert dup.status_code == 409


def test_protected_routes_need_token(client):
    for path in ("/accounts", "/transactions", "/forecast/month-end", "/resilience", "/macro/overview"):
        assert client.get(API + path).status_code == 401
    assert client.get(API + "/accounts", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_contract_shapes(client, auth):
    acc = get(client, auth, "/accounts")
    assert {"id", "bank", "name", "currency", "balance"} <= acc[0].keys()
    tx = get(client, auth, "/transactions?limit=5")
    assert {"id", "date", "amount", "currency", "merchant", "categoryId", "accountId", "needsReview"} <= tx[0].keys()
    me = get(client, auth, "/forecast/month-end")
    assert {"as_of", "model_version", "month", "spentSoFar", "median", "low", "high", "prevMonth", "pacePerDay", "drivers"} <= me.keys()
    assert me["low"] <= me["median"] <= me["high"]
    bal = get(client, auth, "/forecast/balance?days=30")
    assert BALANCE_KEYS <= bal.keys() and len(bal["days"]) == 31
    r = get(client, auth, "/resilience")
    assert 0 <= r["score"] <= 100 and 0 <= r["pShortfall"] <= 1 and len(r["components"]) == 5
    assert {"personal", "official", "contributions"} <= get(client, auth, "/macro/personal-inflation").keys()
    assert {"code", "name", "value", "change", "trend", "why", "series"} <= get(client, auth, "/macro/overview")[0].keys()
    goals = get(client, auth, "/goals")
    assert {"etaMonth", "requiredMonthly", "onTrack", "goalId"} <= goals[0]["projection"].keys()
    cal = get(client, auth, "/obligations/calendar?months=12")
    assert len(cal["months"]) == 12 and cal["income"] > 0
    assert get(client, auth, "/scenarios/presets")[0]["shocks"]
    assert all({"id", "status", "title", "why", "action", "to"} <= i.keys() for i in get(client, auth, "/insights"))


def test_dashboard_excludes_internal_transfers(client, auth):
    txs = get(client, auth, "/transactions?limit=10000")
    internal = [t for t in txs if t["internal"]]
    assert internal, "seed should contain matched own-account transfers"
    month = "2026-09"
    s = get(client, auth, f"/dashboard/summary?month={month}")
    expected = sum(-t["amount"] for t in txs if t["date"].startswith(month) and t["amount"] < 0 and not t["internal"])
    assert s["expense"] == expected


def test_scenario_run_and_save(client, auth):
    r = client.post(f"{API}/scenarios/run", headers=auth, json={"shocks": [{"type": "jobloss", "value": 3}], "days": 60})
    assert r.status_code == 200
    body = r.json()
    assert len(body["base"]) == len(body["scenario"]) == 61 and len(body["deltas"]) >= 4
    assert body["scenario"][-1]["p50"] <= body["base"][-1]["p50"]
    assert client.post(f"{API}/scenarios/run", headers=auth, json={"shocks": [{"type": "fx", "value": 500}]}).status_code == 422
    assert client.post(f"{API}/scenarios", headers=auth, json={"name": "Мой сценарий", "shocks": [{"type": "fx", "value": 10}]}).status_code == 201
    assert get(client, auth, "/scenarios")[0]["name"] == "Мой сценарий"


def test_recategorize_and_bulk_rule(client, auth):
    review = [t for t in get(client, auth, "/transactions?limit=10000") if t["needsReview"]]
    assert review
    t = review[0]
    r = client.patch(f"{API}/transactions/{t['id']}", headers=auth, json={"category": "shopping"})
    assert r.status_code == 200 and r.json()["categoryId"] == "shopping" and not r.json()["needsReview"]
    assert client.patch(f"{API}/transactions/{t['id']}", headers=auth, json={"category": "nope"}).status_code == 422
    assert client.post(f"{API}/transactions/bulk-categorize", headers=auth,
                       json={"merchant": t["merchant"], "category": "other"}).json() == {"ok": True}
    rules = get(client, auth, "/merchant-rules")
    assert any(x["merchant"] == t["merchant"] for x in rules)


def test_goals_crud(client, new_user):
    assert client.post(f"{API}/goals", headers=new_user,
                       json={"name": "Ноутбук", "target": 600000, "saved": 100000, "monthly": 50000, "deadline": "2027-12"}).status_code == 201
    goals = get(client, new_user, "/goals")
    assert len(goals) == 1 and goals[0]["projection"]["etaMonth"]
    assert client.delete(f"{API}/goals/{goals[0]['id']}", headers=new_user).status_code == 200
    assert get(client, new_user, "/goals") == []


def test_users_are_isolated(client, auth, new_user):
    assert get(client, new_user, "/transactions") == []
    assert get(client, new_user, "/accounts") == []
    some_tx = get(client, auth, "/transactions?limit=1")[0]["id"]
    assert client.patch(f"{API}/transactions/{some_tx}", headers=new_user, json={"category": "food"}).status_code == 404
    ob = get(client, auth, "/obligations")[0]["id"]
    assert client.patch(f"{API}/obligations/{ob}", headers=new_user, json={"confirmed": True}).status_code == 404


def test_empty_user_endpoints_do_not_crash(client, new_user):
    for path in ("/forecast/month-end", "/forecast/balance?days=30", "/resilience", "/insights", "/macro/overview",
                 "/macro/personal-inflation", "/obligations/calendar", "/obligations/dti-history", "/dashboard/summary?month=2026-10"):
        assert client.get(API + path, headers=new_user).status_code == 200, path


def test_onboarding_import_flow(client, new_user):
    r = client.post(f"{API}/imports", headers=new_user, json={"bank": "Kaspi Bank"})
    assert r.status_code == 201
    rep = r.json()
    assert rep["status"] == "done" and rep["parsed"] > 50 and rep["period"]["from"] < rep["period"]["to"]
    # repeating the same import adds nothing (idempotent)
    again = client.post(f"{API}/imports", headers=new_user, json={"bank": "Kaspi Bank"}).json()
    assert again["parsed"] == 0
    # recurring payments and income were detected and wait for confirmation
    obs = get(client, new_user, "/obligations")
    assert {o["kind"] for o in obs} >= {"rent", "installment"} and not any(o["confirmed"] for o in obs)
    inc = get(client, new_user, "/income-sources")
    assert {i["name"] for i in inc} == {"ТОО «Технодом» — зарплата", "ТОО «Технодом» — аванс"}
    one = obs[0]
    assert client.patch(f"{API}/obligations/{one['id']}", headers=new_user, json={"confirmed": True}).json()["confirmed"] is True


def test_pdf_upload_is_not_implemented_yet(client, new_user):
    r = client.post(f"{API}/imports", headers=new_user, data={"bank": "Kaspi"}, files={"file": ("s.pdf", b"%PDF-1.4", "application/pdf")})
    assert r.status_code == 501


def test_delete_my_data(client, new_user):
    client.post(f"{API}/imports", headers=new_user, json={"bank": "Halyk"})
    assert get(client, new_user, "/transactions")
    assert client.delete(f"{API}/me", headers=new_user).json() == {"ok": True}
    assert get(client, new_user, "/transactions") == [] and get(client, new_user, "/obligations") == []


@pytest.mark.parametrize("path", ["/forecast/balance?days=3", "/dashboard/summary?month=2026-13", "/dashboard/summary?month=abc"])
def test_validation_errors(client, auth, path):
    assert client.get(API + path, headers=auth).status_code == 422
