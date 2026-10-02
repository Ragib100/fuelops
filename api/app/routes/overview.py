from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from ..ingest import STORE
from ..schemas import (
    OverviewDepot,
    OverviewEventBanner,
    OverviewResponse,
    OverviewStation,
)

router = APIRouter(prefix="/api", tags=["overview"])


STATION_SHORT = {
    "station-mirpur": "Mirpur",
    "station-tongi": "Tongi",
    "station-karnaphuli": "Karnaphuli",
    "station-coxsbazar": "Cox's Bazar",
}

DEPOT_REGION = {
    "depot-gazipur": "Dhaka Division",
    "depot-patiya": "Chattogram Division",
}

PROFILE_REGION = {
    "station-mirpur": "Dhaka Division",
    "station-tongi": "Dhaka Division",
    "station-karnaphuli": "Chattogram Division",
    "station-coxsbazar": "Chattogram Division",
}


@router.get("/overview", response_model=OverviewResponse)
async def overview() -> OverviewResponse:
    snap = STORE.last_snapshot or {}
    inst = snap.get("instance") or {}
    metrics = snap.get("metrics") or {}
    stations_raw = snap.get("stations") or []
    depots_raw = snap.get("depots") or []
    events = snap.get("events") or []

    stations = []
    risky = 0
    for s in stations_raw:
        inv = s.get("inventory", {})
        cap = s.get("capacity", {})
        pct = {}
        for f in ("DIESEL", "PETROL", "OCTANE"):
            c = cap.get(f, 0) or 0
            pct[f] = int(round(100 * inv.get(f, 0) / c)) if c else 0
        # Risk = worst fuel
        worst = min(pct.values()) if pct else 100
        if worst < 30:
            risk = "HIGH"
            risky += 1
        elif worst < 50:
            risk = "MEDIUM"
            if worst < 40:
                risky += 1
        else:
            risk = "LOW"
        stations.append(OverviewStation(
            id=s["id"],
            name=s["name"],
            short=STATION_SHORT.get(s["id"], s["name"]),
            region=PROFILE_REGION.get(s["id"], s.get("region_id", "")),
            profile=s.get("demand_profile", ""),
            status=s.get("status", "UNKNOWN"),
            risk=risk,
            inventory={k: float(v) for k, v in inv.items()},
            capacity={k: float(v) for k, v in cap.items()},
            inventory_pct=pct,
        ))

    depots = []
    for d in depots_raw:
        inv = sum(d.get("inventory", {}).values())
        cap = sum(d.get("capacity", {}).values())
        depots.append(OverviewDepot(
            id=d["id"],
            name=d["name"],
            region=DEPOT_REGION.get(d["id"], d.get("region_id", "")),
            status=d.get("status", "UNKNOWN"),
            inventory_l=int(inv),
            capacity_l=int(cap),
            fill_pct=int(round(100 * inv / cap)) if cap else 0,
            dispatch_per_tick=int(d.get("dispatch_capacity_per_tick", 0)),
        ))

    banner = None
    for ev in events:
        if ev.get("status") == "ACTIVE":
            et = ev.get("type")
            params = ev.get("parameters", {}) or {}
            region = (params.get("region_ids") or ["all"])[0]
            region_label = region.replace("region-", "").title() if region != "all" else "all regions"
            if et == "demand_spike":
                mult = params.get("multiplier", 1.5)
                banner = OverviewEventBanner(
                    type="demand_spike",
                    severity="MEDIUM",
                    title=f"Demand spike · {region_label}",
                    detail=f"Demand is elevated by {int((mult - 1) * 100)}% across the region. "
                           f"Forecasts and allocation priorities have been adjusted.",
                )
            elif et == "route_disruption":
                banner = OverviewEventBanner(
                    type="route_disruption",
                    severity="HIGH",
                    title=f"Route disruption · {region_label}",
                    detail="One or more supply routes are unavailable. "
                           "The optimizer has switched to alternate routes where possible.",
                )
            elif et == "depot_constraint":
                banner = OverviewEventBanner(
                    type="depot_constraint",
                    severity="MEDIUM",
                    title=f"Depot constraint · {region_label}",
                    detail="A depot is operating with reduced capacity. "
                           "Allocations from this depot are throttled.",
                )
            elif et == "station_outage":
                banner = OverviewEventBanner(
                    type="station_outage",
                    severity="HIGH",
                    title=f"Station outage · {region_label}",
                    detail="One or more stations are out of service. "
                           "Demand at the affected stations is being unmet.",
                )
            elif et == "shipment_delay":
                delay = params.get("delay_ticks", 2)
                banner = OverviewEventBanner(
                    type="shipment_delay",
                    severity="MEDIUM",
                    title=f"Shipment delay · {region_label}",
                    detail=f"Inbound supply arrivals are pushed back by {delay} ticks. "
                           "Depot inventories may dip before the next scheduled arrival.",
                )
            elif et == "supply_shortfall":
                factor = params.get("factor", 0.5)
                banner = OverviewEventBanner(
                    type="supply_shortfall",
                    severity="HIGH",
                    title=f"Supply shortfall · {region_label}",
                    detail=f"Inbound supply volumes are reduced to "
                           f"{int(factor * 100)}% of the scheduled amount.",
                )
            break

    return OverviewResponse(
        tick=inst.get("tick"),
        sim_time=inst.get("sim_time"),
        status=inst.get("status"),
        as_of=datetime.now(timezone.utc).isoformat(),
        kpis={
            "service_level_pct": round(metrics.get("service_level", 1.0) * 100, 1),
            "active_alerts": risky,
            "stations_at_risk": risky,
            "allocations_in_transit": sum(
                1 for a in (snap.get("allocations") or []) if a.get("status") in ("IN_TRANSIT", "PENDING")
            ),
            "allocation_liters": metrics.get("allocation_liters", 0),
        },
        service_level=metrics.get("service_level", 1.0),
        unmet_demand_liters=metrics.get("unmet_demand_liters", 0.0),
        allocation_failures=int(metrics.get("allocation_failures", 0)),
        stations=stations,
        depots=depots,
        event_banner=banner,
        stale=STORE.stale,
    )
