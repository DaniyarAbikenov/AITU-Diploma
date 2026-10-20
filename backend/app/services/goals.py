import math
from datetime import date

from app.services.ledger import add_months, month_key


def projection(target: float, saved: float, monthly: float, deadline: str, as_of: date) -> dict:
    left = max(0.0, target - saved)
    months = math.ceil(left / monthly) if monthly > 0 else 999
    eta = month_key(add_months(as_of.replace(day=1), months))
    dy, dm = (int(x) for x in deadline.split("-"))
    months_to_deadline = (dy - as_of.year) * 12 + (dm - as_of.month)
    required = math.ceil(left / max(1, months_to_deadline) / 1000) * 1000
    return {"etaMonth": eta, "requiredMonthly": required, "onTrack": eta <= deadline}
