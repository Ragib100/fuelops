# FuelOps Architecture

This document is the **§20 deliverable #6** for the BUP hackathon: an architecture
diagram of the platform, drawn at three levels of detail so reviewers can read
the system at a glance or drill into the wiring.

> Looking for the live URL? Once the stack is up, every box below is reachable:
> - Frontend: <http://localhost:3000>
> - API: <http://localhost:8080/docs>
> - Prometheus: <http://localhost:9090>
> - Grafana: <http://localhost:3001> (admin / admin by default)

---

## 1. System diagram

A horizontal map of the runtime components. Solid arrows are HTTP/JSON
control traffic. Dashed arrows are data-plane traffic. The dotted arrow into
Postgres represents the remote connection from `api/.env`'s `DATABASE_URL`.

```mermaid
flowchart LR
    subgraph Operator["Operator (browser)"]
        UI["Operator Dashboard<br/>Next.js · port 3000"]
    end

    subgraph Edge["Edge & control plane (docker compose)"]
        SIM["BUP Fuel-Supply Simulator<br/>asifmahmoud414/bup-fuel-supply-simulator:1.0.0<br/>port 8000"]
        API["FuelOps API<br/>FastAPI · port 8080"]
        FE["Frontend<br/>Next.js standalone · port 3000"]
        PROM["Prometheus<br/>v2.55.1 · port 9090"]
        GRAF["Grafana<br/>v11.3.0 · port 3001"]
    end

    subgraph Data["Persistence (remote)"]
        PG[("PostgreSQL<br/>Render managed<br/>fuelops DB")]
    end

    UI  -- HTTPS --> FE
    FE  -- "fetch BACKEND_URL" --> API
    SIM -- "/v1/stations, /v1/routes, /v1/allocations" --> API
    API -- "/metrics" --> PROM
    PROM -- "scrape" --> GRAF
    API -. "DATABASE_URL" .-> PG
    FE -. "server actions only" .-> API
```

### What each box is for

| Component | Role |
|-----------|------|
| **Operator Dashboard** | Next.js UI. Reads `overview`, `alerts`, `recommendations` and shows them to the operator. Server actions call approve/reject. |
| **Frontend container** | The same Next.js app, served from the standalone build. The browser never talks to the API directly — it talks to the same container. |
| **FuelOps API** | FastAPI service. Polls the simulator's `/v1/events` SSE stream, maintains a local snapshot, runs the recommendation policy (greedy-v1 / threshold-v1 fallback), persists decisions, exposes Prometheus metrics. |
| **BUP Simulator** | Vendor-provided simulator of the Bangladesh fuel-distribution problem. Source of truth for stations, depots, routes, and the current network state. |
| **PostgreSQL (remote)** | Render-hosted. Stores snapshots, recommendations, decisions, allocation cache. |
| **Prometheus** | Scrapes the API's `/metrics` endpoint every 5 seconds. |
| **Grafana** | Provisions a Prometheus datasource + a 10-panel dashboard on first boot. |

---

## 2. The decision loop (data flow)

The platform exists to drive a single loop. Every other page in the UI is a
view onto one node in this loop.

```mermaid
flowchart TB
    OBS["Observe<br/>SSE /v1/events + poll<br/>(fallback safety net)"] --> DET
    DET["Detect<br/>rules in app/ingest.py<br/>low / critical stock, imbalance"] --> PRED
    PRED["Predict<br/>snapshot.age_ticks gauge<br/>in /metrics"] --> DEC
    DEC["Decide<br/>policy.refresh(snap)<br/>greedy-v1 → threshold-v1 fallback"] --> SIM
    SIM["Simulate<br/>POST /recommendations/{id}/simulate<br/>before / after diff"] --> ACT
    ACT["Act<br/>operator clicks Approve<br/>POST /recommendations/{id}/approve<br/>(idempotent)"] --> MON
    MON["Monitor<br/>outcomes written to `decisions` table<br/>+ /api/decisions + /metrics"] --> REC
    REC["Recover<br/>circuit breaker<br/>fallback activations gauge"] --> OBS
```

The loop is observable end-to-end. Every arrow above has at least one
Prometheus metric, one Grafana panel, or one UI page dedicated to it.

