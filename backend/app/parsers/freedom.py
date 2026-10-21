"""Freedom Bank PDF statement parser ("Выписка по карте ...", Kaspi-like table).

Columns: Дата | Сумма | Валюта | Операция | Детали. Amounts use a dot for cents and commas for thousands
("-1,090.00 ₸"). Long details wrap onto lines above and below the date line, so every word is assigned to the nearest
date line. Rows are checked against the category totals of the "Краткое содержание операций" block on page 1."""
import io
import re
from datetime import date

from app.parsers.base import ParsedRow, ParsedStatement

DATE_RE = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")
AMOUNT_RE = re.compile(r"^([+-])\s*([\d,]+)\.(\d{2})\s*[₸$€]?$")
SUMMARY_RE = re.compile(r"^[А-Яа-я ]+?\s+([+-]?[\d,]+\.\d{2})\s*₸$", re.M)
STOP_STARTS = ("Подлинность справки",)
# x0 borders (pt) between date | amount | currency | operation | details
BORDERS = (150.0, 258.0, 300.0, 372.0)
COLUMNS = ("date", "amount", "currency", "op", "details")


def _minor(sign: str, whole: str, cents: str) -> int:
    value = int(whole.replace(",", "")) * 100 + int(cents)
    return -value if sign == "-" else value


def _column(x0: float) -> str:
    for border, name in zip(BORDERS, COLUMNS, strict=False):
        if x0 < border:
            return name
    return COLUMNS[-1]


def parse_pages(pages_words: list[list[dict]], text: str = "") -> ParsedStatement:
    rows: list[dict] = []
    for words in pages_words:
        stop = min((w["top"] for w in words if w["text"] == "Подлинность"), default=None)
        anchors = [w for w in words if DATE_RE.match(w["text"]) and _column(w["x0"]) == "date"
                   and any(_column(o["x0"]) == "amount" and abs(o["top"] - w["top"]) < 3 for o in words)]
        if not anchors:
            continue
        page_rows = [{"date": a["text"], "top": a["top"], **{c: [] for c in COLUMNS if c != "date"}} for a in anchors]
        for w in words:
            if (stop is not None and w["top"] >= stop - 1) or w in anchors:
                continue
            if w["top"] < anchors[0]["top"] - 14:
                continue  # statement header above the table
            nearest = min(page_rows, key=lambda r: abs(r["top"] - w["top"]))
            column = _column(w["x0"])
            if column != "date":
                nearest[column].append(w)
        rows.extend(page_rows)
    parsed: list[ParsedRow] = []
    warnings: list[str] = []
    for r in rows:
        def cell(name: str, r=r) -> str:
            return " ".join(w["text"] for w in sorted(r[name], key=lambda w: (round(w["top"] / 3), w["x0"])))

        m = AMOUNT_RE.match(cell("amount"))
        if not m:
            warnings.append(f"{r['date']}: не удалось прочитать сумму")
            continue
        d, mo, y = (int(x) for x in r["date"].split("."))
        details = cell("details")
        op = cell("op")
        parsed.append(ParsedRow(booked_on=date(y, mo, d), amount_minor=_minor(*m.groups()),
                                merchant=details or op, currency=cell("currency") or "KZT"))
    st = ParsedStatement(bank="Freedom Bank", account_name=_account_name(text), rows=parsed, warnings=warnings)
    _reconcile(st, text)
    return st


def _account_name(text: str) -> str:
    m = re.search(r"Выписка по карте ([^\n]+)", text)
    return f"Freedom {m.group(1).strip()}" if m else "Freedom карта"


def _reconcile(st: ParsedStatement, text: str) -> None:
    head = text.split("Краткое содержание операций по карте:")[-1].split("Подлинность")[0] if "Краткое содержание" in text else ""
    totals = [(-1 if v.startswith("-") else 1) * int(v.lstrip("+-").replace(".", "").replace(",", ""))
              for v in SUMMARY_RE.findall(head)]
    if not totals:
        st.warnings.append("Не найдено краткое содержание операций: сверка не выполнена")
        return
    got = sum(r.amount_minor for r in st.rows if r.currency == "KZT")
    if got != sum(totals):
        st.warnings.append(f"Сумма операций не сходится с итогами выписки на {abs(sum(totals) - got) / 100:,.2f} ₸")


class FreedomParser:
    bank = "Freedom Bank"

    @staticmethod
    def detects(first_page_text: str) -> bool:
        return "Фридом Банк" in first_page_text or "bankffin" in first_page_text.lower()

    def parse(self, data: bytes) -> ParsedStatement:
        import pdfplumber

        pages_words: list[list[dict]] = []
        texts: list[str] = []
        try:
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                for page in pdf.pages:
                    pages_words.append(page.extract_words(x_tolerance=1.5))
                    texts.append(page.extract_text(x_tolerance=1.5) or "")
        except Exception as e:  # pdfminer raises many different errors for broken files
            raise ValueError("файл не читается как PDF") from e
        text = "\n".join(texts)
        if not self.detects(text) or "Выписка по карте" not in text:
            raise ValueError("Это не выписка Freedom Bank")
        st = parse_pages(pages_words, text)
        if not st.rows:
            raise ValueError("В выписке не найдено ни одной операции")
        return st
