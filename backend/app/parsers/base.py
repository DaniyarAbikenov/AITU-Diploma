from dataclasses import dataclass, field
from datetime import date
from typing import Protocol


@dataclass(frozen=True)
class ParsedRow:
    booked_on: date
    amount_minor: int  # negative = expense
    merchant: str
    currency: str = "KZT"
    internal: bool = False  # moves money between the user's own accounts, not income or expense


@dataclass
class ParsedStatement:
    bank: str
    account_name: str
    rows: list[ParsedRow]
    closing_balance_minor: int | None = None
    period_from: date | None = None  # statement period from the header; None -> taken from the operation dates
    period_to: date | None = None
    warnings: list[str] = field(default_factory=list)
    account_mask: str | None = None  # "*1234": last 4 digits of the card/account number in the header, if printed

    @property
    def statement_key(self) -> str:
        """Stable identity of the statement's account: by number when the header has one, else by its name."""
        return f"{self.bank}|{self.account_mask}" if self.account_mask else f"{self.bank}|name:{self.account_name}"


MASK_RE = r"(?:KZ\d{2}[A-Z0-9]{9,}(\d{4})|\*{1,}\s?(\d{4})|\b\d{4}\s?\*+\s?(\d{4})\b)"


def find_mask(text: str) -> str | None:
    """Last 4 digits of an IBAN or a masked card number in the header text, as "*1234"."""
    import re

    m = re.search(MASK_RE, text)
    if not m:
        return None
    return "*" + next(g for g in m.groups() if g)


class StatementParser(Protocol):
    """One implementation per bank. Unknown lines must not abort the import: collect them and report."""

    bank: str

    def parse(self, data: bytes) -> ParsedStatement: ...
