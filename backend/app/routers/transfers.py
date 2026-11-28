"""Moves between the user's own accounts: two linked operations that are neither income nor expense (FR-18)."""
import uuid
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import as_of
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.money import to_minor
from app.core.security import current_user
from app.models import Account, Transaction, TransactionEdit, User
from app.routers.data import tx_out
from app.schemas import LinkIn, TransactionOut, TransferCandidate, TransferIn
from app.services import accounts as acc_svc
from app.services.imports import transfer_candidates

router = APIRouter(tags=["data"])


def _account(db: Session, u: User, account_id: str) -> Account:
    a = db.get(Account, int(account_id)) if account_id.isdigit() else None
    if not a or a.user_id != u.id:
        raise ApiError(404, "Счёт не найден")
    return a


@router.post("/transfers", response_model=list[TransactionOut], status_code=201)
def create_transfer(body: TransferIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Both legs are written in one commit. The source must hold enough available money (frozen money is not)."""
    group = f"tr-{body.requestId}"
    done = list(db.scalars(select(Transaction).where(Transaction.user_id == u.id, Transaction.transfer_group == group)
                           .order_by(Transaction.amount_minor)))
    if done:  # the same request repeated (double click, retry after a network error): no second transfer
        return [tx_out(t) for t in done]
    src, dst = _account(db, u, body.fromAccountId), _account(db, u, body.toAccountId)
    if src.id == dst.id:
        raise ApiError(422, "Выберите два разных счёта")
    on = date.fromisoformat(body.date)
    if on > as_of():
        raise ApiError(422, "Перевод не может быть в будущем. Будущий перевод добавьте как плановую статью.")
    out_minor = to_minor(body.amount)
    if src.currency != dst.currency and body.toAmount is None:
        raise ApiError(422, "Счета в разных валютах: укажите сумму зачисления")
    in_minor = to_minor(body.toAmount) if body.toAmount is not None else out_minor
    info = acc_svc.account_out(db, src)
    if info.balanceKnown and info.availableBalance is not None and to_minor(info.availableBalance) < out_minor:
        raise ApiError(422, "На счёте-источнике недостаточно доступных средств")
    # business -> personal is the owner taking money out: not earned income and not a business expense
    kind = "owner_draw" if (src.perimeter, dst.perimeter) == ("business", "personal") else "transfer_own"
    legs = []
    for acc, amount, name in ((src, -out_minor, f"Перевод на {dst.name}"), (dst, in_minor, f"Перевод с {src.name}")):
        t = Transaction(user_id=u.id, account_id=acc.id, booked_on=on, amount_minor=amount, currency=acc.currency,
                        merchant=name, category_id="transfers", category_source="user", needs_review=False,
                        internal=True, user_kind=kind, source="manual", transfer_group=group,
                        user_note=(body.note or "").strip() or None, dedup_key="manual-" + uuid.uuid4().hex)
        db.add(t)
        legs.append(t)
    db.flush()
    for t in legs:
        db.add(TransactionEdit(user_id=u.id, transaction_id=t.id, action="create", before=None,
                               after={"transfer": group, "amount": t.amount_minor / 100, "account": str(t.account_id)}))
    db.commit()
    return [tx_out(t) for t in legs]


@router.get("/transfers/candidates", response_model=list[TransferCandidate])
def candidates(u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Outgoing operations with more than one possible incoming twin: the user confirms which pair is the transfer."""
    return [TransferCandidate(outId=str(o.id), inIds=[str(i.id) for i in ins]) for o, ins in transfer_candidates(db, u)
            if len(ins) > 1]


@router.post("/transfers/link", response_model=list[TransactionOut])
def link(body: LinkIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Confirm that two operations are one transfer between own accounts (sets both as transfers, links them)."""
    pair = []
    for tid in (body.outId, body.inId):
        t = db.get(Transaction, int(tid)) if tid.isdigit() else None
        if not t or t.user_id != u.id:
            raise ApiError(404, "Операция не найдена")
        pair.append(t)
    o, i = pair
    if o.account_id == i.account_id or o.amount_minor >= 0 or i.amount_minor <= 0:
        raise ApiError(422, "Нужны списание с одного счёта и зачисление на другой")
    group = f"link-{uuid.uuid4().hex[:12]}"
    src, dst = db.get(Account, o.account_id), db.get(Account, i.account_id)
    kind = "owner_draw" if (src.perimeter, dst.perimeter) == ("business", "personal") else "transfer_own"
    for t in pair:
        t.internal, t.user_kind, t.needs_review, t.transfer_group = True, kind, False, group
    db.commit()
    return [tx_out(t) for t in pair]
