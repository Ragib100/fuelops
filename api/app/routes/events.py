from __future__ import annotations

from fastapi import APIRouter

from ..ingest import STORE
from ..schemas import EventOut

router = APIRouter(prefix="/api", tags=["events"])


@router.get("/events", response_model=list[EventOut])
async def list_events() -> list[EventOut]:
    snap = STORE.last_snapshot or {}
    raw = snap.get("events") or []
    return [
        EventOut(
            id=int(e["id"]),
            type=e["type"],
            status=e["status"],
            start_tick=int(e["start_tick"]),
            end_tick=int(e["end_tick"]),
            parameters=e.get("parameters") or {},
        )
        for e in raw
    ]
