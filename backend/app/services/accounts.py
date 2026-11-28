"""Accounts, balance checkpoints and the effective type of an operation (user decision over the import)."""
from datetime import date

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.money import to_major
from app.models import Account, AccountCheckpoint, ImportBatch, Transaction
from app.schemas import AccountOut

USER_KINDS = ("expense", "income", "income_salary", "income_other", "transfer_own", "transfer_third_party")


def guess_kind(name: str) -> str:
    low = name.lower()
    if "депозит" in low or "накоп" in low or "deposit" in low or "savings" in low:
        return "savings"
    if "налич" in low or "cash" in low:
        return "cash"
    return "current"


def latest_checkpoint(db: Session, acc: Account) -> AccountCheckpoint | None:
    return db.scalar(select(AccountCheckpoint).where(AccountCheckpoint.account_id == acc.id)
                     .order_by(AccountCheckpoint.as_of.desc(), AccountCheckpoint.id.desc()).limit(1))


def add_checkpoint(db: Session, acc: Account, balance_minor: int, on: date, source: str) -> AccountCheckpoint:
    """Stores the checkpoint; the account balance follows it unless a newer checkpoint already exists."""
    cp = AccountCheckpoint(user_id=acc.user_id, account_id=acc.id, balance_minor=balance_minor, as_of=on, source=source)
    last = latest_checkpoint(db, acc)
    db.add(cp)
    if last is None or on >= last.as_of:
        acc.balance_minor = balance_minor
    db.flush()
    return cp


def account_out(db: Session, a: Account) -> AccountOut:
    cp = latest_checkpoint(db, a)
    known, as_of, source = cp is not None, cp.as_of.isoformat() if cp else None, cp.source if cp else None
    if cp is None:
        # Imports made before checkpoints existed set the balance from the statement header: report the newest
        # statement end for this bank as its date. Without any statement the balance is unknown, not zero.
        end = db.scalar(select(func.max(ImportBatch.period_to)).where(ImportBatch.user_id == a.user_id,
                                                                     ImportBatch.bank == a.bank))
        if end is not None:
            known, as_of, source = True, end.isoformat(), "statement"
    return AccountOut(id=str(a.id), bank=a.bank, name=a.name, currency=a.currency, balance=to_major(a.balance_minor),
                      kind=a.kind, confirmed=a.confirmed, balanceKnown=known, balanceAsOf=as_of, balanceSource=source)


def effective_kind(t: Transaction) -> str:
    if t.user_kind:
        return t.user_kind
    if t.internal:
        return "transfer_own"
    return "income" if t.amount_minor > 0 else "expense"


def is_cashflow():
    """SQL condition: the operation is income or spending, not a move between the user's own accounts."""
    return or_(and_(Transaction.user_kind.is_(None), Transaction.internal.is_(False)),
               and_(Transaction.user_kind.is_not(None), Transaction.user_kind != "transfer_own"))
