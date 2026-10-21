"""Halyk Bank PDF statement ("Выписка по счету", multi-currency card account) as exported from Homebank.

Layout: a header with "Период выписки", "Входящий остаток" and "Исходящий остаток: <KZT>; <USD>; <EUR>", then a ruled table
Дата проведения | Дата обработки | Описание | Сумма операции | Валюта операции | Приход | Расход | Комиссия | № карты/счета.
The first table rows are the bank's totals per currency ("Всего:"). Приход/Расход/Комиссия are in the currency of the
sub-account named in the last column ("KZ..(USD)"); card rows debit the KZT account.

The PDF (PDFsharp) has no space characters, so pdfplumber infers them from gaps (text_x_tolerance). Rows are checked
against the bank's KZT totals; a mismatch or an unreadable row goes to `warnings`."""
import io
import re
from datetime import date

from app.parsers.base import ParsedRow, ParsedStatement

TABLE = {"text_x_tolerance": 1.5}
DATE_RE = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")
AMOUNT_RE = re.compile(r"^(-)?\s*([\d\s]+),(\d{2})$")
PURCHASE_RE = re.compile(r"^Операция оплаты у коммерсанта\s*", re.I)
REF_TAIL_RE = re.compile(r"\s+(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}$")


def _minor(text: str) -> int:
    m = AMOUNT_RE.match((text or "0,00").strip())
    if not m:
        raise ValueError(f"сумма {text!r}")
    value = int(re.sub(r"\s", "", m.group(2))) * 100 + int(m.group(3))
    return -value if m.group(1) else value


def _date(s: str) -> date:
    d, m, y = (int(x) for x in s.split("."))
    return date(y, m, d)


def _merchant(description: str) -> tuple[str, bool]:
    """Halyk description -> (merchant string for the keyword categorizer, internal move between own accounts)."""
    d, low = description, description.lower()
    if PURCHASE_RE.match(d):
        name = REF_TAIL_RE.sub("", PURCHASE_RE.sub("", d))
        return name, "пополнение депозита" in name.lower()  # savings at Отбасы (ЖилстройСберБанк)
    if low.startswith(("автоконвертация", "погашение задолженности по карт-счету", "зачисление с депозита")):
        return d, True  # between the KZT/USD sub-accounts or from the user's deposit
    if low.startswith("поступление на счет"):
        return "Поступление на счет: " + d[len("Поступление на счет"):].strip(), False  # salary, stipend
    if "комиссия" in low:
        return "Комиссия банка: " + re.sub(r"\s*Regular Charge$", "", d), False
    return d, False  # "Поступление перевода", "Перевод на другую карту": transfers, paired across banks


class HalykParser:
    bank = "Halyk Bank"

    @staticmethod
    def detects(first_page_text: str) -> bool:
        flat = re.sub(r"\s+", "", first_page_text).lower()
        return ("народныйбанкказахстана" in flat or "halykbank" in flat) and "выпискапосчету" in flat

    def parse(self, data: bytes) -> ParsedStatement:
        import pdfplumber

        try:
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                text = pdf.pages[0].extract_text(x_tolerance=1.5) or ""
                tables = [t for page in pdf.pages for t in page.extract_tables(TABLE)]
        except Exception as e:  # pdfminer raises many different errors for broken files
            raise ValueError("файл не читается как PDF") from e
        if not self.detects(text):
            raise ValueError("это не выписка Halyk по счёту")
        rows: list[ParsedRow] = []
        warnings: list[str] = []
        total_kzt = None
        card = None
        for table in tables:
            for cells in table:
                if cells and cells[0] == "KZT" and total_kzt is None:
                    total_kzt = sum(_minor(c) for c in cells[5:8] if c)
                    continue
                if len(cells) < 9 or not cells[0] or not DATE_RE.match(cells[0].strip()):
                    continue
                try:
                    rows.extend(self._rows(cells))
                except ValueError:
                    warnings.append(f"{cells[0]}: не удалось прочитать строку")
                    continue
                if card is None and "*" in (cells[8] or ""):
                    card = cells[8].strip()[-4:]
        st = ParsedStatement(bank=self.bank, account_name="Halyk карта" + (f" *{card}" if card else ""), rows=rows,
                             warnings=warnings)
        opening = re.search(r"Входящий\s*остаток:\s*(-?[\d\s]+,\d{2})\s*KZT", text)
        closing = re.search(r"Исходящий\s*остаток:\s*(-?[\d\s]+,\d{2})\s*KZT", text)
        if period := re.search(r"Период\s*выписки:\s*с\s*(\d{2}\.\d{2}\.\d{4})\s*по\s*(\d{2}\.\d{2}\.\d{4})", text):
            st.period_from, st.period_to = _date(period.group(1)), _date(period.group(2))
        got = sum(r.amount_minor for r in rows if r.currency == "KZT")
        if total_kzt is None:
            st.warnings.append("Не найдены итоги выписки: сверка не выполнена")
        elif got != total_kzt:
            st.warnings.append(f"Сумма операций не сходится с итогами выписки на {abs(total_kzt - got) / 100:,.2f} ₸")
        if closing:
            st.closing_balance_minor = _minor(closing.group(1))  # KZT part of "Исходящий остаток"
        elif opening and total_kzt is not None:
            st.closing_balance_minor = _minor(opening.group(1)) + total_kzt
        return st

    @staticmethod
    def _rows(cells: list[str | None]) -> list[ParsedRow]:
        booked = _date(cells[0].strip())
        description = " ".join((cells[2] or "").split())
        currency = (re.search(r"\(([A-Z]{3})\)", cells[8] or "") or [None, "KZT"])[1]
        op_amount, op_currency = _minor(cells[3]), (cells[4] or "").strip()
        income, expense, fee = (_minor(c) for c in cells[5:8])
        merchant, internal = _merchant(description)
        merchant = merchant[:200]
        if currency != "KZT":
            return [ParsedRow(booked, income + expense + fee, merchant, currency, internal=True)]
        main = income + expense
        if description.lower().startswith("перевод") and expense and op_currency == "KZT" and op_amount and op_amount != main:
            # "Перевод на другую карту": -30 200 debited for a 30 000 transfer. The fee goes to its own row so the
            # transfer matches the top-up on the receiving bank and is recognised as internal.
            fee += main - op_amount
            main = op_amount
        out = []
        if main:
            out.append(ParsedRow(booked, main, merchant, "KZT", internal=internal))
        if fee:
            out.append(ParsedRow(booked, fee, merchant if not main else "Комиссия банка: за перевод", "KZT"))
        return out
