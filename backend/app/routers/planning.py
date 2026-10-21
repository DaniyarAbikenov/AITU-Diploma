from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import as_of
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.money import to_major, to_minor
from app.core.security import current_user
from app.models import Goal, IncomeSource, Obligation, Transaction, User
from app.schemas import (
    CalendarMonth,
    ConfirmIn,
    DtiPointOut,
    GoalIn,
    GoalOut,
    GoalProjectionOut,
    IncomeSourceOut,
    ObligationIn,
    ObligationOut,
    ObligationsCalendarOut,
    Ok,
)
from app.services import goals as goal_svc
from app.services.ledger import add_months, month_key

router = APIRouter(tags=["planning"])


def ob_out(o: Obligation) -> ObligationOut:
    return ObligationOut(id=str(o.id), name=o.name, kind=o.kind, amount=to_major(o.amount_minor), dayOfMonth=o.day_of_month,
                         endsAt=o.ends_at, confirmed=o.confirmed)


def _own(db: Session, model, item_id: int, user: User, what: str):
    row = db.get(model, item_id)
    if not row or row.user_id != user.id:
        raise ApiError(404, f"{what} не найден(а)")
    return row


# ---- obligations
@router.get("/obligations", response_model=list[ObligationOut])
def obligations(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return [ob_out(o) for o in db.scalars(select(Obligation).where(Obligation.user_id == u.id).order_by(Obligation.id))]


@router.post("/obligations", response_model=ObligationOut, status_code=201)
def add_obligation(body: ObligationIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    o = Obligation(user_id=u.id, name=body.name, kind=body.kind, amount_minor=to_minor(body.amount),
                   day_of_month=body.dayOfMonth, ends_at=body.endsAt, confirmed=True)
    db.add(o)
    db.commit()
    return ob_out(o)


@router.patch("/obligations/{ob_id}", response_model=ObligationOut)
def confirm_obligation(ob_id: int, body: ConfirmIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    o = _own(db, Obligation, ob_id, u, "Обязательство")
    o.confirmed = body.confirmed
    db.commit()
    return ob_out(o)


@router.delete("/obligations/{ob_id}", response_model=Ok)
def delete_obligation(ob_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own(db, Obligation, ob_id, u, "Обязательство"))
    db.commit()
    return Ok()


def _monthly_income(db: Session, u: User) -> float:
    return sum(i.amount_minor for i in db.scalars(select(IncomeSource).where(IncomeSource.user_id == u.id))) / 100


@router.get("/obligations/calendar", response_model=ObligationsCalendarOut)
def calendar(months: int = 12, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Planned payments for the next `months` months, starting with the month after today."""
    obs = db.scalars(select(Obligation).where(Obligation.user_id == u.id)).all()
    first = add_months(as_of().replace(day=1), 1)
    out = []
    for i in range(max(1, min(months, 36))):
        key = month_key(add_months(first, i))
        active = [o for o in obs if not o.ends_at or key <= o.ends_at]

        def by(kinds: tuple[str, ...], active=active) -> float:
            return to_major(sum(o.amount_minor for o in active if o.kind in kinds))

        out.append(CalendarMonth(month=key, credit=by(("credit",)), installment=by(("installment",)),
                                 regular=by(("rent", "utility", "subscription"))))
    return ObligationsCalendarOut(months=out, income=_monthly_income(db, u))


@router.get("/obligations/dti-history", response_model=list[DtiPointOut])
def dti_history(months: int = 12, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Debt-to-income per completed month: loan/installment payments seen in the statements over income seen."""
    today = as_of()
    cur = today.replace(day=1)
    keys = [month_key(add_months(cur, -k)) for k in range(max(1, min(months, 36)), 0, -1)]
    income = dict.fromkeys(keys, 0)
    debt = dict.fromkeys(keys, 0)
    rows = db.execute(select(Transaction.booked_on, Transaction.amount_minor, Transaction.category_id).where(
        Transaction.user_id == u.id, Transaction.internal.is_(False))).all()
    for on, amount, cat in rows:
        k = month_key(on)
        if k in income:
            if cat == "income" and amount > 0:
                income[k] += amount
            elif cat == "credit" and amount < 0:
                debt[k] += -amount
    return [DtiPointOut(month=k, dti=round(debt[k] / income[k], 3)) for k in keys if income[k] > 0]


# ---- income
@router.get("/income-sources", response_model=list[IncomeSourceOut])
def income_sources(u: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(IncomeSource).where(IncomeSource.user_id == u.id).order_by(IncomeSource.id))
    return [IncomeSourceOut(id=str(i.id), name=i.name, amount=to_major(i.amount_minor), dayOfMonth=i.day_of_month,
                            confirmed=i.confirmed) for i in rows]


@router.patch("/income-sources/{inc_id}", response_model=IncomeSourceOut)
def confirm_income(inc_id: int, body: ConfirmIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    i = _own(db, IncomeSource, inc_id, u, "Источник дохода")
    i.confirmed = body.confirmed
    db.commit()
    return IncomeSourceOut(id=str(i.id), name=i.name, amount=to_major(i.amount_minor), dayOfMonth=i.day_of_month, confirmed=i.confirmed)


# ---- goals
def goal_out(g: Goal) -> GoalOut:
    proj = goal_svc.projection(g.target_minor / 100, g.saved_minor / 100, g.monthly_minor / 100, g.deadline, as_of())
    return GoalOut(id=str(g.id), name=g.name, target=to_major(g.target_minor), saved=to_major(g.saved_minor),
                   monthly=to_major(g.monthly_minor), deadline=g.deadline,
                   projection=GoalProjectionOut(goalId=str(g.id), **proj))


@router.get("/goals", response_model=list[GoalOut])
def goals(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return [goal_out(g) for g in db.scalars(select(Goal).where(Goal.user_id == u.id).order_by(Goal.id))]


@router.post("/goals", response_model=Ok, status_code=201)
def add_goal(body: GoalIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    db.add(Goal(user_id=u.id, name=body.name, target_minor=to_minor(body.target), saved_minor=to_minor(body.saved),
                monthly_minor=to_minor(body.monthly), deadline=body.deadline))
    db.commit()
    return Ok()


@router.delete("/goals/{goal_id}", response_model=Ok)
def delete_goal(goal_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own(db, Goal, goal_id, u, "Цель"))
    db.commit()
    return Ok()


_ = date  # (date kept for type-checkers on query params)
