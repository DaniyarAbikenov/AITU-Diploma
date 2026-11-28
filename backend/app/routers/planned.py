"""Planned one-off and yearly items (expenses and incomes) and their payment by actual operations."""
import uuid
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import as_of
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.money import to_major, to_minor
from app.core.security import current_user
from app.models import Account, Category, PlannedPayment, PlannedSettlement, Transaction, TransactionEdit, User
from app.schemas import (
    Ok,
    PlannedPaymentIn,
    PlannedPaymentOut,
    PlannedPaymentPatch,
    SettleIn,
    SettlementOut,
)
from app.services.accounts import tx_amount
from app.services.ledger import month_key

router = APIRouter(tags=["planning"])


def _own(db: Session, u: User, pid: int) -> PlannedPayment:
    p = db.get(PlannedPayment, pid)
    if not p or p.user_id != u.id:
        raise ApiError(404, "Плановая статья не найдена")
    return p


def _account(db: Session, u: User, account_id: str | None) -> int | None:
    if not account_id:
        return None
    a = db.get(Account, int(account_id)) if account_id.isdigit() else None
    if not a or a.user_id != u.id:
        raise ApiError(404, "Счёт не найден")
    return a.id


def _category(db: Session, category: str | None) -> str | None:
    if category is not None and db.get(Category, category) is None:
        raise ApiError(422, f"Неизвестная категория: {category}")
    return category


def _check_window(p: PlannedPayment) -> None:
    if p.due_to is not None and p.due_to < p.due_on:
        raise ApiError(422, "Конец интервала раньше начала")


def _settlements(db: Session, p: PlannedPayment) -> list[PlannedSettlement]:
    return list(db.scalars(select(PlannedSettlement).where(PlannedSettlement.planned_id == p.id,
                                                          PlannedSettlement.period == p.due_on)
                           .order_by(PlannedSettlement.id)))


def amount_of(db: Session, p: PlannedPayment) -> tuple[int, object]:
    """Amount of the current occurrence in minor units: from its rule or override when it has one, else as entered."""
    from app.routers.rules import rule_info

    info = rule_info(db, db.get(User, p.user_id), "planned", p.id, month_key(p.due_on))
    if info is not None and info.amountThisMonth is not None:
        return to_minor(info.amountThisMonth), info
    return p.amount_minor, info


def out(db: Session, p: PlannedPayment) -> PlannedPaymentOut:
    rows = _settlements(db, p)
    paid = sum(s.amount_minor for s in rows)
    amount_minor, info = amount_of(db, p)
    left = max(0, amount_minor - paid)
    status = "cancelled" if p.cancelled else "paid" if left == 0 else "partial" if paid > 0 else "planned"
    return PlannedPaymentOut(
        id=str(p.id), name=p.name, direction=p.direction, amount=to_major(amount_minor), dueOn=p.due_on.isoformat(),
        dueTo=p.due_to.isoformat() if p.due_to else None, repeat=p.repeat, categoryId=p.category_id,
        accountId=str(p.account_id) if p.account_id else None, mandatory=p.mandatory, movable=p.movable,
        status=status, paid=to_major(paid), left=to_major(left),
        settlements=[SettlementOut(transactionId=str(s.transaction_id), amount=to_major(s.amount_minor),
                                   period=s.period.isoformat()) for s in rows],
        baseAmount=to_major(p.amount_minor), rule=info)


@router.get("/planned-payments", response_model=list[PlannedPaymentOut])
def planned(u: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(PlannedPayment).where(PlannedPayment.user_id == u.id)
                      .order_by(PlannedPayment.due_on, PlannedPayment.id))
    return [out(db, p) for p in rows]