---

## 3. Sequence diagram — operator approves a recommendation

This is the write path that matters for §14 / §18 / §23. It walks through
every box in §1 in the order they actually exchange messages.

```mermaid
sequenceDiagram
    autonumber
    actor O as Operator
    participant F as Frontend<br/>(Next.js server action)
    participant A as API<br/>(FastAPI)
    participant S as Simulator<br/>(BUP /v1/allocations)
    participant DB as PostgreSQL

    O->>F: click "Approve" on recommendation #42
    F->>A: POST /api/recommendations/42/approve<br/>{ operator, idempotency_key }
    A->>A: load Recommendation #42<br/>check status == PENDING
    A->>S: POST /v1/allocations<br/>(source_depot, route, fuel_type, qty)
    S-->>A: 201 { id, status: "APPROVED" }
    A->>DB: INSERT decisions<br/>(rec_id, operator, key, request, response, allocation_id)
    A->>DB: UPSERT allocation_cache<br/>(idempotency_key → allocation)
    A->>A: fuelops_decisions_total{action="approve"}++
    A-->>F: 200 { message, idempotency_key, allocation }
    F-->>O: revalidate + redirect to /status
```

### Failure handling

If the simulator returns 5xx or the SSE feed dies, the sequence changes:

- The **circuit breaker** on the simulator client opens after 3 consecutive
  failures. Approve is rejected with `503` until the breaker half-opens.
- The **fallback policy** (`threshold-vengivalone`) is used by `refresh()`
  when the breaker is open, so recommendations keep arriving even during
  outages.
- Every fallback activation bumps
  `fuelops_fallback_activations_total{policy="threshold-v1"}` so Grafana can
  show it on the dashboard.

---

## 4. Why these choices

A short note on what we traded off and why — for the architecture-conscious
judge.

| Decision | Why |
|----------|-----|
| **Postgres is remote, not a container** | Render already runs it; spinning up a second DB adds nothing. The compose stack talks to it via `DATABASE_URL`. |
| **Single API process** | The decision engine is in-process (`app/policy.py`) so it can use the live snapshot without a network hop. Splitting it out is a "future optimization" in the tech-stack guide, not a requirement. |
| **Server actions for approve/reject** | The Next.js UI doesn't expose its `OPERATOR_TOKEN` to the browser. The server action reads it from `process.env` and calls the API itself, keeping the auth header off the wire. |
| **Prometheus + Grafana over `docker stats`** | We need histograms (for p95/p99) and custom application gauges (`fallback_activations`, `sse_connected`). `docker stats` doesn't give us that. |
| **k6 over Locust/JMeter** | k6 is single-process (k6's own model: 1 VU per goroutine), so a single laptop can drive 50 VUs cleanly. The brief asks for a workload definition + numbers; k6's JS DSL makes both very compact. |

---

## 5. How to read the Grafana dashboard

The provisioned dashboard at <http://localhost:3001/d/fuelops-main> has 10
panels mapped 1-to-1 to the system diagram above:

| Panel | Maps to |
|-------|---------|
| API request rate | §1 box "FuelOps API" (call volume) |
| API p95 latency | §1 box "FuelOps API" (latency budget) |
| Error rate | §1 box "FuelOps API" (5xx counter) |
| SSE connected | §3 step "Client-Observed (SSE)" |
| Latency p50/p95/p99 | §1 box "FuelOps API" (histogram) |
| Requests by status code | §1 box "FuelOps API" (status mix) |
| Snapshot freshness + resilience | §1 box "PostgreSQL" + circuit breaker |
| Fallback policy activations | §2 node "Decide" (policy engine) |
| Recommendations + decisions / sec | §2 nodes "Decide" + "Act" |
| Simulator call latency per endpoint | §1 box "BUP Simulator" |

---

## See also

* [`./DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) — the 14-step demo story
* [`./hackathon_guide.md`](./hackathon_guide.md) — the brief we built against
* [`../loadtest/`](../loadtest/) — k6 scripts
* [`../deploy/grafana-dashboard.json`](../deploy/grafana-dashboard.json) — the
  full Grafana dashboard definition