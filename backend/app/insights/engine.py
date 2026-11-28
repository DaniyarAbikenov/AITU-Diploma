"""Matching knowledge-base entries to computed signals, ranking and delivery (max cards, dedup, cooldown).

Order of work (global_policies): compute signals deterministically → match activation conditions → mandatory checks
(typed values, one snapshot and perimeter, related entities, freshness, ready && evidenceValid) → compound entries
replace primitives of the same root cause → priority tier → P196 rank inside a tier → max cards on the dashboard."""
import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.insights import kb as kb_mod
from app.insights.signals import REGISTRY, Signal, evaluate_all
from app.insights.snapshot import Snapshot
from app.models import InsightState, User

# priority tiers (global policy): data errors → overdue and cash gaps → month plan and reserve → goals → optimization
TIER_NAMES = ("Ошибки данных", "Просрочки и разрывы", "План месяца и резерв", "Цели", "Оптимизация")
PLAN_MODULES = {"cashflow", "monthly_plan", "reserve", "calendar", "debts", "income", "planned_events", "forecast",
                "deposits", "currencies"}
TAB = {"onboarding": "profile", "transactions": "transactions", "cashflow": "home", "income": "calendar",
       "monthly_plan": "calendar", "categories": "transactions", "subscriptions": "calendar", "debts": "debts",
       "reserve": "home", "goals": "goals", "planned_events": "calendar", "business": "profile",
       "spending_habits": "transactions", "forecast": "forecast", "currencies": "macro", "deposits": "profile",
       "decisions": "forecast", "calendar": "calendar"}
# sensitive wording: off until the user turns them on in the profile (addendum, review notes)
OPT_IN = {"K064", "K065", "K066", "K070", "K075", "K076"}
BUSINESS_REASON = "вне области продукта (физлица)"


@dataclass
class Card:
    key: str
    entry_id: str
    title: str
    text: str
    fact: str
    module: str
    tab: str
    action_label: str
    action_intent: str
    tier: int
    rank: float
    critical: bool
    signals: list[str]
    why: dict
    fingerprint: str
    supersedes: list[str] = field(default_factory=list)


def disabled_reason(entry: dict, settings: dict | None = None) -> str | None:
    """Why an entry is switched off (None = enabled). Evaluator availability is checked separately."""
    settings = settings or {}
    if entry["id"] in OPT_IN and not settings.get("sensitive_insights", {}).get(entry["id"]):
        return "выключено по умолчанию: включается в профиле (чувствительная тема)"
    if entry["module"] == "business":
        return BUSINESS_REASON
    if entry["rollout"] == "P1":
        return "этап P1: будет подключено позже"
    return None


FEATURES: dict = {}  # derived features of the dictionary with an evaluator (none yet: all unknown)


def _missing_signals(entry: dict) -> list[str]:
    return sorted(s for s in kb_mod.referenced_signals(entry) if s not in REGISTRY)


def _missing_features(entry: dict) -> list[str]:
    return sorted({c["fact"].split(".", 1)[1] for c in entry["activation"]["all"]
                   if c["fact"].startswith("features.") and c["fact"].split(".", 1)[1] not in FEATURES})


def _fact(path: str, signals: dict[str, Signal], features: dict):
    """Value of a fact or None (unknown). signals.R001.ready / features.someFeature."""
    head, *rest = path.split(".")
    if head == "signals" and len(rest) == 2:
        sig = signals.get(rest[0])
        if sig is None or sig.unavailable:
            return None
        return {"ready": sig.ready, "triggered": sig.triggered, "evidenceValid": sig.evidence_valid}.get(rest[1])
    if head == "features" and len(rest) == 1:
        return features.get(rest[0])
    return None


def _holds(cond: dict, value, base: kb_mod.KnowledgeBase) -> bool:
    if value is None:  # unknown never satisfies (unknown_suppresses), also not "== false"
        return False
    op = cond["op"]
    if op == "eq":
        return type(value) is type(cond["value"]) and value == cond["value"]
    target = base.config(cond["config_key"]) if op == "gte_config" else cond.get("value")
    if not isinstance(value, (int, float)) or isinstance(value, bool) or target is None:
        return False
    return value > target if op == "gt" else value >= target


def matches(entry: dict, signals: dict[str, Signal], features: dict, base: kb_mod.KnowledgeBase) -> bool:
    if not all(_holds(c, _fact(c["fact"], signals, features), base) for c in entry["activation"]["all"]):
        return False
    used = [signals[s] for s in kb_mod.referenced_signals(entry)]
    # mandatory checks: every referenced signal ready and evidenceValid, one snapshot (same period) and perimeter
    if not used or not all(s.usable for s in used):
        return False
    return len({s.period for s in used}) == 1


def _tier(entry: dict, sigs: list[Signal]) -> int:
    if entry["entry_type"] == "data_clarification":
        return 0
    if any(s.critical for s in sigs):
        return 1
    if entry["module"] in PLAN_MODULES:
        return 2
    if entry["module"] == "goals":
        return 3
    return 4


