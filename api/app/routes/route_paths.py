"""GET /api/routes — list of supply routes between depots and stations.

Returns the latest routes list from the in-memory snapshot store,
normalized into the frontend's expected shape.

The frontend /network page uses this directly.
"""
from __future__ import annotations

from fastapi import APIRouter

from ..ingest import STORE
from ..schemas import RouteOut

router = APIRouter(prefix="/api/routes", tags=["routes"])


@router.get("", response_model=list[RouteOut])
async def list_routes() -> list[RouteOut]:
    snap = STORE.last_snapshot or {}
    out: list[RouteOut] = []
    for r in (snap.get("routes") or []):
        out.append(RouteOut(
            id=r["id"],
            from_depot_id=r.get("source_depot_id", ""),
            to_station_id=r.get("destination_station_id", ""),
            transit_ticks=int(r.get("transit_ticks", 0)),
            max_shipment_l=float(r.get("max_shipment", 0)),
            status=r.get("status", "UNKNOWN"),
        ))
    return out
