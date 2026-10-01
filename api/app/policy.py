"""Recommendation engine (inlined for now; can be split into a separate service).

Two policies, both produce the same structured shape that the frontend renders:
  - threshold-v1: simple reorder-point rule, no forecasting. Used as fallback.
  - greedy-v1: priority-based greedy allocator using hours-to-stockout.

Both write rows to the `recommendations` table on refresh.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from .db import SessionLocal
from .metrics import FALLBACK_ACTIVATIONS, RECOMMENDATIONS_GENERATED
from .models import Recommendation

log = logging.getLogger(__name__)

FUELS = ("DIESEL", "PETROL", "OCTANE")

DAILY = {
    "urban_high": {"DIESEL": 8500, "PETROL": 10500, "OCTANE": 5600},
    "industrial": {"DIESEL": 14000, "PETROL": 4500, "OCTANE": 2200},
    "highway":    {"DIESEL": 10500, "PETROL": 11000, "OCTANE": 6200},
    "regional":   {"DIESEL": 7200,  "PETROL": 7600,  "OCTANE": 3600},
}


def _daily_demand(station: dict, fuel: str) -> float:
    return DAILY.get(station["demand_profile"], {}).get(fuel, 0) * station.get("demand_multiplier", 1.0)


def _hours_to_stockout(inventory: float, daily: float) -> float:
    if daily <= 0:
        return float("inf")
    return (inventory / daily) * 24.0


def _stations_at_risk(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for st in snapshot.get("stations") or []:
        if st.get("status") != "OPEN":
            continue
        for fuel in FUELS:
            inv = st["inventory"][fuel]
            cap = st["capacity"][fuel]
            daily = _daily_demand(st, fuel)
            hts = _hours_to_stockout(inv, daily)
            if cap > 0 and inv / cap < 0.45:  # below ~45% capacity
                level = "HIGH" if hts < 8 else "MEDIUM"
                if hts < 4:
                    level = "HIGH"
                out.append({
                    "station_id": st["id"],
                    "station_name": st["name"],
                    "fuel": fuel,
                    "inventory": inv,
                    "capacity": cap,
                    "daily_demand": daily,
                    "hours_to_stockout": hts,
                    "risk_level": level,
                    "headroom": cap - inv,
                })
    out.sort(key=lambda r: (r["hours_to_stockout"], -r["inventory"]))
    return out


def _best_route(routes: list[dict], station_id: str, depot_id: str | None = None):
    """Return the cheapest AVAILABLE route to a station, preferring depot if given."""
    candidates = [r for r in routes if r["destination_station_id"] == station_id and r["status"] == "AVAILABLE"]
    if depot_id:
        candidates = [r for r in candidates if r["source_depot_id"] == depot_id]
    candidates.sort(key=lambda r: r["transit_ticks"])
    return candidates


def _explain(risks: list[dict], best: dict, station: dict, fuel: str) -> dict[str, Any]:
    pct = best["inventory"] / best["capacity"] if best["capacity"] else 0
    return {
        "signals": [
            f"{best['inventory']:.0f} L available · {pct:.0%} of capacity",
            f"Forecast demand {best['daily_demand']:.0f} L/day",
            f"Hours to stockout: {best['hours_to_stockout']:.1f} h",
        ],
        "why": (
            f"Current inventory covers {best['hours_to_stockout']:.1f} hours at forecast demand. "
            f"Shipping from {station['name']}'s primary route to restore service level."
        ),
    }


# ---- Policy A: greedy-v1 ------------------------------------------------------


def greedy_v1(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    risks = _stations_at_risk(snapshot)
    routes = snapshot.get("routes") or []
    stations = {s["id"]: s for s in (snapshot.get("stations") or [])}
    depots = {d["id"]: dict(d) for d in (snapshot.get("depots") or [])}
    recs: list[dict[str, Any]] = []

    for r in risks:
        # Try home depot first.
        st = stations.get(r["station_id"])
        if not st:
            continue
        region_depots = [d for d in depots.values() if d["region_id"] == st["region_id"]]
        candidates = []
        for d in region_depots:
            candidates.extend(_best_route(routes, r["station_id"], d["id"]))
        # Fall back to any route if no home route available.
        if not candidates:
            candidates = _best_route(routes, r["station_id"])

        chosen = None
        for route in candidates:
            d = depots.get(route["source_depot_id"])
            if not d:
                continue
            avail = d["inventory"][r["fuel"]]
            if avail <= 0:
                continue
            # Target: bring inventory back to ~70% of capacity.
            target = r["capacity"] * 0.70
            need = max(0.0, target - r["inventory"])
            qty = min(need, route["max_shipment"], avail)
            if qty < 500:
                continue
            chosen = (route, d, qty)
            break

        if not chosen:
            continue
        route, depot, qty = chosen
        # Reserve the inventory so we don't double-spend within one refresh.
        depots[depot["id"]]["inventory"][r["fuel"]] -= qty

        rec = {
            "station_id": r["station_id"],
            "station_name": r["station_name"],
            "fuel": r["fuel"],
            "risk_level": r["risk_level"],
            "risk": {"level": r["risk_level"], "hours_to_stockout": round(r["hours_to_stockout"], 2),
                     "p_stockout": _p_stockout(r)},
            "action": {
                "depot_id": depot["id"],
                "route_id": route["id"],
                "quantity_l": int(qty),
                "eta_ticks": route["transit_ticks"],
            },
            "impact": _impact_estimate(r, qty),
            "alternatives": [
                {"route_id": c["id"], "transit_ticks": c["transit_ticks"]}
                for c in candidates if c["id"] != route["id"]
            ][:2],
        }
        ex = _explain([r], r, st, r["fuel"])
        rec["signals"] = ex["signals"]
        rec["why"] = ex["why"]
        rec["confidence"] = 0.85
        rec["needs_review"] = r["hours_to_stockout"] < 2
        rec["policy"] = "greedy-v1"
        rec["model_version"] = "threshold-v1.0"
        recs.append(rec)

    return recs


# ---- Policy B: threshold-v1 (fallback) --------------------------------------


def threshold_v1(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    routes = snapshot.get("routes") or []
    stations = {s["id"]: s for s in (snapshot.get("stations") or [])}
    depots = {d["id"]: dict(d) for d in (snapshot.get("depots") or [])}
    recs: list[dict[str, Any]] = []

    for st in (snapshot.get("stations") or []):
        if st.get("status") != "OPEN":
            continue
        for fuel in FUELS:
            inv = st["inventory"][fuel]
            cap = st["capacity"][fuel]
            if cap <= 0 or inv / cap >= 0.35:
                continue
            route = next(iter(_best_route(routes, st["id"])), None)
            if not route:
                continue
            depot = depots.get(route["source_depot_id"])
            if not depot or depot["inventory"][fuel] <= 0:
                continue
            qty = min(route["max_shipment"], (0.6 * cap - inv), depot["inventory"][fuel])
            if qty < 500:
                continue
            depots[depot["id"]]["inventory"][fuel] -= qty

            hts = _hours_to_stockout(inv, _daily_demand(st, fuel))
            risk_level = "HIGH" if hts < 6 else "MEDIUM"
            recs.append({
                "station_id": st["id"],
                "station_name": st["name"],
                "fuel": fuel,
                "risk_level": risk_level,
                "risk": {"level": risk_level, "hours_to_stockout": round(hts, 2),
                         "p_stockout": _p_stockout({"hours_to_stockout": hts, "capacity": cap, "inventory": inv, "daily_demand": _daily_demand(st, fuel)})},
                "action": {"depot_id": depot["id"], "route_id": route["id"],
                           "quantity_l": int(qty), "eta_ticks": route["transit_ticks"]},
                "impact": {"expected_risk_reduction_pct": 50,
                           "stockout_risk_before": _p_stockout({"hours_to_stockout": hts, "capacity": cap, "inventory": inv, "daily_demand": _daily_demand(st, fuel)}),
                           "stockout_risk_after":  _p_stockout({"hours_to_stockout": hts + 24, "capacity": cap, "inventory": inv + qty, "daily_demand": _daily_demand(st, fuel)})},
                "alternatives": [],
                "signals": [
                    f"{inv:.0f} L available · {inv/cap:.0%} of capacity",
                    f"Below 35% reorder threshold for {fuel}",
                ],
                "why": (
                    f"{st['name']} {fuel.lower()} inventory is {inv/cap:.0%} of capacity. "
                    f"Shipping from {depot['name']} to restore buffer."
                ),
                "confidence": 0.7,
                "needs_review": True,
                "policy": "threshold-v1 (fallback)",
                "model_version": "threshold-v1.0",
            })
    return recs


def _p_stockout(r: dict) -> float:
    """Crude p_stockout: probability that inventory bottoms out within 24h."""
    hts = r.get("hours_to_stockout", 999)
    if hts <= 0:
        return 1.0
    if hts >= 48:
        return 0.05
    return round(max(0.0, 1.0 - (hts / 48.0)) ** 1.5, 3)


def _impact_estimate(r: dict, qty: float) -> dict[str, Any]:
    new_hrs = _hours_to_stockout(r["inventory"] + qty, r["daily_demand"])
    before = _p_stockout(r)
    after = _p_stockout({**r, "hours_to_stockout": new_hrs, "inventory": r["inventory"] + qty})
    return {
        "stockout_risk_before": before,
        "stockout_risk_after": after,
        "expected_risk_reduction_pct": int(round((before - after) * 100)),
    }


# ---- refresh & persistence ---------------------------------------------------


def refresh(snapshot: dict[str, Any], use_fallback: bool = False) -> list[dict[str, Any]]:
    if use_fallback:
        recs = threshold_v1(snapshot)
        policy_name = "threshold-v1 (fallback)"
        FALLBACK_ACTIVATIONS.labels(reason="engine_unavailable").inc()
    else:
        recs = greedy_v1(snapshot)
        policy_name = recs[0]["policy"] if recs else "greedy-v1"

    RECOMMENDATIONS_GENERATED.labels(policy=policy_name).inc()

    tick = (snapshot.get("instance") or {}).get("tick")
    with SessionLocal() as s:
        # Expire old PENDING ones we won't keep.
        existing = s.execute(select(Recommendation).where(Recommendation.status == "PENDING")).scalars().all()
        existing_keys = {(r.station_id, r.fuel_type, r.policy) for r in existing}
        kept = []
        for r in recs:
            key = (r["station_id"], r["fuel"], r["policy"])
            if key in existing_keys:
                # Update payload to latest.
                for ex in existing:
                    if (ex.station_id, ex.fuel_type, ex.policy) == key:
                        ex.payload = r
                        ex.confidence = r["confidence"]
                        ex.needs_review = r["needs_review"]
                        ex.created_tick = tick
                        kept.append(ex)
                        break
            else:
                row = Recommendation(
                    created_tick=tick,
                    station_id=r["station_id"],
                    fuel_type=r["fuel"],
                    payload=r,
                    policy=r["policy"],
                    model_version=r["model_version"],
                    confidence=r["confidence"],
                    needs_review=r["needs_review"],
                    status="PENDING",
                )
                s.add(row)
                kept.append(row)
        s.commit()
        # Return DB rows so the caller has IDs.
        result = []
        for row in kept:
            result.append({
                "id": row.id,
                "created_tick": row.created_tick,
                "station_id": row.station_id,
                "fuel": row.fuel_type,
                "policy": row.policy,
                "confidence": row.confidence,
                "needs_review": row.needs_review,
                "payload": row.payload,
            })
        return result


def list_pending() -> list[dict[str, Any]]:
    with SessionLocal() as s:
        rows = s.execute(select(Recommendation).where(Recommendation.status == "PENDING")
                         .order_by(Recommendation.id.desc())).scalars().all()
        return [{
            "id": r.id,
            "created_tick": r.created_tick,
            "station_id": r.station_id,
            "fuel": r.fuel_type,
            "policy": r.policy,
            "confidence": r.confidence,
            "needs_review": r.needs_review,
            "payload": r.payload,
        } for r in rows]


def get(rec_id: int) -> Recommendation | None:
    with SessionLocal() as s:
        return s.get(Recommendation, rec_id)


def update_status(rec_id: int, status: str) -> None:
    with SessionLocal() as s:
        r = s.get(Recommendation, rec_id)
        if r:
            r.status = status
            s.commit()
