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
    warnings: list[str] = field(default_factory=list)


class StatementParser(Protocol):
    """One implementation per bank. Unknown lines must not abort the import: collect them and report."""

    bank: str

    def parse(self, data: bytes) -> ParsedStatement: ...
