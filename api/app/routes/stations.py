from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..ingest import STORE
from ..schemas import StationDetail
from ..simulator.client import simulator_client

router = APIRouter(prefix="/api/stations", tags=["stations"])


def _profile_demand(profile: str, fuel: str) -> float:
    daily = {
        "urban_high": {"DIESEL": 8500, "PETROL": 10500, "OCTANE": 5600},
        "industrial": {"DIESEL": 14000, "PETROL": 4500, "OCTANE": 2200},
        "highway":    {"DIESEL": 10500, "PETROL": 11000, "OCTANE": 6200},
        "regional":   {"DIESEL": 7200,  "PETROL": 7600,  "OCTANE": 3600},
    }.get(profile, {}).get(fuel, 0)
    return daily


@router.get("/{station_id}", response_model=StationDetail)
async def station_detail(station_id: str) -> StationDetail:
    snap = STORE.last_snapshot or {}
    stations = snap.get("stations") or []
    st = next((s for s in stations if s["id"] == station_id), None)
    if not st:
        raise HTTPException(status_code=404, detail=f"station {station_id} not found")

    inv = st["inventory"]
    cap = st["capacity"]
    pct = {}
    forecast = {}
    risk_breakdown = {}
    for f in ("DIESEL", "PETROL", "OCTANE"):
        c = cap.get(f, 0) or 0
        i = inv.get(f, 0) or 0
        pct[f] = int(round(100 * i / c)) if c else 0
        d = _profile_demand(st["demand_profile"], f) * st.get("demand_multiplier", 1.0)
        forecast[f] = d
        if d > 0:
            hts = (i / d) * 24.0
        else:
            hts = 999
        risk_breakdown[f] = {
            "inventory_l": i,
            "capacity_l": c,
            "daily_demand_l": round(d, 1),
            "hours_to_stockout": round(hts, 1),
            "coverage_pct_of_capacity": pct[f],
        }

    # Incoming shipments = PENDING or IN_TRANSIT allocations to this station
    incoming = [
        {
            "allocation_id": a["id"],
            "fuel_type": a["fuel_type"],
            "quantity": a["quantity"],
            "departure_tick": a.get("departure_tick"),
            "expected_arrival_tick": a.get("expected_arrival_tick"),
            "status": a["status"],
            "route_id": a["route_id"],
        }
        for a in (snap.get("allocations") or [])
        if a.get("destination_station_id") == station_id
        and a.get("status") in ("PENDING", "IN_TRANSIT")
    ]

    # Demand history (last 60 rows)
    try:
        history = await simulator_client.get_demand_history(station_id=station_id, limit=60)
    except Exception:
        history = []
    # Convert to a compact form (drop id, sim_time for brevity)
    history_compact = [
        {
            "tick": r["tick"],
            "fuel_type": r["fuel_type"],
            "demand_liters": r["demand_liters"],
            "served_liters": r["served_liters"],
            "unmet_liters": r["unmet_liters"],
        }
        for r in history
    ]

    return StationDetail(
        id=st["id"],
        name=st["name"],
        region=st.get("region_id", ""),
        profile=st["demand_profile"],
        status=st["status"],
        demand_multiplier=st.get("demand_multiplier", 1.0),
        inventory={k: float(v) for k, v in inv.items()},
        capacity={k: float(v) for k, v in cap.items()},
        inventory_pct=pct,
        forecast=forecast,
        incoming=incoming,
        risk_breakdown=risk_breakdown,
        demand_history=history_compact,
    )
