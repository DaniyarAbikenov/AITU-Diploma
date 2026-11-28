"""Additive schema upgrade for databases created before a column existed.

There is no Alembic yet (docs/decisions.md): `create_all` creates missing tables but never alters existing ones.
This adds missing nullable or server-defaulted columns so an existing database (with real user data) keeps
working after an upgrade. It never drops, renames or rewrites anything."""
import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.core.db import Base

log = logging.getLogger(__name__)


def add_missing_columns(engine: Engine) -> list[str]:
    insp = inspect(engine)
    added: list[str] = []
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                if not col.nullable and col.server_default is None:
                    raise RuntimeError(f"{table.name}.{col.name}: a new NOT NULL column needs a server default")
                ddl = f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(engine.dialect)}"
                if col.server_default is not None:
                    default = col.server_default.arg
                    default = default if isinstance(default, str) else str(default.compile(dialect=engine.dialect))
                    if isinstance(col.server_default.arg, str):
                        default = "'" + default.replace("'", "''") + "'"
                    ddl += f" DEFAULT {default}"
                    if not col.nullable:
                        ddl += " NOT NULL"
                conn.execute(text(ddl))
                added.append(f"{table.name}.{col.name}")
    if added:
        log.info("Added columns: %s", ", ".join(added))
    return added