def _fingerprint(sigs: list[Signal]) -> str:
    raw = json.dumps([s.values for s in sigs], sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()


def build_cards(s: Snapshot, settings: dict | None = None) -> list[Card]:
    base = kb_mod.load()
    active = [e for e in base.entries if disabled_reason(e, settings) is None]
    needed = set().union(*(kb_mod.referenced_signals(e) for e in active)) if active else set()
    signals = evaluate_all(s, needed)
    features: dict = {}  # derived features of the dictionary: unknown until their evaluators exist
    cards: list[Card] = []
    for e in active:
        if not matches(e, signals, features, base):
            continue
        sigs = [signals[x] for x in sorted(kb_mod.referenced_signals(e))]
        facts = [x.summary for x in sigs if x.summary]
        if len(facts) < len(sigs):  # evidence policy: every clause needs a server fact, else no insight
            continue
        main = sigs[0]
        key = f"{e['id']}:{main.root_cause or main.id}:{main.entity}:{main.period}"
        fact = " ".join(facts)
        cr = e.get("calculation_reference") or {}
        cards.append(Card(
            key=key, entry_id=e["id"], title=e["title"], text=f"{e['message']['base_text']} {fact}", fact=fact,
            module=e["module"], tab=TAB.get(e["action"]["target_module"], TAB.get(e["module"], "home")),
            action_label=e["action"]["label"], action_intent=e["action"]["intent"], tier=_tier(e, sigs), rank=0.0,
            critical=any(x.critical for x in sigs), signals=[x.id for x in sigs],
            why={"signal": cr.get("id"), "formula": cr.get("formula") or "составная: " + " и ".join(x.id for x in sigs),
                 "inputs": {x.id: x.values for x in sigs}, "evidence": sum((x.evidence_ids for x in sigs), [])[:20],
                 "asOf": s.as_of.isoformat(), "kbVersion": base.version, "entryVersion": e["version"],
                 "status": e.get("validation_status")},
            fingerprint=_fingerprint(sigs),
            supersedes=sorted(kb_mod.referenced_signals(e)) if e["entry_type"] == "compound_insight" else []))
    # a compound entry replaces the primitive cards of the same root cause (its own signals)
    covered = {sig for c in cards for sig in c.supersedes}
    cards = [c for c in cards if c.supersedes or not (set(c.signals) & covered)]
    # P196 inside a tier: 0.45*impact + 0.25*urgency + 0.20*evidence - 0.10*effort
    impact_max = max((signals[c.signals[0]].impact_minor for c in cards), default=0) or 1
    for c in cards:
        sig = signals[c.signals[0]]
        c.rank = round(0.45 * sig.impact_minor / impact_max + 0.25 * sig.urgency + 0.20 * sig.evidence
                       - 0.10 * sig.effort, 4)
    # dedup by key (same root cause, entity, period): keep the best
    best: dict[str, Card] = {}
    for c in cards:
        k = c.key.split(":", 1)[1]
        if k not in best or (c.tier, -c.rank) < (best[k].tier, -best[k].rank):
            best[k] = c
    return sorted(best.values(), key=lambda c: (c.tier, -c.rank))


def _states(db: Session, user: User) -> dict[str, InsightState]:
    return {r.key: r for r in db.scalars(select(InsightState).where(InsightState.user_id == user.id))}


def deliver(db: Session, user: User, cards: list[Card], surface: str) -> list[Card]:
    """Hidden/snoozed cards stay away until their time or a material change; critical ones stay in the calendar."""
    now = datetime.now(timezone.utc)
    states = _states(db, user)
    out = []
    for c in cards:
        st = states.get(c.key)
        until = st.until if st and st.until.tzinfo else (st.until.replace(tzinfo=timezone.utc) if st else None)
        if st and until > now and st.fingerprint == c.fingerprint:
            if not (c.critical and surface == "calendar"):
                continue
        out.append(c)
    if surface == "dashboard":
        out = out[: int(kb_mod.load().config("max_cards_on_dashboard") or 3)]
    if surface == "calendar":
        out = [c for c in out if c.critical or c.module in ("calendar", "planned_events")]
    return out


def set_state(db: Session, user: User, key: str, state: str, days: int, fingerprint: str) -> None:
    until = datetime.now(timezone.utc) + timedelta(days=days)
    row = db.scalar(select(InsightState).where(InsightState.user_id == user.id, InsightState.key == key))
    if row is None:
        row = InsightState(user_id=user.id, key=key)
        db.add(row)
    row.state, row.until, row.fingerprint = state, until, fingerprint
    db.commit()


def catalog(settings: dict | None = None) -> dict:
    """Which entries are enabled, which are not and why (no evaluation of user data)."""
    base = kb_mod.load()
    enabled, disabled = [], []
    for e in base.entries:
        reason = disabled_reason(e, settings)
        if reason is None and _missing_signals(e):
            reason = "нужен вычислитель сигналов: " + ", ".join(_missing_signals(e))
        if reason is None and _missing_features(e):
            reason = "нужны данные: признаки " + ", ".join(_missing_features(e))
        (disabled if reason else enabled).append({"id": e["id"], "title": e["title"], "module": e["module"],
                                                  "rollout": e["rollout"], "reason": reason})
    return {"version": base.version, "addendumVersion": base.addendum_version, "title": base.title,
            "entries": len(base.entries), "enabled": enabled, "disabled": disabled,
            "signalsImplemented": len(REGISTRY), "signalsTotal": len(base.signal_formulas),
            "noncriticalCooldownDays": base.config("noncritical_cooldown_days"),
            "maxCardsOnDashboard": base.config("max_cards_on_dashboard")}
