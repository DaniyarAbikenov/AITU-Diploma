"""Signal evaluators grouped by module of the knowledge base; importing registers them."""
from app.insights.evaluators import (  # noqa: F401
    addendum,
    calendar,
    cashflow,
    data_quality,
    debts_reserve,
    goals_events,
    plan,
    transactions,
)
