# FuelOps

> **A one-line elevator pitch:** FuelOps is a small, opinionated control loop
> for fuel distribution. It watches the Bangladesh fuel-supply simulator in
> real time, detects stations at risk, proposes allocations, lets a human
> approve them, and audits every decision — all from a single `docker
> compose up`.

---

## What you get

| Component  | What it is                                                                | Port |
| ---------- | ------------------------------------------------------------------------- | ---- |
| Frontend   | Next.js operator dashboard (alert feed, recommendations, status, demo)   | 3000 |
| API        | FastAPI service: ingest, recommend, simulate, approve, audit, metrics     | 8080 |
| Simulator  | BUP fuel-supply simulator (`asifmahmoud414/bup-fuel-supply-simulator:1.0.0`) | 8000 |
| Prometheus | Metrics scrape target                                                     | 9090 |
| Grafana    | Pre-provisioned dashboard with 10 panels                                  | 3001 |
| PostgreSQL | Remote Render instance — *not* a Docker container                         | —    |

> Looking for the architecture? See [`docs/architecture.md`](docs/architecture.md).
> Looking for the demo? See [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

---

## Quick start (one command)

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env and put a valid DATABASE_URL pointing at your Postgres.

# 2. Bring the whole stack up
make up
# or, if you prefer docker compose directly:
docker compose up -d

# 3. Open the dashboard
open http://localhost:3000
```

The first `make up` takes ~60 seconds while Docker pulls the simulator image
and builds the API + frontend images. Subsequent starts are ~10 seconds.

### Useful Make targets

```bash
make help          # list every target with a one-liner
make up            # bring the stack up
make down          # stop the stack (keeps Postgres volume untouched)
make nuke          # down + remove the Grafana volume (full reset)
make logs          # tail logs from all services
make ps            # show running containers
make smoke         # curl /health, /metrics, /api/overview — fails loudly
make loadtest       # k6 50 VU × 2 min decision-path load test
make single-decision  # k6 end-to-end refresh→simulate→approve smoke
make open          # open the four key URLs in your browser
```

---

## Repository layout

```
fuelops/
├── README.md                    ← you are here
├── docker-compose.yml           ← simulator + api + frontend + prom + grafana
├── Makefile                     ← convenience targets
├── .env.example                 ← template for the secrets DATABASE_URL needs
│
├── api/                         ← FastAPI service
│   ├── Dockerfile
│   ├── README.md                ← per-service install + run + endpoint reference
│   ├── app/                     ← ingest, policy, simulator client, routes
│   └── tests/
│
├── frontend/                    ← Next.js operator dashboard
│   ├── Dockerfile               ← multi-stage pnpm build
│   ├── .dockerignore
│   ├── README.md                ← per-service install + run + page reference
│   ├── app/                     ← App Router pages (overview, alerts, recommendations, …)
│   ├── components/
│   └── lib/
│
├── deploy/                      ← Prometheus + Grafana provisioning
│   ├── prometheus.yml
│   ├── grafana-dashboard.json   ← 10-panel decision-loop dashboard
│   └── grafana-provisioning/
│       ├── datasources/datasource.yml
│       └── dashboards/dashboards.yml
│
├── loadtest/                    ← k6 scripts
│   ├── decision-path.js         ← 50 VU × 2 min read-loop load test
│   ├── single-decision.js       ← 1 VU end-to-end approve smoke
│   └── README.md
│
└── docs/                        ← Hackathon documentation
    ├── architecture.md          ← visualization of the architecture
    ├── DEMO_SCRIPT.md           ← 14-step live demo story
    ├── loadtest-results.md      ← measured workload results table
    ├── hackathon_guide.md       ← the brief we built against
    ├── simulator_integration_guide.md
    └── tech_stack_guide.md
```

---

## How it works (30-second version)

1. The **API** opens an SSE stream against the simulator's `/v1/events`
   endpoint and maintains a local snapshot in memory.
2. On every snapshot it runs **detection rules** (low/critical stock,
   depot imbalance) and writes any new alert rows to Postgres.
3. The **decision engine** (`api/app/policy.py`) turns the snapshot into a
   list of pending recommendations. It uses `greedy-v1` as the primary
   policy and falls back to `threshold-v1` if the simulator is degraded.
5. The operator reviews each one and decides on **Approve** or **Reject**.
   Approve is the only write path and uses an idempotency key to keep the
   simulator's allocation cache consistent across retries.
6. Every action — request, decision, fallback activation, SSE
   reconnect — emits a **Prometheus** metric. Grafana renders the full
   decision loop in 10 panels.

For the architectural deep-dive, see [`docs/architecture.md`](docs/architecture.md).
For the live demo, see [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

---

## Environment

| Variable              | Required | Default              | Purpose |
| --------------------- |:--------:| -------------------- | ------- |
| `DATABASE_URL`        | ✓        | —                    | Postgres DSN. The stack talks to a remote Render instance. |
| `OPERATOR_TOKEN`      | ✓        | `local-dev-token`    | Required by `/api/admin/demo/*` and the approve/reject paths. |
| `SIMULATOR_START_MODE`|          | `paused`             | `paused | running` — initial state on first container start. |
| `SIMULATION_SPEED`     |          | `2`                  | Tick multiplier for the simulator. |
| `TICK_MINUTES`        |          | `15`                 | Wall-clock minutes per simulated tick. |
| `POLL_INTERVAL_SECONDS` |        | `5`                  | Safety-net poll cadence (SSE is primary). |
| `LOG_LEVEL`           |          | `INFO`               | API log level. |
| `CORS_ORIGINS`        |          | `` (allow all)       | Comma-separated origins; empty = allow all. |
| `GRAFANA_USER` / `GRAFANA_PASSWORD` | | `admin` / `admin`  | Grafana admin credentials. |

See [`.env.example`](.env.example) for the canonical template.

---

## Verifying a fresh clone

```bash
make up                            # bring the stack up
sleep 20                           # first boot may take a minute
make smoke                         # curl /health, /metrics, /api/overview, /api/system/status
make single-decision               # end-to-end approve against a running sim
make loadtest                      # 50 VU × 2 min decision-path
```

After `make smoke` you should see four `200`s and one healthy simulator
status. After `make single-decision` you should see `decision row exists
for our recommendation: true`. After `make loadtest` you'll see a k6
summary table; see [`docs/loadtest-results.md`](docs/loadtest-results.md)
for how to interpret it.

---

## Why this repo

This is a hackathon submission for the **BUP Fuel Distribution** problem
statement. The platform is intentionally small and explicit:

- Every decision is **explainable**: the policy code cites the source depot,
  route, and fuel type for every recommendation.
- Every action is **auditable**: the `decisions` table records the
  operator, idempotency key, request payload, simulator response, and
  allocation ID.
- Every system is **observable**: the API emits Prometheus metrics for
  every event loop iteration, request, decision, fallback, and SSE
  reconnect. Grafana renders all ten of them.

See [`docs/architecture.md`](docs/architecture.md) for the system
diagram, [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) for the live demo,
and [`docs/loadtest-results.md`](docs/loadtest-results.md) for the
measured workload.

---

## License

Internal hackathon project; no public license.