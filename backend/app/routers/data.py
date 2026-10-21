from datetime import date, timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.core.config import as_of
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.money import to_major
from app.core.security import current_user
from app.models import Account, Category, ImportBatch, MerchantRule, Transaction, User
from app.parsers import synthetic
from app.parsers.kaspi import PARSERS
from app.schemas import (
    AccountOut,
    BulkCategorizeIn,
    CategoryOut,
    ImportReportOut,
    MerchantRuleOut,
    Ok,
    RecategorizeIn,
    TransactionOut,
)
from app.services import imports

router = APIRouter(tags=["data"])
MAX_UPLOAD = 10 * 1024 * 1024
SYNTHETIC_DAYS = 130


def tx_out(t: Transaction) -> TransactionOut:
    return TransactionOut(id=str(t.id), date=t.booked_on.isoformat(), amount=to_major(t.amount_minor), currency=t.currency,
                          merchant=t.merchant, categoryId=t.category_id, accountId=str(t.account_id),
                          needsReview=t.needs_review, internal=t.internal)


def _category_or_422(db: Session, category_id: str) -> None:
    if db.get(Category, category_id) is None:
        raise ApiError(422, f"Неизвестная категория: {category_id}")


@router.get("/accounts", response_model=list[AccountOut])
def accounts(u: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Account).where(Account.user_id == u.id).order_by(Account.id)).all()
    return [AccountOut(id=str(a.id), bank=a.bank, name=a.name, currency=a.currency, balance=to_major(a.balance_minor)) for a in rows]


@router.get("/categories", response_model=list[CategoryOut])
def categories(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return [CategoryOut(id=c.id, name=c.name, color=c.color) for c in db.scalars(select(Category))]


@router.get("/transactions", response_model=list[TransactionOut])
def transactions(date_from: date | None = None, date_to: date | None = None, category: str | None = None,
                 account: int | None = None, q: str | None = None, limit: int = 5000, offset: int = 0,
                 u: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Transaction).where(Transaction.user_id == u.id)
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


def report(b: ImportBatch) -> ImportReportOut:
    return ImportReportOut(id=str(b.id), status=b.status, parsed=b.parsed, needsReview=b.needs_review, bank=b.bank,
                           period={"from": (b.period_from or as_of()).isoformat(), "to": (b.period_to or as_of()).isoformat()})


@router.post("/imports", response_model=ImportReportOut, status_code=201)
async def import_statement(request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """JSON {"bank": "..."} runs a synthetic demo statement through the real pipeline. multipart (fields `bank`,
    `file`) is the real PDF path: parsers are registered per bank and Kaspi is the next slice."""
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/"):
        form = await request.form()
        bank, file = str(form.get("bank", "")), form.get("file")
        if not isinstance(file, UploadFile):
            raise ApiError(422, "Приложите файл выписки в поле file")
        data = await file.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise ApiError(413, "Файл больше 10 МБ")
        parser_cls = PARSERS.get(bank.lower().split()[0] if bank else "")
        if parser_cls is None:
            raise ApiError(422, f"Банк «{bank}» пока не поддерживается")
        try:
            parsed = parser_cls().parse(data)
        except NotImplementedError:
            raise ApiError(501, "Разбор PDF-выписок этого банка ещё не реализован. Используйте демо-импорт (JSON).") from None
        batch = imports.import_statement(db, u, parsed, source="pdf")
        return report(batch)
    try:
        bank = (await request.json()).get("bank", "")
    except ValueError:
        raise ApiError(422, "Ожидается JSON {\"bank\": \"...\"} или multipart с файлом") from None
    today = as_of()
    parsed = synthetic.generate(bank, today - timedelta(days=SYNTHETIC_DAYS), today - timedelta(days=1))
    return report(imports.import_statement(db, u, parsed, source="synthetic"))
