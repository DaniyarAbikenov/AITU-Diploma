from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import create_token, current_user, hash_password, verify_password
from app.models import (
    Account,
    Goal,
    ImportBatch,
    IncomeSource,
    InsightDismissal,
    MerchantRule,
    Obligation,
    ResilienceSnapshot,
    SavedScenario,
    Transaction,
    User,
)
from app.schemas import AuthOut, LoginIn, Ok, ProfilePatch, RegisterIn, UserOut

router = APIRouter(tags=["auth"])


def user_out(u: User) -> UserOut:
    return UserOut(id=str(u.id), email=u.email, name=u.name, city=u.city)


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
    return AuthOut(token=create_token(u.id), user=user_out(u), onboarded=False)


@router.post("/auth/login", response_model=AuthOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    u = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not u or not verify_password(body.password, u.password_hash):
        raise ApiError(401, "Неверный email или пароль")
    return AuthOut(token=create_token(u.id), user=user_out(u), onboarded=onboarded(db, u))


@router.get("/me", response_model=UserOut)
def me(u: User = Depends(current_user)):
    return user_out(u)


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfilePatch, u: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.name:
        u.name = body.name.strip()
    if body.city:
        u.city = body.city
    db.commit()
    return user_out(u)


@router.delete("/me", response_model=Ok)
def delete_my_data(u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Right to erasure: removes every financial record of the user. The login itself is kept."""
    for model in (Transaction, ImportBatch, Account, MerchantRule, Obligation, IncomeSource, Goal, SavedScenario,
                  InsightDismissal, ResilienceSnapshot):
        db.execute(delete(model).where(model.user_id == u.id))
    db.commit()
    return Ok()
