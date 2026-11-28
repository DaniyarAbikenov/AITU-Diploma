"""Accounts, balance checkpoints and the effective type of an operation (user decision over the import)."""
from datetime import date

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import as_of as app_today
from app.core.money import to_major, to_minor
from app.models import Account, AccountCheckpoint, ImportBatch, Transaction
from app.schemas import AccountOut
from app.services import fx

USER_KINDS = ("expense", "income", "income_salary", "income_other", "transfer_own", "owner_draw",
              "transfer_third_party")
# moves of the user's own money: never income or spending (owner_draw = business account -> personal account)
OWN_MOVES = ("transfer_own", "owner_draw")


def guess_kind(name: str) -> str:
    low = name.lower()
    if "депозит" in low or "deposit" in low:
        return "deposit"
    if "накоп" in low or "savings" in low:
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
    current = None
    if known:
        # manual operations entered after the known balance move it; imported ones are already in the statement
        since = date.fromisoformat(as_of)
        delta = db.scalar(select(func.coalesce(func.sum(eff_amount), 0)).where(
            Transaction.account_id == a.id, Transaction.source == "manual", Transaction.voided.is_(False),
            eff_date > since)) or 0
        current = to_major(a.balance_minor + int(delta))
    out = AccountOut(id=str(a.id), bank=a.bank, name=a.name, currency=a.currency, balance=to_major(a.balance_minor),
                     kind=a.kind, confirmed=a.confirmed, balanceKnown=known, balanceAsOf=as_of, balanceSource=source,
                     currentBalance=current)
    r = fx.latest(db, a.currency)
    if r is not None and a.currency != "KZT":
        out.rate, out.rateDate, out.rateStale = r.rate, r.rate_date.isoformat(), r.stale
    if r is not None and known:
        out.balanceKzt = to_major(round(a.balance_minor * r.rate))
        out.currentBalanceKzt = to_major(round(to_minor(current) * r.rate))
        then = fx.rate_on(db, a.currency, date.fromisoformat(as_of)) if a.currency != "KZT" else 1.0
        if then is not None:
            out.revaluationKzt = to_major(round(a.balance_minor * (r.rate - then)))
    out.perimeter = a.perimeter
    out.interestRate, out.earlyWithdrawal, out.numberMask = a.interest_rate, a.early_withdrawal, a.number_mask
    if a.frozen_until is not None:
        out.frozenUntil = a.frozen_until.isoformat()
    if known:
        now_minor = to_minor(current)
        frozen = frozen_minor(a, now_minor)
        out.frozenAmount, out.availableBalance = to_major(frozen), to_major(now_minor - frozen)
        if r is not None:
            out.frozenKzt = to_major(round(frozen * r.rate))
            out.availableKzt = to_major(round((now_minor - frozen) * r.rate))
    return out


def frozen_minor(a: Account, balance_minor: int, today: date | None = None) -> int:
    """Blocked money today: none after frozen_until, the given part, or the whole (non-negative) balance."""
    today = today or app_today()
    if a.frozen_until is None or a.frozen_until <= today or balance_minor <= 0:
        return 0
    return balance_minor if a.frozen_minor is None else min(a.frozen_minor, balance_minor)


def effective_kind(t: Transaction) -> str:
    if t.user_kind:
        return t.user_kind
    if t.internal:
        return "transfer_own"
    return "income" if t.amount_minor > 0 else "expense"


def is_cashflow():
    """SQL condition: the operation is income or spending, not a move between the user's own accounts, not
    cancelled by the user and not on a business account (perimeters are never mixed silently, BR-03)."""
    business = select(Account.id).where(Account.perimeter == "business")
    return and_(Transaction.voided.is_(False), Transaction.account_id.not_in(business),
                or_(and_(Transaction.user_kind.is_(None), Transaction.internal.is_(False)),
                    and_(Transaction.user_kind.is_not(None), Transaction.user_kind.not_in(OWN_MOVES))))


# Effective values: the user's correction when there is one, otherwise the imported value.
eff_amount = func.coalesce(Transaction.user_amount_minor, Transaction.amount_minor)
eff_date = func.coalesce(Transaction.user_booked_on, Transaction.booked_on)


def tx_amount(t: Transaction) -> int:
    return t.user_amount_minor if t.user_amount_minor is not None else t.amount_minor


def tx_date(t: Transaction) -> date:
    return t.user_booked_on or t.booked_on
