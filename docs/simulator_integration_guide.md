# BUP Fuel Supply Simulator — Integration & Interaction Guide
*(Summary of the official "Integration and Interaction Guide", plus practical how-to notes. Read together with `hackathon_guide.md`.)*

**Scope of the official doc:** everything your app needs to *integrate* with the simulator and *interact* with its API surfaces (REST, SSE, admin). It does **not** cover challenge framing, deliverables, scoring, demo, or strategy (that is the participant brief).

---

## 1. What the Simulator Is

- A **deterministic, locally-runnable** environment modelling a small Bangladeshi fuel supply chain.
- **2 regions, 2 depots, 4 stations, 6 routes, 3 fuel types**, and a **15-minute tick clock** (controllable).
- Every participant gets the **same world**: same demand curve, same initial inventory, same injected crises → judges score your *decisions*, not your luck.
- Your app runs **outside** the simulator container and talks to it over **HTTP**:
  - **Read** the world through REST (`/v1/...`)
  - **Get change hints** via Server-Sent Events (`/v1/stream`)
  - **Write** decisions through **exactly one endpoint**: `POST /v1/allocations`
- The simulator then executes your decisions, advances time, and reports what happened.
- Use the historical + simulated data to build predictive capabilities and continuously improve decisions.
- **REST = source of truth. SSE = a hint that something changed.**

---

## 2. Fast Start

The simulator ships as one `docker-compose.yml`:

```yaml
services:
  simulator-api:
    image: asifmahmoud414/bup-fuel-supply-simulator:1.0.0
    environment:
      SIMULATION_SPEED: ${SIMULATION_SPEED:-8}
      TICK_MINUTES: ${TICK_MINUTES:-15}
      SIMULATOR_START_MODE: ${SIMULATOR_START_MODE:-paused}   # paused | running
    ports:
      - "8000:8000"
```

| Env var | Meaning |
|---|---|
| `SIMULATION_SPEED` | Wall-clock **ticks per second** while running. Higher = faster time |
| `TICK_MINUTES` | Simulated **minutes per tick**. Larger = coarser steps |
| `SIMULATOR_START_MODE` | `running` = tick immediately; `paused` = wait until resumed |

```bash
docker compose up -d
curl -s http://localhost:8000/v1/health
```

**Tip for your own stack:** put the simulator as a service in *your* `docker-compose.yml` (same image) so `docker compose up` launches everything. Use `http://simulator-api:8000` as the base URL inside the compose network.

---

## 3. Hard Rules (Do Not Break These)

1. **The simulator is the world, not the brain.** It doesn't predict, optimize, recommend, or decide. It only executes your `POST /v1/allocations` calls and reports what happened.
2. **REST is the source of truth.** Treat SSE as notification only — **always re-GET the affected resource after every event**.
3. **Deterministic:** same scenario + same seed + same actions + same injected events ⇒ **byte-identical state** (including per-tick demand jitter).
4. **Scenario is baked into the image.** Can't switch at runtime. Default scenario (`baseline`) has **no preloaded events**.
5. **One simulator instance per participant.** Single-tenant, local. No central server.
6. **Do NOT modify the simulator source** to solve the challenge. Judges run your submission against the **published image**.
7. **`/admin/*` bypasses all fault injection.** To test fault handling, hit `/v1/*` only. `/v1/health` also bypasses faults (use as liveness probe).
8. **Only allocations can be written from `/v1/*`.** Everything else is read-only. Crisis events and faults are injected via `/admin/*`. *(The last bullet is cut off in the source PDF; this is the evident meaning.)*

---

## 4. Quick Reference Card

| Setting | Details |
|---|---|
| Base URL (local) | `http://localhost:8000` |
| Swagger UI | `http://localhost:8000/docs` |
| ReDoc | `http://localhost:8000/redoc` |
| Simulator dashboard | `http://localhost:8000/admin` |
| Idempotency key | **Not a header.** Sent as `idempotency_key` **body field** on `/v1/allocations` |
| Stale-data signal | `X-Simulator-Stale: true` response header on `/v1/*` GETs when a stale-data fault is active |
| Default tick | 15 simulated minutes (`TICK_MINUTES`) |
| Default speed | 8 ticks/sec wall-clock while RUNNING (`SIMULATION_SPEED`) |

