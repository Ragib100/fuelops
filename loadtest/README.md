# FuelOps Load Tests (k6)

This directory contains k6 scripts that satisfy the **§18 Load Test**
requirement of the hackathon brief:

> Define a workload and submit measured results.

There are two scripts. They are designed to be run in order.

## 1. `decision-path.js` — sustained read-loop load

The decision path is the read-heavy operator workflow: an operator watching the
overview, alerts, recommendations, and component health.

| Setting      | Value                                        |
| ------------ | -------------------------------------------- |
| Virtual users | **50 concurrent**                           |
| Duration     | **2 minutes**                                |
| Per-VU mix   | 40% `/api/overview` · 30% `/api/alerts` · 20% `/api/recommendations` · 10% `/api/system/status` |
| Think time   | 200–600 ms (random)                          |
| Effective RPS | ~80–240 aggregate (depends on think time)   |

### SLO thresholds

k6 fails the run if any of these are breached:

| Metric                            | Threshold   |
| --------------------------------- | ----------- |
| p95 latency per endpoint          | **< 500 ms** |
| p99 latency per endpoint          | **< 1000 ms** |
| HTTP failure rate (overall)       | **< 1 %**   |
| Custom `fuelops_http_fail_rate`   | **< 1 %**   |

### How to run

```bash
# Local API on default port
k6 run loadtest/decision-path.js

# Point at a different host/port
k6 run -e BASE_URL=http://localhost:8080 loadtest/decision-path.js

# Save the full JSON summary alongside the run
k6 run -e SUMMARY_OUT=loadtest/results.json loadtest/decision-path.js
```

Or via the Makefile:

```bash
make loadtest
```

## 2. `single-decision.js` — end-to-end happy path

A **1-VU / 1-iteration** smoke test that drives one allocation all the way
through:

1. `POST /api/recommendations/refresh`
2. `GET  /api/recommendations` — pick first PENDING id
3. `POST /api/recommendations/{id}/simulate`
4. `POST /api/recommendations/{id}/approve` (passes a unique idempotency key)
5. `GET  /api/decisions` — verify the row exists

This is the write-path counterpart to `decision-path.js`. Re-runs are safe
because each invocation generates a fresh idempotency key (`k6-<ts>-<vu>-<iter>`).

### How to run

```bash
k6 run loadtest/single-decision.js
# or
make single-decision
```

## Results table

The measured values captured on this hardware are in
[`../docs/loadtest-results.md`](../docs/loadtest-results.md). Numbers are
non-deterministic; re-runs produce the same shape but slightly different
values. The brief asks for "relevant measurements" rather than reproducible
benchmarks.

## Installing k6

If `k6` is not on `$PATH`:

```bash
# macOS
brew install k6

# Linux (apt)
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows
winget install k6 --source winget
```

## Files

```
loadtest/
├── decision-path.js    # 50 VU × 2 min read-loop load test
├── single-decision.js  # 1 VU end-to-end approve smoke
└── README.md           # this file
```