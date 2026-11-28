"""Halyk parser. Cells mirror what pdfplumber extracts from a real Homebank statement (fictional values).

Set STATEMENTS_DIR=/path/with/halyk/ (a folder holding halyk/*.pdf) to also run the parser on real files kept outside the repo."""
import os
from datetime import date
from pathlib import Path

import pytest

from app.engine.categorization import categorize
from app.parsers.halyk import HalykParser
from app.parsers.registry import pick_parser

CARD = "400000******1234"
KZT_ACC = "KZ000000000000000001\n(KZT)"
USD_ACC = "KZ000000000000000002\n(USD)"


def rows(desc, amount, cur, inc, exp, fee="0,00", acc=CARD):
    return HalykParser._rows(["21.12.2025", "21.12.2025", desc, amount, cur, inc, exp, fee, acc])


def test_purchase_amount_and_merchant():
    [r] = rows("Операция оплаты у\nкоммерсанта YANDEX.GO", "-1 800,00", "KZT", "0,00", "-1 800,00")
    assert (r.booked_on, r.amount_minor, r.merchant, r.internal) == (date(2025, 12, 21), -180000, "YANDEX.GO", False)
    assert categorize(r.merchant).category_id == "transport"


def test_unsigned_income_is_read_in_full():
    [r] = rows("Поступление на счет ТОО\nРаботодатель", "48 500,00", "KZT", "48 500,00", "0,00", acc=KZT_ACC)
    assert (r.amount_minor, r.merchant) == (4850000, "Поступление на счет: ТОО Работодатель")
    assert categorize(r.merchant).category_id == "income"


def test_transfer_fee_is_split_off():
    out = rows("Перевод на другую карту", "-30 000,00", "KZT", "0,00", "-30 200,00")
    assert [(r.amount_minor, r.merchant) for r in out] == [(-3000000, "Перевод на другую карту"),
                                                           (-20000, "Комиссия банка: за перевод")]
    assert [categorize(r.merchant).category_id for r in out] == ["transfers", "other"]


def test_monthly_fee_row():
    [r] = rows("Ежемесячная комиссия за\nобслуживание карточки\nRegular Charge", "0,00", "", "0,00", "0,00", "-150,00")
    assert (r.amount_minor, r.merchant) == (-15000, "Комиссия банка: Ежемесячная комиссия за обслуживание карточки")


def test_own_money_moves_are_internal():
    [usd] = rows("Автоконвертация дополнительной\nсуммы по прошедшим операциям", "-1 100,00", "KZT", "0,00", "-2,10", acc=USD_ACC)
    assert (usd.amount_minor, usd.currency, usd.internal) == (-210, "USD", True)
    [dep] = rows("Операция оплаты у\nкоммерсанта Пополнение\nдепозита в\nЖилстройСберБанке", "-10 000,50", "KZT",
                 "0,00", "-10 000,50", acc=KZT_ACC)
    assert dep.internal


def test_detection():
    assert HalykParser.detects('АО "Народный Банк Казахстана"\nВыпискапосчету')
    assert not HalykParser.detects("АО «Kaspi Bank» ВЫПИСКА по Kaspi Gold")


REAL = Path(os.environ.get("STATEMENTS_DIR", "/nonexistent")) / "halyk"
FILES = sorted(REAL.glob("*.pdf")) if REAL.is_dir() else []


@pytest.mark.skipif(not FILES, reason="STATEMENTS_DIR with real Halyk statements not set")
@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_real_statement_reconciles(path):
    data = path.read_bytes()
    st = pick_parser(data)().parse(data)
    assert st.bank == "Halyk Bank" and st.rows and not st.warnings
