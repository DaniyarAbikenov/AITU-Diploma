"""Statement parsers by bank. The bank is detected from the PDF itself; the name sent by the client is only a
fallback, so choosing the wrong bank in the UI does not break an upload."""
import io

from app.parsers.freedom import FreedomParser
from app.parsers.kaspi import KaspiParser

PARSERS = {"kaspi": KaspiParser, "freedom": FreedomParser}


def first_page_text(data: bytes) -> str:
    import pdfplumber

    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            return pdf.pages[0].extract_text(x_tolerance=1.5) or ""
    except Exception as e:  # pdfminer raises many different errors for broken files
        raise ValueError("файл не читается как PDF") from e


def pick_parser(data: bytes, bank_hint: str = ""):
    """Parser class for this PDF. Raises ValueError for unreadable files, LookupError for unsupported banks."""
    text = first_page_text(data)
    if FreedomParser.detects(text):
        return FreedomParser
    if "Kaspi" in text:
        return KaspiParser
    key = bank_hint.lower().split()[0] if bank_hint else ""
    if key in PARSERS:
        return PARSERS[key]
    raise LookupError("Не удалось определить банк: сейчас поддерживаются выписки Kaspi Gold и Freedom Bank в PDF")
