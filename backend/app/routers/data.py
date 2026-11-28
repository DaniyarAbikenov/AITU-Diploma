from datetime import date, timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.core.config import as_of
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.money import to_major, to_minor
from app.core.security import current_user
from app.models import Account, AccountCheckpoint, Category, ImportBatch, MerchantRule, Transaction, User
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
    ImportReportOut,
    MerchantRuleOut,
    Ok,
    RecategorizeIn,
    TransactionOut,
    TxKindIn,
)
from app.services import accounts as acc_svc
from app.services import imports

router = APIRouter(tags=["data"])
MAX_UPLOAD = 10 * 1024 * 1024
SYNTHETIC_DAYS = 130


def tx_out(t: Transaction) -> TransactionOut:
    return TransactionOut(id=str(t.id), date=t.booked_on.isoformat(), amount=to_major(t.amount_minor), currency=t.currency,
                          merchant=t.merchant, categoryId=t.category_id, accountId=str(t.account_id),
                          needsReview=t.needs_review, internal=t.internal, kind=acc_svc.effective_kind(t),
                          kindSource="user" if t.user_kind else "auto")


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
    db.commit()
    return acc_svc.account_out(db, a)


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
        stmt = stmt.where(Transaction.booked_on >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.booked_on <= date_to)
    if category:
        stmt = stmt.where(Transaction.category_id == category)
    if account:
        stmt = stmt.where(Transaction.account_id == account)
    if q:
        stmt = stmt.where(Transaction.merchant.ilike(f"%{q}%"))
    rows = db.scalars(stmt.order_by(Transaction.booked_on.desc(), Transaction.id.desc()).limit(min(limit, 10000)).offset(offset))
    return [tx_out(t) for t in rows]


@router.patch("/transactions/{tx_id}", response_model=TransactionOut)
def recategorize(tx_id: int, body: RecategorizeIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    t = db.get(Transaction, tx_id)
    if not t or t.user_id != u.id:
        raise ApiError(404, "Операция не найдена")
    _category_or_422(db, body.category)
    t.category_id, t.category_source, t.needs_review = body.category, "user", False
    db.commit()
    return tx_out(t)


@router.patch("/transactions/{tx_id}/kind", response_model=TransactionOut)
def set_kind(tx_id: int, body: TxKindIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """The user's decision about the operation type (expense, income, own transfer, transfer to someone else).
    It is stored next to the imported original, which is not changed, and wins over automatic rules (FR-10, FR-17).
    saveRule applies it to every operation of the merchant and to future imports."""
    t = db.get(Transaction, tx_id)
    if not t or t.user_id != u.id:
        raise ApiError(404, "Операция не найдена")
    t.user_kind = body.kind
    t.needs_review = False
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
    return [MerchantRuleOut(id=str(r.id), merchant=r.merchant, categoryId=r.category_id) for r in rows]


@router.delete("/merchant-rules/{rule_id}", response_model=Ok)
def delete_rule(rule_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(MerchantRule, rule_id)
    if not r or r.user_id != u.id:
        raise ApiError(404, "Правило не найдено")
    db.delete(r)
    db.commit()
    return Ok()


def report(b: ImportBatch, warnings: list[str] | None = None) -> ImportReportOut:
    return ImportReportOut(id=str(b.id), status=b.status, parsed=b.parsed, needsReview=b.needs_review, bank=b.bank,
                           period={"from": (b.period_from or as_of()).isoformat(), "to": (b.period_to or as_of()).isoformat()},
                           warnings=warnings or [])


@router.post("/imports", response_model=ImportReportOut, status_code=201)
async def import_statement(request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """JSON {"bank": "..."} runs a synthetic demo statement through the real pipeline. multipart (fields `bank`,
    `file`) is the real PDF path: the bank is detected from the PDF (Kaspi Gold, Halyk, Freedom Bank)."""
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/"):
        form = await request.form()
        bank, file = str(form.get("bank", "")), form.get("file")
        if not isinstance(file, UploadFile):
            raise ApiError(422, "Приложите файл выписки в поле file")
        data = await file.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise ApiError(413, "Файл больше 10 МБ")
        try:
            parsed = pick_parser(data, bank)().parse(data)
        except LookupError as e:
            raise ApiError(422, str(e)) from None
        except NotImplementedError:
            raise ApiError(501, "Разбор PDF-выписок этого банка ещё не реализован. Используйте демо-импорт (JSON).") from None
        except ValueError as e:
            raise ApiError(422, f"Не удалось прочитать выписку: {e}") from None
        batch = imports.import_statement(db, u, parsed, source="pdf")
        return report(batch, parsed.warnings)
    try:
        bank = (await request.json()).get("bank", "")
    except ValueError:
        raise ApiError(422, "Ожидается JSON {\"bank\": \"...\"} или multipart с файлом") from None
    today = as_of()
    parsed = synthetic.generate(bank, today - timedelta(days=SYNTHETIC_DAYS), today - timedelta(days=1))
    return report(imports.import_statement(db, u, parsed, source="synthetic"))
