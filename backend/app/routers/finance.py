import re
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import PRESETS
from app.core.config import as_of, settings
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.money import to_major
from app.core.security import current_user
from app.engine import forecast as fc
from app.engine import montecarlo as mc
from app.engine import resilience as res
from app.models import ForecastRun, InsightDismissal, ResilienceSnapshot, SavedScenario, Transaction, User
from app.schemas import (
    BalanceForecastOut,
    DashboardSummaryOut,
    InsightOut,
    MonthEndForecastOut,
    Ok,
    ResilienceHistoryPoint,
    ResilienceOut,
    SavedScenarioIn,
    SavedScenarioOut,
    ScenarioPresetOut,
    ScenarioResultOut,
    ScenarioRunIn,
    TopCategory,
)
from app.services import insights as insight_svc
from app.services import macro as macro_svc
from app.services import scenarios as scenario_svc
from app.services.ledger import Context, add_months, build_context, month_key

router = APIRouter(tags=["finance"])
MODEL = settings.model_version


def ctx_for(db: Session, u: User) -> Context:
    return build_context(db, u, as_of())


def log_run(db: Session, u: User, kind: str, ctx: Context, params: dict, result: dict) -> None:
    db.add(ForecastRun(user_id=u.id, kind=kind, model_version=MODEL, as_of=ctx.as_of, params=params, result=result))
    db.commit()


@router.get("/dashboard/summary", response_model=DashboardSummaryOut)
def summary(month: str = Query(pattern=r"^\d{4}-\d{2}$"), u: User = Depends(current_user), db: Session = Depends(get_db)):
    y, m = (int(x) for x in month.split("-"))
    if not 1 <= m <= 12:
        raise ApiError(422, "month: некорректный месяц")
    prev = month_key(add_months(date(y, m, 1), -1))
    rows = db.execute(select(Transaction.booked_on, Transaction.amount_minor, Transaction.category_id).where(
        Transaction.user_id == u.id, Transaction.internal.is_(False))).all()
    income = expense = prev_expense = 0
    cur_cat: dict[str, int] = {}
    prev_cat: dict[str, int] = {}
    for on, amount, cat in rows:
        k = month_key(on)
        if k == month:
            if amount > 0:
                income += amount
            else:
                expense += -amount
                cur_cat[cat] = cur_cat.get(cat, 0) - amount
        elif k == prev and amount < 0:
            prev_expense += -amount
            prev_cat[cat] = prev_cat.get(cat, 0) - amount
    cats = sorted(set(cur_cat) | set(prev_cat), key=lambda c: -cur_cat.get(c, 0))
    top = [TopCategory(categoryId=c, amount=to_major(cur_cat.get(c, 0)), prev=to_major(prev_cat.get(c, 0))) for c in cats if c != "income"]
    return DashboardSummaryOut(month=month, income=to_major(income), expense=to_major(expense), net=to_major(income - expense),
                               prevExpense=to_major(prev_expense), topCategories=top)


@router.get("/forecast/month-end", response_model=MonthEndForecastOut)
def month_end(u: User = Depends(current_user), db: Session = Depends(get_db)):
    ctx = ctx_for(db, u)
    me = fc.month_end(ctx, u.id, settings.mc_paths)
    log_run(db, u, "month-end", ctx, {"paths": settings.mc_paths}, {"median": me.median, "low": me.low, "high": me.high, "naive": me.naive})
    return MonthEndForecastOut(
        as_of=ctx.as_of.isoformat(), model_version=MODEL, month=me.month, spentSoFar=round(me.spent_so_far), median=me.median,
        low=me.low, high=me.high, prevMonth=round(me.prev_month), pacePerDay=round(me.pace_per_day),
        drivers=[{"label": n, "delta": d} for n, d in me.drivers])


@router.get("/forecast/balance", response_model=BalanceForecastOut)
def balance(days: int = Query(default=60, ge=7, le=180), u: User = Depends(current_user), db: Session = Depends(get_db)):
    ctx = ctx_for(db, u)
    out = fc.balance_forecast(ctx, u.id, days, settings.mc_paths)
    log_run(db, u, "balance", ctx, {"days": days, "paths": settings.mc_paths},
            {"pShortfall": mc.p_shortfall(out["paths"]), "riskDays": len(out["risk_days"])})
    return BalanceForecastOut(as_of=ctx.as_of.isoformat(), model_version=MODEL, days=out["points"], riskDays=out["risk_days"],
                              payments=out["payments"])


