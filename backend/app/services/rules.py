"""Amount rules: the monthly amount of an obligation or a planned item computed from a formula.

Every rule kind compiles to one expression in the safe formula language (app/engine/formula.py). Variables are known
per month; an unknown input (no confirmed income) leaves the amount uncomputed instead of turning it into 0."""
import calendar as cal
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.formula import FormulaError, MissingInput, check, evaluate
from app.models import AmountOverride, AmountRule, IncomeSource, Obligation, PlannedPayment, Transaction, User
from app.services.accounts import eff_amount, eff_date, is_cashflow
from app.services.ledger import add_months, month_key

VARIABLES = {
    "days_in_month": "дней в месяце (28–31)",
    "days_left": "дней до конца месяца, включая сегодня (для будущих месяцев — все дни)",
    "income_month": "ожидаемый доход месяца: сумма подтверждённых выплат",
    "income_min": "осторожный доход: нижние границы подтверждённых выплат",
    "income_max": "верхние границы подтверждённых выплат",
    "income_confirmed": "доход, уже пришедший в этом месяце по операциям (для будущих месяцев неизвестен)",
}
INCOME_VARS = {"income_month", "income_min", "income_max"}
KINDS = ("per_day", "percent_income", "percent_of", "fixed_plus", "formula")


def ref_name(target_type: str, target_id: int) -> str:
    return f"{'ob' if target_type == 'obligation' else 'pl'}_{target_id}"


def _money(v: Decimal) -> str:
    q = v.quantize(Decimal("1")) if v == v.to_integral_value() else v
    s = f"{q:,.2f}" if q != q.to_integral_value() else f"{q:,.0f}"
    return s.replace(",", " ").replace(".", ",") + " ₸"


def compile_rule(kind: str, params: dict, expression: str | None = None) -> str:
    """Rule parameters → one formula. Raises ValueError for bad parameters."""
    def num(key: str) -> str:
        try:
            v = Decimal(str(params[key]).replace(",", "."))
        except Exception:
            raise ValueError(f"укажите число: {key}") from None
        if v < 0:
            raise ValueError(f"{key} не может быть отрицательным")
        return str(v)

    if kind == "per_day":
        return f"{num('perDay')} * {'days_left' if params.get('days') == 'left' else 'days_in_month'}"
    if kind == "percent_income":
        base = params.get("base", "income_min")
        if base not in ("income_month", "income_min", "income_max", "income_confirmed"):
            raise ValueError("неизвестная база дохода")
        return f"{num('percent')} / 100 * {base}"
    if kind == "percent_of":
        ref = str(params.get("ref", ""))
        if not (ref.startswith("ob_") or ref.startswith("pl_")):
            raise ValueError("выберите статью, от которой считается процент")
        return f"{num('percent')} / 100 * {ref}"
    if kind == "fixed_plus":
        extra = (params.get("formula") or "0").strip()
        return f"{num('fixed')} + ({extra})"
    if kind == "formula":
        if not expression:
            raise ValueError("введите формулу")
        return expression.strip()
    raise ValueError("неизвестный тип правила")


@dataclass
class Computed:
    amount: Decimal | None
    explanation: str
    estimate: bool
    overridden: bool = False
    missing: str | None = None
    rule: AmountRule | None = None
    warnings: list[str] = field(default_factory=list)


def _incomes(db: Session, user: User) -> list[IncomeSource]:
    return list(db.scalars(select(IncomeSource).where(IncomeSource.user_id == user.id, IncomeSource.confirmed.is_(True),
                                                      IncomeSource.rejected.is_(False))))


def env_for(db: Session, user: User, month: str, today: date, with_refs: bool = True) -> dict[str, Decimal | None]:
    y, m = (int(x) for x in month.split("-"))
    days = cal.monthrange(y, m)[1]
    cur = month_key(today)
    left = days if month > cur else (days - today.day + 1 if month == cur else 0)
    inc = _incomes(db, user)
    env: dict[str, Decimal | None] = {
        "days_in_month": Decimal(days),
        "days_left": Decimal(left),
        "income_month": Decimal(sum(i.amount_minor for i in inc)) / 100 if inc else None,
        "income_min": Decimal(sum(i.amount_min_minor or i.amount_minor for i in inc)) / 100 if inc else None,
        "income_max": Decimal(sum(i.amount_max_minor or i.amount_minor for i in inc)) / 100 if inc else None,
        "income_confirmed": None,
    }
    if month <= cur:
        first = date(y, m, 1)
        rows = db.execute(select(eff_amount).where(Transaction.user_id == user.id, is_cashflow(), eff_amount > 0,
                                                   Transaction.category_id == "income", eff_date >= first,
                                                   eff_date <= date(y, m, days))).scalars().all()
        env["income_confirmed"] = Decimal(sum(rows)) / 100
    if with_refs:
        for o in db.scalars(select(Obligation).where(Obligation.user_id == user.id, Obligation.rejected.is_(False))):
            c = compute(db, user, "obligation", o.id, month, today, refs=False)
            env[ref_name("obligation", o.id)] = c.amount if c else Decimal(o.amount_minor) / 100
        for p in db.scalars(select(PlannedPayment).where(PlannedPayment.user_id == user.id)):
            c = compute(db, user, "planned", p.id, month, today, refs=False)
            env[ref_name("planned", p.id)] = c.amount if c else Decimal(p.amount_minor) / 100
    return env


