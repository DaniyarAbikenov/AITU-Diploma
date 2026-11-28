import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.core.config import as_of
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.money import to_major, to_minor
from app.core.security import current_user
from app.models import (
    Account,
    AccountCheckpoint,
    Category,
    ImportBatch,
    MerchantRule,
    PlannedSettlement,
    Transaction,
    TransactionEdit,
    User,
)
from app.parsers import synthetic
from app.parsers.registry import pick_parser
from app.schemas import (
    AccountIn,
    AccountOut,
    AccountPatch,
    BulkCategorizeIn,
    CategoryOut,
    CheckpointIn,
    CheckpointOut,
    ImportAccountOption,
    ImportPreviewOut,
    ImportReportOut,
    MerchantRuleOut,
    MoveOperationsIn,
    Ok,
    RecategorizeIn,
    TransactionEditOut,
    TransactionIn,
    TransactionOut,
    TxKindIn,
)
from app.services import accounts as acc_svc
from app.services import imports

router = APIRouter(tags=["data"])
MAX_UPLOAD = 10 * 1024 * 1024
SYNTHETIC_DAYS = 130


def tx_out(t: Transaction) -> TransactionOut:
    corrected = t.source == "import" and (t.user_amount_minor is not None or t.user_booked_on is not None)
    original = {"amount": to_major(t.amount_minor), "date": t.booked_on.isoformat()} if corrected else None
    return TransactionOut(id=str(t.id), date=acc_svc.tx_date(t).isoformat(), amount=to_major(acc_svc.tx_amount(t)),
                          currency=t.currency, merchant=t.merchant, categoryId=t.category_id, accountId=str(t.account_id),
                          needsReview=t.needs_review, internal=t.internal, kind=acc_svc.effective_kind(t),
                          kindSource="user" if t.user_kind else "auto", source=t.source, note=t.user_note,
                          voided=t.voided, original=original, transferGroup=t.transfer_group)


def _snapshot(t: Transaction) -> dict:
    o = tx_out(t)
    return {"date": o.date, "amount": o.amount, "merchant": o.merchant, "category": o.categoryId, "note": o.note,
            "account": o.accountId, "kind": o.kind, "voided": o.voided}


def _audit(db: Session, t: Transaction, action: str, before: dict | None) -> None:
    after = None if action == "delete" else _snapshot(t)
    db.add(TransactionEdit(user_id=t.user_id, transaction_id=t.id, action=action, before=before, after=after))


def _own_tx(db: Session, u: User, tx_id: int) -> Transaction:
    t = db.get(Transaction, tx_id)
    if not t or t.user_id != u.id:
        raise ApiError(404, "Операция не найдена")
    return t


def _parse_day(value: str) -> date:
    d = date.fromisoformat(value)
    if d > as_of() + timedelta(days=1):
        raise ApiError(422, "Фактическая операция не может быть в будущем. Для будущих трат используйте план.")
    return d


def _default_category(kind: str | None, amount_minor: int) -> str:
    if kind == "transfer_own":
        return "transfers"
    if (kind or "").startswith("income") or (kind is None and amount_minor > 0):
        return "income"
    return "other"


def _category_or_422(db: Session, category_id: str) -> None:
    if db.get(Category, category_id) is None:
        raise ApiError(422, f"Неизвестная категория: {category_id}")


@router.get("/accounts", response_model=list[AccountOut])
def accounts(u: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Account).where(Account.user_id == u.id).order_by(Account.id)).all()
    return [acc_svc.account_out(db, a) for a in rows]


def _own_account(db: Session, u: User, account_id: int) -> Account:
    a = db.get(Account, account_id)
    if not a or a.user_id != u.id:
        raise ApiError(404, "Счёт не найден")
    return a


