"""Alert detection.

Given a snapshot, classifies alerts into shortage / disruption / anomaly / system
and writes them to the DB. Idempotent on rerun: an alert with the same key
(station+fuel+kind) that already exists for an active state is not duplicated;
when the condition clears, it's marked resolved.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from .db import SessionLocal
from .models import Alert

log = logging.getLogger(__name__)


def _alert_key(kind: str, station_id: str | None, fuel_type: str | None) -> str:
    return f"{kind}|{station_id or '-'}|{fuel_type or '-'}"


# ---- shortage: hours-to-stockout under 8h with a healthy demand baseline ----


def _daily_demand(station: dict, fuel: str) -> float:
    """Crude baseline: profile table × station demand_multiplier."""
    daily = {
        "urban_high": {"DIESEL": 8500, "PETROL": 10500, "OCTANE": 5600},
        "industrial": {"DIESEL": 14000, "PETROL": 4500, "OCTANE": 2200},
        "highway":    {"DIESEL": 10500, "PETROL": 11000, "OCTANE": 6200},
        "regional":   {"DIESEL": 7200,  "PETROL": 7600,  "OCTANE": 3600},
    }.get(station["demand_profile"], {}).get(fuel, 0)
    return daily * station.get("demand_multiplier", 1.0)


def detect(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    stations = snapshot.get("stations") or []
    routes = snapshot.get("routes") or []
    events = snapshot.get("events") or []

    for st in stations:
        if st.get("status") != "OPEN":
            continue
        for fuel in ("DIESEL", "PETROL", "OCTANE"):
            inv = st["inventory"][fuel]
            cap = st["capacity"][fuel]
            daily = _daily_demand(st, fuel)
            if daily <= 0:
                continue
            hours = (inv / daily) * 24.0
            if inv / cap < 0.30 and hours < 12:
                level = "CRITICAL" if hours < 6 else "HIGH"
                found.append({
                    "kind": "shortage",
                    "severity": level,
                    "station_id": st["id"],
                    "fuel_type": fuel,
                    "message": f"{st['name']} {fuel.lower()} projected to stock out in {hours:.1f}h "
                               f"(inventory {inv:.0f} L, {inv/cap:.0%} of capacity)",
                    "payload": {"hours_to_stockout": round(hours, 2),
                                "inventory_l": inv, "capacity_l": cap,
                                "daily_demand_l": round(daily, 1)},
                })

    # disruption: any route DISRUPTED OR station OUTAGE OR depot CONSTRAINED.
    for r in routes:
        if r.get("status") == "DISRUPTED":
            found.append({
                "kind": "disruption",
                "severity": "HIGH",
                "station_id": None,
                "fuel_type": None,
                "message": f"Route {r['id']} is disrupted",
                "payload": {"route_id": r["id"]},
            })
    for s in stations:
        if s.get("status") == "OUTAGE":
            found.append({
                "kind": "disruption",
                "severity": "CRITICAL",
                "station_id": s["id"],
                "fuel_type": None,
                "message": f"Station {s['name']} is offline",
                "payload": {"station_id": s["id"]},
            })
    for d in snapshot.get("depots") or []:
        if d.get("status") == "CONSTRAINED":
            found.append({
                "kind": "disruption",
                "severity": "MEDIUM",
                "station_id": None,
                "fuel_type": None,
                "message": f"Depot {d['name']} operating with reduced capacity",
                "payload": {"depot_id": d["id"]},
            })

    # demand anomaly from active events
    for ev in events:
        if ev.get("status") != "ACTIVE":
            continue
        if ev.get("type") == "demand_spike":
            mult = (ev.get("parameters") or {}).get("multiplier", 1.5)
            found.append({
                "kind": "anomaly",
                "severity": "MEDIUM",
                "station_id": None,
                "fuel_type": None,
                "message": f"Demand spike active (+{int((mult-1)*100)}%)",
                "payload": {"event_id": ev["id"], "multiplier": mult},
            })
        elif ev.get("type") == "shipment_delay":
            delay = (ev.get("parameters") or {}).get("delay_ticks", 2)
            found.append({
                "kind": "disruption",
                "severity": "MEDIUM",
                "station_id": None,
                "fuel_type": None,
                "message": f"Supply shipment delayed by {delay} ticks",
                "payload": {"event_id": ev["id"], "delay_ticks": delay},
            })

    return found


def recompute_alerts(snapshot: dict[str, Any]) -> None:
    found = detect(snapshot)
    log.info("alerts.recompute", extra={"tick": (snapshot.get("instance") or {}).get("tick"), "found": len(found)})
    found_keys = {_alert_key(a["kind"], a["station_id"], a["fuel_type"]) for a in found}

    with SessionLocal() as s:
        # Mark resolved: any open alert whose key isn't in this snapshot
        rows = s.execute(select(Alert).where(Alert.resolved_at.is_(None))).scalars().all()
        now = datetime.now(timezone.utc)
        for r in rows:
            key = _alert_key(r.kind, r.station_id, r.fuel_type)
            if key not in found_keys:
                r.resolved_at = now

        # Insert new ones. If a key already exists and is open, skip.
        existing_keys = {
            _alert_key(r.kind, r.station_id, r.fuel_type)
            for r in s.execute(select(Alert).where(Alert.resolved_at.is_(None))).scalars().all()
        }
        inserted = 0
        for a in found:
            k = _alert_key(a["kind"], a["station_id"], a["fuel_type"])
            if k in existing_keys:
                continue
            tick = (snapshot.get("instance") or {}).get("tick")
            s.add(Alert(
                created_tick=tick,
                kind=a["kind"],
                severity=a["severity"],
                station_id=a["station_id"],
                fuel_type=a["fuel_type"],
                message=a["message"],
                payload=a["payload"],
            ))
            inserted += 1
        s.commit()
        log.info("alerts.committed", extra={"inserted": inserted, "existing": len(existing_keys)})
