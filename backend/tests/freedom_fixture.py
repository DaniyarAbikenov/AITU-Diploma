"""Builds an anonymised Freedom Bank-like statement PDF (fictional card, merchants and amounts) with the real column
layout: Дата | Сумма | Валюта | Операция | Детали, a summary block on page 1, long details wrapping over lines."""
import io

from tests.kaspi_fixture import FONT, HEIGHT, font_available  # noqa: F401

ROWS = [
    ("03.09.2026", "-2,340.00 ₸", "KZT", "Покупка", ["Magnum Test"]),
    ("02.09.2026", "-13,000.00 ₸", "KZT", "Перевод", ["Перевод на карту Иван И."]),
    ("01.09.2026", "+400,000.00 ₸", "KZT", "Пополнение", ["ТОО Работодатель", "Зарплата за август"]),
]
SUMMARY = [("Перевод", "-13,000.00₸"), ("Покупка", "-2,340.00₸"), ("Пополнение", "+400,000.00₸")]


def build_pdf(summary=SUMMARY) -> bytes:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    pdfmetrics.registerFont(TTFont("DejaVu", FONT))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(612, HEIGHT))

    def text(x: float, top: float, s: str, size: int = 9) -> None:
        c.setFont("DejaVu", size)
        c.drawString(x, HEIGHT - top, s)

    text(40, 50, 'АО "Фридом Банк Казахстан"', 10)
    text(40, 80, "Выписка по карте Test Card", 12)
    text(40, 100, "Дата: 04.09.2026")
    text(40, 130, "Краткое содержание операций по карте:")
    top = 146
    for name, amount in summary:
        text(40, top, f"{name} {amount}")
        top += 14
    top += 30
    for d, amount, cur, op, details in ROWS:
        text(60, top, d)
        text(160, top, amount)
        text(270, top, cur)
        text(310, top, op)
        for i, line in enumerate(details):
            text(380, top + 12 * (i - len(details) // 2), line)
        top += 40
    text(40, 700, "Подлинность справки можете проверить на сайте банка", 8)
    c.showPage()
    c.save()
    return buf.getvalue()