@router.post("/accounts", response_model=AccountOut, status_code=201)
def create_account(body: AccountIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """An account the user adds by hand (for example cash). It is confirmed by definition."""
    a = Account(user_id=u.id, bank=body.bank.strip(), name=body.name.strip(), currency=body.currency, kind=body.kind,
                confirmed=True, balance_minor=0)
    _apply_availability(a, body, body.model_fields_set)
    db.add(a)
    db.flush()
    if body.balance is not None:
        on = date.fromisoformat(body.balanceAsOf) if body.balanceAsOf else as_of()
        acc_svc.add_checkpoint(db, a, to_minor(body.balance), on, "manual")
    db.commit()
    return acc_svc.account_out(db, a)


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def update_account(account_id: int, body: AccountPatch, u: User = Depends(current_user), db: Session = Depends(get_db)):
    a = _own_account(db, u, account_id)
    for field, attr in (("bank", "bank"), ("name", "name"), ("kind", "kind"), ("currency", "currency"),
                        ("confirmed", "confirmed")):
        value = getattr(body, field)
        if value is not None:
            setattr(a, attr, value.strip() if isinstance(value, str) and field in ("bank", "name") else value)
    _apply_availability(a, body, body.model_fields_set)
    db.commit()
    return acc_svc.account_out(db, a)


def _apply_availability(a: Account, body, sent: set[str]) -> None:
    if "frozenUntil" in sent:
        a.frozen_until = date.fromisoformat(body.frozenUntil) if body.frozenUntil else None
    if "frozenAmount" in sent:
        a.frozen_minor = None if body.frozenAmount is None else to_minor(body.frozenAmount)
    if "interestRate" in sent:
        a.interest_rate = body.interestRate
    if "earlyWithdrawal" in sent:
        a.early_withdrawal = body.earlyWithdrawal


def _cp_out(c: AccountCheckpoint) -> CheckpointOut:
    return CheckpointOut(id=str(c.id), accountId=str(c.account_id), balance=to_major(c.balance_minor),
                         asOf=c.as_of.isoformat(), source=c.source)


@router.get("/accounts/{account_id}/checkpoints", response_model=list[CheckpointOut])
def checkpoints(account_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    a = _own_account(db, u, account_id)
    rows = db.scalars(select(AccountCheckpoint).where(AccountCheckpoint.account_id == a.id)
                      .order_by(AccountCheckpoint.as_of.desc(), AccountCheckpoint.id.desc()))
    return [_cp_out(c) for c in rows]


@router.post("/accounts/{account_id}/checkpoints", response_model=AccountOut, status_code=201)
def add_checkpoint(account_id: int, body: CheckpointIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Record a known balance on a date (FR-12). The balance is what the user or the statement header says,
    never a sum of operations. Saving it also confirms the account."""
    a = _own_account(db, u, account_id)
    on = date.fromisoformat(body.asOf)
    if on > as_of():
        raise ApiError(422, "Дата остатка не может быть в будущем")
    acc_svc.add_checkpoint(db, a, to_minor(body.balance), on, body.source)
    a.confirmed = True
    db.commit()
    return acc_svc.account_out(db, a)


@router.get("/categories", response_model=list[CategoryOut])
def categories(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return [CategoryOut(id=c.id, name=c.name, color=c.color) for c in db.scalars(select(Category))]


@router.get("/transactions", response_model=list[TransactionOut])
def transactions(date_from: date | None = None, date_to: date | None = None, category: str | None = None,
                 account: int | None = None, bank: str | None = None, q: str | None = None, limit: int = 5000,
                 offset: int = 0, u: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Transaction).where(Transaction.user_id == u.id)
    if bank:
        stmt = stmt.join(Account, Account.id == Transaction.account_id).where(Account.bank == bank)
    if date_from:
        stmt = stmt.where(acc_svc.eff_date >= date_from)
    if date_to:
        stmt = stmt.where(acc_svc.eff_date <= date_to)
    if category:
        stmt = stmt.where(Transaction.category_id == category)
    if account:
        stmt = stmt.where(Transaction.account_id == account)
    if q:
        stmt = stmt.where(Transaction.merchant.ilike(f"%{q}%"))
    rows = db.scalars(stmt.order_by(acc_svc.eff_date.desc(), Transaction.id.desc()).limit(min(limit, 10000)).offset(offset))
    return [tx_out(t) for t in rows]


@router.post("/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(body: TransactionIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """A manual operation (cash, a purchase not imported yet). Negative amount = money out."""
    if body.amount == 0:
        raise ApiError(422, "Сумма операции не может быть нулевой")
    acc = _own_account(db, u, int(body.accountId)) if body.accountId.isdigit() else None
    if acc is None:
        raise ApiError(404, "Счёт не найден")
    amount = to_minor(body.amount)
    category = body.category or _default_category(body.kind, amount)
    _category_or_422(db, category)
    t = Transaction(user_id=u.id, account_id=acc.id, booked_on=_parse_day(body.date), amount_minor=amount,
                    currency=acc.currency, merchant=body.merchant.strip(), category_id=category, category_source="user",
                    needs_review=False, internal=body.kind == "transfer_own", user_kind=body.kind, source="manual",
                    user_note=(body.note or "").strip() or None, dedup_key="manual-" + uuid.uuid4().hex)
    db.add(t)
    db.flush()
    _audit(db, t, "create", None)
    db.commit()
    return tx_out(t)


@router.patch("/transactions/{tx_id}", response_model=TransactionOut)
def update_transaction(tx_id: int, body: RecategorizeIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Manual operations are edited directly. For an imported one the change is stored as a user correction
    (user_amount_minor, user_booked_on, user_note) next to the untouched original, with before/after history."""
    t = _own_tx(db, u, tx_id)
    before = _snapshot(t)
    sent = body.model_fields_set
    if body.category is not None:
        _category_or_422(db, body.category)
        t.category_id, t.category_source, t.needs_review = body.category, "user", False
    if body.amount is not None:
        if body.amount == 0:
            raise ApiError(422, "Сумма операции не может быть нулевой")
        if t.source == "manual":
            t.amount_minor = to_minor(body.amount)
        else:
            t.user_amount_minor = None if to_minor(body.amount) == t.amount_minor else to_minor(body.amount)
    if body.date is not None:
        d = _parse_day(body.date)
        if t.source == "manual":
            t.booked_on = d
        else:
            t.user_booked_on = None if d == t.booked_on else d
    if "note" in sent:
        t.user_note = (body.note or "").strip() or None
    if t.source == "manual":
        if body.merchant:
            t.merchant = body.merchant.strip()
        if body.accountId:
            t.account_id = _own_account(db, u, int(body.accountId)).id
    elif body.merchant and body.merchant.strip() != t.merchant:
        t.user_note = body.merchant.strip()  # the imported description stays; the user's wording goes to the note
    db.flush()
    if _snapshot(t) != before:
        _audit(db, t, "update", before)
    db.commit()
    return tx_out(t)


@router.delete("/transactions/{tx_id}", response_model=Ok)
def delete_transaction(tx_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Manual operations are deleted. Imported ones cannot be: cancel them with POST /transactions/{id}/void."""
    t = _own_tx(db, u, tx_id)
    if t.source != "manual":
        raise ApiError(409, "Операцию из выписки нельзя удалить, её можно только отменить")
    legs = [t]
    if t.transfer_group:  # a transfer is two linked operations: both go together
        legs = list(db.scalars(select(Transaction).where(Transaction.user_id == u.id,
                                                         Transaction.transfer_group == t.transfer_group)))
    for leg in legs:
        _audit(db, leg, "delete", _snapshot(leg))
        db.execute(delete(PlannedSettlement).where(PlannedSettlement.transaction_id == leg.id))
        db.delete(leg)
    db.commit()
    return Ok()


@router.post("/transactions/{tx_id}/void", response_model=TransactionOut)
def void_transaction(tx_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Cancel an operation: it stays in the history but leaves every total, balance and forecast."""
    t = _own_tx(db, u, tx_id)
    before = _snapshot(t)
    t.voided = True
    _audit(db, t, "void", before)
    db.commit()
    return tx_out(t)


@router.post("/transactions/{tx_id}/restore", response_model=TransactionOut)
def restore_transaction(tx_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    t = _own_tx(db, u, tx_id)
    before = _snapshot(t)
    t.voided = False
    _audit(db, t, "restore", before)
    db.commit()
    return tx_out(t)


@router.get("/transactions/{tx_id}/history", response_model=list[TransactionEditOut])
def transaction_history(tx_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    t = _own_tx(db, u, tx_id)
    rows = db.scalars(select(TransactionEdit).where(TransactionEdit.transaction_id == t.id,
                                                    TransactionEdit.user_id == u.id).order_by(TransactionEdit.id))
    return [TransactionEditOut(action=e.action, before=e.before, after=e.after, at=e.created_at.isoformat()) for e in rows]


@router.patch("/transactions/{tx_id}/kind", response_model=TransactionOut)
def set_kind(tx_id: int, body: TxKindIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """The user's decision about the operation type (expense, income, own transfer, transfer to someone else).
    It is stored next to the imported original, which is not changed, and wins over automatic rules (FR-10, FR-17).
    saveRule applies it to every operation of the merchant and to future imports."""
    t = _own_tx(db, u, tx_id)
    before = _snapshot(t)
    t.user_kind = body.kind
    t.needs_review = False
    _audit(db, t, "update", before)
    if body.saveRule:
        for other in db.scalars(select(Transaction).where(Transaction.user_id == u.id, Transaction.merchant == t.merchant)):
            other.user_kind = body.kind
        rule = db.scalar(select(MerchantRule).where(MerchantRule.user_id == u.id, MerchantRule.merchant == t.merchant))
        if rule:
            rule.kind = body.kind
        elif body.kind:
            db.add(MerchantRule(user_id=u.id, merchant=t.merchant, category_id=t.category_id, kind=body.kind))
    db.commit()
    return tx_out(t)


@router.post("/transactions/bulk-categorize", response_model=Ok)
def bulk_categorize(body: BulkCategorizeIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Apply a category to every operation of a merchant and remember it as a rule for future imports."""
    _category_or_422(db, body.category)
    for t in db.scalars(select(Transaction).where(Transaction.user_id == u.id, Transaction.merchant == body.merchant)):
        t.category_id, t.category_source, t.needs_review = body.category, "user", False
    rule = db.scalar(select(MerchantRule).where(MerchantRule.user_id == u.id, MerchantRule.merchant == body.merchant))
    if rule:
        rule.category_id = body.category
    else:
        db.add(MerchantRule(user_id=u.id, merchant=body.merchant, category_id=body.category))
    db.commit()
    return Ok()


@router.get("/merchant-rules", response_model=list[MerchantRuleOut])
def rules(u: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(MerchantRule).where(MerchantRule.user_id == u.id).order_by(MerchantRule.id))
    return [MerchantRuleOut(id=str(r.id), merchant=r.merchant, categoryId=r.category_id, kind=r.kind) for r in rows]


@router.delete("/merchant-rules/{rule_id}", response_model=Ok)
def delete_rule(rule_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(MerchantRule, rule_id)
    if not r or r.user_id != u.id:
        raise ApiError(404, "Правило не найдено")
    db.delete(r)
    db.commit()
    return Ok()


def report(b: ImportBatch, warnings: list[str] | None = None, db: Session | None = None) -> ImportReportOut:
    acc = db.get(Account, b.account_id) if db is not None and b.account_id else None
    return ImportReportOut(id=str(b.id), status=b.status, parsed=b.parsed, needsReview=b.needs_review, bank=b.bank,
                           period={"from": (b.period_from or as_of()).isoformat(), "to": (b.period_to or as_of()).isoformat()},
                           warnings=warnings or [], accountId=str(acc.id) if acc else None,
                           accountName=acc.name if acc else None)


async def _parse_upload(request: Request):
    form = await request.form()
    bank, file = str(form.get("bank", "")), form.get("file")
    if not isinstance(file, UploadFile):
        raise ApiError(422, "Приложите файл выписки в поле file")
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise ApiError(413, "Файл больше 10 МБ")
    try:
        return pick_parser(data, bank)().parse(data), form
    except LookupError as e:
        raise ApiError(422, str(e)) from None
    except NotImplementedError:
        raise ApiError(501, "Разбор PDF-выписок этого банка ещё не реализован. Используйте демо-импорт (JSON).") from None
    except ValueError as e:
        raise ApiError(422, f"Не удалось прочитать выписку: {e}") from None


@router.post("/imports/preview", response_model=ImportPreviewOut)
async def preview_import(request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Parse a PDF without saving anything: which bank and account (number mask from the header), how many operations,
    and which of the user's accounts it would go to. The user confirms or picks another account before importing."""
    parsed, _ = await _parse_upload(request)
    acc, how = imports.match_account(db, u, parsed)
    own = db.scalars(select(Account).where(Account.user_id == u.id).order_by(Account.id)).all()
    dates = [r.booked_on for r in parsed.rows]
    return ImportPreviewOut(
        bank=parsed.bank, accountName=parsed.account_name, numberMask=parsed.account_mask,
        currency=imports.statement_currency(parsed),
        periodFrom=(parsed.period_from or (min(dates) if dates else None) or as_of()).isoformat(),
        periodTo=(parsed.period_to or (max(dates) if dates else None) or as_of()).isoformat(),
        operations=len(parsed.rows),
        closingBalance=None if parsed.closing_balance_minor is None else to_major(parsed.closing_balance_minor),
        suggestedAccountId=str(acc.id) if acc else None, matchedBy=how, needsChoice=how != "number",
        accounts=[ImportAccountOption(id=str(a.id), bank=a.bank, name=a.name, currency=a.currency,
                                      numberMask=a.number_mask) for a in own],
        warnings=parsed.warnings)


@router.post("/accounts/{account_id}/move-operations", response_model=Ok)
def move_operations(account_id: int, body: MoveOperationsIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Move every operation, import record and statement link of one account to another of the user's accounts
    (for a statement that went to the wrong account). Balances on dates (checkpoints) stay with the old account."""
    src = _own_account(db, u, account_id)
    dst = _own_account(db, u, int(body.targetAccountId)) if body.targetAccountId.isdigit() else None
    if dst is None:
        raise ApiError(404, "Счёт не найден")
    if dst.id == src.id:
        raise ApiError(422, "Выберите другой счёт")
    for t in db.scalars(select(Transaction).where(Transaction.user_id == u.id, Transaction.account_id == src.id)):
        before = _snapshot(t)
        t.account_id = dst.id
        db.flush()
        _audit(db, t, "update", before)
    for b in db.scalars(select(ImportBatch).where(ImportBatch.user_id == u.id, ImportBatch.account_id == src.id)):
        b.account_id = dst.id
    if src.statement_key and dst.statement_key is None:
        dst.statement_key, dst.number_mask = src.statement_key, src.number_mask
        src.statement_key, src.number_mask = None, None
    db.commit()
    return Ok()


@router.post("/imports", response_model=ImportReportOut, status_code=201)
async def import_statement(request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """JSON {"bank": "..."} runs a synthetic demo statement through the real pipeline. multipart (fields `bank`,
    `file`, optional `accountId` = "auto" | "new" | an account id) is the real PDF path: the bank is detected from the
    PDF (Kaspi Gold, Halyk, Freedom Bank); the account is the one the user confirmed in the preview."""
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/"):
        parsed, form = await _parse_upload(request)
        try:
            batch = imports.import_statement(db, u, parsed, source="pdf", target=str(form.get("accountId") or "auto"))
        except LookupError as e:
            raise ApiError(404, str(e)) from None
        return report(batch, parsed.warnings, db)
    try:
        bank = (await request.json()).get("bank", "")
    except ValueError:
        raise ApiError(422, "Ожидается JSON {\"bank\": \"...\"} или multipart с файлом") from None
    today = as_of()
    parsed = synthetic.generate(bank, today - timedelta(days=SYNTHETIC_DAYS), today - timedelta(days=1))
    return report(imports.import_statement(db, u, parsed, source="synthetic"), db=db)
