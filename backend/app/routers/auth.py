from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import pinned_today
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.money import to_major, to_minor
from app.core.security import create_token, current_user, hash_password, verify_password
from app.insights.snapshot import Snapshot
from app.models import (
    Account,
    AccountCheckpoint,
    AllocationRule,
    AmountOverride,
    AmountRule,
    DailyNeed,
    ForecastRun,
    Goal,
    ImportBatch,
    IncomeAllocation,
    IncomeSource,
    InsightDismissal,
    InsightState,
    MerchantRule,
    Obligation,
    PlannedPayment,
    PlannedSettlement,
    ResilienceSnapshot,
    SavedScenario,
    Transaction,
    TransactionEdit,
    User,
)
from app.schemas import AuthOut, LoginIn, Ok, ProfilePatch, RegisterIn, UserOut
from app.services import basis

router = APIRouter(tags=["auth"])


def _major(minor: int | None):
    return None if minor is None else to_major(minor)


def user_out(db: Session, u: User) -> UserOut:
    """Plan fields are the effective values: automatic ones when they can be computed, see services/basis.py."""
    snap = Snapshot(db, u)
    return UserOut(id=str(u.id), email=u.email, name=u.name, city=u.city, timezone=u.timezone or "Asia/Almaty",
                   pinnedToday=p.isoformat() if (p := pinned_today(u)) else None,
                   plannedIncome=_major(basis.income(snap)["valueMinor"]), essentialExpenses=_major(snap.essential_minor),
                   workHours=u.work_hours_month)


def onboarded(db: Session, u: User) -> bool:
    return db.scalar(select(Transaction.id).where(Transaction.user_id == u.id).limit(1)) is not None


@router.post("/auth/register", response_model=AuthOut, status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise ApiError(409, "Пользователь с таким email уже существует")
    u = User(email=email, name=body.name.strip(), city=body.city or "Алматы", password_hash=hash_password(body.password))
    db.add(u)
    db.commit()
    return AuthOut(token=create_token(u.id), user=user_out(db, u), onboarded=False)


@router.post("/auth/login", response_model=AuthOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    u = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not u or not verify_password(body.password, u.password_hash):
        raise ApiError(401, "Неверный email или пароль")
    return AuthOut(token=create_token(u.id), user=user_out(db, u), onboarded=onboarded(db, u))


@router.get("/me", response_model=UserOut)
def me(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_out(db, u)


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfilePatch, u: User = Depends(current_user), db: Session = Depends(get_db)):
    sent = body.model_fields_set
    if body.name:
        u.name = body.name.strip()
    if body.city:
        u.city = body.city.strip()
    if body.timezone:
        try:
            ZoneInfo(body.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ApiError(422, f"Неизвестный часовой пояс: {body.timezone}") from None
        u.timezone = body.timezone
    # plan fields: sent null = back to the automatic value, not sent = unchanged
    # a value typed while the automatic one exists overrides it; otherwise it only fills the gap until it can be computed
    snap = Snapshot(db, u)
    if "plannedIncome" in sent:
        v = body.plannedIncome
        u.planned_income_minor = None if v is None else to_minor(v)
        u.planned_income_override = v is not None and bool(snap.confirmed_incomes)
        u.planned_income_set_on = None if v is None else snap.as_of
    if "essentialExpenses" in sent:
        v = body.essentialExpenses
        auto = snap.essential.auto_minor is not None and snap.essential.everyday_known
        u.essential_expenses_minor = None if v is None else to_minor(v)
        u.essential_override = v is not None and auto
        u.essential_set_on = None if v is None else snap.as_of
    if "workHours" in sent:
        u.work_hours_month = body.workHours
    db.commit()
    return user_out(db, u)


@router.delete("/me", response_model=Ok)
def delete_my_data(u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Right to erasure: removes every financial record of the user. The login itself is kept."""
    for model in (IncomeAllocation, AllocationRule, DailyNeed, AmountRule, AmountOverride, InsightState, ForecastRun,
                  PlannedSettlement, PlannedPayment, TransactionEdit, Transaction, ImportBatch, AccountCheckpoint, Account, MerchantRule, Obligation, IncomeSource, Goal, SavedScenario,
                  InsightDismissal, ResilienceSnapshot):
        db.execute(delete(model).where(model.user_id == u.id))
    u.planned_income_minor = u.planned_income_set_on = u.essential_expenses_minor = u.essential_set_on = None
    u.work_hours_month, u.planned_income_override, u.essential_override = None, False, False
    db.commit()
    return Ok()
