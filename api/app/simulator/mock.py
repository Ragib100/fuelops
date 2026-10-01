"""In-process simulator mock.

Returns data shaped exactly like the real BUP Fuel Supply Simulator's `/v1/*`
endpoints (see simulator_integration_guide.md). Used when SIMULATOR_URL is empty
so the platform is demoable without Docker.

The mock is **stateful**: it advances a fake tick on each `step()` call and
mutates inventory / events accordingly. This is enough to drive the dashboard
end-to-end (KPIs move, alerts fire, recommendations change).
"""
from __future__ import annotations

import asyncio
import copy
import math
import random
from datetime import datetime, timedelta, timezone
from typing import Any

# ---- Static world (mirrors simulator_integration_guide.md §9) -----------------

FUELS = ("DIESEL", "PETROL", "OCTANE")

REGIONS = [
    {"id": "region-dhaka", "name": "Dhaka Division", "demand_factor": 1.00},
    {"id": "region-chattogram", "name": "Chattogram Division", "demand_factor": 1.08},
]

DEPOTS = [
    {
        "id": "depot-gazipur",
        "name": "Gazipur Depot",
        "region_id": "region-dhaka",
        "status": "OPEN",
        "dispatch_capacity_per_tick": 12000,
        "capacity": {"DIESEL": 90000, "PETROL": 70000, "OCTANE": 45000},
        "inventory": {"DIESEL": 60000, "PETROL": 45000, "OCTANE": 26000},
    },
    {
        "id": "depot-patiya",
        "name": "Patiya Depot",
        "region_id": "region-chattogram",
        "status": "OPEN",
        "dispatch_capacity_per_tick": 11000,
        "capacity": {"DIESEL": 85000, "PETROL": 65000, "OCTANE": 40000},
        "inventory": {"DIESEL": 55000, "PETROL": 42000, "OCTANE": 24000},
    },
]

STATIONS = [
    {
        "id": "station-mirpur",
        "name": "Mirpur Fuel Station",
        "region_id": "region-dhaka",
        "status": "OPEN",
        "demand_profile": "urban_high",
        "demand_multiplier": 1.0,
        "capacity": {"DIESEL": 15000, "PETROL": 14000, "OCTANE": 9000},
        "inventory": {"DIESEL": 9000, "PETROL": 9000, "OCTANE": 5000},
    },
    {
        "id": "station-tongi",
        "name": "Tongi Fuel Station",
        "region_id": "region-dhaka",
        "status": "OPEN",
        "demand_profile": "industrial",
        "demand_multiplier": 1.0,
        "capacity": {"DIESEL": 18000, "PETROL": 9000, "OCTANE": 6000},
        "inventory": {"DIESEL": 11000, "PETROL": 6000, "OCTANE": 3500},
    },
    {
        "id": "station-karnaphuli",
        "name": "Karnaphuli Fuel Station",
        "region_id": "region-chattogram",
        "status": "OPEN",
        "demand_profile": "highway",
        "demand_multiplier": 1.0,
        "capacity": {"DIESEL": 14000, "PETROL": 15000, "OCTANE": 9000},
        "inventory": {"DIESEL": 8500, "PETROL": 9500, "OCTANE": 5200},
    },
    {
        "id": "station-coxsbazar",
        "name": "Cox's Bazar Fuel Station",
        "region_id": "region-chattogram",
        "status": "OPEN",
        "demand_profile": "regional",
        "demand_multiplier": 1.0,
        "capacity": {"DIESEL": 12000, "PETROL": 12000, "OCTANE": 7000},
        "inventory": {"DIESEL": 7500, "PETROL": 7500, "OCTANE": 4200},
    },
]

