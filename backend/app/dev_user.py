"""Development user on synthetic data, for trying the "Мои данные" mode without anyone's real statements.

    python -m app.dev_user            # creates the user if missing (Kaspi + Halyk synthetic history)
    python -m app.dev_user --reset    # removes this user's data and generates it again

Only the user below is touched; demo@zapas.kz and real accounts are left alone. Plan fields of the profile
(income, mandatory expenses, hours) stay empty on purpose, so the "no data yet" screens can be checked."""
import sys
from datetime import timedelta

from sqlalchemy import delete, select

from app.core.config import as_of
from app.core.db import Base, SessionLocal, engine
from app.core.migrate import add_missing_columns
from app.core.security import hash_password
from app.models import (
    Account,
    AccountCheckpoint,
    AllocationRule,
    AmountOverride,
    AmountRule,
    DailyNeed,
    ForecastRun,
    Goal,
    ImportBatch,
    IncomeAllocation,
    IncomeSource,
    InsightDismissal,
    InsightState,
    MerchantRule,
    Obligation,
    PlannedPayment,
    PlannedSettlement,
    ResilienceSnapshot,
    SavedScenario,
    Transaction,
    TransactionEdit,
    User,
)
from app.parsers import synthetic
from app.seed import ensure_reference_data
from app.services import imports

TEST_EMAIL = "navigator-test@example.com"
TEST_PASSWORD = "test12345"
TEST_NAME = "Тестовый пользователь"


def _wipe(db, user: User) -> None:
    for model in (IncomeAllocation, AllocationRule, DailyNeed, AmountRule, AmountOverride, InsightState, ForecastRun,
                  PlannedSettlement, PlannedPayment, TransactionEdit, Transaction, ImportBatch, AccountCheckpoint, Account, MerchantRule, Obligation, IncomeSource, Goal,
                  SavedScenario, InsightDismissal, ResilienceSnapshot):
        db.execute(delete(model).where(model.user_id == user.id))
    db.commit()


def ensure_test_user(db, reset: bool = False) -> User:
    ensure_reference_data(db)
    user = db.scalar(select(User).where(User.email == TEST_EMAIL))
    if user and not reset:
        return user
    if user is None:
        user = User(email=TEST_EMAIL, name=TEST_NAME, city="Алматы", password_hash=hash_password(TEST_PASSWORD))
        db.add(user)
        db.commit()
    else:
        _wipe(db, user)
    today = as_of()
    for bank in ("kaspi", "halyk"):
        stmt = synthetic.generate(bank, today - timedelta(days=400), today - timedelta(days=1), seed=4242 + len(bank))
        imports.import_statement(db, user, stmt, source="synthetic")
    return user


if __name__ == "__main__":
    Base.metadata.create_all(engine)
    add_missing_columns(engine)
    with SessionLocal() as session:
        u = ensure_test_user(session, reset="--reset" in sys.argv)
        n = len(session.scalars(select(Transaction.id).where(Transaction.user_id == u.id)).all())
    print(f"Test user: {TEST_EMAIL} / {TEST_PASSWORD} ({n} synthetic operations, as of {as_of()})")
