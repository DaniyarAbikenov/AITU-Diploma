"""Knowledge base of smart insights: loading, validation, matching rules and delivery."""
import copy
import json
import uuid

from app.insights import engine, kb
from app.insights.signals import Signal
from tests.conftest import API


def _user(client, synthetic=True):
    r = client.post(f"{API}/auth/register", json={"email": f"kb-{uuid.uuid4().hex[:8]}@example.com",
                                                 "password": "secret12", "name": "Тест"})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    if synthetic:
        client.post(f"{API}/imports", headers=h, json={"bank": "kaspi"})
    return h


def test_knowledge_base_loads_and_is_valid():
    base = kb.load()
    assert base.version == "1.0.0" and base.addendum_version == "1.1.0"
    assert len(base.entries) == 204 and len(base.signal_formulas) == 194  # 190 + addendum A001–A004
    raw = json.loads(kb.KB_FILE.read_text(encoding="utf-8"))
    assert kb.validate(raw) == []
    bad = copy.deepcopy(raw)
    bad["entries"][1]["id"] = bad["entries"][0]["id"]
    bad["entries"][2]["activation"]["all"][0]["op"] = "regex"
    bad["entries"][3]["activation"]["all"][0]["fact"] = "signals.R999.ready"
    problems = " ".join(kb.validate(bad))
    assert "повторяющиеся" in problems and "regex" in problems and "R999" in problems


def test_unknown_never_satisfies_a_condition():
    base = kb.load()
    e = base.entry("K001")
    unknown = {"R001": Signal("R001", unavailable="нет данных")}
    assert engine.matches(e, unknown, {}, base) is False
    not_ready = {"R001": Signal("R001", ready=False, triggered=True, evidence_valid=True)}
    assert engine.matches(e, not_ready, {}, base) is False
    ok = {"R001": Signal("R001", ready=True, triggered=True, evidence_valid=True, period="2026-10")}
    assert engine.matches(e, ok, {}, base) is True
    # "== false" with an unknown fact does not pass either
    assert engine._holds({"op": "eq", "value": False}, None, base) is False
    assert engine._holds({"op": "gte_config", "config_key": "frequent_withdrawals_count"}, 5, base) is True
    assert engine._holds({"op": "gt", "value": 0}, True, base) is False  # typed values: a bool is not a number


def test_catalog_explains_disabled_entries(client):
    h = _user(client, synthetic=False)
    c = client.get(f"{API}/insights/knowledge-base", headers=h).json()
    assert c["version"] == "1.0.0" and c["entries"] >= 200
    assert len(c["enabled"]) + len(c["disabled"]) == c["entries"]
    reasons = {d["id"]: d["reason"] for d in c["disabled"]}
    assert "P1" in reasons["K032"] and all(reasons[k] == "вне области продукта (физлица)" for k in ("K161", "K170", "K192")) and "профиле" in reasons["K064"]
    assert any(e["id"] == "K001" for e in c["enabled"])


def test_cards_with_facts_hide_snooze_and_ownership(client):
    h = _user(client)
    cards = client.get(f"{API}/insights/smart?surface=all", headers=h).json()
    k001 = next(c for c in cards if c["entryId"] == "K001")
    assert "не хватает" in k001["fact"] and k001["tab"] == "profile" and k001["tierName"] == "Ошибки данных"
    assert k001["why"]["formula"].startswith("q =") and k001["why"]["kbVersion"] == "1.0.0"
    dash = client.get(f"{API}/insights/smart", headers=h).json()
    assert len(dash) <= 3
    assert client.post(f"{API}/insights/smart/hide", headers=h, json={"key": k001["key"]}).status_code == 200
    assert all(c["key"] != k001["key"] for c in client.get(f"{API}/insights/smart?surface=all", headers=h).json())
    # a material change of the facts brings it back before the cooldown ends
    client.patch(f"{API}/me", headers=h, json={"essentialExpenses": 250000})
    again = client.get(f"{API}/insights/smart?surface=all", headers=h).json()
    assert any(c["entryId"] == "K001" for c in again)
    # keys are per user: another user hiding the "same" key changes only their own cards
    other = _user(client, synthetic=False)
    client.post(f"{API}/insights/smart/hide", headers=other, json={"key": k001["key"]})
    assert any(c["entryId"] == "K001" for c in client.get(f"{API}/insights/smart?surface=all", headers=h).json())
    assert client.post(f"{API}/insights/smart/hide", headers=other, json={"key": "K999:x"}).status_code == 404


def test_settings_defaults_change_reset_and_opt_in(client):
    h = _user(client, synthetic=False)
    st = client.get(f"{API}/insights/settings", headers=h).json()
    mat = next(t for t in st["thresholds"] if t["key"] == "materialityMinor")
    assert mat["isDefault"] and mat["value"] == 5000
    assert {x["id"] for x in st["sensitive"]} == {"K064", "K065", "K066", "K070", "K075", "K076"}
    r = client.patch(f"{API}/insights/settings", headers=h, json={"thresholds": {"materialityMinor": 2000, "targetReserveMonths": 6},
                                                                   "sensitive": {"K070": True}}).json()
    mat = next(t for t in r["thresholds"] if t["key"] == "materialityMinor")
    assert mat["value"] == 2000 and not mat["isDefault"]
    assert next(x for x in r["sensitive"] if x["id"] == "K070")["enabled"]
    cat = client.get(f"{API}/insights/knowledge-base", headers=h).json()
    assert "K070" not in {d["id"]: d for d in cat["disabled"] if "профиле" in (d["reason"] or "")}
    r = client.patch(f"{API}/insights/settings", headers=h, json={"thresholds": {"materialityMinor": None}}).json()
    assert next(t for t in r["thresholds"] if t["key"] == "materialityMinor")["isDefault"]
    assert client.patch(f"{API}/insights/settings", headers=h, json={"thresholds": {"debtCap": 5}}).status_code == 422
    assert client.patch(f"{API}/insights/settings", headers=h, json={"sensitive": {"K001": True}}).status_code == 422
