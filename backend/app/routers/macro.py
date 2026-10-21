from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import current_user
from app.models import MacroSeries, User
from app.routers.finance import ctx_for
from app.schemas import CityPriceOut, MacroIndicatorOut, PersonalInflationOut
from app.services import macro as macro_svc

router = APIRouter(prefix="/macro", tags=["macro"])


@router.get("/overview", response_model=list[MacroIndicatorOut])
def overview(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return macro_svc.overview(db, ctx_for(db, u))


@router.get("/personal-inflation", response_model=PersonalInflationOut)
def personal_inflation(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return macro_svc.personal_inflation(db, ctx_for(db, u), settings.model_version)


@router.get("/city-prices", response_model=list[CityPriceOut])
def city_prices(city: str = Query(min_length=1, max_length=80), _: User = Depends(current_user), db: Session = Depends(get_db)):
    return macro_svc.city_prices(db, city)


@router.get("/series/{code}")
def series(code: str, date_from: date | None = None, date_to: date | None = None, _: User = Depends(current_user),
           db: Session = Depends(get_db)):
    stmt = select(MacroSeries).where(MacroSeries.code == code).order_by(MacroSeries.as_of)
    if date_from:
        stmt = stmt.where(MacroSeries.as_of >= date_from)
    if date_to:
        stmt = stmt.where(MacroSeries.as_of <= date_to)
    rows = db.scalars(stmt).all()
    if not rows:
        raise ApiError(404, "Ряд не найден")
    return [{"date": r.as_of.isoformat(), "value": r.value, "source": r.source} for r in rows]
