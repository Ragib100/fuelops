from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


# Use SQLAlchemy's portable JSON type. On Postgres this maps to JSONB
# (we set this in db.py via the dialect inspector). On SQLite it maps to TEXT
# with automatic JSON serialization.
JSONType = JSON()

# SQLite autoincrement requires the column to be declared INTEGER PRIMARY KEY
# (rowid alias). On Postgres, BIGINT works for autoincrement.
BigIntPK = BigInteger().with_variant(Integer, "sqlite")


class Snapshot(Base):
    __tablename__ = "snapshots"

    tick: Mapped[int] = mapped_column(Integer, primary_key=True)
    sim_time: Mapped[str | None] = mapped_column(String(64), nullable=True)
    taken_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    status: Mapped[str | None] = mapped_column(String(16), nullable=True)  # RUNNING | PAUSED
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True)

    stations: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    depots: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    routes: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    supply_arrivals: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    allocations: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    events: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    metrics: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    stale: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    created_tick: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    station_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fuel_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    created_tick: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    station_id: Mapped[str] = mapped_column(String(64), nullable=False)
    fuel_type: Mapped[str] = mapped_column(String(16), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONType, nullable=False)
    policy: Mapped[str] = mapped_column(String(64), nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="PENDING", nullable=False)


class Decision(Base):
    __tablename__ = "decisions"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    recommendation_id: Mapped[int | None] = mapped_column(BigIntPK, nullable=True)
    decided_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    operator: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)  # approve | reject
    idempotency_key: Mapped[str | None] = mapped_column(String(150), nullable=True)
    request: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    simulator_response: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    allocation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)


class SystemEvent(Base):
    __tablename__ = "system_events"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    component: Mapped[str] = mapped_column(String(64), nullable=False)
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONType, nullable=True)


class AllocationCache(Base):
    """Persist successful allocations for idempotent approval retries."""

    __tablename__ = "allocation_cache"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_allocation_key"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    idempotency_key: Mapped[str] = mapped_column(String(150), nullable=False)
    request: Mapped[dict] = mapped_column(JSONType, nullable=False)
    response: Mapped[dict] = mapped_column(JSONType, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
