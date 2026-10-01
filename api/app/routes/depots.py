"""GET /api/depots — list of depots with current inventory.

Returns the latest depot list from the in-memory snapshot store,
with per-fuel inventory percentages and total fill %.

The frontend /network page uses this directly.
"""
from __future__ import annotations

from fastapi import APIRouter

from ..ingest import STORE
from ..schemas import DepotOut

router = APIRouter(prefix="/api/depots", tags=["depots"])


@router.get("", response_model=list[DepotOut])
async def list_depots() -> list[DepotOut]:
    snap = STORE.last_snapshot or {}
    out: list[DepotOut] = []
    for d in (snap.get("depots") or []):
        inv = d.get("inventory", {}) or {}
        cap = d.get("capacity", {}) or {}
        pct = {}
        for f, c in cap.items():
            try:
                pct[f] = int(round(100 * inv.get(f, 0) / c)) if c else 0
            except Exception:
                pct[f] = 0
        total_inv = sum(inv.values())
        total_cap = sum(cap.values())
        out.append(DepotOut(
            id=d["id"],
            name=d["name"],
            region=d.get("region_id", ""),
            status=d.get("status", "UNKNOWN"),
            inventory={k: float(v) for k, v in inv.items()},
            capacity={k: float(v) for k, v in cap.items()},
            inventory_pct=pct,
            fill_pct=int(round(100 * total_inv / total_cap)) if total_cap else 0,
            dispatch_per_tick=int(d.get("dispatch_capacity_per_tick", 0)),
        ))
    return out
