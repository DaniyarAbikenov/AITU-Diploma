"""Kaspi Gold PDF statement parser ("Выписка по Kaspi Gold").

The statement is a table with columns Дата | Сумма | Операция | Детали. A row starts at a date in the first column;
the operation and details wrap onto the following lines, so words are assigned to the last date line above them.
Column borders are taken from the header words of the first table page. Lines that cannot be read are collected in
`warnings` instead of aborting the import, and the sum of rows is checked against the opening and closing balance."""
import io
import re
from collections import defaultdict
from datetime import date

from app.parsers.base import ParsedRow, ParsedStatement

DATE_RE = re.compile(r"^\d{2}\.\d{2}\.\d{2}$")
AMOUNT_RE = re.compile(r"^([+-])\s*([\d\s]+),(\d{2})\s*₸$")
FOREIGN_RE = re.compile(r"\(([+-])\s*([\d\s]+,\d{2})\s+([A-Z]{3})\)")
BALANCE_RE = re.compile(r"Доступно на (\d{2}\.\d{2}\.\d{2})[:\s]+([+-])\s*([\d\s]+),(\d{2})\s*₸")
FOOTER_STARTS = ("АО «Kaspi", "- Сумма заблокирована", "Раздел «Краткое")
OWN_ACCOUNT_OPS = ("поступление со своего счета", "перевод на свой счет")
DEFAULT_BORDERS = (108.0, 204.0, 301.0)  # end of date, amount and operation columns (pt)


def _undouble(word: str) -> str:
    """Some Kaspi footers are drawn twice and extract as "ААОО": collapse words whose characters are all doubled."""
    half = len(word) // 2
    return word[:half * 2:2] if len(word) % 2 == 0 and all(word[i] == word[i + 1] for i in range(0, len(word), 2)) and word else word


def _date(s: str) -> date:
    d, m, y = (int(x) for x in s.split("."))
    return date(2000 + y, m, d)


def _minor(sign: str, whole: str, cents: str) -> int:
    value = int(re.sub(r"\s", "", whole)) * 100 + int(cents)
    return -value if sign == "-" else value


def _lines(words: list[dict]) -> list[tuple[float, list[dict]]]:
    by_top: dict[int, list[dict]] = defaultdict(list)
    for w in words:
        by_top[round(w["top"] / 3)].append(w)
    return [(min(w["top"] for w in ws), sorted(ws, key=lambda w: w["x0"])) for _, ws in sorted(by_top.items())]


def _borders(pages_words: list[list[dict]]) -> tuple[float, float, float]:
    for words in pages_words:
        head = {w["text"]: w for w in words if w["text"] in ("Дата", "Сумма", "Операция", "Детали")}
        if len(head) == 4:
            return ((head["Дата"]["x1"] + head["Сумма"]["x0"]) / 2, (head["Сумма"]["x1"] + head["Операция"]["x0"]) / 2,
                    (head["Операция"]["x1"] + head["Детали"]["x0"]) / 2)
    return DEFAULT_BORDERS


def parse_pages(pages_words: list[list[dict]], text: str = "") -> ParsedStatement:
    date_end, amount_end, op_end = _borders(pages_words)
    rows: list[dict] = []
    warnings: list[str] = []
    for words in pages_words:
        current = None
        for _, line in _lines(words):
            joined = " ".join(_undouble(w["text"]) for w in line)
            if joined.startswith(FOOTER_STARTS):
                break
            first = line[0]
            if first["x0"] < date_end and DATE_RE.match(first["text"]):
                current = {"date": first["text"], "top": first["top"], "amount": [], "op": [], "details": []}
                rows.append(current)
            elif current is None:
                continue  # page header or the summary block above the table
            for w in line:
                if w is first and w["text"] == current["date"]:
                    continue
                col = "amount" if w["x0"] < amount_end else "op" if w["x0"] < op_end else "details"
                if col == "amount" and abs(w["top"] - current["top"]) > 3:
                    col = "details"  # second line of the amount cell: "(- 30,00 USD)" for foreign-currency purchases
                current[col].append((w["top"], w["text"]))
    parsed: list[ParsedRow] = []
    for r in rows:
        amount_text = " ".join(t for _, t in r["amount"])
        m = AMOUNT_RE.match(amount_text)
        if not m:
            warnings.append(f"{r['date']}: не удалось прочитать сумму")
            continue
        op = " ".join(t for _, t in r["op"]).strip()
        detail_lines = _join_lines(r["details"])
        details = " ".join(detail_lines)
        foreign = FOREIGN_RE.search(details)
        details = FOREIGN_RE.sub("", details).strip()
        fx_adjustment = "курсовая разница" in details.lower()
        details = re.sub(r"курсовая разница", "", details, flags=re.I).strip()
        low = op.lower()
        own = low in OWN_ACCOUNT_OPS and "кредит" not in details.lower()
        if low == "покупка" or not details or (low in OWN_ACCOUNT_OPS and not own):
            merchant = details or op
        else:
            merchant = f"{op}: {details}"
        if fx_adjustment:
            merchant += " (курсовая разница)"
        if foreign and not fx_adjustment:
            merchant += f" ({foreign.group(1)}{foreign.group(2).strip()} {foreign.group(3)})"
        parsed.append(ParsedRow(booked_on=_date(r["date"]), amount_minor=_minor(*m.groups()), merchant=merchant, internal=own))
    account = re.search(r"Выписка по ([^\n]+?) за период", text.replace("ВЫПИСКА\n", "ВЫПИСКА ")) or re.search(r"по (Kaspi [A-Za-z]+)", text)
    st = ParsedStatement(bank="Kaspi Bank", account_name=account.group(1).strip() if account else "Kaspi Gold", rows=parsed,
                         warnings=warnings)
    _reconcile(st, text)
    return st


def _join_lines(cells: list[tuple[float, str]]) -> list[str]:
    by_top: dict[int, list[str]] = defaultdict(list)
    for top, t in cells:
        by_top[round(top / 3)].append(t)
    return [" ".join(v) for _, v in sorted(by_top.items())]


def _reconcile(st: ParsedStatement, text: str) -> None:
    balances = [(_date(d), _minor(s, w, c)) for d, s, w, c in BALANCE_RE.findall(text)]
    if len(balances) < 2:
        st.warnings.append("Не найден остаток на начало или конец периода: сверка не выполнена")
        return
    opening = min(balances)[1]
    closing = max(balances)[1]
    st.closing_balance_minor = closing
    diff = closing - opening - sum(r.amount_minor for r in st.rows)
    if diff:
        st.warnings.append(f"Сумма операций не сходится с остатками на {abs(diff) / 100:,.2f} ₸ (возможны заблокированные суммы)")


class KaspiParser:
    bank = "Kaspi Bank"

    def parse(self, data: bytes) -> ParsedStatement:
        import pdfplumber

        pages_words: list[list[dict]] = []
        texts: list[str] = []
        try:
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                for page in pdf.pages:
                    pages_words.append(page.extract_words())
                    texts.append(page.extract_text() or "")
        except Exception as e:  # pdfminer raises many different errors for broken files
            raise ValueError("файл не читается как PDF") from e
        text = "\n".join(texts)
        if "Kaspi" not in text or "ВЫПИСКА" not in text:
            raise ValueError("Это не выписка Kaspi")
        st = parse_pages(pages_words, text)
        if not st.rows:
            raise ValueError("В выписке не найдено ни одной операции")
        return st


PARSERS = {"kaspi": KaspiParser}