@router.get("/resilience", response_model=ResilienceOut)
def resilience(u: User = Depends(current_user), db: Session = Depends(get_db)):
    ctx = ctx_for(db, u)
    paths = mc.simulate(ctx, 90, settings.mc_paths, fc.seed_for(u.id, ctx))
    r = res.compute(ctx, mc.p_shortfall(paths))
    key = month_key(ctx.as_of)
    snap = db.scalar(select(ResilienceSnapshot).where(ResilienceSnapshot.user_id == u.id, ResilienceSnapshot.month == key))
    if snap:
        snap.score, snap.source = r.score, "computed"
    else:
        db.add(ResilienceSnapshot(user_id=u.id, month=key, score=r.score, source="computed"))
    db.commit()
    return ResilienceOut(as_of=ctx.as_of.isoformat(), model_version=MODEL, score=r.score, pShortfall=round(r.p_shortfall, 3),
                         runwayMonths=r.runway_months, components=r.components)


@router.get("/resilience/history", response_model=list[ResilienceHistoryPoint])
def resilience_history(u: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(ResilienceSnapshot).where(ResilienceSnapshot.user_id == u.id).order_by(ResilienceSnapshot.month)).all()
    return [ResilienceHistoryPoint(month=r.month, score=r.score) for r in rows[-12:]]


@router.get("/scenarios/presets", response_model=list[ScenarioPresetOut])
def presets(_: User = Depends(current_user)):
    return PRESETS


@router.post("/scenarios/run", response_model=ScenarioResultOut)
def run_scenario(body: ScenarioRunIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    ctx = ctx_for(db, u)
    shocks = [s.model_dump() for s in body.shocks]
    out = scenario_svc.run(ctx, u.id, shocks, body.days, settings.mc_paths)
    log_run(db, u, "scenario", ctx, {"shocks": shocks, "days": body.days},
            {"pBase": out["p_base"], "pScenario": out["p_scenario"]})
    return ScenarioResultOut(as_of=ctx.as_of.isoformat(), model_version=MODEL, base=out["base"], scenario=out["scenario"],
                             deltas=out["deltas"])


@router.get("/scenarios", response_model=list[SavedScenarioOut])
def saved_scenarios(u: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(SavedScenario).where(SavedScenario.user_id == u.id).order_by(SavedScenario.id.desc()))
    return [SavedScenarioOut(id=str(s.id), name=s.name, shocks=s.shocks, createdAt=s.created_at.isoformat()) for s in rows]


@router.post("/scenarios", response_model=Ok, status_code=201)
def save_scenario(body: SavedScenarioIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    db.add(SavedScenario(user_id=u.id, name=body.name, shocks=[s.model_dump() for s in body.shocks], created_at=as_of()))
    db.commit()
    return Ok()


@router.delete("/scenarios/{scenario_id}", response_model=Ok)
def delete_scenario(scenario_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(SavedScenario, scenario_id)
    if not s or s.user_id != u.id:
        raise ApiError(404, "Сценарий не найден")
    db.delete(s)
    db.commit()
    return Ok()


def _income_monthly(ctx: Context) -> float:
    return res._monthly_income(ctx)


@router.get("/insights", response_model=list[InsightOut])
def insights(u: User = Depends(current_user), db: Session = Depends(get_db)):
    ctx = ctx_for(db, u)
    if not ctx.txs:
        return []
    me = fc.month_end(ctx, u.id, settings.mc_paths)
    bal = fc.balance_forecast(ctx, u.id, 60, settings.mc_paths)
    personal = macro_svc.personal_inflation(db, ctx, MODEL)
    items = insight_svc.build(ctx, me, bal["risk_days"], personal, _income_monthly(ctx))
    dismissed = {d.key for d in db.scalars(select(InsightDismissal).where(InsightDismissal.user_id == u.id))}
    return [InsightOut(**i) for i in items if i["id"] not in dismissed]


@router.post("/insights/{insight_id}/dismiss", response_model=Ok)
def dismiss(insight_id: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    key = re.sub(r"[^a-z0-9\-]", "", insight_id.lower())[:80]
    if not db.get(InsightDismissal, (u.id, key)):
        db.add(InsightDismissal(user_id=u.id, key=key))
        db.commit()
    return Ok()
