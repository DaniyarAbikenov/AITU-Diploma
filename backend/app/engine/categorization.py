"""Transaction categorization: user rules -> keyword dictionary -> 'other' (flagged for review).

The Categorizer interface is deliberately small so an ML model (TF-IDF + LogisticRegression, see
docs/architecture.md section 4.3) can replace the keyword layer without touching the callers."""
from dataclasses import dataclass

from app.catalog import KEYWORDS


@dataclass(frozen=True)
class Categorized:
    category_id: str
    source: str  # rule (user rule) | model (keyword/ML layer) | none
    needs_review: bool


def normalize(merchant: str) -> str:
    return " ".join(merchant.lower().split())


def categorize(merchant: str, user_rules: dict[str, str] | None = None) -> Categorized:
    user_rules = user_rules or {}
    if merchant in user_rules:
        return Categorized(user_rules[merchant], "user", False)
    text = normalize(merchant)
    for needle, category in KEYWORDS:
        if needle in text:
            return Categorized(category, "model", False)
    return Categorized("other", "none", True)
