# FuelOps API Service

The brain behind the **Fuel Supply Intelligence & Resilience Platform**.

This is the Python (FastAPI) backend that sits between the BUP fuel-supply
simulator (a separate Docker container) and the Next.js operator dashboard.
Its job is to keep asking the simulator "what's happening?", remember the
answer, raise alarms, suggest fuel shipments, and execute the ones an operator
approves.

```
+----------+        +-----------------+        +-----------------+
|  Next.js |  HTTP  |  FuelOps API    |  HTTP  |  BUP Simulator  |
| frontend | <----> |  (this repo)    | <----> |  (Docker)       |
+----------+        +-----------------+        +-----------------+
                            |
                            | SQLAlchemy
                            v
                     +-----------------+
                     |  PostgreSQL     |
                     |  (Render/local) |
                     +-----------------+
```

---

## Table of contents

1. [What this service actually does (in plain English)](#1-what-this-service-actually-does-in-plain-english)
2. [Install + run (step by step)](#2-install--run-step-by-step)
3. [Configuration (`.env` reference)](#3-configuration-env-reference)
4. [The complete workflow (how a tick becomes an action)](#4-the-complete-workflow-how-a-tick-becomes-an-action)
5. [Every API endpoint, explained](#5-every-api-endpoint-explained)
6. [Resilience: what happens when things break](#6-resilience-what-happens-when-things-break)
7. [Where data is stored](#7-where-data-is-stored)
8. [Project layout](#8-project-layout)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. What this service actually does (in plain English)

Imagine you run a network of fuel stations across Bangladesh. Trucks move
fuel between depots and stations, demand rises and falls, sometimes a
highway floods, sometimes a depot runs dry. You need a system that:

- **Watches** every station and depot every few minutes (a "tick").
- **Shouts** when something is going wrong (a station about to run out,
  a route blocked, the simulator going offline).
- **Thinks** about what to do (move 6,500 L of diesel from Gazipur to
  Tongi in the next 2 ticks to avoid a stockout).
- **Asks for permission** before doing it (an operator clicks "Approve").
- **Executes** the move through the simulator and remembers the decision
  forever (audit trail).
- **Stays alive** even when parts of it break — the simulator can glitch,
  the database can hiccup, the SSE stream can drop. The API keeps the
  last known good state visible and degrades gracefully.

That's it. This service is that brain.

The simulator is the **world** (it owns the geography, the trucks, the
fuel tanks, the events). The database is the **memory** (it remembers
every snapshot, every alert, every decision). The API is the **nervous
system** (it pulls from the simulator, decides, writes to the database,
talks to the dashboard).

---

## 2. Install + run (step by step)

### Prerequisites

You need three things on your machine:

| Thing                | Why                                       | Tested version |
|----------------------|-------------------------------------------|----------------|
| **Python**           | Runs the API                              | 3.11+ (3.14 OK)|
| **Docker**           | Runs the simulator + (optional) Postgres  | 24+            |
| **Postgres database**| Stores snapshots, alerts, decisions       | 16 (or Render) |

You can run the API in **mock mode** with zero external dependencies
(no Docker, no Postgres) for a quick demo — but to see the real
end-to-end pipeline you want all three.

### Step A — clone and set up Python

```bash
cd /path/to/fuelops          # the repo root
cd api

# Create a virtual environment so packages don't pollute your system
python -m venv .venv
source .venv/bin/activate    # on Windows: .venv\Scripts\activate

# Install everything the API needs
pip install -r requirements.txt
```

You should see a list of packages being installed:
`fastapi`, `uvicorn`, `httpx`, `pydantic`, `SQLAlchemy`, `psycopg`,
`prometheus-client`, `python-json-logger`, `sse-starlette`.

### Step B — start a Postgres database (optional but recommended)

**Option 1 — Docker Postgres on your laptop:**

```bash
docker run -d --name fuelops-pg -p 5432:5432 \
  -e POSTGRES_USER=fuelops \
  -e POSTGRES_PASSWORD=fuelops \
  -e POSTGRES_DB=fuelops \
  postgres:16-alpine
```

**Option 2 — Render / Neon / Supabase hosted Postgres:**
Just grab the connection URL they give you. You only need to add
`?sslmode=require` for Render.

### Step C — start the simulator (Docker)

```bash
docker pull asifmahmoud414/bup-fuel-supply-simulator:1.0.0

docker run -d --name fuelops-sim -p 8000:8000 \
  -e SIMULATOR_START_MODE=paused \
  -e SIMULATION_SPEED=2 \
  -e TICK_MINUTES=15 \
  asifmahmoud414/bup-fuel-supply-simulator:1.0.0
```

What the flags mean:

| Flag                      | What it does                                              |
|---------------------------|-----------------------------------------------------------|
| `-d`                      | Run in background (don't block the terminal).             |
| `--name fuelops-sim`      | Give it a memorable name so you can stop/start it later.  |
| `-p 8000:8000`            | Expose the simulator's port 8000 on your machine.         |
| `SIMULATOR_START_MODE=paused` | Start paused — the API connects, you click "Run" when ready. (Useful so you can see tick 0 first.) |
| `SIMULATION_SPEED=2`      | Run the simulation clock at 2× real time.                 |
| `TICK_MINUTES=15`         | Each "tick" represents 15 simulated minutes.              |

Verify it's alive:

```bash
curl http://localhost:8000/v1/health
# → {"status":"ok","database":"ok","simulation":{"status":"PAUSED","tick":0}}
```

### Step D — configure `.env`

```bash
cp .env.example .env
```

Open `api/.env` in any editor. The file looks like this:

```env
# Leave empty to use the in-process mock simulator (no Docker needed)
SIMULATOR_URL=http://localhost:8000

# Your Postgres connection string
DATABASE_URL=postgresql+psycopg://USERNAME:PASSWORD@HOST:PORT/DBNAME

# Token required for /api/admin/demo/* endpoints
OPERATOR_TOKEN=local-dev-token

# How often the safety-net poll runs if SSE drops (seconds)
POLL_INTERVAL_SECONDS=3

# Server
HOST=0.0.0.0
PORT=8080
LOG_LEVEL=INFO

# CORS origins (comma-separated). Empty = allow all.
CORS_ORIGINS=
```

- Set `SIMULATOR_URL=http://localhost:8000` if you started the Docker
  simulator in Step C.
- Leave it **empty** to run against the in-process mock simulator
  (the API pretends to be the simulator itself — great for offline
  development).
- Set `DATABASE_URL` to your Postgres URL. If using Render, the format is
  `postgresql+psycopg://user:pass@host/dbname?sslmode=require`.

### Step E — start the API

```bash
# Make sure your virtualenv is still active
source .venv/bin/activate

# Run the server
uvicorn app.main:app --reload --port 8080
```

You should see:

```
INFO:     Started server process [xxxxx]
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8080 (Press CTRL+C to quit)
```

The API will:
1. Connect to Postgres and create the tables it needs (idempotent).
2. Connect to the simulator and bootstrap an initial snapshot.
3. Open an SSE stream so it gets a ping on every tick.
4. Start serving HTTP requests.

### Step F — smoke test

```bash
# Health
curl http://localhost:8080/health
# → {"status":"ok","db":"ok","simulator":"real"}

# System status (every component's health)
curl http://localhost:8080/api/system/status | head -c 500

# Live overview (KPIs + station cards)
curl http://localhost:8080/api/overview | head -c 500

# Unpause the simulator and start ticking
curl -X POST http://localhost:8080/api/admin/demo/run \
  -H "X-Operator-Token: local-dev-token" \
  -H "Content-Type: application/json" -d '{}'

# Generate fuel-shipment recommendations
curl -X POST http://localhost:8080/api/recommendations/refresh

# Approve one (replace 1 with a real rec id from the response above)
curl -X POST http://localhost:8080/api/recommendations/1/approve \
  -H "Content-Type: application/json" -d '{"operator":"me"}'

# See your decision in the audit log
curl http://localhost:8080/api/decisions
```

That's it — full pipeline working. Open
[http://localhost:8080/docs](http://localhost:8080/docs) in a browser
for the interactive Swagger UI (try any endpoint with one click).

---

## 3. Configuration (`.env` reference)

| Variable                  | Required | Default                  | What it does |
|---------------------------|----------|--------------------------|--------------|
| `SIMULATOR_URL`           | no       | _(empty = mock mode)_    | Where to reach the BUP simulator. Empty means use the in-process mock. |
| `DATABASE_URL`            | yes      | -                        | SQLAlchemy connection string. `postgresql+psycopg://...` or `sqlite:///./fuelops.db` for local file. |
| `OPERATOR_TOKEN`          | yes      | `local-dev-token`        | Shared secret for `/api/admin/demo/*` and approve endpoints. Set to empty to disable the check (NOT recommended). |
| `POLL_INTERVAL_SECONDS`   | no       | `3`                      | Backup poll interval in seconds. SSE normally drives fetches; this is the safety net if SSE drops. |
| `HOST`                    | no       | `0.0.0.0`                | Bind address. |
| `PORT`                    | no       | `8080`                   | Bind port. |
| `LOG_LEVEL`               | no       | `INFO`                   | `DEBUG` / `INFO` / `WARNING` / `ERROR`. |
| `CORS_ORIGINS`            | no       | _(empty = allow all)_    | Comma-separated list of allowed origins for browser requests. |

---

## 4. The complete workflow (how a tick becomes an action)

Here's what happens between "the simulator clock ticks" and "the operator
sees a recommendation on the dashboard". Read this once and the whole
codebase will make sense.

```
                Simulator ticks (every 15 simulated minutes)
                              │
                              ▼ SSE: "tick=42, sim_time=..."
                ┌──────────────────────────────┐
                │  ingest.run_ingest_loop      │
                │  (background asyncio task)   │
                └──────────────────────────────┘
                              │
            1. Fetch all /v1/* endpoints (stations, depots,
               routes, supply, events, allocations, metrics)
                              │
                              ▼
                ┌──────────────────────────────┐
                │  Persist Snapshot row        │  ◄── every tick becomes a
                │  (one row per tick)          │      frozen row in Postgres
                └──────────────────────────────┘
                              │
                              ▼
                ┌──────────────────────────────┐
                │  alerts.recompute_alerts     │  ◄── writes Alert rows for
                │  (threshold rules)           │      any shortage/disruption
                └──────────────────────────────┘
                              │
                              ▼
                ┌──────────────────────────────┐
                │  Update Prometheus gauges    │  ◄── /metrics stays fresh
                └──────────────────────────────┘
                              │
                              │  (operator opens dashboard or
                              │   clicks "Generate recommendations")
                              ▼
                ┌──────────────────────────────┐
                │  policy.recommend()          │  ◄── reads latest snapshot,
                │  (greedy-v1 / threshold-v1)  │      writes Recommendation rows
                └──────────────────────────────┘
                              │
                              ▼
                Frontend renders recs. Operator clicks "Approve".
                              │
                              ▼
                ┌──────────────────────────────┐
                │  POST /api/recommendations/  │  ◄── builds idempotency key,
                │  {id}/approve                │      POST /v1/allocations,
                └──────────────────────────────┘  writes Decision row
                              │
                              ▼
                Simulator creates the allocation. Tick advances.
                Truck "moves" fuel. Inventory updates.
                Next tick the dashboard shows the new state.
```

**Two loops, two speeds**

- **Fast loop (every tick):** fetch → snapshot → alerts → metrics.
  Runs forever in the background, regardless of what the user is doing.
- **Slow loop (user-triggered):** recommend → approve → allocate →
  decide. Runs when an operator pushes a button.

---

## 5. Every API endpoint, explained

### Public endpoints (no auth)

#### `GET /health`
Quick liveness check. Returns:
```json
{ "status": "ok", "db": "ok", "simulator": "real" }
```
- `simulator: "real"` = talking to the Docker simulator.
- `simulator: "mock"` = running on the in-process mock (offline mode).

Use this for Docker `HEALTHCHECK`, Kubernetes `livenessProbe`, etc.

#### `GET /api/overview`
The dashboard's home page payload.
Returns the current tick, simulated clock time, network-wide KPIs
(service level %, unmet demand, allocation failures), and a list of
every station with its current inventory %. The frontend uses this to
draw the KPI tiles and station cards on `/`.

#### `GET /api/stations/{id}`
Drill-down for a single station. Returns the station's current
inventory by fuel type, recent demand history, upcoming supply arrivals,
risk breakdown, and a forecast (hours-to-stockout per fuel).
The frontend uses this on `/stations/[id]`.

#### `GET /api/alerts`
The alerts feed. Returns Critical / High / Medium / Low alerts with
title, detail, station, color badge, and tick at which the alert was
raised. Resolved alerts are kept (with `resolved_at`) so you can
audit the history.
The frontend uses this on `/alerts`.

#### `GET /api/recommendations`
The list of pending fuel-shipment recommendations. Each rec says
"move X liters of FUEL from DEPOT to STATION via ROUTE, ETA Y ticks,
because inventory will last only Z hours". Includes confidence score,
human-readable `why`, signals that drove it, and a list of alternative
depots that were considered.
The frontend renders these on `/recommendations`.

#### `POST /api/recommendations/refresh`
Re-runs the recommendation engine against the latest snapshot. Use
this when the operator clicks "Generate recommendations" — it returns
a fresh list of recommendations in the same response shape as
`GET /api/recommendations`.

#### `POST /api/recommendations/{id}/approve`
The big button. Approves a recommendation:
1. Builds an idempotency key (so retrying the same approve never
   double-books).
2. Calls `POST {SIMULATOR_URL}/v1/allocations` to actually create the
   shipment in the simulator.
3. Writes a `Decision` row to the audit log with operator name,
   action, and the simulator's response.

Request body:
```json
{ "operator": "your-name-here" }
```

#### `POST /api/recommendations/{id}/reject`
Marks a recommendation as rejected. No simulator call — just records
the operator's choice in the `Decision` table. Same request shape as
approve.

#### `POST /api/recommendations/{id}/simulate`
Local what-if. Computes a `p_stockout_before` vs `p_stockout_after` for
the recommended shipment **without** actually executing it. Use this
to show "if you approve this, the stockout probability drops from
94% to 38%" before the operator commits.

#### `GET /api/decisions`
The full audit trail of every approve/reject ever done. Append-only —
nothing ever deletes from here. The frontend uses this on `/history`.

#### `GET /api/events`
The event stream view: which crisis events are currently active
(storm warning, road blocked, depot disruption) and recent ones that
resolved. The frontend uses this for the right-hand event panel.

#### `GET /api/system/status`
The platform health dashboard. Returns the status of every component
(Backend API, Database, Fuel simulator, Decision engine, SSE stream),
p95 request latency, error rate %, whether the fallback policy is
active, whether the cached state is stale, and the last 20 system
events. The frontend uses this on `/status`.

#### `GET /metrics`
Prometheus scrape endpoint in standard text format. Counters for
request count/latency, simulator errors by endpoint, fallback
activations, snapshot age, circuit-breaker state. Point your
Prometheus instance at this URL.

### Admin / demo endpoints (require `X-Operator-Token` header)

These proxy directly to the simulator's `/admin/*` API and let you
control the simulation. They're meant for the `/demo` page on the
frontend and for live demos.

All admin endpoints require the header:
```
X-Operator-Token: local-dev-token
```

#### `POST /api/admin/demo/run`
Unpause the simulator. The clock starts ticking.

#### `POST /api/admin/demo/pause`
Pause the simulator. The clock freezes; nothing changes until you
`run` again.

#### `POST /api/admin/demo/toggle`
Convenience: if running, pauses; if paused, runs.

#### `POST /api/admin/demo/step`
Advance exactly one tick without unpausing. Useful for showing the
dashboard reacting tick-by-tick.

#### `POST /api/admin/demo/reset`
Wipe the simulation back to tick 0 with the original seed.

#### `POST /api/admin/demo/events`
Inject a crisis event (storm, road block, depot fire, demand surge).
Body shape:
```json
{ "kind": "storm", "region": "Chattogram Division", "severity": "high" }
```

#### `POST /api/admin/demo/faults`
Turn on simulator fault injection (so you can demo the resilience
behavior). Body:
```json
{ "fault": "503_fault_injected", "endpoints": ["stations"], "duration_s": 60 }
```
Common faults:
- `503_fault_injected` — every call to the listed endpoints returns
  HTTP 503 with a `FAULT_INJECTED` body for `duration_s` seconds.
- `stale_data` — the simulator returns data with `X-Simulator-Stale: true`
  to force the API to surface its stale banner.
- `stream_disconnect` — the SSE stream drops so you can watch the
  reconnect logic kick in.
- `slow_response` — adds latency so you can watch timeouts retry.

#### `POST /api/admin/demo/faults/clear`
Clear all active faults.

#### `GET /docs` and `GET /redoc`
Interactive API documentation (Swagger UI / ReDoc). Use these to try
any endpoint from the browser — no curl needed.

---

## 6. Resilience: what happens when things break

This is the whole point of building a real backend, not a thin proxy.

| Scenario                          | What the API does |
|-----------------------------------|-------------------|
| Simulator returns 503 with `FAULT_INJECTED` | Retry once with backoff. If still failing, serve the **last known good snapshot** from memory and log a `WARN` SystemEvent. The dashboard keeps working with stale data. |
| Simulator returns `X-Simulator-Stale: true` | Mark the snapshot as stale. `/api/system/status` flips `stale=true`. The frontend shows a yellow "stale data" banner. |
| SSE stream drops                  | Auto-reconnect with exponential backoff. A safety-net REST poll runs every `POLL_INTERVAL_SECONDS` (default 3s) so ticks never silently stop. |
| 5+ consecutive failures to any endpoint | Open the **circuit breaker** for 30s. During that window the API serves cached data without even trying the simulator. After 30s it probes again. |
| Decision engine down (future)     | The fallback policy `threshold-v1` is built in and always available. If a future ML engine times out, we fall back to threshold-v1 and tag the rec with `policy = "threshold-v1 (fallback)"`. The `fallback_activations_total` Prometheus counter ticks up. |
| Operator clicks "Approve" twice   | The idempotency key (`rec-{id}-{tick}`) makes the second call return the same `allocation_id` without creating a duplicate shipment. |
| Database is down at startup       | The API still starts (serving reads from in-memory cache) but `/api/system/status` shows Database as Degraded. |

You can trigger each of these via `/api/admin/demo/faults` to demo them
live.

---

## 7. Where data is stored

Everything in Postgres. On startup, `init_db()` creates the tables
if they don't exist (idempotent — safe to restart anytime).

| Table              | One row per | Contents |
|--------------------|-------------|----------|
| `snapshots`        | simulator tick | Frozen copy of the entire world at that tick (stations, depots, routes, supply, allocations, events, metrics). |
| `alerts`           | alert raised | `kind`, `severity`, `station_id`, `fuel_type`, `message`, `payload`, `resolved_at`. |
| `recommendations`  | recommendation generated | `station_id`, `fuel_type`, `payload` (route, qty, ETA), `policy`, `confidence`, `needs_review`, `status`. |
| `decisions`        | approve/reject click | `recommendation_id`, `operator`, `action`, `idempotency_key` (unique), `request`, `simulator_response`, `allocation_id`, `outcome`. |
| `system_events`    | notable backend event | `component`, `level`, `message`, `payload`. Powers the `/api/system/status` event feed. |
| `allocation_cache` | successful allocation | Idempotency key + cached response so retries return the same answer. |

To inspect the data:

```bash
# Connect to your Postgres
psql "$DATABASE_URL"

# See how many ticks you've captured
SELECT COUNT(*), MIN(tick), MAX(tick) FROM snapshots;

# See the last 10 decisions
SELECT id, recommendation_id, operator, action, outcome, decided_at
FROM decisions ORDER BY decided_at DESC LIMIT 10;

# See active (unresolved) critical alerts
SELECT kind, station_id, fuel_type, message FROM alerts
WHERE resolved_at IS NULL AND severity = 'Critical';
```

---

## 8. Project layout

```
api/
├── requirements.txt        # All Python dependencies
├── README.md               # You are here
├── .env.example            # Template for .env
├── Dockerfile              # Optional: containerize the API itself
└── app/
    ├── main.py             # FastAPI app, CORS, lifespan, /metrics, /health
    ├── config.py           # Loads .env into typed settings
    ├── db.py               # SQLAlchemy engine, SessionLocal, init_db
    ├── models.py           # Table definitions (Snapshot, Alert, …)
    ├── schemas.py          # Pydantic response shapes for the API
    ├── ingest.py           # Background loop: tick → fetch → snapshot → alerts
    ├── alerts.py           # Threshold rules that turn a snapshot into alerts
    ├── policy.py           # Recommendation engine (greedy-v1 + threshold-v1)
    ├── metrics.py          # Prometheus counters/gauges
    ├── simulator/
    │   ├── client.py       # httpx client: timeouts, retries, circuit breaker,
    │   │                   #   last-known-good cache, mock fallback
    │   ├── mock.py         # In-process mock simulator (used when SIMULATOR_URL is empty)
    │   └── sse.py          # SSE consumer with auto-reconnect
    └── routes/
        ├── overview.py          # GET /api/overview
        ├── stations.py          # GET /api/stations/{id}
        ├── alerts.py            # GET /api/alerts
        ├── recommendations.py   # GET /api/recommendations, POST refresh/approve/reject/simulate
        ├── decisions.py         # GET /api/decisions
        ├── events.py            # GET /api/events
        ├── system.py            # GET /api/system/status
        └── demo.py              # POST /api/admin/demo/*
```

---

## 9. Troubleshooting

**`Connection refused` on `http://localhost:8000`**
→ The simulator container isn't running. Check `docker ps`. If it's not there, re-run Step C.

**`simulator: "mock"` even though I set `SIMULATOR_URL`**
→ The API was started before you set the env var, or `.env` is in the wrong directory. The API loads `.env` from `api/.env` (the working dir when you run `uvicorn`). Restart the API.

**`psycopg.OperationalError: connection to server failed`**
→ Postgres isn't reachable on the URL you set. Check `DATABASE_URL`. If using Render, append `?sslmode=require`.

**Tables don't exist / `relation "snapshots" does not exist`**
→ `init_db()` only runs at API startup. Restart the API after fixing the DB connection.

**Port `8080` already in use**
→ Either change `PORT` in `.env`, or kill the old process: `lsof -i :8080 -t | xargs kill -9` (Linux/Mac).

**SSE keeps disconnecting**
→ Could be a corporate proxy stripping `text/event-stream`. Try `curl -N http://localhost:8000/api/system/status` to see if regular REST is fine — if so, the issue is SSE-specific.

**Approval returns `idempotency_key conflict`**
→ You're retrying an approval that already succeeded. Look it up in `/api/decisions` — you should have an existing `allocation_id`.

**I changed code and nothing happens**
→ Are you using `--reload`? It watches `.py` files but **not** `.env`. Restart manually if you changed `.env`.

**Want to start clean?**
```bash
# Wipe Postgres tables (CAREFUL — deletes all history)
docker exec fuelops-pg psql -U fuelops -d fuelops -c "DROP TABLE IF EXISTS snapshots, alerts, recommendations, decisions, system_events, allocation_cache CASCADE;"

# Reset the simulator
curl -X POST http://localhost:8080/api/admin/demo/reset \
  -H "X-Operator-Token: local-dev-token"
```

---

## Cheat sheet

```bash
# Start everything (3 terminals, or one with &)
# Terminal 1: simulator
docker run -d --name fuelops-sim -p 8000:8000 \
  -e SIMULATOR_START_MODE=paused -e SIMULATION_SPEED=2 \
  asifmahmoud414/bup-fuel-supply-simulator:1.0.0

# Terminal 2: API
cd api && source .venv/bin/activate
uvicorn app.main:app --reload --port 8080

# Terminal 3: try it
curl http://localhost:8080/health
open http://localhost:8080/docs        # Swagger UI
open http://localhost:3000            # Frontend (if running separately)
```

```bash
# Stop everything
docker stop fuelops-sim
# Ctrl+C the uvicorn process
```
