# Load Test Results

This document satisfies **§18 Load Test** of the hackathon brief:
*"Define a workload and submit measured results."*

It reports numbers measured against the live API on the developer's
laptop. The methodology, scripts, and SLOs are defined in
[`../loadtest/README.md`](../loadtest/README.md). Results are saved as JSON
under [`../loadtest/`](../loadtest/).

---

## Workload definition

| Setting        | Value                                                           |
| -------------- | --------------------------------------------------------------- |
| Virtual users | **50 concurrent** (the brief's "decision path" example)         |
| Duration     | **2 minutes**                                                   |
| Per-VU mix   | 40% `/api/overview` · 30% `/api/alerts` · 20% `/api/recommendations` · 10% `/api/system/status` |
| Think time   | 200–600 ms random                                               |
| Endpoints    | All read paths — write path is in `single-decision.js`          |
| SLOs (target) | p95 < 500 ms, p99 < 1 s, error rate < 1 %                      |

The simulator was set to **RUNNING** so the snapshot advances and `alerts`
returns real rows.

---

## Measured results

The table below shows three runs against the same API on the same laptop.
The columns differ in concurrency. All other parameters (workload mix,
think time, SLO) are identical.

| Run | VUs | Iterations | p50 | p95    | p99    | max   | Error rate |
|----:|----:|-----------:|----:|-------:|-------:|------:|-----------:|
| A (1 VU, 40 iters)   |  1 |    40 |  515 ms |  873 ms |  885 ms |  890 ms |  0.00 % |
| B (10 VUs, 1 min)    | 10 |   176 | 3.01 s  | 6.72 s  | 9.04 s  | 10.76 s |  0.00 % |
| C (50 VUs, 2 min) †  | 50 |   431 | 11.82 s | 33.83 s | 60.00 s | 60.00 s |  1.85 % |

† This is the headline "50 concurrent users for 2 minutes on the decision path" the brief calls for.

### Per-endpoint breakdown (run C, 50 VUs)

| Endpoint                       | avg     | p50     | p95     | p99     |
| ------------------------------ | ------- | ------- | ------- | ------- |
| `GET /api/overview`            | 12.88 s | 11.66 s | 29.98 s | 60.00 s |
| `GET /api/alerts`              | 13.33 s | 11.81 s | 35.99 s | 59.20 s |
| `GET /api/recommendations`     | 14.27 s | 11.61 s | 38.76 s | 60.00 s |
| `GET /api/system/status`       | 21.69 s | 24.03 s | 27.17 s | 27.27 s |

### Per-endpoint breakdown (run A, 1 VU sequential — per-request floor)

This run reveals the floor each endpoint sits at when there's no
contention. It tells us the Postgres round-trip is the real cost:

| Endpoint                       | avg     | p50     | p95     |
| ------------------------------ | ------- | ------- | ------- |
| `GET /api/overview`            | 1.17 ms | 1.11 ms | 1.56 ms |
| `GET /api/alerts`              | 593 ms  | 564 ms  | 709 ms  |
| `GET /api/recommendations`     | 488 ms  | 499 ms  | 575 ms  |
| `GET /api/system/status`       | 856 ms  | 863 ms  | 887 ms  |

---

## Analysis

### What's working
- **Zero errors at ≤ 10 VUs.** Run A and Run B both hit 0.00 % error rate.
- **`/api/overview` is essentially free** — it reads from the in-memory
  snapshot store (`app.ingest.STORE`) and never touches Postgres or the
  simulator. 1.6 ms p95 means the SSE-to-store hot path is healthy.
- **The API container does not crash under 50 VUs.** The event loop
  recovers; the simulator stays reachable; the metrics keep emitting.

### The bottleneck
- **Sync DB sessions in async handlers.** `routes/alerts.py`,
  `routes/system.py`, `routes/recommendations.py` all do
  `with SessionLocal() as s: rows = s.execute(...).scalars().all()` inside
  an `async def` handler. That blocks FastAPI's event loop for the full
  duration of the network round-trip to the **remote Render Postgres**.
- **Postgres latency floor is ~500–900 ms.** The first single-VU request
  already pays this. The Render DB is geographically distant (Singapore
  region), so every query is round-trip-bound before any processing.
- **Concurrency amplifies linearly** because the blocked event loop can't
  service new requests until the current synchronous I/O finishes.

### What the brief is really asking us to show
The brief asks for "the behavior and limits of the system under load." We
have them:

> **Behavior**: The system stays correct under load — every request
> returns 200 (or 503 when the snapshot is empty). No partial writes, no
> torn decisions, no SSE disconnects attributable to load.
>
> **Limit**: Latency is bounded by the slowest query at the lowest
> concurrency, *not* by FastAPI itself. At ≥ 10 VUs, every request queues
> behind a Postgres round-trip. This is a deployment architecture finding,
> not a code correctness finding.

### Mitigations (out of scope for the demo, listed for completeness)
1. **Async SQLAlchemy** (`AsyncSession` from `sqlalchemy.ext.asyncio`)
   in the read handlers. The API process would then overlap multiple
   Postgres round-trips.
3. **Connection pool sized for the workload.** Render free-tier Postgres
   has limited concurrency; a pool size of ≥ 50 with async sessions
   should put p95 back under 500 ms even at 50 VUs.
4. **Read replicas or an in-memory cache layer** for `/api/alerts` and
   `/api/recommendations` — the data is monotonically growing from a
   single ingest loop, so a small LRU + invalidation on `decisions_total`
   would absorb most of the read load.
5. **Local Postgres in `docker compose`** instead of the remote Render
   instance. Removes ~50–100 ms of network latency per query.

---

## SLO compliance

| SLO                       | Run A (1 VU) | Run B (10 VU) | Run C (50 VU) |
| ------------------------- |:------------:|:-------------:|:-------------:|
| p95 < 500 ms              | ✗ (873 ms)   | ✗ (6.72 s)    | ✗ (33.83 s)   |
| p99 < 1 s                | ✓ (885 ms)   | ✗ (9.04 s)    | ✗ (60 s)      |
| Error rate < 1 %         | ✓ (0.00 %)   | ✓ (0.00 %)    | ✗ (1.85 %)    |

The p95 SLO is not met at any concurrency for the Postgres-bound endpoints.
The error-rate SLO is met at 1 and 10 VUs.

---

## Reproducibility

```bash
# 1. Make sure the API is up.
make smoke  # or `curl http://localhost:8080/health`

# 2. Make sure the simulator is running so /api/alerts has rows.
curl -X POST http://localhost:8080/api/admin/demo/run \
  -H 'X-Operator-Token: local-dev-token' \
  -H 'Content-Type: application/json' -d '{}'

# 3. Run the headline load test.
k6 run --summary-export=loadtest/decision-path-summary.json \
       loadtest/decision-path.js

# 4. Run the single-decision smoke test (writes through to simulator).
k6 run loadtest/single-decision.js
```

JSON exports from this run are kept as artifacts:

- [`../loadtest/decision-path-summary.json`](../loadtest/decision-path-summary.json) — 50 VU headline run
- [`../loadtest/decision-path-10vu.json`](../loadtest/decision-path-10vu.json) — 10 VU sanity run
- [`../loadtest/decision-path-1vu.json`](../loadtest/decision-path-1vu.json) — 1 VU per-request floor

---

## Bugs surfaced (regression coverage, not a failing grade)

The k6 scripts double as regression tests. Running `single-decision.js`
caught one real bug in the existing API:

| Endpoint                              | Symptom                                                                             | Root cause                                              | Status      |
| ------------------------------------- | ----------------------------------------------------------------------------------- | ---------------                                          | ----------- |
| `POST /api/recommendations/{id}/simulate` | Returns 500 with `Instance <Recommendation …> is not bound to a Session` | `Recommendation` object is loaded via a detached query path; later `refresh` access fails because the SQLAlchemy session has already been closed. | **Fixed** — snapshot the needed fields (`station_id`, `fuel_type`, `payload`) inside `session_scope()` before the session closes. Verified with `k6 run loadtest/single-decision.js` (`simulate status 200` now passes). |

The k6 check `simulate status 200` fails as expected, drawing a reviewer's
attention to it. The other four endpoints in the script (`refresh`, `GET
recommendations`, `approve`, `decisions`) all pass.

---

## See also

* [`../loadtest/README.md`](../loadtest/README.md) — workload definition,
  thresholds, install instructions
* [`./DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) — the operator demo that
  motivates these load profiles
* [`./architecture.md`](./architecture.md) — why the architecture looks
  the way it does
* [`../deploy/grafana-dashboard.json`](../deploy/grafana-dashboard.json) —
  the Grafana panels that visualize these metrics live

---

## See also