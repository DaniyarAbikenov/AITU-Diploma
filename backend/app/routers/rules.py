"""Amount rules for obligations and planned items, month overrides, preview."""
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import as_of
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.money import to_major, to_minor
from app.core.security import current_user
from app.engine.formula import FormulaError
from app.models import AmountOverride, AmountRule, Obligation, PlannedPayment, User
from app.schemas import Ok, OverrideIn, RuleIn, RuleInfoOut, RulePreviewIn, RulePreviewOut, RuleVariableOut
from app.services import rules as svc
from app.services.ledger import month_key

router = APIRouter(tags=["planning"])
TARGETS = {"obligation": Obligation, "planned": PlannedPayment}


def _target(db: Session, u: User, target_type: str, target_id: int):
    model = TARGETS.get(target_type)
    row = db.get(model, target_id) if model else None
    if row is None or row.user_id != u.id:
        raise ApiError(404, "Статья не найдена")
    return row


def _major(v: Decimal | None):
    return None if v is None else to_major(to_minor(float(v)))


def rule_info(db: Session, u: User, target_type: str, target_id: int, month: str | None = None) -> RuleInfoOut | None:
    """Rule view for an item: this month (or the given one) plus the next two months."""
    today = as_of(u)
    month = month or month_key(today)
    months = svc.months_ahead(today) if month == month_key(today) else [month]
    first = svc.compute(db, u, target_type, target_id, month, today)
    r = svc.rule_for(db, u, target_type, target_id, month)
    if first is None or (r is None and not first.overridden):
        return None
    by_month = {}
    for m in months:
        c = svc.compute(db, u, target_type, target_id, m, today)
        by_month[m] = _major(c.amount) if c else None
    return RuleInfoOut(kind=r.kind if r else "formula", params=r.params if r else {}, expression=r.expression if r else "",
                       validFrom=r.valid_from if r else month, amountThisMonth=_major(first.amount),
                       explanation=first.explanation, estimate=first.estimate, overridden=first.overridden,
                       missing=first.missing, amountsByMonth=by_month)


@router.get("/rules/variables", response_model=list[RuleVariableOut])
def variables(_: User = Depends(current_user)):
    return [RuleVariableOut(name=n, description=d) for n, d in svc.VARIABLES.items()]


@router.post("/rules/preview", response_model=RulePreviewOut)
def preview(body: RulePreviewIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Check a rule and show what it gives for a month, without saving. Errors come with a position."""
    today = as_of(u)
    month = body.month or month_key(today)
    try:
        expr = svc.validate(db, u, body.kind, body.params, body.expression)
    except FormulaError as e:
        return RulePreviewOut(error=e.message, errorPos=e.pos)
    except ValueError as e:
        return RulePreviewOut(error=str(e))
    c = svc.evaluate_rule(body.kind, body.params, expr, svc.env_for(db, u, month, today), month, today)
    return RulePreviewOut(amount=_major(c.amount), explanation=c.explanation, estimate=c.estimate, missing=c.missing,
                          expression=expr)


@router.put("/rules/{target_type}/{target_id}", response_model=RuleInfoOut)
def set_rule(target_type: str, target_id: int, body: RuleIn, u: User = Depends(current_user),
             db: Session = Depends(get_db)):
    """A new rule version valid from the current month; earlier months keep their version (facts are not rewritten).
    A second change in the same month replaces that month's version."""
    _target(db, u, target_type, target_id)
    try:
        expr = svc.validate(db, u, body.kind, body.params, body.expression)
    except FormulaError as e:
        raise ApiError(422, f"Ошибка в формуле: {e}") from None
    except ValueError as e:
        raise ApiError(422, str(e)) from None
    if svc.ref_name(target_type, target_id) in expr:
        raise ApiError(422, "Статья не может ссылаться сама на себя")
    month = month_key(as_of(u))
    same = db.scalar(select(AmountRule).where(AmountRule.user_id == u.id, AmountRule.target_type == target_type,
                                              AmountRule.target_id == target_id, AmountRule.valid_from == month))
    if same is None:
        same = AmountRule(user_id=u.id, target_type=target_type, target_id=target_id, valid_from=month)
        db.add(same)
    same.kind, same.params, same.expression, same.active = body.kind, body.params, expr, True
    db.commit()
    return rule_info(db, u, target_type, target_id)


@router.delete("/rules/{target_type}/{target_id}", response_model=Ok)
def delete_rule(target_type: str, target_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """From this month the entered (fixed) amount applies again; past months keep the rule they used."""
    _target(db, u, target_type, target_id)
    month = month_key(as_of(u))
    same = db.scalar(select(AmountRule).where(AmountRule.user_id == u.id, AmountRule.target_type == target_type,
                                              AmountRule.target_id == target_id, AmountRule.valid_from == month))
    if same is None:
        same = AmountRule(user_id=u.id, target_type=target_type, target_id=target_id, valid_from=month, params={})
        db.add(same)
    same.kind, same.expression, same.params = "none", "0", {}
    db.commit()
    return Ok()


@router.put("/overrides/{target_type}/{target_id}/{month}", response_model=Ok)
def set_override(target_type: str, target_id: int, month: str, body: OverrideIn, u: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    """The user's own amount for one month (over the rule); amount=null removes it."""
    _target(db, u, target_type, target_id)
    if len(month) != 7 or month[4] != "-":
        raise ApiError(422, "Месяц в формате ГГГГ-ММ")
    row = db.scalar(select(AmountOverride).where(AmountOverride.user_id == u.id, AmountOverride.target_type == target_type,
                                                 AmountOverride.target_id == target_id, AmountOverride.month == month))
    if body.amount is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(AmountOverride(user_id=u.id, target_type=target_type, target_id=target_id, month=month,
                              amount_minor=to_minor(body.amount)))
    else:
        row.amount_minor = to_minor(body.amount)
    db.commit()
    return Ok()
