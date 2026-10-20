"""Macro indicators, personal inflation and city prices, built from macro_series / city_prices tables."""
import re
import xml.etree.ElementTree as ET
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Category, CityPrice, MacroSeries
from app.services.ledger import Context


def _series(db: Session, code: str, limit: int = 12) -> list[float]:
    rows = db.scalars(select(MacroSeries).where(MacroSeries.code == code).order_by(MacroSeries.as_of.desc()).limit(limit)).all()
    return [r.value for r in reversed(rows)]


def _ru(x: float, digits: int = 1) -> str:
    return f"{x:.{digits}f}".replace(".", ",")


def _sign(x: float, digits: int = 1) -> str:
    return ("+" if x > 0 else "−" if x < 0 else "") + _ru(abs(x), digits)


def _trend(delta: float, eps: float = 1e-9) -> str:
    return "up" if delta > eps else "down" if delta < -eps else "flat"


def overview(db: Session, ctx: Context) -> list[dict]:
    out = []
    total_exp = sum(ctx.var_by_category.values()) or 1.0
    food_share = round(ctx.var_by_category.get("food", 0.0) / total_exp * 100)

    def get(code):
        return _series(db, code)

    usd, brent, cpi, rate, food = get("usdkzt"), get("brent"), get("cpi"), get("rate"), get("cpi_food")
    if usd:
        pct = (usd[-1] / usd[-2] - 1) * 100 if len(usd) > 1 else 0.0
        out.append({"code": "usdkzt", "name": "USD/KZT", "value": f"{_ru(usd[-1])} ₸", "change": f"{_sign(pct)}% за месяц",
                    "trend": _trend(pct), "series": usd,
                    "why": "Техника, лекарства и часть продуктов импортные: при росте доллара ваши покупки дорожают через 1–3 месяца."})
    if brent:
        pct = (brent[-1] / brent[-2] - 1) * 100 if len(brent) > 1 else 0.0
        out.append({"code": "brent", "name": "Нефть Brent", "value": f"${_ru(brent[-1])}", "change": f"{_sign(pct)}% за месяц",
                    "trend": _trend(pct), "series": brent,
                    "why": "Нефть — главный экспорт Казахстана. Её цена влияет на курс тенге и бюджет страны."})
    if cpi:
        d = cpi[-1] - cpi[-2] if len(cpi) > 1 else 0.0
        out.append({"code": "cpi", "name": "Инфляция, год к году", "value": f"{_ru(cpi[-1])}%", "change": f"{_sign(d)} п.п.",
                    "trend": _trend(d), "series": cpi,
                    "why": "Средний рост цен по стране. Ваша личная инфляция отличается: смотрите блок ниже."})
    if rate:
        d = rate[-1] - rate[-2] if len(rate) > 1 else 0.0
        out.append({"code": "rate", "name": "Базовая ставка НБРК", "value": f"{_ru(rate[-1], 2)}%",
                    "change": "без изменений" if d == 0 else f"{_sign(d, 2)} п.п.", "trend": _trend(d), "series": rate,
                    "why": "От неё зависят ставки по депозитам и новым кредитам. Сравните доходность депозита с инфляцией."})
    if food:
        d = food[-1] - food[-2] if len(food) > 1 else 0.0
        share = f" (у вас {food_share}% трат)" if food_share else ""
        out.append({"code": "food", "name": "Продукты, год к году", "value": f"{_ru(food[-1])}%", "change": f"{_sign(d)} п.п.",
                    "trend": _trend(d), "series": food,
                    "why": f"Рост цен на продукты{share} заметнее всего для бюджета, если эта категория крупная."})
    return out


def personal_inflation(db: Session, ctx: Context, model_version: str) -> dict:
    """Weights = shares of the user's consumption spending over the last 90 days (excluding transfers, loan
    payments and unclassified spend); inflation per category group from the CPI series."""
    from datetime import timedelta

    start = ctx.as_of - timedelta(days=90)
    cats = {c.id: c for c in db.scalars(select(Category))}
    spend: dict[str, float] = {}
    for t in ctx.txs:
        c = cats.get(t.category)
        if t.amount < 0 and start <= t.on <= ctx.as_of and c and c.cpi_group:
            spend[t.category] = spend.get(t.category, 0.0) - t.amount
    total = sum(spend.values())
    official = (_series(db, "cpi", 1) or [ctx.cpi_now])[-1]
    contributions, personal = [], 0.0
    if total > 0:
        for cid, amount in spend.items():
            group = (_series(db, cats[cid].cpi_group, 1) or [official])[-1]
            pp = amount / total * group
            personal += pp
            contributions.append({"category": cats[cid].name, "pp": round(pp, 1)})
        contributions.sort(key=lambda c: -c["pp"])
    else:
        personal = official
    return {"as_of": ctx.as_of.isoformat(), "model_version": model_version, "personal": round(personal / 100, 4),
            "official": round(official / 100, 4), "contributions": contributions}


def city_prices(db: Session, city: str) -> list[dict]:
    rows = db.scalars(select(CityPrice).where(CityPrice.city == city)).all()
    if not rows:
        rows = db.scalars(select(CityPrice).where(CityPrice.city == "Астана")).all()
    return [{"item": r.item, "unit": r.unit, "price": round(r.price), "change": r.change} for r in rows]


def parse_nbk_rates(xml_text: str) -> tuple[date, dict[str, float]]:
    """Parse https://nationalbank.kz/rss/rates_all.xml: <item><title>USD</title><pubDate>20.10.2026</pubDate>
    <description>452.59</description><quant>1</quant>... Returns (publication date, tenge per 1 unit of currency)."""
    root = ET.fromstring(xml_text)
    rates: dict[str, float] = {}
    published: date | None = None
    for item in root.iter("item"):
        code = (item.findtext("title") or "").strip()
        raw = (item.findtext("description") or "").strip().replace(",", ".")
        quant = float((item.findtext("quant") or "1").strip() or 1)
        if not code or not re.fullmatch(r"\d+(\.\d+)?", raw):
            continue
        rates[code] = float(raw) / quant
        if published is None:
            d, m, y = (item.findtext("pubDate") or "").strip().split(".")
            published = date(int(y), int(m), int(d))
    if published is None:
        raise ValueError("no rates found in feed")
    return published, rates
