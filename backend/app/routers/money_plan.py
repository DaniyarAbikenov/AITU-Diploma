"""Overview plan, everyday needs and the user's rules for splitting a payout. Nothing here moves money."""
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.core.money import to_major, to_minor
from app.core.security import current_user
from app.insights.snapshot import Snapshot
from app.models import AllocationRule, DailyNeed, IncomeAllocation, Transaction, User
from app.schemas import Ok
from app.services import money_plan as svc

router = APIRouter(tags=["planning"])
PROPOSAL_DAYS = 14


class NeedIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    amount: float = Field(gt=0, le=1e9)
    period: Literal["day", "month"] = "day"
    coveredBy: str | None = Field(default=None, pattern=r"^(ob|pl)_\d+$")


class RuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["tax", "reserve", "goals"]
    mode: Literal["percent", "fixed"]
    value: float = Field(gt=0, le=1e9)


def _need(n: DailyNeed, s: Snapshot) -> dict:
    return {"id": str(n.id), "name": n.name, "amount": to_major(n.amount_minor), "period": n.period,
            "coveredBy": n.covered_by, "skipped": s._covered(n)}


def _items(items: list[dict]) -> list[dict]:
    return [{"type": x["type"], "id": x.get("id"), "name": x["name"], "amount": to_major(x["amountMinor"])} for x in items]


@router.get("/money-plan")
def money_plan(u: User = Depends(current_user), db: Session = Depends(get_db)):
    s = Snapshot(db, u)
    st, aside, sug = s.sts, svc.set_aside(s), svc.suggested_daily_minor(s)
    foreign = sum(s.available_kzt_minor(a) for a in s.usable_accounts
                  if a.kind in ("current", "cash") and a.currency != "KZT")
    return {
        "asOf": s.as_of.isoformat(),
        "liquid": None if s.liquid_minor is None else to_major(s.liquid_minor), "liquidForeign": to_major(foreign),
        "protected": to_major(s.protected_minor),
        "plan": None if st is None else {
            "days": st.days, "until": st.until.isoformat(), "horizon": st.horizon, "committed": to_major(st.committed_minor),
            "needs": to_major(st.needs_minor), "safeDaily": to_major(st.safe_daily_minor),
            "deficit": to_major(st.deficit_minor)},
        "needs": [_need(n, s) for n in s.needs], "needToday": to_major(round(s.need_on(s.as_of))) if s.needs else None,
        "suggestedDaily": None if sug is None else to_major(sug),
        "setAside": {"amount": None if aside["amountMinor"] is None else to_major(aside["amountMinor"]),
                     "free": None if aside["freeMinor"] is None else to_major(aside["freeMinor"]),
                     "missing": aside["missing"], "items": _items(aside["items"]), "days": svc.SET_ASIDE_DAYS,
                     "hasTargets": bool(svc.targets(s))}}


