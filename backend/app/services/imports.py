"""Statement import pipeline: accounts -> dedup -> categorization -> internal transfers -> recurring detection."""
import hashlib
from collections import Counter, defaultdict

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.catalog import SUBSCRIPTION_HINTS
from app.engine.categorization import categorize
from app.models import (
    Account,
    AccountCheckpoint,
    ImportBatch,
    IncomeSource,
    MerchantRule,
    Obligation,
    Transaction,
    User,
)
from app.parsers.base import ParsedStatement
from app.services import fx
from app.services.accounts import guess_kind


def user_rules(db: Session, user: User) -> dict[str, str]:
    rows = db.scalars(select(MerchantRule).where(MerchantRule.user_id == user.id)).all()
    return {r.merchant: r.category_id for r in rows}


def match_account(db: Session, user: User, parsed: ParsedStatement) -> tuple[Account | None, str | None]:
    """The user's account this statement belongs to and how it was found: by the number from the header (reliable),
    by the header name (no number printed: needs the user's confirmation in the preview), or none."""
    acc = db.scalar(select(Account).where(Account.user_id == user.id, Account.statement_key == parsed.statement_key))
    if acc is not None:
        return acc, "number" if parsed.account_mask else "name"
    if parsed.account_mask:
        acc = db.scalar(select(Account).where(Account.user_id == user.id, Account.bank == parsed.bank,
                                              Account.number_mask == parsed.account_mask))
        if acc is not None:
            return acc, "number"
    name_key = f"{parsed.bank}|name:{parsed.account_name}"
    acc = db.scalar(select(Account).where(Account.user_id == user.id, Account.bank == parsed.bank, or_(
        Account.statement_key == name_key,
        and_(Account.statement_key.is_(None), Account.name == parsed.account_name))))
    return (acc, "name") if acc is not None else (None, None)


def get_or_create_account(db: Session, user: User, parsed: ParsedStatement, target: str = "auto") -> Account:
    """target: "auto" (match by number, then by name), "new" (always a new account) or an account id the user chose.
    The chosen or found account remembers the statement key, so renaming it later does not break the link."""
    acc = None
    if target not in ("auto", "new"):
        acc = db.get(Account, int(target)) if str(target).isdigit() else None
        if acc is None or acc.user_id != user.id:
            raise LookupError("Счёт не найден")
    elif target == "auto":
        acc, _ = match_account(db, user, parsed)
    if acc is None:
        acc = Account(user_id=user.id, bank=parsed.bank, name=parsed.account_name, currency=statement_currency(parsed),
                      balance_minor=parsed.closing_balance_minor or 0, kind=guess_kind(parsed.account_name),
                      confirmed=False)
        db.add(acc)
        db.flush()
    elif parsed.closing_balance_minor is not None and not _older_than_known(db, acc, parsed):
        acc.balance_minor = parsed.closing_balance_minor  # the newest statement carries the current balance
    # a number from the header upgrades a name-based key; a key never changes when the account is renamed
    if acc.statement_key is None or (parsed.account_mask and acc.number_mask is None):
        acc.statement_key = parsed.statement_key
    if parsed.account_mask and acc.number_mask is None:
        acc.number_mask = parsed.account_mask
    return acc


def backfill_statement_keys(db: Session) -> int:
    """Accounts created by imports before statement keys existed get a key from their current bank and name.
    Only the key is written; operations, balances and names stay as they are."""
    rows = db.scalars(select(Account).where(Account.statement_key.is_(None))).all()
    n = 0
    for a in rows:
        if db.scalar(select(ImportBatch.id).where(ImportBatch.user_id == a.user_id, ImportBatch.bank == a.bank).limit(1)):
            a.statement_key = f"{a.bank}|name:{a.name}"
            n += 1
    db.commit()
    return n


def statement_currency(parsed: ParsedStatement) -> str:
    """The account currency is the currency of most operations of the statement (KZT for an empty one)."""
    counts = Counter(r.currency for r in parsed.rows)
    top = counts.most_common(1)[0][0] if counts else "KZT"
    return top if top in fx.SUPPORTED else "KZT"