ROUTES = [
    {"id": "route-gazipur-mirpur", "source_depot_id": "depot-gazipur",
     "destination_station_id": "station-mirpur", "transit_ticks": 2, "max_shipment": 7000, "status": "AVAILABLE"},
    {"id": "route-gazipur-tongi", "source_depot_id": "depot-gazipur",
     "destination_station_id": "station-tongi", "transit_ticks": 2, "max_shipment": 6500, "status": "AVAILABLE"},
    {"id": "route-patiya-karnaphuli", "source_depot_id": "depot-patiya",
     "destination_station_id": "station-karnaphuli", "transit_ticks": 2, "max_shipment": 7000, "status": "AVAILABLE"},
    {"id": "route-patiya-coxsbazar", "source_depot_id": "depot-patiya",
     "destination_station_id": "station-coxsbazar", "transit_ticks": 3, "max_shipment": 6000, "status": "AVAILABLE"},
    {"id": "route-gazipur-karnaphuli", "source_depot_id": "depot-gazipur",
     "destination_station_id": "station-karnaphuli", "transit_ticks": 4, "max_shipment": 5000, "status": "AVAILABLE"},
    {"id": "route-patiya-mirpur", "source_depot_id": "depot-patiya",
     "destination_station_id": "station-mirpur", "transit_ticks": 4, "max_shipment": 5000, "status": "AVAILABLE"},
]

# Demand prior: liters per simulated day, per profile x fuel (matches docs §9).
DAILY = {
    "urban_high": {"DIESEL": 8500, "PETROL": 10500, "OCTANE": 5600},
    "industrial": {"DIESEL": 14000, "PETROL": 4500, "OCTANE": 2200},
    "highway":    {"DIESEL": 10500, "PETROL": 11000, "OCTANE": 6200},
    "regional":   {"DIESEL": 7200,  "PETROL": 7600,  "OCTANE": 3600},
}
NOISE = {"urban_high": 0.10, "industrial": 0.08, "highway": 0.12, "regional": 0.10}

SIM_START = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
TICK_MINUTES = 15


def hour_factor(profile: str, h: int) -> float:
    if profile == "industrial":
        return 1.55 if 6 <= h <= 17 else 0.45
    if profile == "highway":
        return 1.35 if (6 <= h <= 9 or 16 <= h <= 20) else 0.75
    if profile == "urban_high":
        return 1.45 if (7 <= h <= 9 or 16 <= h <= 20) else 0.70
    if profile == "regional":
        return 1.25 if 7 <= h <= 20 else 0.65
    return 1.0


# ---- Mutable world state ------------------------------------------------------