@router.post("/daily-needs", status_code=201, response_model=Ok)
def add_need(body: NeedIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    db.add(DailyNeed(user_id=u.id, name=body.name.strip(), amount_minor=to_minor(body.amount), period=body.period,
                     covered_by=body.coveredBy))
    db.commit()
    return Ok()


def _own_need(db: Session, u: User, need_id: int) -> DailyNeed:
    n = db.get(DailyNeed, need_id)
    if n is None or n.user_id != u.id:
        raise ApiError(404, "Потребность не найдена")
    return n


@router.put("/daily-needs/{need_id}", response_model=Ok)
def put_need(need_id: int, body: NeedIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    n = _own_need(db, u, need_id)
    n.name, n.amount_minor, n.period, n.covered_by = body.name.strip(), to_minor(body.amount), body.period, body.coveredBy
    db.commit()
    return Ok()


@router.delete("/daily-needs/{need_id}", response_model=Ok)
def delete_need(need_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own_need(db, u, need_id))
    db.commit()
    return Ok()


def _rules(db: Session, u: User) -> list[AllocationRule]:
    return list(db.scalars(select(AllocationRule).where(AllocationRule.user_id == u.id).order_by(AllocationRule.position)))


def _rule(r: AllocationRule) -> dict:
    return {"name": r.name, "kind": r.kind, "mode": r.mode, "value": r.value / 100}


@router.get("/allocation-rules")
def rules(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return [_rule(r) for r in _rules(db, u)]


@router.put("/allocation-rules")
def put_rules(body: list[RuleIn], u: User = Depends(current_user), db: Session = Depends(get_db)):
    if len(body) > 20:
        raise ApiError(422, "Не больше 20 правил")
    if sum(r.value for r in body if r.mode == "percent") > 100:
        raise ApiError(422, "Сумма процентов больше 100")
    db.execute(delete(AllocationRule).where(AllocationRule.user_id == u.id))
    for i, r in enumerate(body):
        db.add(AllocationRule(user_id=u.id, position=i, name=r.name.strip(), kind=r.kind, mode=r.mode,
                              value=round(r.value * 100)))
    db.commit()
    return [_rule(r) for r in _rules(db, u)]


def _split(s: Snapshot, rules: list[AllocationRule], amount: int) -> tuple[list[dict], int]:
    left, where = amount, {t["type"] + str(t["id"]): dict(t) for t in svc.targets(s)}
    out: list[dict] = []
    for r in rules:
        want = min(left, amount * r.value // 10_000 if r.mode == "percent" else r.value)
        if r.kind == "tax":
            got = [{"type": "tax", "id": None, "name": r.name, "amountMinor": want}] if want else []
        else:
            kind = "reserve" if r.kind == "reserve" else "goal"
            got = svc.distribute(want, [t for t in where.values() if t["type"] == kind])
            for g in got:
                where[g["type"] + str(g["id"])]["needMinor"] -= g["amountMinor"]
        left -= sum(g["amountMinor"] for g in got)
        out += got
    return out, left


def _income_ops(s: Snapshot) -> list[Transaction]:
    return [t for t in s.cashflow(s.as_of - timedelta(days=PROPOSAL_DAYS), s.as_of)
            if s.amount(t) > 0 and (t.user_kind == "income_salary" or (t.user_kind is None and t.category_id == "income"))]


@router.get("/income-allocations")
def proposals(u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Payouts of the last two weeks without a decision, and confirmed splits not marked as done yet."""
    s, rules = Snapshot(db, u), _rules(db, u)
    known = {r.transaction_id: r for r in db.scalars(select(IncomeAllocation).where(IncomeAllocation.user_id == u.id))}
    new = []
    for t in _income_ops(s) if rules else []:
        if t.id not in known:
            items, left = _split(s, rules, s.amount(t))
            new.append({"transactionId": str(t.id), "date": s.day(t).isoformat(), "name": t.merchant,
                        "amount": to_major(s.amount(t)), "items": _items(items), "left": to_major(left)})
    return {"proposals": new, "confirmed": [{"transactionId": str(r.transaction_id), "items": _items(r.items)}
                                            for r in known.values() if r.status == "confirmed"]}


class DecisionIn(BaseModel):
    action: Literal["confirm", "skip", "done"]


@router.post("/income-allocations/{tx_id}", response_model=Ok)
def decide(tx_id: int, body: DecisionIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """confirm: protect the proposed sums; skip: no split; done: the user has moved the money, protection ends."""
    s = Snapshot(db, u)
    row = db.scalar(select(IncomeAllocation).where(IncomeAllocation.user_id == u.id,
                                                   IncomeAllocation.transaction_id == tx_id))
    if body.action == "done":
        if row is None or row.status != "confirmed":
            raise ApiError(404, "Подтверждённое распределение не найдено")
        row.status = "done"
    else:
        t = next((x for x in _income_ops(s) if x.id == tx_id), None)
        if t is None:
            raise ApiError(404, "Поступление не найдено")
        if row is not None:
            raise ApiError(409, "По этому поступлению решение уже принято")
        items = _split(s, _rules(db, u), s.amount(t))[0] if body.action == "confirm" else []
        db.add(IncomeAllocation(user_id=u.id, transaction_id=tx_id, items=items,
                                status="confirmed" if body.action == "confirm" else "skipped"))
    db.commit()
    return Ok()
