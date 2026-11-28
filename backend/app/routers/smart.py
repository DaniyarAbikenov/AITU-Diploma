"""Smart insights from the knowledge base: catalog, cards for the user, hide and snooze."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import current_user
from app.insights import engine
from app.insights.snapshot import Snapshot
from app.models import User
from app.schemas import Ok

router = APIRouter(prefix="/insights", tags=["insights"])


class SmartCardOut(BaseModel):
    key: str
    entryId: str
    title: str
    text: str
    fact: str
    module: str
    tab: str
    actionLabel: str
    actionIntent: Literal["review_data", "review_scenario"]
    tier: int
    tierName: str
    rank: float
    critical: bool
    why: dict


class StateIn(BaseModel):
    key: str = Field(min_length=1, max_length=200)
    days: int = Field(default=7, ge=1, le=90)


def _settings(u: User) -> dict:
    return u.insight_settings or {}


def _cards(db: Session, u: User) -> list[engine.Card]:
    return engine.build_cards(Snapshot(db, u), _settings(u))


@router.get("/knowledge-base")
def knowledge_base(u: User = Depends(current_user)):
    """Version, number of entries, which are on and off and why. Nothing is evaluated."""
    return engine.catalog(_settings(u))


@router.get("/smart", response_model=list[SmartCardOut])
def smart(surface: Literal["dashboard", "calendar", "all"] = "dashboard", u: User = Depends(current_user),
          db: Session = Depends(get_db)):
    cards = engine.deliver(db, u, _cards(db, u), surface)
    return [SmartCardOut(key=c.key, entryId=c.entry_id, title=c.title, text=c.text, fact=c.fact, module=c.module,
                         tab=c.tab, actionLabel=c.action_label, actionIntent=c.action_intent, tier=c.tier,
                         tierName=engine.TIER_NAMES[c.tier], rank=c.rank, critical=c.critical, why=c.why)
            for c in cards]


def _state(db: Session, u: User, body: StateIn, state: str, days: int) -> Ok:
    card = next((c for c in _cards(db, u) if c.key == body.key), None)
    if card is None:
        raise ApiError(404, "Подсказка не найдена")
    engine.set_state(db, u, body.key, state, days, card.fingerprint)
    return Ok()


@router.post("/smart/hide", response_model=Ok)
def hide(body: StateIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Hide for the cooldown (7 days for non-critical); it comes back earlier if its facts change materially."""
    return _state(db, u, body, "hidden", int(engine.kb_mod.load().config("noncritical_cooldown_days") or 7))


@router.post("/smart/snooze", response_model=Ok)
def snooze(body: StateIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    return _state(db, u, body, "snoozed", body.days)


class SettingsIn(BaseModel):
    """thresholds: {key: value | null} (null = back to the default); sensitive: {entry id: on/off}."""
    thresholds: dict[str, float | None] = {}
    sensitive: dict[str, bool] = {}


def _settings_out(u: User) -> dict:
    from app.insights import kb as kb_mod
    from app.insights import settings as th

    base = kb_mod.load()
    on = (u.insight_settings or {}).get("sensitive_insights", {})
    return {"thresholds": th.describe(u.insight_settings),
            "sensitive": [{"id": i, "title": base.entry(i)["title"], "enabled": bool(on.get(i))}
                          for i in sorted(engine.OPT_IN)]}


@router.get("/settings")
def get_settings(u: User = Depends(current_user)):
    return _settings_out(u)


@router.patch("/settings")
def patch_settings(body: SettingsIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.insights import settings as th

    cur = dict(u.insight_settings or {})
    thresholds = dict(cur.get("thresholds", {}))
    for k, v in body.thresholds.items():
        spec = th.DEFAULTS.get(k)
        if spec is None:
            raise ApiError(422, f"Неизвестная настройка: {k}")
        if v is None:
            thresholds.pop(k, None)
            continue
        if v < 0 or (spec["unit"] == "share" and v > 1) or (spec["unit"] in ("days", "months") and v > 3650):
            raise ApiError(422, f"Недопустимое значение для «{spec['label']}»")
        thresholds[k] = int(v * 100) if spec["unit"] == "money" else (int(v) if spec["unit"] in ("days", "months") else v)
    sensitive = dict(cur.get("sensitive_insights", {}))
    for k, v in body.sensitive.items():
        if k not in engine.OPT_IN:
            raise ApiError(422, f"Запись {k} не относится к чувствительным")
        sensitive[k] = v
    u.insight_settings = {**cur, "thresholds": thresholds, "sensitive_insights": sensitive}
    db.commit()
    return _settings_out(u)
