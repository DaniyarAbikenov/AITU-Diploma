import pytest

from app.parsers.kaspi import KaspiParser
from tests import kaspi_fixture as fx

pytestmark = pytest.mark.skipif(not fx.font_available(), reason="DejaVu font for the PDF fixture is not installed")


def test_parse_rows_signs_and_internal_flags():
    st = KaspiParser().parse(fx.build_pdf())
    assert st.bank == "Kaspi Bank" and st.account_name == "Kaspi Gold"
    assert [r.amount_minor for r in st.rows] == [-234_000, 500_000, -1_375_620, -3_000_000, 40_000_000, -11_000]
    assert [r.internal for r in st.rows] == [False, True, False, False, False, False]
    assert st.rows[0].merchant == "Magnum Test"
    assert st.rows[2].merchant == "GOOGLE*TEST AB12CD (-30,00 USD)"
    assert st.rows[3].merchant == "Оплата Kaspi Кредита"  # a credit payment is a real expense, not an own-account move
    assert st.rows[4].merchant == "Пополнение: ТОО Работодатель"


def test_reconciles_with_balances_and_warns_otherwise():
    ok = KaspiParser().parse(fx.build_pdf())
    assert ok.warnings == [] and ok.closing_balance_minor == 45_879_380
    bad = KaspiParser().parse(fx.build_pdf(closing="458 000,00"))
    assert any("не сходится" in w for w in bad.warnings)


def test_rejects_other_pdfs_and_garbage():
    with pytest.raises(ValueError):
        KaspiParser().parse(b"not a pdf")
