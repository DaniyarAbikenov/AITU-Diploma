"""Rule-based insights and early warnings built from forecasts. Every insight carries a stable key so it can be
dismissed, a one-line reason and a single action."""
from datetime import date

from app.engine.forecast import MonthEnd
from app.services.ledger import Context
from app.services.scenarios import fmt_money

MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
MONTHS_NOM = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"]


def build(ctx: Context, me: MonthEnd, risk_days: list[dict], personal: dict, income_monthly: float) -> list[dict]:
    out: list[dict] = []
    if risk_days:
        first = risk_days[0]
        d = date.fromisoformat(first["date"])
        p = round(first["pBelowZero"] * 100)
        out.append({"id": "shortfall", "status": "risk" if p >= 20 else "warn",
                    "title": f"Возможен минус около {d.day} {MONTHS_GEN[d.month - 1]}",
                    "why": f"{first['reason']}. Вероятность отрицательного остатка в этот день около {p}%.",
                    "action": "Посмотреть прогноз", "to": "/forecast"})
    if me.prev_month > 0 and me.median > me.prev_month * 1.10:
        pct = round((me.median / me.prev_month - 1) * 100)
        out.append({"id": "pace", "status": "warn", "title": f"К концу месяца расходы около {fmt_money(me.median)}",
                    "why": f"Это на {pct}% больше прошлого месяца ({fmt_money(me.prev_month)}). Сейчас вы тратите {fmt_money(me.pace_per_day)} в день.",
                    "action": "Открыть расходы", "to": "/expenses"})
    for name, delta in me.drivers:
        if delta >= 15_000:
            out.append({"id": "cat-growth", "status": "warn", "title": f"{name}: +{fmt_money(delta)} к прошлому месяцу",
                        "why": "Если темп сохранится, эта категория вырастет сильнее остальных.",
                        "action": "Открыть расходы", "to": "/expenses"})
            break
    if personal["personal"] - personal["official"] >= 0.01:
        out.append({"id": "inflation", "status": "warn", "title": "Ваша личная инфляция выше официальной",
                    "why": f"Цены на то, что покупаете именно вы, растут на {personal['personal'] * 100:.1f}% против {personal['official'] * 100:.1f}% в среднем по стране.",
                    "action": "Почему так", "to": "/macro"})
    debt = sum(o.amount for o in ctx.obligations if o.kind in ("credit", "installment"))
    ending = sorted((o for o in ctx.obligations if o.kind in ("credit", "installment") and o.ends_at), key=lambda o: o.ends_at)
    if ending and income_monthly > 0:
        o = ending[0]
        y, m = (int(x) for x in o.ends_at.split("-"))
        if (y - ctx.as_of.year) * 12 + m - ctx.as_of.month <= 12:
            before, after = debt / income_monthly, (debt - o.amount) / income_monthly
            out.append({"id": "end-soonest", "status": "ok", "title": f"«{o.name}» закончится в {MONTHS_NOM[m - 1]}",
                        "why": f"После этого долговая нагрузка снизится с {before * 100:.0f}% до {after * 100:.0f}%, освободится {fmt_money(o.amount)} в месяц.",
                        "action": "К обязательствам", "to": "/debts"})
    return out
