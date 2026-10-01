from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import select

from ..db import SessionLocal
from ..ingest import STORE
from ..models import Alert
from ..schemas import AlertOut

router = APIRouter(prefix="/api", tags=["alerts"])


SEVERITY_COLOR = {"CRITICAL": "red", "HIGH": "red", "MEDIUM": "amber", "LOW": "blue"}
SEVERITY_TITLE = {"CRITICAL": "Critical", "HIGH": "Critical", "MEDIUM": "Warning", "LOW": "Info"}


@router.get("/alerts", response_model=list[AlertOut])
async def list_alerts() -> list[AlertOut]:
    snap = STORE.last_snapshot or {}
    stations = {s["id"]: s["name"] for s in (snap.get("stations") or [])}
    with SessionLocal() as s:
        rows = s.execute(select(Alert).order_by(Alert.id.desc()).limit(50)).scalars().all()
    out: list[AlertOut] = []
    for r in rows:
        kind_title = {
            "shortage": "Shortage risk",
            "disruption": "Disruption",
            "anomaly": "Demand anomaly",
            "system": "System",
        }.get(r.kind, r.kind.title())
        out.append(AlertOut(
            id=f"ALT-{r.id:03d}",
            severity=SEVERITY_TITLE.get(r.severity, r.severity),
            kind=kind_title,
            title=r.message.split("·")[0].strip() if "·" in r.message else r.message,
            detail=r.message,
            station=stations.get(r.station_id) if r.station_id else None,
            color=SEVERITY_COLOR.get(r.severity, "blue"),
            time=_ago(r.created_at),
            tick=r.created_tick,
        ))
    return out


def _ago(dt: datetime | None) -> str:
    if not dt:
        return "—"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - dt
    s = int(delta.total_seconds())
    if s < 60:
        return f"{s} sec ago"
    if s < 3600:
        return f"{s // 60} min ago"
    return f"{s // 3600} h ago"
