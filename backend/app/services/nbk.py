"""Official USD/KZT rate from the National Bank of Kazakhstan (nationalbank.kz RSS). Replaces the `demo-seed` points
of the `usdkzt` series: the current month holds the latest published rate, past months the rate on their last day."""
import logging
import urllib.request
from collections.abc import Callable
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MacroSeries
from app.services.ledger import add_months
from app.services.macro import parse_nbk_rates

LATEST_URL = "https://nationalbank.kz/rss/rates_all.xml"
ON_DATE_URL = "https://nationalbank.kz/rss/get_rates.cfm?fdate={:%d.%m.%Y}"
CODE = "usdkzt"
MONTHS = 12
log = logging.getLogger(__name__)


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=15) as r:  # noqa: S310 (fixed https URL)
        return r.read().decode("utf-8")


def _store(db: Session, month, value: float) -> None:
    row = db.scalar(select(MacroSeries).where(MacroSeries.code == CODE, MacroSeries.as_of == month))
    if row is None:
        db.add(MacroSeries(code=CODE, as_of=month, value=value, source="nbk"))
    else:
        row.value, row.source = value, "nbk"


def refresh(db: Session, get: Callable[[str], str] = fetch) -> float:
    """Store the latest USD rate, then backfill past months that are still demo values. Returns the latest rate."""
    published, rates = parse_nbk_rates(get(LATEST_URL))
    current = published.replace(day=1)
    _store(db, current, rates["USD"])
    done = set(db.scalars(select(MacroSeries.as_of).where(MacroSeries.code == CODE, MacroSeries.source == "nbk")))
    for i in range(1, MONTHS):
        month = add_months(current, -i)
        if month in done:
            continue
        _, past = parse_nbk_rates(get(ON_DATE_URL.format(add_months(month, 1) - timedelta(days=1))))
        _store(db, month, past["USD"])
    db.commit()
    return rates["USD"]