class MockWorld:
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.tick = 0
        self.status = "PAUSED"
        self.seed = 12345
        self.scenario_id = "baseline"
        self.scenario_version = "1.0"
        self.regions = copy.deepcopy(REGIONS)
        self.depots = copy.deepcopy(DEPOTS)
        self.stations = copy.deepcopy(STATIONS)
        self.routes = copy.deepcopy(ROUTES)
        self.allocations: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.supply_arrivals = self._seed_supply_arrivals()
        self.demand_history: list[dict[str, Any]] = []
        self.served_total = 0.0
        self.unmet_total = 0.0
        self.failures = 0
        self._next_allocation_id = 1
        self._next_event_id = 1
        self._rng = random.Random(self.seed)
        self.stale_flag = False  # toggled by stale_data fault
        self.fault_state: dict[str, Any] = {}

    # ---- internal helpers -----------------------------------------------------

    def _seed_supply_arrivals(self) -> list[dict[str, Any]]:
        arrivals = []
        # Initial burst at ticks 12-20 covering day 1.
        burst = [
            ("depot-gazipur", "DIESEL", 18000, 12),
            ("depot-gazipur", "PETROL", 14000, 14),
            ("depot-patiya", "DIESEL", 16000, 16),
            ("depot-patiya", "PETROL", 12000, 20),
        ]
        for i, (depot, fuel, qty, t) in enumerate(burst, start=1):
            arrivals.append({
                "id": f"supply-{i:03d}",
                "depot_id": depot,
                "fuel_type": fuel,
                "quantity": qty,
                "planned_tick": t,
                "actual_tick": None,
                "status": "SCHEDULED",
            })
        # Recurring resupply every 64 ticks, sized to ~1 day regional demand.
        for cycle in range(3):
            base_tick = 84 + cycle * 64
            for j, (depot, fuel) in enumerate(
                [("depot-gazipur", "DIESEL"), ("depot-gazipur", "PETROL"),
                 ("depot-gazipur", "OCTANE"), ("depot-patiya", "DIESEL"),
                 ("depot-patiya", "PETROL"), ("depot-patiya", "OCTANE")]
            ):
                arrivals.append({
                    "id": f"supply-{len(arrivals) + 1:03d}",
                    "depot_id": depot,
                    "fuel_type": fuel,
                    "quantity": 15000 if fuel == "DIESEL" else 10000,
                    "planned_tick": base_tick + j * 4,
                    "actual_tick": None,
                    "status": "SCHEDULED",
                })
        return arrivals

    def sim_time(self) -> datetime:
        return SIM_START + timedelta(minutes=TICK_MINUTES * self.tick)

    def current_hour(self) -> int:
        return self.sim_time().hour

    # ---- public API matching /v1/* --------------------------------------------

    async def get_instance(self) -> dict:
        async with self.lock:
            return {
                "id": 1,
                "scenario_id": self.scenario_id,
                "scenario_version": self.scenario_version,
                "seed": self.seed,
                "sim_time": self.sim_time().isoformat(),
                "tick": self.tick,
                "tick_minutes": TICK_MINUTES,
                "status": self.status,
            }

    async def get_health(self) -> dict:
        return {
            "status": "ok",
            "database": "ok",
            "simulation": {"status": self.status.lower(), "tick": self.tick},
        }

    async def get_regions(self) -> list[dict]:
        async with self.lock:
            return copy.deepcopy(self.regions)

    async def get_depots(self) -> list[dict]:
        async with self.lock:
            return copy.deepcopy(self.depots)

    async def get_stations(self) -> list[dict]:
        async with self.lock:
            return copy.deepcopy(self.stations)

    async def get_routes(self) -> list[dict]:
        async with self.lock:
            return copy.deepcopy(self.routes)

    async def get_events(self) -> list[dict]:
        async with self.lock:
            return list(reversed(self.events))

    async def get_allocations(self) -> list[dict]:
        async with self.lock:
            return list(reversed(self.allocations))

    async def get_supply_arrivals(self) -> list[dict]:
        async with self.lock:
            return sorted(
                copy.deepcopy(self.supply_arrivals), key=lambda a: a["planned_tick"]
            )

    async def get_demand_history(self, station_id: str | None = None, limit: int = 200) -> list[dict]:
        async with self.lock:
            rows = self.demand_history
            if station_id:
                rows = [r for r in rows if r["station_id"] == station_id]
            return list(reversed(rows[-limit:]))

    async def get_metrics(self) -> dict:
        async with self.lock:
            total = self.served_total + self.unmet_total
            sl = self.served_total / total if total > 0 else 1.0
            alloc_liters = sum(
                a["quantity"] for a in self.allocations if a["status"] in ("IN_TRANSIT", "ARRIVED")
            )
            return {
                "served_demand_liters": round(self.served_total, 3),
                "unmet_demand_liters": round(self.unmet_total, 3),
                "service_level": round(sl, 6),
                "allocation_liters": round(alloc_liters, 3),
                "allocation_failures": self.failures,
            }

    async def post_allocation(self, body: dict) -> tuple[int, dict]:
        """Returns (status_code, response). Mirrors simulator validation."""
        async with self.lock:
            return self._post_allocation_locked(body)

    def _post_allocation_locked(self, body: dict) -> tuple[int, dict]:
        key = body.get("idempotency_key")
        depot_id = body.get("source_depot_id")
        station_id = body.get("destination_station_id")
        route_id = body.get("route_id")
        fuel = body.get("fuel_type")
        qty = body.get("quantity")

        if not (key and depot_id and station_id and route_id and fuel and qty):
            return 422, {"detail": [{"msg": "missing required field"}]}

        # Idempotency replay
        existing = next((a for a in self.allocations if a["idempotency_key"] == key), None)
        if existing:
            if (existing["source_depot_id"] == depot_id
                    and existing["destination_station_id"] == station_id
                    and existing["route_id"] == route_id
                    and existing["fuel_type"] == fuel
                    and existing["quantity"] == qty):
                return 200, copy.deepcopy(existing)
            return 409, {"detail": {"code": "IDEMPOTENCY_KEY_MISMATCH", "message": "key reused with different body"}}

        depot = next((d for d in self.depots if d["id"] == depot_id), None)
        station = next((s for s in self.stations if s["id"] == station_id), None)
        route = next((r for r in self.routes if r["id"] == route_id), None)
        if not depot or not station or not route:
            return 404, {"detail": {"code": "NOT_FOUND", "message": "unknown depot/station/route"}}
        if (route["source_depot_id"] != depot_id
                or route["destination_station_id"] != station_id):
            return 409, {"detail": {"code": "ROUTE_MISMATCH", "message": "route endpoints differ"}}
        if depot["status"] not in ("OPEN", "CONSTRAINED"):
            return 409, {"detail": {"code": "DEPOT_CLOSED", "message": f"depot {depot_id} {depot['status']}"}}
        if station["status"] != "OPEN":
            return 409, {"detail": {"code": "STATION_CLOSED", "message": f"station {station_id} {station['status']}"}}
        if route["status"] != "AVAILABLE":
            return 409, {"detail": {"code": "ROUTE_DISRUPTED", "message": f"route {route_id} {route['status']}"}}
        if qty > route["max_shipment"]:
            return 409, {"detail": {"code": "ROUTE_CAPACITY_EXCEEDED", "message": "qty > max_shipment"}}
        if depot["inventory"][fuel] < qty:
            return 409, {"detail": {"code": "INSUFFICIENT_INVENTORY", "message": "depot lacks fuel"}}
        # Dispatch cap check (pending + in-transit from depot this tick)
        committed = sum(
            a["quantity"] for a in self.allocations
            if a["source_depot_id"] == depot_id
            and a["status"] in ("PENDING", "IN_TRANSIT")
            and a["departure_tick"] == self.tick
        )
        if committed + qty > depot["dispatch_capacity_per_tick"]:
            return 409, {"detail": {"code": "DISPATCH_CAPACITY_EXCEEDED", "message": "dispatch budget exceeded"}}
        headroom = station["capacity"][fuel] - station["inventory"][fuel]
        if qty > headroom:
            return 409, {"detail": {"code": "DESTINATION_CAPACITY_EXCEEDED", "message": "station over capacity"}}

        # Accept
        depot["inventory"][fuel] -= qty
        a = {
            "id": self._next_allocation_id,
            "idempotency_key": key,
            "source_depot_id": depot_id,
            "destination_station_id": station_id,
            "route_id": route_id,
            "fuel_type": fuel,
            "quantity": qty,
            "created_tick": self.tick,
            "departure_tick": self.tick + 1,
            "expected_arrival_tick": self.tick + 1 + route["transit_ticks"],
            "actual_arrival_tick": None,
            "status": "PENDING",
            "failure_reason": None,
        }
        self._next_allocation_id += 1
        self.allocations.append(a)
        return 201, copy.deepcopy(a)

    async def cancel_allocation(self, alloc_id: int) -> tuple[int, dict]:
        async with self.lock:
            a = next((x for x in self.allocations if x["id"] == alloc_id), None)
            if not a:
                return 404, {"detail": {"code": "ALLOCATION_NOT_FOUND", "message": "unknown"}}
            if a["status"] != "PENDING":
                return 409, {"detail": {"code": "CANNOT_CANCEL", "message": f"status={a['status']}"}}
            # Refund
            depot = next(d for d in self.depots if d["id"] == a["source_depot_id"])
            depot["inventory"][a["fuel_type"]] += a["quantity"]
            a["status"] = "CANCELLED"
            return 200, copy.deepcopy(a)

    # ---- admin (fault/event injection) ---------------------------------------

    async def admin_run(self) -> dict:
        async with self.lock:
            self.status = "RUNNING"
        return {"status": "RUNNING", "tick": self.tick}

    async def admin_pause(self) -> dict:
        async with self.lock:
            self.status = "PAUSED"
        return {"status": "PAUSED", "tick": self.tick}

    async def admin_toggle(self) -> dict:
        async with self.lock:
            self.status = "RUNNING" if self.status == "PAUSED" else "PAUSED"
        return {"status": self.status, "tick": self.tick}

    async def admin_step(self) -> dict:
        async with self.lock:
            self._advance_tick_locked()
        return {"tick": self.tick, "sim_time": self.sim_time().isoformat()}

    async def admin_reset(self) -> dict:
        async with self.lock:
            self.tick = 0
            self.status = "PAUSED"
            self.depots = copy.deepcopy(DEPOTS)
            self.stations = copy.deepcopy(STATIONS)
            self.routes = copy.deepcopy(ROUTES)
            self.allocations = []
            self.events = []
            self.supply_arrivals = self._seed_supply_arrivals()
            self.demand_history = []
            self.served_total = 0.0
            self.unmet_total = 0.0
            self.failures = 0
            self._next_allocation_id = 1
            self._next_event_id = 1
            self._rng = random.Random(self.seed)
        return {"status": "reset", "tick": self.tick}

    async def admin_inject_event(self, body: dict) -> tuple[int, dict]:
        async with self.lock:
            t = body.get("type")
            start = int(body.get("start_tick", self.tick))
            dur = int(body.get("duration_ticks", 1))
            params = body.get("parameters", {})
            ev = {
                "id": self._next_event_id,
                "type": t,
                "start_tick": start,
                "end_tick": start + dur,
                "status": "SCHEDULED" if start > self.tick else "ACTIVE",
                "parameters": params,
            }
            self._next_event_id += 1
            self.events.append(ev)
            self._apply_event_locked(ev, active=True)
        return 201, copy.deepcopy(ev)

    async def admin_inject_fault(self, body: dict) -> dict:
        async with self.lock:
            self.fault_state = {"type": body.get("type"), "duration_seconds": body.get("duration_seconds", 60)}
            if body.get("type") == "stale_data":
                self.stale_flag = True
        return {"status": "injected", "fault": self.fault_state}

    async def admin_clear_faults(self) -> dict:
        async with self.lock:
            self.fault_state = {}
            self.stale_flag = False
        return {"status": "cleared"}

    async def admin_audit(self, limit: int = 200) -> list[dict]:
        async with self.lock:
            return list(reversed(self.events[-limit:]))

    # ---- tick advance ---------------------------------------------------------

    def _advance_tick_locked(self) -> None:
        self.tick += 1
        hour = self.current_hour()

        # 1. Update event statuses; expire ACTIVE events whose end_tick has passed.
        for ev in self.events:
            if ev["status"] == "SCHEDULED" and ev["start_tick"] <= self.tick:
                ev["status"] = "ACTIVE"
                self._apply_event_locked(ev, active=True)
            if ev["status"] == "ACTIVE" and ev["end_tick"] <= self.tick:
                ev["status"] = "RESOLVED"
                self._apply_event_locked(ev, active=False)

        # 2. Process pending allocations: PENDING -> IN_TRANSIT -> ARRIVED.
        for a in self.allocations:
            if a["status"] == "PENDING" and a["departure_tick"] is not None and a["departure_tick"] <= self.tick:
                route = next(r for r in self.routes if r["id"] == a["route_id"])
                if route["status"] != "AVAILABLE":
                    a["status"] = "FAILED"
                    a["failure_reason"] = "ROUTE_DISRUPTED_AT_DEPARTURE"
                    self.failures += 1
                    # Refund depot
                    depot = next(d for d in self.depots if d["id"] == a["source_depot_id"])
                    depot["inventory"][a["fuel_type"]] += a["quantity"]
                else:
                    a["status"] = "IN_TRANSIT"
            if a["status"] == "IN_TRANSIT" and a["expected_arrival_tick"] is not None and a["expected_arrival_tick"] <= self.tick:
                a["status"] = "ARRIVED"
                a["actual_arrival_tick"] = self.tick
                station = next(s for s in self.stations if s["id"] == a["destination_station_id"])
                station["inventory"][a["fuel_type"]] += a["quantity"]

        # 3. Process supply arrivals.
        for sa in self.supply_arrivals:
            if sa["status"] == "SCHEDULED" and sa["planned_tick"] <= self.tick:
                sa["status"] = "ARRIVED"
                sa["actual_tick"] = self.tick
                depot = next(d for d in self.depots if d["id"] == sa["depot_id"])
                depot["inventory"][sa["fuel_type"]] += sa["quantity"]

        # 4. Consume demand at each station, write history, update totals.
        for st in self.stations:
            if st["status"] != "OPEN":
                continue
            region = next(r for r in self.regions if r["id"] == st["region_id"])
            for fuel in FUELS:
                prior = DAILY[st["demand_profile"]][fuel] / 96.0 * hour_factor(st["demand_profile"], hour)
                noise = self._rng.gauss(1.0, NOISE[st["demand_profile"]])
                demand = max(0.0, prior * st["demand_multiplier"] * region["demand_factor"] * noise)
                served = min(demand, st["inventory"][fuel])
                unmet = demand - served
                st["inventory"][fuel] -= served
                self.served_total += served
                self.unmet_total += unmet
                self.demand_history.append({
                    "id": len(self.demand_history) + 1,
                    "station_id": st["id"],
                    "fuel_type": fuel,
                    "tick": self.tick,
                    "sim_time": self.sim_time().isoformat(),
                    "demand_liters": round(demand, 3),
                    "served_liters": round(served, 3),
                    "unmet_liters": round(unmet, 3),
                })

        # 5. Keep demand_history bounded (last 2000 rows).
        if len(self.demand_history) > 2000:
            self.demand_history = self.demand_history[-2000:]

    def _apply_event_locked(self, ev: dict, *, active: bool) -> None:
        t = ev["type"]
        params = ev.get("parameters", {}) or {}
        if t == "demand_spike":
            mult = float(params.get("multiplier", 1.5)) if active else 1.0
            ids = params.get("station_ids") or [s["id"] for s in self.stations
                                                 if s["region_id"] in params.get("region_ids", [])]
            for s in self.stations:
                if s["id"] in ids:
                    s["demand_multiplier"] = mult
        elif t == "route_disruption":
            ids = params.get("route_ids") or [r["id"] for r in self.routes]
            for r in self.routes:
                if r["id"] in ids:
                    r["status"] = "DISRUPTED" if active else "AVAILABLE"
        elif t == "station_outage":
            ids = params.get("station_ids") or [s["id"] for s in self.stations
                                                  if s["region_id"] in params.get("region_ids", [])]
            for s in self.stations:
                if s["id"] in ids:
                    s["status"] = "OUTAGE" if active else "OPEN"
        elif t == "depot_constraint":
            ids = params.get("depot_ids") or [d["id"] for d in self.depots]
            for d in self.depots:
                if d["id"] in ids:
                    d["status"] = "CONSTRAINED" if active else "OPEN"


# ---- Fault injection hooks ----------------------------------------------------

class FaultState:
    """Read by the client to decide whether to short-circuit a call."""

    def __init__(self) -> None:
        self.mode: str = "none"  # none | unavailable | error_rate | latency | stream_disconnect
        self.rate: float = 0.25
        self.delay_ms: int = 500

    def maybe_fault(self) -> str | None:
        """Return a fault code to inject, or None."""
        if self.mode == "none":
            return None
        if self.mode == "unavailable":
            return "unavailable"
        if self.mode == "stream_disconnect":
            return "stream_disconnect"
        if self.mode == "error_rate":
            return "error_rate" if random.random() < self.rate else None
        return None

    def maybe_delay_seconds(self) -> float:
        if self.mode == "latency":
            return self.delay_ms / 1000.0
        return 0.0


WORLD = MockWorld()
FAULTS = FaultState()
