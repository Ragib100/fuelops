"""Crisis-event tour — exercise every /admin/events type and verify the
banner / event list surfaces it on /api/overview and /api/events.

Usage:
  python3 loadtest/event-tour.py
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request

API = "http://localhost:8080"
TOKEN = "local-dev-token"
SETTLE = 6


def post(path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body or {}).encode(),
        headers={"Content-Type": "application/json", "X-Operator-Token": TOKEN},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def get(path: str):
    with urllib.request.urlopen(API + path, timeout=10) as r:
        return json.loads(r.read().decode())


def tour(event_type: str, parameters: dict, duration_ticks: int = 8) -> dict:
    print(f"\n--- Event: {event_type} ---")
    # Get current tick
    ov = get("/api/overview")
    start_tick = (ov.get("tick") or 0) + 1
    inject = post("/api/admin/demo/events", {
        "type": event_type,
        "start_tick": start_tick,
        "duration_ticks": duration_ticks,
        "parameters": parameters,
    })
    print(f"  inject: {inject}")
    time.sleep(SETTLE)
    events = get("/api/events")
    active = [e for e in events if e["type"] == event_type and e["status"] == "ACTIVE"]
    print(f"  active events of this type: {len(active)}")
    if active:
        print(f"  event row: id={active[0]['id']} start={active[0]['start_tick']} end={active[0]['end_tick']}")
    ov2 = get("/api/overview")
    banner = ov2.get("event_banner")
    banner_summary = None
    if banner:
        banner_summary = {"type": banner["type"], "severity": banner["severity"], "title": banner["title"]}
    print(f"  banner: {banner_summary}")
    return {"event": event_type, "inject": inject, "banner": banner_summary, "active_count": len(active)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output", default="loadtest/event-tour.json")
    args = p.parse_args()

    print("=== FuelOps crisis-event tour ===")
    # Ensure simulator is RUNNING (paused sims don't advance ticks)
    try:
        post("/api/admin/demo/run")
    except Exception:
        pass

    results = []
    cases = [
        ("demand_spike", {"multiplier": 1.8, "region_ids": ["region-dhaka"]}),
        ("route_disruption", {"route_ids": ["route-gazipur-mirpur"]}),
        ("depot_constraint", {"depot_ids": ["depot-gazipur"]}),
        ("station_outage", {"station_ids": ["station-mirpur"]}),
        ("shipment_delay", {"delay_ticks": 3, "depot_ids": ["depot-gazipur"]}),
        ("supply_shortfall", {"factor": 0.5, "depot_ids": ["depot-patiya"]}),
    ]
    for et, params in cases:
        try:
            results.append(tour(et, params))
        except Exception as exc:
            print(f"  crashed: {exc}")
            results.append({"event": et, "error": str(exc)})

    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
