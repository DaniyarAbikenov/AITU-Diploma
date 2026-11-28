import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  (registers tables)
from app.core.config import as_of, settings
from app.core.db import Base, SessionLocal, engine
from app.core.errors import install_error_handlers
from app.core.migrate import add_missing_columns
from app.routers import auth, data, finance, macro, planned, planning, transfers
from app.seed import ensure_reference_data, seed_all
from app.services import imports as imports_svc
from app.services import nbk

API_PREFIX = "/api/v1"
log = logging.getLogger(__name__)


def _refresh_rates() -> None:
    with SessionLocal() as db:
        rate = nbk.refresh(db)
    log.info("USD/KZT from nationalbank.kz: %s", rate)


async def _rates_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(_refresh_rates)
        except Exception:  # network or feed format: keep the previous values and try again next time
            log.exception("USD/KZT refresh from nationalbank.kz failed")
        await asyncio.sleep(settings.nbk_rates_interval)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    add_missing_columns(engine)
    with SessionLocal() as db:
        imports_svc.backfill_statement_keys(db)
        if settings.seed_demo:
            seed_all(db)
        else:
            ensure_reference_data(db)
    task = asyncio.create_task(_rates_loop()) if settings.nbk_rates else None
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="Financial Resilience API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])
install_error_handlers(app)
for r in (macro.rates_router, auth.router, data.router, finance.router, macro.router, planning.router, planned.router, transfers.router):
    app.include_router(r, prefix=API_PREFIX)


@app.get("/healthz", tags=["ops"])
def healthz():
    return {"status": "ok", "as_of": as_of().isoformat(), "model_version": settings.model_version}
