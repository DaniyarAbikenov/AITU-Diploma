"""Statement import pipeline: accounts -> dedup -> categorization -> internal transfers -> recurring detection."""
import hashlib
from collections import Counter, defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import SUBSCRIPTION_HINTS
from app.engine.categorization import categorize
from app.models import Account, ImportBatch, IncomeSource, MerchantRule, Obligation, Transaction, User
from app.parsers.base import ParsedStatement


def user_rules(db: Session, user: User) -> dict[str, str]:
    rows = db.scalars(select(MerchantRule).where(MerchantRule.user_id == user.id)).all()
    return {r.merchant: r.category_id for r in rows}


def get_or_create_account(db: Session, user: User, parsed: ParsedStatement) -> Account:
    acc = db.scalar(select(Account).where(Account.user_id == user.id, Account.bank == parsed.bank,
                                          Account.name == parsed.account_name))
    if acc is None:
        acc = Account(user_id=user.id, bank=parsed.bank, name=parsed.account_name, currency="KZT",
                      balance_minor=parsed.closing_balance_minor or 0)
        db.add(acc)
        db.flush()
    return acc


def dedup_key(user_id: int, account_id: int, row, seq: int) -> str:
    raw = f"{user_id}|{account_id}|{row.booked_on}|{row.amount_minor}|{row.merchant}|{seq}"
    return hashlib.sha1(raw.encode()).hexdigest()


def import_statement(db: Session, user: User, parsed: ParsedStatement, source: str = "synthetic") -> ImportBatch:
    """Idempotent: re-importing the same statement adds no rows (dedup on date, amount, merchant, occurrence #)."""
    acc = get_or_create_account(db, user, parsed)
    batch = ImportBatch(user_id=user.id, bank=parsed.bank, source=source, status="done")
    db.add(batch)
    db.flush()
    rules = user_rules(db, user)
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
                           internal=row.internal, dedup_key=key))
        added += 1
        review += cat.needs_review
    batch.parsed, batch.needs_review = added, review
    if dates:
        batch.period_from, batch.period_to = min(dates), max(dates)
    db.flush()
    mark_internal_transfers(db, user)
    detect_recurring(db, user)
    db.commit()
    return batch


def mark_internal_transfers(db: Session, user: User) -> int:
    """A transfer out of one own account matched by an equal transfer in on another within +-1 day is internal:
    it moves money between the user's accounts and is excluded from income and expense."""
    txs = db.scalars(select(Transaction).where(Transaction.user_id == user.id, Transaction.category_id == "transfers",
                                               Transaction.internal.is_(False))).all()
    outs = [t for t in txs if t.amount_minor < 0]
    ins = [t for t in txs if t.amount_minor > 0]
    used: set[int] = set()
    marked = 0
    for o in outs:
        for i in ins:
            if i.id in used or i.account_id == o.account_id or i.amount_minor != -o.amount_minor:
                continue
            if abs((i.booked_on - o.booked_on).days) <= 1:
                o.internal = i.internal = True
                o.needs_review = i.needs_review = False
                used.add(i.id)
                marked += 2
                break
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

