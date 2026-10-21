import pytest

from app.parsers.freedom import FreedomParser
from tests import freedom_fixture as fx

pytestmark = pytest.mark.skipif(not fx.font_available(), reason="DejaVu font for the PDF fixture is not installed")


def test_parse_rows_and_reconcile():
    st = FreedomParser().parse(fx.build_pdf())
    assert st.bank == "Freedom Bank" and st.account_name == "Freedom Test Card"
    assert [r.amount_minor for r in st.rows] == [-234_000, -1_300_000, 40_000_000]
    assert st.rows[0].merchant == "Magnum Test"
    assert st.rows[2].merchant == "ТОО Работодатель Зарплата за август"
    assert st.warnings == []


def test_warns_when_totals_do_not_match():
    bad = FreedomParser().parse(fx.build_pdf(summary=[("Покупка", "-1.00₸")]))
    assert any("не сходится" in w for w in bad.warnings)


def test_rejects_other_pdfs_and_garbage():
    with pytest.raises(ValueError):
        FreedomParser().parse(b"not a pdf")