> Open `/docs` (Swagger) first thing at the event — it is the authoritative machine-readable spec.

---

## 5. Public `/v1/*` Endpoints (Read APIs)

All return JSON. **All `/v1/*` except `/v1/health` are subject to fault injection.**

| Endpoint | Purpose | Notes |
|---|---|---|
| `GET /v1/health` | Liveness probe | Bypasses faults. `{status, database, simulation:{status, tick}}` |
| `GET /v1/instance` | Current tick, sim_time, status, seed | Read often. `status ∈ {PAUSED, RUNNING}` |
| `GET /v1/regions` | Regions + `demand_factor` | Dhaka 1.00, Chattogram 1.08 |
| `GET /v1/depots`, `/v1/depots/{id}` | Depot status, capacity, inventory, dispatch cap | `status ∈ {OPEN, CONSTRAINED}`; unknown id → `404 NOT_FOUND` |
| `GET /v1/stations`, `/v1/stations/{id}` | Station status, capacity, inventory, demand profile/multiplier | `status ∈ {OPEN, OUTAGE}`; `demand_multiplier` mutated by `demand_spike` events |
| `GET /v1/routes` | Depot→station links | `status ∈ {AVAILABLE, DISRUPTED}` |
| `GET /v1/supply-arrivals` | Incoming supply, sorted by `planned_tick` asc | `status ∈ {SCHEDULED, DELAYED, ARRIVED}` |
| `GET /v1/events` | Domain events (injected or preloaded), id-desc | `status ∈ {SCHEDULED, ACTIVE, RESOLVED}` |
| `GET /v1/allocations` | Your shipment ledger, id-desc | `status ∈ {PENDING, IN_TRANSIT, ARRIVED, FAILED, CANCELLED}` |
| `GET /v1/demand-history?station_id=&limit=` | Demand time-series for forecasting | `limit` clamped to [1, 2000], default 200. **Always pass a limit** (table grows unboundedly) |
| `GET /v1/metrics` | Aggregated ground-truth metrics | see below |
| `GET /v1/stream` | SSE feed | see §7 |

### Response shapes

**Instance**
```json
{ "id": 1, "scenario_id": "baseline", "scenario_version": "1.0", "seed": 12345,
  "sim_time": "2026-01-01T00:00:00+00:00", "tick": 0, "tick_minutes": 15, "status": "PAUSED" }
```

**Depot**
```json
{ "id": "depot-gazipur", "name": "Gazipur Depot", "region_id": "region-dhaka", "status": "OPEN",
  "dispatch_capacity_per_tick": 12000,
  "capacity":  { "DIESEL": 90000, "PETROL": 70000, "OCTANE": 45000 },
  "inventory": { "DIESEL": 60000, "PETROL": 45000, "OCTANE": 26000 } }
```

**Station**
```json
{ "id": "station-mirpur", "name": "Mirpur Fuel Station", "region_id": "region-dhaka", "status": "OPEN",
  "demand_profile": "urban_high", "demand_multiplier": 1.0,
  "capacity":  { "DIESEL": 15000, "PETROL": 14000, "OCTANE": 9000 },
  "inventory": { "DIESEL": 9000,  "PETROL": 9000,  "OCTANE": 5000 } }
```

**Route**
```json
{ "id": "route-gazipur-mirpur", "source_depot_id": "depot-gazipur",
  "destination_station_id": "station-mirpur", "transit_ticks": 2, "max_shipment": 7000, "status": "AVAILABLE" }
```

**Supply arrival**
```json
{ "id": "supply-001", "depot_id": "depot-gazipur", "fuel_type": "DIESEL", "quantity": 18000,
  "planned_tick": 12, "actual_tick": null, "status": "SCHEDULED" }
```

**Event**
```json
{ "id": 1, "type": "demand_spike", "start_tick": 8, "end_tick": 20, "status": "RESOLVED",
  "parameters": { "region_ids": ["region-dhaka"], "multiplier": 1.8 } }
```

**Allocation**
```json
{ "id": 1, "idempotency_key": "demo-001", "source_depot_id": "depot-gazipur",
  "destination_station_id": "station-mirpur", "route_id": "route-gazipur-mirpur",
  "fuel_type": "DIESEL", "quantity": 3000, "created_tick": 5, "departure_tick": 6,
  "expected_arrival_tick": 8, "actual_arrival_tick": 8, "status": "ARRIVED", "failure_reason": null }
```