def record_statement_checkpoint(db: Session, acc: Account, parsed: ParsedStatement) -> None:
    """The closing balance from the statement header becomes a dated checkpoint (FR-12), once per statement."""
    end = parsed.period_to or max((r.booked_on for r in parsed.rows), default=None)
    if parsed.closing_balance_minor is None or end is None:
        return
    exists = db.scalar(select(AccountCheckpoint.id).where(
        AccountCheckpoint.account_id == acc.id, AccountCheckpoint.as_of == end, AccountCheckpoint.source == "statement",
        AccountCheckpoint.balance_minor == parsed.closing_balance_minor))
    if not exists:
        db.add(AccountCheckpoint(user_id=acc.user_id, account_id=acc.id, balance_minor=parsed.closing_balance_minor,
                                 as_of=end, source="statement"))


def user_kind_rules(db: Session, user: User) -> dict[str, str]:
    rows = db.scalars(select(MerchantRule).where(MerchantRule.user_id == user.id, MerchantRule.kind.is_not(None))).all()
    return {r.merchant: r.kind for r in rows}


def _older_than_known(db: Session, acc: Account, parsed: ParsedStatement) -> bool:
    end = parsed.period_to or max((r.booked_on for r in parsed.rows), default=None)
    last = db.scalar(select(func.max(Transaction.booked_on)).where(Transaction.account_id == acc.id))
    return end is not None and last is not None and end < last


def dedup_key(user_id: int, account_id: int, row, seq: int) -> str:
    raw = f"{user_id}|{account_id}|{row.booked_on}|{row.amount_minor}|{row.merchant}|{seq}"
    return hashlib.sha1(raw.encode()).hexdigest()


def import_statement(db: Session, user: User, parsed: ParsedStatement, source: str = "synthetic",
                     target: str = "auto") -> ImportBatch:
    """Idempotent: re-importing the same statement adds no rows (dedup on date, amount, merchant, occurrence #)."""
    acc = get_or_create_account(db, user, parsed, target)
    batch = ImportBatch(user_id=user.id, bank=parsed.bank, source=source, status="done", account_id=acc.id)
    db.add(batch)
    db.flush()
    rules = user_rules(db, user)
    kind_rules = user_kind_rules(db, user)
    seen: Counter = Counter()
    added = review = 0
    dates = []
    for row in parsed.rows:
        base = (row.booked_on, row.amount_minor, row.merchant)
        seq = seen[base]
        seen[base] += 1
        key = dedup_key(user.id, acc.id, row, seq)
        dates.append(row.booked_on)
        if db.scalar(select(Transaction.id).where(Transaction.user_id == user.id, Transaction.dedup_key == key)):
            continue
        cat = categorize(row.merchant, rules)
        db.add(Transaction(user_id=user.id, account_id=acc.id, batch_id=batch.id, booked_on=row.booked_on,
                           amount_minor=row.amount_minor, currency=row.currency, merchant=row.merchant,
                           category_id=cat.category_id, category_source=cat.source, needs_review=cat.needs_review,
                           internal=row.internal, user_kind=kind_rules.get(row.merchant), dedup_key=key))
        added += 1
        review += cat.needs_review
    batch.parsed, batch.needs_review = added, review
    if parsed.period_from and parsed.period_to:
        batch.period_from, batch.period_to = parsed.period_from, parsed.period_to
    elif dates:
        batch.period_from, batch.period_to = min(dates), max(dates)
    record_statement_checkpoint(db, acc, parsed)
    db.flush()
    mark_internal_transfers(db, user)
    detect_recurring(db, user)
    db.commit()
    return batch


def transfer_candidates(db: Session, user: User) -> list[tuple[Transaction, list[Transaction]]]:
    """For every outgoing operation not yet a transfer: incoming operations on another own account with the same
    amount and currency within +-1 day."""
    txs = db.scalars(select(Transaction).where(Transaction.user_id == user.id, Transaction.internal.is_(False),
                                               Transaction.user_kind.is_(None), Transaction.voided.is_(False),
                                               Transaction.category_id == "transfers")).all()
    outs = [t for t in txs if t.amount_minor < 0]
    ins = [t for t in txs if t.amount_minor > 0]
    out = []
    for o in outs:
        match = [i for i in ins if i.account_id != o.account_id and i.amount_minor == -o.amount_minor
                 and i.currency == o.currency and abs((i.booked_on - o.booked_on).days) <= 1]
        if match:
            out.append((o, match))
    return out


