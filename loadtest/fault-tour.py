"""Bounded fault-injection tour. For each of the 5 simulator faults:
  1. Clear faults.
  2. Inject the fault for a fixed duration.
  3. Probe /api/system/status and /api/overview after a settle delay.
  4. Capture the result.
  5. Clear faults.

Usage:
  python3 loadtest/fault-tour.py
  python3 loadtest/fault-tour.py --output /tmp/fault-tour.json
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request
import urllib.error

API = "http://localhost:8080"
TOKEN = "local-dev-token"
SETTLE_SECONDS = 8  # let ingest poll pick up the fault
FAULT_DURATION_S = 25


def post(path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body or {}).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Operator-Token": TOKEN,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def get(path: str) -> dict:
    with urllib.request.urlopen(API + path, timeout=10) as r:
        return json.loads(r.read().decode())


def get_status() -> dict:
    with urllib.request.urlopen(API + "/api/system/status", timeout=10) as r:
        return json.loads(r.read().decode())


def get_overview() -> dict:
    with urllib.request.urlopen(API + "/api/overview", timeout=10) as r:
        return json.loads(r.read().decode())


def tour_one(fault: str) -> dict:
    print(f"\n--- Fault: {fault} ---")
    post("/api/admin/demo/faults/clear")
    time.sleep(2)
    inject_resp = post(
        "/api/admin/demo/faults",
        {"type": fault, "duration_seconds": FAULT_DURATION_S},
    )
    print(f"  inject: {inject_resp}")
    time.sleep(SETTLE_SECONDS)
    try:
        status = get_status()
        overview_ok = True
        try:
            get_overview()
        except Exception as exc:
            overview_ok = False
            print(f"  /api/overview ERROR: {exc}")
        snap = {
            "overall": status.get("overall"),
            "fallback_active": status.get("fallback_active"),
            "stale": status.get("stale"),
            "simulator_status": next(
                (s for s in status.get("services", []) if s["name"] == "Fuel simulator"),
                {},
            ),
            "sse_status": next(
                (s for s in status.get("services", []) if s["name"] == "SSE stream"),
                {},
            ),
            "overview_http_ok": overview_ok,
        }
        print(f"  status snapshot: {snap}")
    except Exception as exc:
        snap = {"error": str(exc)}
        print(f"  status snapshot FAILED: {exc}")
    post("/api/admin/demo/faults/clear")
    print("  cleared")
    time.sleep(2)
    return {"fault": fault, "during_fault": snap}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--output", default="loadtest/fault-tour.json")
    args = p.parse_args()

    print("=== FuelOps fault-injection tour ===")
    print(f"API: {API}  duration: {FAULT_DURATION_S}s  settle: {SETTLE_SECONDS}s")

    results = []
    # Order matters: faults that open the circuit breaker (unavailable,
    # error_rate) leave the breaker open for ~30s. To observe
    # `stale_data` we need the breaker closed. So we test stale_data
    # last, with a long pre-settle to let the breaker reset.
    for fault in ["unavailable", "error_rate", "latency", "stream_disconnect"]:
        try:
            results.append(tour_one(fault))
        except Exception as exc:
            print(f"  tour_one({fault}) crashed: {exc}")
            results.append({"fault": fault, "error": str(exc)})

    # Wait for circuit-breaker cooldown before testing stale_data.
    print("\n--- Waiting 35s for circuit-breaker cooldown ---")
    time.sleep(35)
    try:
        results.append(tour_one("stale_data"))
    except Exception as exc:
        print(f"  tour_one(stale_data) crashed: {exc}")
        results.append({"fault": "stale_data", "error": str(exc)})

    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