@router.post("/planned-payments", response_model=PlannedPaymentOut, status_code=201)
def add_planned(body: PlannedPaymentIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = PlannedPayment(user_id=u.id, name=body.name.strip(), direction=body.direction, amount_minor=to_minor(body.amount),
                       due_on=date.fromisoformat(body.dueOn), due_to=date.fromisoformat(body.dueTo) if body.dueTo else None,
                       repeat=body.repeat, category_id=_category(db, body.category),
                       account_id=_account(db, u, body.accountId), mandatory=body.mandatory, movable=body.movable)
    _check_window(p)
    db.add(p)
    db.commit()
    return out(db, p)


@router.patch("/planned-payments/{pid}", response_model=PlannedPaymentOut)
def update_planned(pid: int, body: PlannedPaymentPatch, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = _own(db, u, pid)
    sent = body.model_fields_set
    if body.name:
        p.name = body.name.strip()
    for field, attr in (("direction", "direction"), ("repeat", "repeat"), ("mandatory", "mandatory"),
                        ("movable", "movable"), ("cancelled", "cancelled")):
        value = getattr(body, field)
        if value is not None:
            setattr(p, attr, value)
    if body.amount is not None:
        p.amount_minor = to_minor(body.amount)
    if body.dueOn is not None:
        new_due = date.fromisoformat(body.dueOn)
        # moving an occurrence keeps what was already paid for it
        db.execute(PlannedSettlement.__table__.update().where(PlannedSettlement.planned_id == p.id,
                                                              PlannedSettlement.period == p.due_on)
                   .values(period=new_due))
        p.due_on = new_due
    if "dueTo" in sent:
        p.due_to = date.fromisoformat(body.dueTo) if body.dueTo else None
    if "category" in sent:
        p.category_id = _category(db, body.category)
    if "accountId" in sent:
        p.account_id = _account(db, u, body.accountId)
    _check_window(p)
    db.commit()
    return out(db, p)


@router.delete("/planned-payments/{pid}", response_model=Ok)
def delete_planned(pid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Deletes the plan item and its payment links. The actual operations stay."""
    p = _own(db, u, pid)
    db.execute(delete(PlannedSettlement).where(PlannedSettlement.planned_id == p.id))
    db.delete(p)
    db.commit()
    return Ok()


@router.post("/planned-payments/{pid}/settle", response_model=PlannedPaymentOut)
def settle(pid: int, body: SettleIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Mark as paid (fully or partly). With transactionId an existing operation is linked and nothing new is booked,
    so the money is never counted twice. Without it one manual operation is created for the paid amount."""
    p = _own(db, u, pid)
    if p.cancelled:
        raise ApiError(409, "Статья отменена")
    paid = sum(s.amount_minor for s in _settlements(db, p))
    left = amount_of(db, p)[0] - paid
    if left <= 0:
        raise ApiError(409, "Статья уже оплачена")
    if body.transactionId:
        t = db.get(Transaction, int(body.transactionId)) if body.transactionId.isdigit() else None
        if not t or t.user_id != u.id:
            raise ApiError(404, "Операция не найдена")
        if db.scalar(select(PlannedSettlement.id).where(PlannedSettlement.transaction_id == t.id)):
            raise ApiError(409, "Эта операция уже привязана к плановой статье")
        amount = to_minor(body.amount) if body.amount else min(abs(tx_amount(t)), left)
    else:
        account_id = _account(db, u, body.accountId) or p.account_id
        if account_id is None:
            raise ApiError(422, "Выберите счёт, с которого прошла оплата")
        amount = to_minor(body.amount) if body.amount else left
        on = date.fromisoformat(body.date) if body.date else as_of(u)
        sign = 1 if p.direction == "income" else -1
        acc = db.get(Account, account_id)
        t = Transaction(user_id=u.id, account_id=account_id, booked_on=on, amount_minor=sign * amount, currency=acc.currency,
                        merchant=p.name, category_id=p.category_id or ("income" if sign > 0 else "other"),
                        category_source="user", needs_review=False, internal=False,
                        user_kind="income_other" if sign > 0 else "expense", source="manual",
                        dedup_key="manual-" + uuid.uuid4().hex)
        db.add(t)
        db.flush()
        db.add(TransactionEdit(user_id=u.id, transaction_id=t.id, action="create", before=None,
                               after={"date": on.isoformat(), "amount": to_major(sign * amount), "plannedId": str(p.id)}))
    if amount > left:
        raise ApiError(422, f"Сумма больше остатка по статье ({to_major(left)} ₸)")
    db.add(PlannedSettlement(user_id=u.id, planned_id=p.id, transaction_id=t.id, amount_minor=amount, period=p.due_on))
    db.flush()
    if p.repeat == "yearly" and paid + amount >= amount_of(db, p)[0]:
        p.due_on = _next_year(p.due_on)  # the next occurrence starts unpaid; history keeps the old period
        if p.due_to:
            p.due_to = _next_year(p.due_to)
    db.commit()
    return out(db, p)


def _next_year(d: date) -> date:
    try:
        return d.replace(year=d.year + 1)
    except ValueError:  # 29 February
        return d.replace(year=d.year + 1, day=28)