def mark_internal_transfers(db: Session, user: User) -> int:
    """Link a pair automatically only when it is unambiguous: the outgoing operation has exactly one incoming twin
    and that twin matches no other outgoing operation. Ambiguous pairs wait for the user (GET /transfers/candidates)."""
    pairs = transfer_candidates(db, user)
    twins_of: Counter = Counter(i.id for _, ins in pairs for i in ins)
    marked = 0
    for o, ins in pairs:
        if len(ins) == 1 and twins_of[ins[0].id] == 1:
            i = ins[0]
            group = f"auto-{o.id}-{i.id}"
            o.internal = i.internal = True
            o.needs_review = i.needs_review = False
            o.transfer_group = i.transfer_group = group
            marked += 2
    return marked


def _kind(name: str, category: str) -> str:
    low = name.lower()
    if category == "housing":
        return "rent" if "аренда" in low else "utility"
    if category == "credit":
        return "installment" if "рассрочка" in low else "credit"
    return "subscription"


def detect_recurring(db: Session, user: User) -> tuple[int, int]:
    """Find monthly obligations and incomes: same merchant in >= 3 distinct months, similar amount and day."""
    txs = db.scalars(select(Transaction).where(Transaction.user_id == user.id, Transaction.internal.is_(False))).all()
    groups: dict[tuple[str, bool], list[Transaction]] = defaultdict(list)
    for t in txs:
        groups[(t.merchant, t.amount_minor > 0)].append(t)
    existing_ob = {o.name for o in db.scalars(select(Obligation).where(Obligation.user_id == user.id))}
    existing_in = {i.name for i in db.scalars(select(IncomeSource).where(IncomeSource.user_id == user.id))}
    new_ob = new_in = 0
    newest = max((t.booked_on for t in txs), default=None)
    for (merchant, is_income), items in groups.items():
        min_months = 3
        if not is_income and items[0].category_id == "credit":
            # Loan payments change when a loan is replaced or topped up: take the amount cluster (+-3%) that repeats
            # in the most months, accept two months for it, but only while it is still being paid (last 45 days).
            best = _best_cluster(items)
            if newest and (newest - max(t.booked_on for t in best)).days <= 45:
                items, min_months = best, 2
        months = {(t.booked_on.year, t.booked_on.month) for t in items}
        if len(months) < min_months:
            continue
        amounts = sorted(abs(t.amount_minor) for t in items)
        median = amounts[len(amounts) // 2]
        if any(abs(a - median) > 0.05 * median for a in amounts):
            continue
        days = sorted(t.booked_on.day for t in items)
        if days[-1] - days[0] > 3:
            continue
        day = days[len(days) // 2]
        category = items[0].category_id
        if is_income:
            if category == "income" and merchant not in existing_in:
                db.add(IncomeSource(user_id=user.id, name=merchant, amount_minor=median, day_of_month=day, detected=True))
                new_in += 1
            continue
        is_sub = any(h in merchant.lower() for h in SUBSCRIPTION_HINTS)
        if category in ("housing", "credit") or is_sub:
            if merchant not in existing_ob:
                ends = _installment_end(merchant)
                db.add(Obligation(user_id=user.id, name=merchant, kind=_kind(merchant, "other" if is_sub else category),
                                  amount_minor=median, day_of_month=day, ends_at=ends, detected=True))
                new_ob += 1
    return new_ob, new_in


def _best_cluster(items: list[Transaction]) -> list[Transaction]:
    def near(seed: Transaction) -> list[Transaction]:
        return [t for t in items if abs(abs(t.amount_minor) - abs(seed.amount_minor)) <= 0.03 * abs(seed.amount_minor)]

    return max((near(t) for t in items),
               key=lambda c: (len({(t.booked_on.year, t.booked_on.month) for t in c}), max(t.booked_on for t in c)))


def _installment_end(merchant: str) -> str | None:
    """End dates are unknown from a statement alone; demo merchants carry known terms (user confirms in onboarding)."""
    known = {"Kaspi Рассрочка — iPhone": "2027-04", "Halyk Кредит наличными": "2028-02"}
    return known.get(merchant)

