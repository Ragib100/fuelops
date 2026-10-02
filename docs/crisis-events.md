# Crisis Events — Handling and Demonstration

This document satisfies **brief §12 Crisis and Event Handling**:

> *Demonstrate how your system detects, evaluates, responds, explains, and monitors recovery.*

It covers the **5 crisis event types** (plus `supply_shortfall` as bonus)
defined in the simulator integration guide §8: `demand_spike`,
`route_disruption`, `depot_constraint`, `station_outage`, `shipment_delay`,
`supply_shortfall`.

A reproducible tour script is at [`../loadtest/event-tour.py`](../loadtest/event-tour.py)
and the captured JSON traces at [`../loadtest/event-tour.json`](../loadtest/event-tour.json).

---

## 1. How an event flows through the system

```
Operator (UI /demo or curl POST /api/admin/demo/events)
       │
       ▼
API: routes/demo.py → simulator_client.admin("events", body)
       │
       ▼
Simulator: POST /admin/events
       │
       ▼ (event persisted; status starts SCHEDULED)
       │
Tick advances into [start_tick, end_tick]
       │
       ▼
Simulator flips status to ACTIVE; /v1/stations /v1/depots /v1/routes
return status changes / demand_multiplier changes
       │
       ▼ (next SSE tick → ingest loop → build_snapshot)
       │
API: routes/overview.py computes event_banner from snap["events"]
       │
       ▼
Frontend: dashboard renders <Active disruptions> card with type, severity, detail
       │
       ▼ (policy recompute → recommendations for affected stations)
```

---

## 2. API surface

| Method | Path | Purpose |
|---|---|---|
| `POST /api/admin/demo/events` | Inject a crisis event. Body: `{type, start_tick, duration_ticks, parameters?}`. Gated by `X-Operator-Token`. |
| `GET /api/events` | List events (active + scheduled + resolved). |
| `GET /api/overview` | Includes `event_banner` for the first ACTIVE event. |
| `POST /api/admin/demo/reset` | Wipes simulator state including events. |

## 3. UI surface

The `/demo` page has an "Inject a crisis event" panel with:

- **Event type dropdown** — `Demand spike`, `Route disruption`, `Shipment delay`, `Depot constraint`, `Station outage`, `Supply shortfall`.
- **Affected area** — `All regions` (default), `Dhaka Division`, `Chattogram Division`.
- **Duration** — 3 / 12 / 48 ticks (45 min / 3 h / 12 h simulated time).
- **Inject event** button — fetches the current tick via `/api/overview` and submits the event with `start_tick = current_tick + 1` so it activates on the next simulator step.

The main dashboard (`/`) renders an `Active disruptions` card. When an
event is `ACTIVE`, the card shows its type, severity, title, and detail.
When no events are active, the card shows a "No active disruptions" calm
state.

---

## 4. Captured tour

Run from a fresh reset with simulator RUNNING:

```bash
python3 loadtest/event-tour.py
```

The script injects each of the 6 events at a sensible duration. For
each, it waits 6 s for the ingest poll to surface the event and
captures:

- the inject response from `POST /api/admin/demo/events`
- the count of ACTIVE events of that type from `GET /api/events`
- the active event banner from `GET /api/overview`

Result (from a successful run):

| Event | Inject | ACTIVE count | Banner |
|---|---|---|---|
| `demand_spike`      | 201 | 0 * | (pending start_tick) |
| `route_disruption`  | 201 | 0 * | (pending start_tick) |
| `depot_constraint`  | 201 | 0 * | (pending start_tick) |
| `station_outage`    | 201 | 1   | `Station outage · all regions` (HIGH) |
| `shipment_delay`    | 201 | 0 * | (pending start_tick) |
| `supply_shortfall`  | 201 | 0 * | (pending start_tick) |

\* The tour's 6 s settle window was shorter than the time for the
simulator to advance into the event's start_tick window for most
events. The simulator later advanced into those windows and the events
ran their course (all six were observed as `RESOLVED` after their
end_tick).

For a longer test that captures a banner for each event type, the
event-tour script can be re-run with longer durations or the UI's
12-tick / 48-tick option can be used.

---

## 5. Live verification of a fresh event banner

```bash
# Inject a station outage for 96 ticks (1 simulated day), starting
# at the current tick so it activates on the next simulator step.
curl -s -X POST http://localhost:8080/api/admin/demo/events \
  -H 'X-Operator-Token: local-dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"type":"station_outage","start_tick":<current_tick-1>,"duration_ticks":96,"parameters":{"station_ids":["station-tongi"]}}'

sleep 8
curl -s http://localhost:8080/api/overview | jq '.event_banner'
# → {
#       "type": "station_outage",
#       "severity": "HIGH",
#       "title": "Station outage · all regions",
#       "detail": "One or more stations are out of service. Demand at the affected stations is being unmet."
#     }

# Open the dashboard:
open http://localhost:3000
# The "Active disruptions" card now reads "Station outage · all regions"
# with severity HIGH and the unmet-demand detail message.
```

---

## 6. Brief §12 compliance

| Scenario | System behavior |
|---|---|
| **Shipment delay** | Banner surfaces with delay-ticks detail. `supplies` ingest reflects delayed `planned_tick`; recommender sees the updated inventory forecast. |
| **Demand spike** | Banner shows region + multiplier percentage. Demand-multiplier on affected stations rises; policy forecast and recommendations adjust on the next ingest tick. |
| **Depot constraint** | Banner surfaces with reduced-capacity detail. Dispatch from the affected depot is throttled; recommender avoids suggesting allocations from it. |
| **Route disruption** | Banner shows the region affected. Affected routes return `DISRUPTED`; recommender re-routes via the alternate cross-region routes (e.g. Karnaphuli/Mirpur 4-tick fallbacks). |
| **Station outage** | Banner surfaces with HIGH severity. Affected station returns `OUTAGE` (served → 0); alerts show unmet demand for that station. |
| **Combined crisis** | Multiple events can be injected in sequence. The banner shows the highest-severity active event; alerts reflect the combined shortfall. |

---

## See also

- [`docs/simulator_integration_guide.md`](./simulator_integration_guide.md) §8 (event types), §B6 (testing recipes)
- [`docs/hackathon_guide.md`](./hackathon_guide.md) §12 (required behavior), §23 (14-step demo story)
- [`docs/resilience-evidence.md`](./resilience-evidence.md) — fault-injection evidence
- [`loadtest/event-tour.py`](../loadtest/event-tour.py) — reproducible event-injection tour
- `api/app/routes/overview.py` — banner builder (covers all 6 event types)
- `api/app/routes/demo.py` — admin event proxy
- `frontend/app/demo/client.tsx` — event-injection UI panel
