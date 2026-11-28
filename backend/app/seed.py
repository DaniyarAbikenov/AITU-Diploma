"""Reference data and the demo user. Demo/macro values are flagged `demo-seed` in the database: they are
placeholders for local development and must be replaced by ingested official data (NBK, Bureau of National
Statistics) before any real evaluation."""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import CATEGORIES
from app.core.config import as_of
from app.core.security import hash_password
from app.models import (
    Category,
    CityPrice,
    Goal,
    MacroSeries,
    MerchantRule,
    Obligation,
    ResilienceSnapshot,
    User,
)
from app.parsers import synthetic
from app.services import imports
from app.services.ledger import add_months, month_key

DEMO_EMAIL = "demo@zapas.kz"
DEMO_PASSWORD = "demo1234"

# 12 monthly points, oldest first. Endpoints of usdkzt (NBK 20.10.2026: 452.59) are real; the rest is interpolation.
MACRO = {
    "usdkzt": [510.4, 505.0, 498.2, 490.1, 484.6, 478.3, 470.2, 464.8, 458.1, 446.0, 440.5, 452.59],
    "brent": [84, 83, 85, 82, 80, 81, 79, 80, 82, 80, 79, 78],
    "cpi": [11.4, 11.2, 11.0, 10.8, 10.6, 10.4, 10.2, 10.0, 9.8, 9.6, 9.4, 9.3],
    "rate": [18.0, 18.0, 18.0, 18.0, 17.5, 17.5, 17.5, 17.0, 16.75, 16.75, 16.75, 16.25],
    "cpi_food": [11.0, 11.0, 10.9, 10.8, 10.6, 10.5, 10.4, 10.3, 10.2, 10.1, 10.0, 10.2],
    "cpi_nonfood": [8.2, 8.1, 8.0, 7.9, 7.8, 7.7, 7.6, 7.6, 7.5, 7.5, 7.4, 7.5],
    "cpi_services": [12.0, 11.9, 11.8, 11.6, 11.5, 11.4, 11.3, 11.2, 11.1, 11.0, 11.0, 11.0],
    "cpi_housing": [13.0, 12.9, 12.8, 12.6, 12.5, 12.4, 12.3, 12.2, 12.1, 12.0, 12.0, 12.0],
    "cpi_transport": [9.5, 9.4, 9.3, 9.2, 9.0, 8.9, 8.8, 8.7, 8.6, 8.6, 8.5, 8.5],
    "cpi_health": [9.8, 9.7, 9.6, 9.5, 9.4, 9.3, 9.2, 9.1, 9.1, 9.0, 9.0, 9.0],
}

# item, unit, base price (Astana), y/y change
CITY_ITEMS = [
    ("Хлеб пшеничный", "кг", 380, 0.07), ("Молоко 2,5%", "л", 520, 0.09), ("Говядина", "кг", 3950, 0.12),
    ("Яйца", "10 шт", 720, 0.15), ("Картофель", "кг", 260, -0.04), ("Рис", "кг", 640, 0.06),
    ("Бензин АИ-92", "л", 245, 0.11), ("Проезд в автобусе", "поездка", 150, 0.25),
]
CITY_FACTORS = {"Астана": 1.0, "Алматы": 1.02, "Шымкент": 0.96, "Караганда": 0.97}

SNAPSHOT_HISTORY = [70, 71, 69, 66, 64, 65, 61, 58, 60, 59, 61, 62]


def ensure_reference_data(db: Session) -> None:
    known = set(db.scalars(select(Category.id)))
    for cid, name, color, cpi, fx in CATEGORIES:  # added one by one so new categories reach existing databases
        if cid not in known:
            db.add(Category(id=cid, name=name, color=color, cpi_group=cpi, fx_sensitivity=fx))
    if db.scalar(select(MacroSeries.id).limit(1)) is None:
        first = add_months(as_of().replace(day=1), -11)
        for code, values in MACRO.items():
            for i, v in enumerate(values):
                db.add(MacroSeries(code=code, as_of=add_months(first, i), value=float(v), source="demo-seed"))
    if db.scalar(select(CityPrice.id).limit(1)) is None:
        for city, k in CITY_FACTORS.items():
            for item, unit, price, change in CITY_ITEMS:
                db.add(CityPrice(city=city, item=item, unit=unit, price=price * k, change=change, as_of=as_of(), source="demo-seed"))
    db.commit()


def seed_demo_user(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user:
        return user
    user = User(email=DEMO_EMAIL, name="Айгерим", city="Алматы", password_hash=hash_password(DEMO_PASSWORD))
    db.add(user)
    db.flush()
    db.add(MerchantRule(user_id=user.id, merchant="Glovo", category_id="cafe"))
    db.commit()
    today = as_of()
    for bank in ("kaspi", "halyk"):
        stmt = synthetic.generate(bank, today - timedelta(days=400), today - timedelta(days=1))
        imports.import_statement(db, user, stmt, source="synthetic")
    for o in db.scalars(select(Obligation).where(Obligation.user_id == user.id, Obligation.kind == "rent")):
        o.confirmed = True
    db.add_all([
        Goal(user_id=user.id, name="Подушка безопасности", target_minor=2_400_000_00, saved_minor=860_000_00,
             monthly_minor=90_000_00, deadline=month_key(add_months(today.replace(day=1), 20))),
        Goal(user_id=user.id, name="Отпуск", target_minor=900_000_00, saved_minor=310_000_00,
             monthly_minor=60_000_00, deadline=month_key(add_months(today.replace(day=1), 8))),
    ])
    cur = today.replace(day=1)
    for i, score in enumerate(SNAPSHOT_HISTORY):
        db.add(ResilienceSnapshot(user_id=user.id, month=month_key(add_months(cur, i - 11)), score=score, source="demo-seed"))
    db.commit()
    return user


def seed_all(db: Session) -> None:
    ensure_reference_data(db)
    seed_demo_user(db)


if __name__ == "__main__":
    from app.core.db import Base, SessionLocal, engine

    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        seed_all(session)
    print(f"Seeded. Demo login: {DEMO_EMAIL} / {DEMO_PASSWORD} (as of {as_of()})")

