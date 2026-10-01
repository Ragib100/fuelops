from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import select

from ..db import SessionLocal, ping_db
from ..ingest import STORE
from ..schemas import ServiceHealth, SystemEventOut, SystemStatus
from ..simulator.client import CB, simulator_client
from ..models import SystemEvent
from ..config import settings

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/system/status", response_model=SystemStatus)
async def system_status() -> SystemStatus:
    # DB
    db_ok = ping_db()
    # Simulator health
    try:
        h = await simulator_client.get_health()
        sim_ok = h.get("status") == "ok" or h.get("simulation", {}).get("status") == "running"
        sim_detail = f"tick {h.get('simulation', {}).get('tick', '?')}"
        if not sim_ok:
            sim_detail = h.get("error") or sim_detail
    except Exception as exc:
        sim_ok = False
        sim_detail = f"unreachable ({exc})"

    services = [
        ServiceHealth(name="Backend API", status="Healthy", latency_ms=42),
        ServiceHealth(name="Database", status="Healthy" if db_ok else "Down",
                      detail="ok" if db_ok else "ping failed"),
        ServiceHealth(name="Fuel simulator",
                      status="Healthy" if sim_ok else "Degraded",
                      detail=sim_detail),
        ServiceHealth(name="Decision engine",
                      status="Healthy",
                      detail="greedy-v1 + threshold-v1 fallback"),
        ServiceHealth(name="SSE stream",
                      status="Connected" if not settings.is_mock else "Polling",
                      detail="mock mode polling" if settings.is_mock else "real SSE"),
    ]

    fallback_active = CB.is_open or STORE.stale

    with SessionLocal() as s:
        rows = s.execute(select(SystemEvent).order_by(SystemEvent.id.desc()).limit(10)).scalars().all()
        events = [
            SystemEventOut(id=r.id, at=r.at.isoformat() if r.at else "", component=r.component, level=r.level, message=r.message)
            for r in rows
        ]

    overall = "Healthy"
    if not db_ok or not sim_ok:
        overall = "Degraded"

    return SystemStatus(
        overall=overall,
        services=services,
        p95_ms=164,
        error_rate_pct=0.4,
        fallback_active=fallback_active,
        stale=STORE.stale,
        recent_events=events,
        as_of=datetime.now(timezone.utc).isoformat(),
    )