**Demand observation** (one row per station × fuel per tick → **4 × 3 = 12 rows/tick**)
```json
{ "id": 100, "station_id": "station-mirpur", "fuel_type": "DIESEL", "tick": 12,
  "sim_time": "2026-01-01T03:00:00+00:00", "demand_liters": 95.123, "served_liters": 95.123, "unmet_liters": 0.0 }
```

**Metrics**
```json
{ "served_demand_liters": 12345.678, "unmet_demand_liters": 234.567, "service_level": 0.981408,
  "allocation_liters": 9800.000, "allocation_failures": 2 }
```
- `service_level = served / (served + unmet)` (1.0 = zero unmet demand). **This is the natural headline KPI for your dashboard and for measuring your policy.**
- `allocation_liters` counts only `IN_TRANSIT` + `ARRIVED` (not PENDING/FAILED/CANCELLED).
- `allocation_failures` = count of `FAILED` allocations (route disrupted at departure time).

---

## 6. `POST /v1/allocations` — The Only Domain Write

### Request
```http
POST /v1/allocations
Content-Type: application/json

{
  "idempotency_key": "demo-001",
  "source_depot_id": "depot-gazipur",
  "destination_station_id": "station-mirpur",
  "route_id": "route-gazipur-mirpur",
  "fuel_type": "DIESEL",
  "quantity": 3000
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `idempotency_key` | string | yes | length 1–150; unique unless replaying the *exact same* request |
| `source_depot_id` | string | yes | must exist in `/v1/depots` |
| `destination_station_id` | string | yes | must exist in `/v1/stations` |
| `route_id` | string | yes | must exist in `/v1/routes` |
| `fuel_type` | enum | yes | `DIESEL` \| `PETROL` \| `OCTANE` |
| `quantity` | float | yes | > 0 and ≤ `route.max_shipment` |

### Validation order (first failure wins)
1. **Idempotency check** (see below)
2. `NOT_FOUND` (404) — unknown depot / station / route id
3. `ROUTE_MISMATCH` (409) — route's (depot, station) ≠ the ones in your request
4. `DEPOT_CLOSED` (409) — depot status not in {OPEN, CONSTRAINED}
5. `STATION_CLOSED` (409) — station status ≠ OPEN
6. `ROUTE_DISRUPTED` (409) — route status ≠ AVAILABLE
7. `ROUTE_CAPACITY_EXCEEDED` (409) — quantity > route.max_shipment
8. `INSUFFICIENT_INVENTORY` (409) — depot inventory[fuel] < quantity
9. `DISPATCH_CAPACITY_EXCEEDED` (409) — (in-flight + pending qty from this depot this tick) + quantity > depot.dispatch_capacity_per_tick
10. `DESTINATION_CAPACITY_EXCEEDED` (409) — station inventory[fuel] + quantity > station.capacity[fuel]

### Success — `201 Created`
Returns the allocation with `status: "PENDING"` and `departure_tick / expected_arrival_tick / actual_arrival_tick = null` (filled later as ticks advance).

### Idempotency rules
- **Same key + same body** → returns the existing allocation (safe retry). The rules section says **HTTP 201**; the status table says **200** — *the doc is inconsistent, so accept both 200 and 201 as success*.
- **Same key + different body** → `409 IDEMPOTENCY_KEY_MISMATCH` (first submission wins; use a new key).
- **Cancellation does NOT free the key.** A used key is permanently occupied.

### Cancel — `POST /v1/allocations/{allocation_id}/cancel`
- Refunds depot inventory, marks `CANCELLED`. **Only valid for `PENDING`.**
- `200` updated allocation · `404 ALLOCATION_NOT_FOUND` · `409 CANNOT_CANCEL` (not PENDING — already moving, can't recover).

### Allocation lifecycle
`PENDING` (created this tick) → `IN_TRANSIT` (departed) → `ARRIVED`
Other end states: `FAILED` (route disrupted at departure time), `CANCELLED`.

---

## 7. SSE Stream — `GET /v1/stream`

`text/event-stream`. The only push channel from the simulator.

### Wire protocol
- On connect: `: connected\n\n` (comment — ignore).
- Each event: `event: <name>\ndata: <json>\n\n`
- After 15 s silence: `: keepalive\n\n` (**normal — not a disconnect**).
- Per-subscriber buffer: `asyncio.Queue(maxsize=200)`. If you fall >200 events behind, **your queue is silently dropped** → you must reconnect.

### Reconnection
- **No `Last-Event-ID` replay.** After reconnect you only get events from that moment on.
- **Always re-fetch full state via REST after any reconnect.**

### Event names
| Event | When | Payload |
|---|---|---|
| `simulation.tick` | End of every tick | `{"tick": int, "sim_time": ISO-8601}` |
| `allocation.status_changed` | Allocation created / departed / arrived / failed / cancelled | full allocation object |
| `inventory.updated` | Depot inventory changed | `{"entity_type":"depot","entity_id":"<id>","inventory":{...}}` |
| `simulator.notice` | `POST /admin/reset`, or background-runner exception | `{"message":"..."}` or `{"level":"error","message":"..."}` |

Audit-log actions like `event.started`, `event.resolved`, `supply.arrived`, `allocation.departed` are **not** SSE events — read them from `GET /admin/audit`.

> Note: SSE has **no** event for crisis events starting/ending or station inventory changes. After each `simulation.tick`, re-GET `/v1/events`, `/v1/stations`, `/v1/routes`, etc. yourself.

### Fault interaction
- `stream_disconnect` fault → `GET /v1/stream` returns `503 {"detail":{"code":"FAULT_INJECTED"}}`.
- `stale_data` fault → non-stream GETs get `X-Simulator-Stale: true`. The SSE stream itself does **not**.

---

## 8. Admin Endpoints — `/admin/*`

Bypass fault injection. Meant for organizers, but **very useful for your own testing and demo**.

| Endpoint | What it does |
|---|---|
| `GET /admin` | HTML console (auto-refresh 2 s): live state, metrics, row counts, audit log, forms to inject events/faults and run/pause/step/reset |
| `POST /admin/run` | Status → `RUNNING`; background runner ticks |
| `POST /admin/pause` | Status → `PAUSED`; PENDING/IN_TRANSIT allocations stay frozen |
| `POST /admin/toggle` | Flip RUNNING ↔ PAUSED |
| `POST /admin/step` | **Advance exactly one tick** (works even while PAUSED). Returns `{"tick": 6, "sim_time": "..."}`. **Best way to run deterministic tests** |
| `POST /admin/reset` | **Hard reset**: wipes all rows (demand_observations, allocations, events, faults, audit_logs, supply_arrivals, routes, stations, depots, regions, simulation_instances) and reloads the baked scenario. Publishes `simulator.notice` "Simulation reset" |
| `POST /admin/events` | Inject a crisis event |
| `POST /admin/faults` | Inject an API fault |
| `POST /admin/faults/clear` | Deactivate all active faults (idempotent) → `{"status":"cleared"}` |
| `GET /admin/audit?limit=` | Ground-truth audit log (limit [1,1000], default 200, id-desc) |
| `GET /admin/faults`, `GET /admin/events` | Last 50 rows each, id-desc (timeline visualisation) |

> **Reset caution:** after `/admin/reset` your local DB/cache (allocation IDs, tick numbers, demand history) is stale — detect the `simulator.notice` (or tick going backwards) and rebuild state.

### Inject a crisis event — `POST /admin/events`
```json
{ "type": "demand_spike", "start_tick": 8, "duration_ticks": 12,
  "parameters": { "region_ids": ["region-dhaka"], "multiplier": 1.8 } }
```
| Field | Type | Required | Constraints |
|---|---|---|---|
| `type` | enum | yes | one of 6 (below) |
| `start_tick` | int | yes | ≥ 0 |
| `duration_ticks` | int | yes | > 0 |
| `parameters` | object | no | default `{}` |

`end_tick = start_tick + duration_ticks`. Returns `201` with the persisted event.

### Event types

| type | Parameters | Effect while ACTIVE | On resolve |
|---|---|---|---|
| `demand_spike` | `multiplier` (def 1.5), `station_ids[]`, `region_ids[]` | multiplies affected stations' `demand_multiplier` | divides back (≥ 0.01) |
| `route_disruption` | `route_ids[]` | routes → `DISRUPTED` | routes → `AVAILABLE` |
| `station_outage` | `station_ids[]` | stations → `OUTAGE` (served drops to 0) | stations → `OPEN` |
| `depot_constraint` | `depot_ids[]` | depots → `CONSTRAINED` (still shippable; signals reduced capacity) | depots → `OPEN` |
| `shipment_delay` | `delay_ticks` (def 2), `depot_ids[]`, `fuel_types[]` | supply `planned_tick += delay_ticks`, status → `DELAYED` | **one-shot**, not auto-undone |
| `supply_shortfall` | `factor` (def 0.5), `depot_ids[]`, `fuel_types[]` | supply `quantity *= factor` | **one-shot**, not auto-restored |

**Filters:** `station_ids / region_ids / route_ids / depot_ids / fuel_types` are filters — **an empty list means "all" of that type**.

*These six types map directly onto the brief's crisis table:* shipment delay → `shipment_delay`; demand spike → `demand_spike`; depot constraint → `depot_constraint`; regional disruption → `route_disruption` / `station_outage`; combined crisis → inject 2+ at once. (`supply_shortfall` is an extra to prepare for.)

### Inject a fault — `POST /admin/faults`
```json
{ "type": "stale_data", "duration_seconds": 60, "parameters": {} }
```
`duration_seconds`: 0 < x ≤ 3600. Auto-expires (or clear manually).

| type | parameters | Effect on `/v1/*` (not `/admin/*`, not `/v1/health`) |
|---|---|---|
| `latency` | `{"delay_ms": 500}` (default 500) | sleeps `delay_ms` before every non-admin, non-health request |
| `unavailable` | — | returns `503 {"error":{"code":"FAULT_INJECTED","message":"Simulator API temporarily unavailable."}}` |
| `error_rate` | `{"rate": 0.25}` (default 0.25) | with probability `rate`, returns `503 {"error":{"code":"FAULT_INJECTED","message":"Injected transient API error."}}` |
| `stale_data` | — | doesn't block; adds `X-Simulator-Stale: true` to `/v1/*` GETs |
| `stream_disconnect` | — | `GET /v1/stream` → `503 {"detail":{"code":"FAULT_INJECTED"}}` (**nested under `detail`, not `error`**) |

**These are the "simulator dependency failure" cases for your resilience demo** — and the organizers will likely use them against you. Handle all five.

---

## 9. The Simulated World (Fixed)

The image runs `baseline.yaml` (seed 12345, no preloaded events). All scenarios share this world; they differ only in **seed and preloaded events**.

### Regions
| id | name | demand_factor |
|---|---|---|
| region-dhaka | Dhaka Division | 1.00 |
| region-chattogram | Chattogram Division | 1.08 |

### Depots (D = Diesel, P = Petrol, O = Octane)
| id | region | dispatch/tick | capacity D/P/O | initial inventory D/P/O |
|---|---|---|---|---|
| depot-gazipur | region-dhaka | 12,000 | 90,000 / 70,000 / 45,000 | 60,000 / 45,000 / 26,000 |
| depot-patiya | region-chattogram | 11,000 | 85,000 / 65,000 / 40,000 | 55,000 / 42,000 / 24,000 |

### Stations
| id | region | profile | capacity D/P/O | initial inventory D/P/O |
|---|---|---|---|---|
| station-mirpur | region-dhaka | urban_high | 15,000 / 14,000 / 9,000 | 9,000 / 9,000 / 5,000 |
| station-tongi | region-dhaka | industrial | 18,000 / 9,000 / 6,000 | 11,000 / 6,000 / 3,500 |
| station-karnaphuli | region-chattogram | highway | 14,000 / 15,000 / 9,000 | 8,500 / 9,500 / 5,200 |
| station-coxsbazar | region-chattogram | regional | 12,000 / 12,000 / 7,000 | 7,500 / 7,500 / 4,200 |

### Routes
| id | depot → station | transit_ticks | max_shipment |
|---|---|---|---|
| route-gazipur-mirpur | gazipur → mirpur | 2 | 7,000 |
| route-gazipur-tongi | gazipur → tongi | 2 | 6,500 |
| route-patiya-karnaphuli | patiya → karnaphuli | 2 | 7,000 |
| route-patiya-coxsbazar | patiya → coxsbazar | 3 | 6,000 |
| route-gazipur-karnaphuli | gazipur → karnaphuli | 4 | 5,000 |
| route-patiya-mirpur | patiya → mirpur | 4 | 5,000 |

**Network insight:** each station has a "home" depot route; **Karnaphuli and Mirpur each have a second, longer (4-tick) cross-region route** — these are your *alternative routes* when a primary route is disrupted. Tongi and Cox's Bazar have **no alternate** — if their only route is disrupted, you can't resupply them (a deliberate "failure boundary" to surface in the UI).

### Demand profiles (liters per simulated day)
| profile | DIESEL | PETROL | OCTANE | noise |
|---|---|---|---|---|
| urban_high | 8,500 | 10,500 | 5,600 | 0.10 |
| industrial | 14,000 | 4,500 | 2,200 | 0.08 |
| highway | 10,500 | 11,000 | 6,200 | 0.12 |
| regional | 7,200 | 7,600 | 3,600 | 0.10 |

### Hour-of-day factors
| profile | busy hours → factor | off-peak → factor |
|---|---|---|
| industrial | 06:00–17:59 → 1.55 | 18:00–05:59 → 0.45 |
| highway | 06–09 or 16–20 → 1.35 | else → 0.75 |
| urban_high | 07–09 or 16–20 → 1.45 | else → 0.70 |
| regional | 07:00–20:59 → 1.25 | 21:00–06:59 → 0.65 |

### Supply arrival pattern (same for all scenarios)
- **22 arrivals** total.
- **4 "initial burst"** arrivals at ticks 12–20 (cover day 1).
- **18 "recurring resupply"** arrivals, **64 ticks apart** (~16 simulated hours), sized to ~one day's regional demand.

### Time math
- 1 tick = 15 sim-min → **96 ticks/day**.
- At default speed 8 ticks/s → **one simulated day ≈ 12 seconds** wall-clock. For readable demos, lower `SIMULATION_SPEED` or run `paused` + `/admin/step`.

---

## 10. Status-Code Cheat Sheet

`/v1/allocations` errors: `{"detail": {"code": "<UPPER_SNAKE>", "message": "..."}}`
Injected faults: `{"error": {"code": "FAULT_INJECTED", ...}}` — **`error`, not `detail`** (and `stream_disconnect` uses `detail`!)
Pydantic validation: FastAPI default `{"detail":[...]}`.

| HTTP | Code | Trigger | Handling |
|---|---|---|---|
| 200 | — | Idempotent replay | Continue normally (doc also says 201 — accept both) |
| 201 | — | New allocation accepted | Cache returned `id` |
| 404 | `NOT_FOUND` | Unknown depot/station/route id | Check ids against `/v1/depots`, `/stations`, `/routes` |
| 404 | `ALLOCATION_NOT_FOUND` | Cancel on unknown id | Check `/v1/allocations` |
| 409 | `IDEMPOTENCY_KEY_MISMATCH` | Same key, different body | New key; first wins |
| 409 | `ROUTE_MISMATCH` | Route connects different endpoints | Use a matching route |
| 409 | `DEPOT_CLOSED` | Depot not OPEN/CONSTRAINED | Wait for `depot_constraint` to resolve |
| 409 | `STATION_CLOSED` | Station ≠ OPEN | Wait for `station_outage` to resolve |
| 409 | `ROUTE_DISRUPTED` | Route ≠ AVAILABLE | Wait, or pick another route |
| 409 | `ROUTE_CAPACITY_EXCEEDED` | qty > `max_shipment` | Split into smaller allocations |
| 409 | `INSUFFICIENT_INVENTORY` | Depot lacks the fuel | Re-fetch inventory; wait for next supply arrival |
| 409 | `DISPATCH_CAPACITY_EXCEEDED` | In-flight + pending from depot this tick > dispatch cap | Wait for next tick |
| 409 | `DESTINATION_CAPACITY_EXCEEDED` | station inv + qty > capacity | Wait for demand to consume fuel |
| 409 | `CANNOT_CANCEL` | Cancel on non-PENDING | Already in motion |
| 422 | (Pydantic) | Bad enum, missing field, `duration_ticks=0`, `quantity ≤ 0` … | Validate payload client-side |
| 503 | `FAULT_INJECTED` | Active `unavailable` / `error_rate` / `stream_disconnect` | Backoff + retry + degraded mode |

---

## 11. Defensive Client Checklist (from the doc)

Your client should handle all of these:

- `GET /v1/health` — liveness (bypasses faults)
- `GET /v1/instance` — tick, sim_time, status, seed
- `GET /v1/depots` — capacity, inventory, dispatch capacity
- `GET /v1/stations` — inventory, demand_multiplier, capacity
- `GET /v1/routes` — availability, max_shipment, transit_ticks
- `GET /v1/supply-arrivals` — upcoming deliveries
- `GET /v1/events` — past/active/scheduled crisis events
- `GET /v1/allocations` — shipment ledger
- `GET /v1/demand-history` — forecasting series (limit 1–2000)
- `GET /v1/metrics` — service_level + allocation_failures
- `POST /v1/allocations` — returns 201/200/404/409/503
- `POST /v1/allocations/{id}/cancel` — refunds PENDING only
- `GET /v1/stream` — SSE (queue 200; 15 s keepalive)

**SSE rules**
1. SSE is advisory — re-GET REST state after every interesting event.
2. Watch `X-Simulator-Stale: true` on `/v1/*` GETs and **invalidate local cache**.
3. `stream_disconnect` active → `/v1/stream` returns 503 → back off and retry.
4. >200 events behind → silently dropped → reconnect and refetch.
5. No `Last-Event-ID` replay → refetch state after reconnect.
6. 15 s silence is normal (keepalive), not a disconnect.

---

# Part B — Practical Integration Notes (my suggestions, not from the PDF)

## B1. Simulator client module (single choke point)
- One class/module (`simulator_client`) is the **only** code that calls the simulator.
- **Timeouts** on every call (e.g. 2–3 s connect/read).
- **Retries with exponential backoff + jitter** for `503 FAULT_INJECTED`, timeouts, connection errors. **Never retry 4xx** (except after re-fetching state).
- **Parse both error shapes** (`error.code` and `detail.code`) + the 422 list shape.
- **Schema-validate** responses (Pydantic / zod). Invalid/unexpected → reject + raise alert (brief §Resilience).
- **Stale detection:** if `X-Simulator-Stale: true` → mark data stale, don't cache it as fresh, show a UI badge, lower prediction confidence / request human review.
- **Circuit breaker:** after N consecutive failures, stop hammering, serve **cached last-known-good state** (with an "as of tick X" label), probe `/v1/health` to close the breaker.
- Emit metrics for every call (count, latency, status class) → Prometheus.

## B2. Data loop
1. Bootstrap: GET instance, regions, depots, stations, routes, supply-arrivals, events, allocations, metrics, demand-history (limit ≤ 2000).
2. Persist a **snapshot per tick** in your DB (inventory, statuses, metrics) — gives you history, replay, and charts.
3. Subscribe to SSE. On `simulation.tick` → re-GET the state you need (and events/routes/stations). On `allocation.status_changed` → refresh that allocation / ledger. On `inventory.updated` → re-GET the depot.
4. **Safety-net poll** (e.g. every few seconds) in case SSE dies silently (queue drop, stream fault).
5. On reconnect or `simulator.notice` (reset) → full re-sync; if tick goes **backwards**, treat as reset and clear local state.

## B3. Idempotency-key strategy
- Deterministic keys like `{policy}-{tick}-{depot}-{station}-{fuel}` (or a UUID stored *before* sending) so a retry after a timeout replays safely instead of double-shipping.
- Never reuse a key with a changed quantity (→ `IDEMPOTENCY_KEY_MISMATCH`); to change, cancel (only if PENDING) and use a **new** key.
- Because cancellation permanently burns keys, include a version/attempt counter in the key.

## B4. Making the decision engine constraint-aware (pre-validate client-side)
Mirror the simulator's validation order so you don't waste calls and can *explain* why an option was rejected:
- route exists and matches depot↔station; route `AVAILABLE`; depot `OPEN/CONSTRAINED`; station `OPEN`
- `qty ≤ route.max_shipment` (split larger amounts)
- `qty ≤ depot inventory[fuel]`
- depot's **dispatch budget this tick** (`dispatch_capacity_per_tick` minus already-pending/in-flight) — spread shipments over ticks
- `station inventory + qty ≤ station capacity` (also account for shipments already in transit to that station)
- Account for **transit time** (2–4 ticks): a station must be resupplied *before* projected stockout minus transit ticks.
- Prefer the shorter/home route; use the 4-tick cross-region route only as fallback (Karnaphuli, Mirpur).
- Factor in depot inventory forecast: `current + scheduled arrivals − already-committed allocations`.

## B5. Forecasting hints
- Per-station, per-fuel demand ≈ daily rate ÷ 96 × hour-of-day factor × `demand_multiplier` (region `demand_factor` likely also applies) plus noise. *This is my approximation from the tables — verify it against `/v1/demand-history` before relying on it.*
- Hour-of-day seasonality is strong (e.g. industrial 1.55 vs 0.45) → a forecast that ignores time of day will be poor; use hour-of-day baselines or a seasonal model.
- `demand_spike` events change `demand_multiplier` (visible on `/v1/stations` and `/v1/events`) — use it as a feature and to trigger re-forecast.
- `unmet_liters` in demand-history marks actual stockouts (good label for shortage prediction/evaluation).
- **Hours-to-stockout** = `inventory ÷ (forecast demand per hour)`; stockout probability can use the noise level (8–12%) as a spread.
- `service_level` and `allocation_failures` from `/v1/metrics` are the ground truth to compare your policy against a baseline (e.g. "do nothing" or naive threshold policy).

## B6. Testing & demo recipes (deterministic)
1. `SIMULATOR_START_MODE=paused`; `POST /admin/reset` for a clean world.
2. Run baseline with your policy off: `POST /admin/step` ×N (or `/admin/run`), record `GET /v1/metrics`.
3. `POST /admin/reset`, turn policy on, repeat the same steps → compare `service_level`. Determinism makes this a **fair A/B** (great for the "why is my intelligence useful" story, and for RL-vs-heuristic comparison).
4. Crisis: `POST /admin/events` (e.g. `demand_spike` region-dhaka ×1.8, `route_disruption` on `route-gazipur-mirpur`) → show detection → recommendation → simulate → approve.
5. Failure injection: `POST /admin/faults` (`unavailable`, `error_rate`, `latency`, `stale_data`, `stream_disconnect`) → show alert, degraded mode, cached state → `POST /admin/faults/clear` → recovery.
6. Use `GET /admin/audit` as an independent cross-check of what the simulator actually did.

**Example commands**
```bash
curl -X POST localhost:8000/admin/reset
curl -X POST localhost:8000/admin/step
curl -X POST localhost:8000/admin/events -H 'Content-Type: application/json' \
  -d '{"type":"demand_spike","start_tick":8,"duration_ticks":12,"parameters":{"region_ids":["region-dhaka"],"multiplier":1.8}}'
curl -X POST localhost:8000/admin/faults -H 'Content-Type: application/json' \
  -d '{"type":"error_rate","duration_seconds":60,"parameters":{"rate":0.3}}'
curl -X POST localhost:8000/admin/faults/clear
```

## B7. Gotchas & inconsistencies in the source doc
- Idempotent replay: text says **201**, status table says **200** → accept both.
- Fault errors use `{"error": {...}}`, but `stream_disconnect` uses `{"detail": {...}}` → handle both shapes.
- Section 4.3 is missing in the PDF's numbering (nothing lost that I can tell); "see 5.5" for the idempotency check actually points to the idempotency rules section.
- Hard-rules last bullet is truncated in the PDF (see §3 item 8).
- The doc lists `allocation.status_changed` etc. as the only SSE events → **no SSE event for crisis events or station inventory** — poll them.
- The image tag is pinned (`:1.0.0`); judges run the published image, so don't depend on modifying it.
- `POST /admin/reset` wipes **your allocations too** (they live in the simulator) — don't hit it during a judged run.
- Allocation quantity is a float; keep amounts sensible (round to whole liters).
- Sensitive operator actions (reset, fault/event injection from your own UI): restrict/confirm them (brief §Security), and keep human approval before `POST /v1/allocations`.
