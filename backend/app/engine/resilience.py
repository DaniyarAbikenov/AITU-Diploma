"""Resilience index. Main indicator: probability of a cash shortfall (balance < 0) within 90 days.
The 0-100 index is a transparent weighted sum of components; thresholds and weights are listed below and
documented in docs/architecture.md section 4.6."""
from dataclasses import dataclass

from app.engine.montecarlo import Shocks
from app.services.ledger import Context, month_has_data, monthly_totals

WEIGHTS = {"shortfall": 0.25, "buffer": 0.25, "dti": 0.20, "volatility": 0.10, "income": 0.10, "fx": 0.10}


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _fmt_pct(x: float) -> str:
    return f"{round(x * 100)}%"


def _fmt_months(x: float) -> str:
    return f"{x:.1f}".replace(".", ",") + " мес."


@dataclass
class Result:
    score: int
    p_shortfall: float
    runway_months: float
    dti: float
    components: list[dict]


def _monthly_income(ctx: Context) -> float:
    declared = sum(i.amount for i in ctx.incomes)
    if declared > 0:
        return declared
    totals = [v["income"] for v in monthly_totals(ctx, 3).values() if v["income"] > 0]
    return sum(totals) / len(totals) if totals else 0.0


def compute(ctx: Context, p_shortfall: float, shocks: Shocks | None = None) -> Result:
    shocks = shocks or Shocks()
    income = _monthly_income(ctx) * (1 - shocks.income_cut / 100)
    if shocks.job_loss_months:
        income = 0.0
    debt = sum(o.amount for o in ctx.obligations if o.kind in ("credit", "installment"))
    fixed = sum(o.amount for o in ctx.obligations)
    essential = sum(v for c, v in ctx.var_by_category.items() if c in ("food", "transport", "health"))
    window = max(len(ctx.var_all), 1)
    mandatory = fixed + essential / window * 30 * (1 + shocks.fx / 100 * ctx.fx_weight)
    runway = ctx.balance / mandatory if mandatory > 0 else 12.0
    dti = debt / income if income > 0 else (1.0 if debt > 0 else 0.0)

    totals = [v for k, v in monthly_totals(ctx, 6).items() if month_has_data(ctx, k) and v["expense"] > 0]
    cv = None
    if len(totals) >= 3:
        vals = [t["expense"] for t in totals]
        mean = sum(vals) / len(vals)
        cv = (sum((x - mean) ** 2 for x in vals) / len(vals)) ** 0.5 / mean if mean else 0.0
    recent = list(monthly_totals(ctx, 3).values())
    income_months = sum(1 for v in recent if v["income"] > 0)
    fx_share = ctx.fx_weight

    comps = []

    def status(value: float, ok: float, warn: float, higher_is_worse: bool = True) -> str:
        if higher_is_worse:
            return "ok" if value < ok else "warn" if value < warn else "risk"
        return "ok" if value >= ok else "warn" if value >= warn else "risk"

    st = status(runway, 3, 1.5, higher_is_worse=False)
    comps.append({"key": "buffer", "name": "Финансовая подушка", "status": st, "value": _fmt_months(runway),
                  "explain": f"Остатка на счетах хватит примерно на {_fmt_months(runway)} обязательных расходов без дохода.",
                  "action": "Откладывать 10% с каждой зарплаты до запаса в 3 месяца" if st != "ok" else "Запас достаточный, поддерживайте его"})
    st = status(dti, 0.2, 0.35)
    comps.append({"key": "dti", "name": "Долговая нагрузка (КДН)", "status": st, "value": _fmt_pct(dti),
                  "explain": f"Платежи по кредитам и рассрочкам забирают {_fmt_pct(dti)} дохода. Комфортно до 30%, банки смотрят на 50%.",
                  "action": "Не брать новые рассрочки, пока нагрузка не снизится" if st != "ok" else "Нагрузка в норме"})
    if cv is None:
        comps.append({"key": "volatility", "name": "Стабильность расходов", "status": "warn", "value": "мало данных",
                      "explain": "Для оценки нужно хотя бы три полных месяца выписок.", "action": "Загрузите выписки за больший период"})
        vol_score = 0.5
    else:
        st = status(cv, 0.10, 0.20)
        vol_score = 1 - _clamp01(cv / 0.3)
        comps.append({"key": "volatility", "name": "Стабильность расходов", "status": st, "value": f"±{round(cv * 100)}%",
                      "explain": f"Расходы колеблются от месяца к месяцу примерно на {round(cv * 100)}%.",
                      "action": "Поставить лимиты на самые изменчивые категории" if st != "ok" else "Расходы стабильны"})
    st = "ok" if income_months == 3 else "warn" if income_months == 2 else "risk"
    comps.append({"key": "income", "name": "Стабильность дохода", "status": st, "value": f"{income_months} из 3 мес.",
                  "explain": f"Доход поступал в {income_months} из последних 3 месяцев.",
                  "action": "Всё в порядке, ничего делать не нужно" if st == "ok" else "Проверьте, все ли источники дохода есть в выписках"})
    st = status(fx_share, 0.15, 0.30)
    comps.append({"key": "fx", "name": "Валютный риск", "status": st, "value": _fmt_pct(fx_share) + " расходов",
                  "explain": f"Около {_fmt_pct(fx_share)} ваших трат следует за курсом доллара (оценка по категориям).",
                  "action": "Следить за покупками импортной техники" if st != "ok" else "Зависимость от курса небольшая"})

    parts = {
        "shortfall": 1 - _clamp01(p_shortfall), "buffer": _clamp01(runway / 6), "dti": 1 - _clamp01(dti / 0.5),
        "volatility": vol_score, "income": income_months / 3, "fx": 1 - _clamp01(fx_share / 0.5),
    }
    score = int(round(100 * sum(WEIGHTS[k] * v for k, v in parts.items())))
    return Result(score=score, p_shortfall=p_shortfall, runway_months=round(runway, 1), dti=dti, components=comps)
