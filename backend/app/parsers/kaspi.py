from app.parsers.base import ParsedStatement


class KaspiParser:
    """Kaspi Gold PDF statement parser. Planned for the import slice (needs real anonymised statements)."""

    bank = "Kaspi Bank"

    def parse(self, data: bytes) -> ParsedStatement:
        raise NotImplementedError("Kaspi PDF parsing is not implemented yet")


PARSERS = {"kaspi": KaspiParser}