def rule_for(db: Session, user: User, target_type: str, target_id: int, month: str) -> AmountRule | None:
    """The version valid in this month (latest valid_from not after it); a 'none' version means no rule."""
    r = db.scalar(select(AmountRule).where(AmountRule.user_id == user.id, AmountRule.target_type == target_type,
                                           AmountRule.target_id == target_id, AmountRule.valid_from <= month)
                  .order_by(AmountRule.valid_from.desc(), AmountRule.id.desc()))
    return None if r is None or r.kind == "none" else r


def explain(kind: str, params: dict, expression: str, env: dict, amount: Decimal) -> str:
    if kind == "per_day":
        days = env["days_left" if params.get("days") == "left" else "days_in_month"]
        return f"{_money(Decimal(str(params['perDay'])))} × {int(days)} дн. = {_money(amount)}"
    if kind == "percent_income":
        base = env.get(params.get("base", "income_min"))
        return f"{params['percent']} % × {_money(base or Decimal(0))} = {_money(amount)}"
    if kind == "percent_of":
        base = env.get(params.get("ref", ""))
        return f"{params['percent']} % × {_money(base or Decimal(0))} = {_money(amount)}"
    return f"{expression} = {_money(amount)}"


def evaluate_rule(kind: str, params: dict, expression: str, env: dict, month: str, today: date) -> Computed:
    try:
        value = evaluate(expression, env)
    except MissingInput as e:
        what = "нужен подтверждённый доход" if e.name.startswith("income") else f"нет значения {e.name}"
        return Computed(None, f"не рассчитано: {what}", estimate=True, missing=e.name)
    if value < 0:
        value = Decimal(0)
    estimate = month > month_key(today) or any(v in expression for v in INCOME_VARS)
    return Computed(value, explain(kind, params, expression, env, value), estimate)


def compute(db: Session, user: User, target_type: str, target_id: int, month: str, today: date,
            refs: bool = True) -> Computed | None:
    """Amount of an item in a month from its override or rule; None when it has neither (the fixed amount applies)."""
    ov = db.scalar(select(AmountOverride).where(AmountOverride.user_id == user.id, AmountOverride.target_type == target_type,
                                                AmountOverride.target_id == target_id, AmountOverride.month == month))
    if ov is not None:
        v = Decimal(ov.amount_minor) / 100
        return Computed(v, f"задано вручную на {month}: {_money(v)}", estimate=False, overridden=True)
    r = rule_for(db, user, target_type, target_id, month)
    if r is None:
        return None
    env = env_for(db, user, month, today, with_refs=refs)
    if not refs and any(t in r.expression for t in ("ob_", "pl_")):
        return None  # a reference inside a reference is not followed (no cycles)
    c = evaluate_rule(r.kind, r.params, r.expression, env, month, today)
    c.rule = r
    return c


def validate(db: Session, user: User, kind: str, params: dict, expression: str | None) -> str:
    """Compile and check the rule (syntax, known variables and references). Raises ValueError or FormulaError."""
    expr = compile_rule(kind, params, expression)
    names = set(VARIABLES)
    names |= {ref_name("obligation", i) for i in db.scalars(select(Obligation.id).where(Obligation.user_id == user.id))}
    names |= {ref_name("planned", i) for i in db.scalars(select(PlannedPayment.id).where(PlannedPayment.user_id == user.id))}
    check(expr, names)
    return expr


def months_ahead(today: date, n: int = 3) -> list[str]:
    first = today.replace(day=1)
    return [month_key(add_months(first, i)) for i in range(n)]


__all__ = ["VARIABLES", "KINDS", "FormulaError", "compile_rule", "compute", "validate", "evaluate_rule", "env_for",
           "months_ahead", "rule_for", "ref_name"]
