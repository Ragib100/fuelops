from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

log = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def _build_engine() -> Engine:
    url = settings.database_url
    connect_args: dict = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        future=True,
        connect_args=connect_args,
    )


def _upgrade_json_to_jsonb() -> None:
    """After models are imported, swap portable JSON columns for JSONB on Postgres."""
    if engine.dialect.name != "postgresql":
        return
    from sqlalchemy import JSON
    from sqlalchemy.dialects.postgresql import JSONB

    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, JSON):
                col.type = JSONB()


engine: Engine = _build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db() -> None:
    """Create tables if they don't exist. Idempotent."""
    from . import models  # noqa: F401  (register tables on Base)
    _upgrade_json_to_jsonb()
    Base.metadata.create_all(bind=engine)
    log.info("db.init.complete", extra={"url": settings.database_url.split("@")[-1]})


@contextmanager
def session_scope() -> Iterator[Session]:
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency."""
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


def ping_db() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:
        log.warning("db.ping.failed", extra={"error": str(exc)})
        return False
