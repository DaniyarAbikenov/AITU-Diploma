"""Synthetic bank statements for demos and tests (no real personal data).

The generator produces a realistic-looking history for one bank: salary, rent, an installment, a loan, utilities,
a subscription, own-account transfers and random daily purchases. It feeds the same import pipeline as real
statements, so seed data exercises dedup, categorization, internal-transfer and recurring-payment detection."""
import math
import zlib
from datetime import date, timedelta

from app.parsers.base import ParsedRow, ParsedStatement

BANKS = {
    "kaspi": {"bank": "Kaspi Bank", "account": "Kaspi Gold", "balance": 486_300, "purchases_per_day": 1.4},
    "halyk": {"bank": "Halyk Bank", "account": "Halyk карта", "balance": 212_000, "purchases_per_day": 0.6},
}

# merchant, low, high (tenge)
PURCHASES = [
    ("Magnum Cash&Carry", 4000, 22000), ("Small", 1500, 9000), ("Galmart", 5000, 30000),
    ("Glovo", 2500, 9000), ("Wolt", 3000, 8000), ("Coffee Boom", 1200, 3500),
    ("Yandex Go", 900, 4500), ("Onay", 200, 2000), ("Helios АЗС", 8000, 18000),
    ("Europharma", 2000, 15000), ("Kaspi Магазин", 6000, 60000), ("Wildberries", 3000, 25000),
    ("Перевод Айгерим С.", 5000, 40000), ("ИП Нурлан К.", 2000, 15000),
]


def lcg(seed: int):
    """Same generator as the frontend mock, so demo numbers stay comparable."""
    state = seed

    def rnd() -> float:
        nonlocal state
        state = (state * 16807) % 2147483647
        return (state - 1) / 2147483646

    return rnd


def _round(x: float) -> int:
    return math.floor(x + 0.5)


def bank_key(bank: str) -> str:
    b = bank.lower()
    return "halyk" if "halyk" in b or "халык" in b else "kaspi"


def generate(bank: str, start: date, end: date, seed: int | None = None) -> ParsedStatement:
    key = bank_key(bank)
    cfg = BANKS[key]
    rnd = lcg(seed if seed is not None else zlib.crc32(key.encode()) % 100000 + 7)
    rows: list[ParsedRow] = []
    day = start
    while day <= end:
        n = math.floor(rnd() * (cfg["purchases_per_day"] + 1))
        for _ in range(n):
            merchant, lo, hi = PURCHASES[math.floor(rnd() * len(PURCHASES))]
            amount = _round((lo + rnd() * (hi - lo)) / 10) * 10
            rows.append(ParsedRow(day, -amount * 100, merchant))
        d = day.day
        if key == "kaspi":
            if d == 5:
                rows.append(ParsedRow(day, 620_000 * 100, "ТОО «Технодом» — зарплата"))
            if d == 20:
                rows.append(ParsedRow(day, 180_000 * 100, "ТОО «Технодом» — аванс"))
            if d == 1:
                rows.append(ParsedRow(day, -220_000 * 100, "Аренда квартиры"))
            if d == 3:
                rows.append(ParsedRow(day, -2_490 * 100, "Yandex Plus"))
            if d == 10 and day >= date(2026, 5, 10):
                rows.append(ParsedRow(day, -54_300 * 100, "Kaspi Рассрочка — iPhone"))
            if d == 6:
                rows.append(ParsedRow(day, -100_000 * 100, "Перевод на карту Halyk"))
        else:
            if d == 15 and day >= date(2025, 12, 15):
                rows.append(ParsedRow(day, -87_500 * 100, "Halyk Кредит наличными"))
            if d == 12:
                rows.append(ParsedRow(day, -28_400 * 100, "Алсеко ЖКУ"))
            if d == 6:
                rows.append(ParsedRow(day, 100_000 * 100, "Перевод с Kaspi Gold"))
        day += timedelta(days=1)
    return ParsedStatement(bank=cfg["bank"], account_name=cfg["account"], rows=rows,
                           closing_balance_minor=cfg["balance"] * 100)
