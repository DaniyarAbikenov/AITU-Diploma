from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  (registers tables)
from app.core.config import as_of, settings
from app.core.db import Base, SessionLocal, engine
from app.core.errors import install_error_handlers
from app.routers import auth, data, finance, macro, planning
from app.seed import ensure_reference_data, seed_all

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if settings.seed_demo:
            seed_all(db)
        else:
            ensure_reference_data(db)
    yield


app = FastAPI(title="Financial Resilience API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])
install_error_handlers(app)
for r in (auth.router, data.router, finance.router, macro.router, planning.router):
    app.include_router(r, prefix=API_PREFIX)


@app.get("/healthz", tags=["ops"])
def healthz():
    return {"status": "ok", "as_of": as_of().isoformat(), "model_version": settings.model_version}
