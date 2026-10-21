"""Builds an anonymised Kaspi Gold-like statement PDF (fictional person, merchants and amounts) with the same column
layout as the real one: Дата | Сумма | Операция | Детали, rows continuing on a second page, footer on every page."""
import io
import os

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
HEIGHT = 842

PAGE1 = [
    ("03.09.26", "- 2 340,00 ₸", ["Покупка"], ["Magnum Test"]),
    ("03.09.26", "+ 5 000,00 ₸", ["Поступление со", "своего счета"], ["Со своего Счета в Kaspi Pay"]),
    ("02.09.26", "- 13 756,20 ₸", ["Покупка"], ["GOOGLE*TEST AB12CD", "(- 30,00 USD)"]),
]
PAGE2 = [
    ("02.09.26", "- 30 000,00 ₸", ["Перевод на свой", "счет"], ["Оплата Kaspi Кредита"]),
    ("01.09.26", "+ 400 000,00 ₸", ["Пополнение"], ["ТОО Работодатель"]),
    ("01.09.26", "- 110,00 ₸", ["Покупка"], ["Билет Avtobys. Оплата проезда"]),
]
OPENING, CLOSING = "100 000,00", "458 793,80"


def font_available() -> bool:
    return os.path.exists(FONT)


def build_pdf(opening: str = OPENING, closing: str = CLOSING) -> bytes:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    pdfmetrics.registerFont(TTFont("DejaVu", FONT))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, HEIGHT))

    def text(x: float, top: float, s: str, size: int = 9) -> None:
        c.setFont("DejaVu", size)
        c.drawString(x, HEIGHT - top, s)

    def footer() -> None:
        text(40, 780, "АО «Kaspi Bank», БИК CASPKZKA, www.kaspi.kz", 8)

    def rows(items: list, top: float) -> None:
        for d, amount, op, details in items:
            text(52, top, d)
            text(185 - 6.2 * len(amount), top, amount)
            for i, line in enumerate(op):
                text(266 - pdfmetrics.stringWidth(line, "DejaVu", 9) / 2, top + 12 * i, line)
            for i, line in enumerate(details):
                if line.startswith("("):
                    text(130, top + 12 * i, line)
                else:
                    text(311, top + 12 * i, line)
            top += 12 * max(len(op), len(details), 1) + 14

    text(40, 60, "Приложение к Справке №1 от 03 сентября 2026", 8)
    text(40, 90, "ВЫПИСКА", 12)
    text(40, 108, "по Kaspi Gold за период с 01.09.26 по 03.09.26")
    text(40, 140, f"Доступно на 03.09.26: + {closing} ₸")
    text(40, 160, f"Доступно на 01.09.26 + {opening} ₸")
    text(59, 200, "Дата")
    text(134, 200, "Сумма")
    text(243, 200, "Операция")
    text(312, 200, "Детали")
    rows(PAGE1, 220)
    footer()
    c.showPage()
    text(40, 60, "Приложение к Справке №1 от 03 сентября 2026", 8)
    rows(PAGE2, 90)
    footer()
    c.save()
    return buf.getvalue()
