from dataclasses import dataclass
from datetime import date
from typing import Protocol


@dataclass(frozen=True)
class ParsedRow:
    booked_on: date
    amount_minor: int  # negative = expense
    merchant: str
    currency: str = "KZT"


@dataclass
class ParsedStatement:
    bank: str
    account_name: str
    rows: list[ParsedRow]
    closing_balance_minor: int | None = None


class StatementParser(Protocol):
    """One implementation per bank. Unknown lines must not abort the import: collect them and report."""

    bank: str

    def parse(self, data: bytes) -> ParsedStatement: ...
