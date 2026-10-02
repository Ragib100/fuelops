# FuelOps Demo Script

> **Target duration:** 2 minutes. **Equipment:** 1 laptop, 1 projected browser.
> **Audience:** hackathon judges who have never seen FuelOps before.

This is the 14-step story for **§23** of the hackathon brief. Each step says
what to click, what to say out loud, and what should appear on screen. The
steps are deliberately ordered so the *story* (Observe → Detect → Predict →
Decide → Simulate → Act → Monitor → Recover) maps onto the operator
dashboard in that order.

> Looking for the architectural context behind any of these steps? See
> [`./architecture.md`](./architecture.md).

---

## Pre-demo checklist (do 5–10 minutes before the live demo)

| # | Action                                                                                                  |
| - | ------------------------------------------------------------------------------------------------------- |
| 0 | `make up` (or `docker compose up -d`) — full stack on `localhost:3000/8080/9090/3001`                  |
| 1 | Confirm `DATABASE_URL` is set in `.env` (otherwise the API fails healthcheck).                          |
| 2 | `make smoke` — confirms `/health`, `/metrics`, `/api/overview`, `/api/system/status` are all 200.       |
| 3 | Open four tabs: Dashboard, Operator Dashboard, Prometheus, Grafana. Pin the Grafana dashboard.         |
| 4 | On the Demo page: click **Run simulation** so the simulator is advancing.                               |
| 5 | Verify a non-zero tick is shown in the top-right "live tick" pill.                                      |
| 6 | Have `OPERATOR_TOKEN=local-dev-token` memorized or copied to a scratch note.                            |

---

## The 14 steps (≈ 2 minutes)

> **Pacing tip:** each step is one click and one sentence. Don't stop to
> explain; let the UI do the talking. If a step is slow because of a slow
> click, narrate the *intent*, not the wait.

### 1. Land on the operator dashboard
**URL:** <http://localhost:3000/>

**Action:** Open the Dashboard.

**Say:** *"Operators see a single pane — current tick, network health, and
the most urgent alerts. No charts of historical model accuracy; this is an
ops console, not an analytics dashboard."*

**What you should see:** A header with the current tick (e.g. `tick 042`),
the simulator's sim-time, and 3–4 status pills (status: RUNNING, data:
LIVE).

---

### 2. Point out at the alert panel
**URL:** <http://localhost:3000/alerts>

**Action:** Click **Alerts** in the sidebar.

**Say:** *"Alerts come straight from the ingest rules — low stock, critical
stock, depot imbalance. Each has a kind, a severity, and a station context."*

**What you should see:** A list of `Alert` rows. At least one is severity
`high` or `critical` so the demo has something to react to. If the list is
empty, *pause the simulator*, *step* 5 times, and *resume* — the rules
re-evaluate on each new snapshot.

---

### 3. Open the recommendations page
**URL:** <http://localhost:3000/recommendations>

**Action:** Click **Recommendations**.

**Say:** *"For each alert, the decision engine proposes a concrete
allocation: source depot, route, fuel type, quantity in liters. The
operator never has to figure out the network — they decide whether to
trust the recommendation."*

**What you should see:** A table with `Station | Fuel | Quantity (L) |
Source depot | Route | Generated at | Actions`.

---

### 4. Click **Refresh recommendations**
**Action:** Press the **Refresh** button.

**Say:** *"Refresh re-runs the policy against the latest snapshot. Every
recommendation is explainable: it cites the source depot, the route, and
the fuel type directly — so an operator can audit every line."*

**What you should see:** The list re-renders with a fresh batch. The
`fuelops_decisions_total` counter does **not** move — refresh is read-only.

---

### 5. Drill into one recommendation — show "what if you approved it"
**URL:** Reuse the **Decision** row from step 4.

**Action:** Click **Simulate** on a single recommendation.

**Say:** *"Simulate answers the question every operator actually asks:
what changes if I approve this? You get a before/after of the station's
projected stock."*

**What you should see:** A modal/panel showing `before` (current stock)
and `after` (projected stock after the allocation). The "after" stock
should be higher (we just added fuel).

---

### 6. Approve the recommendation
**Action:** Click **Approve**.

**Say:** *"Approve is the only write path. It calls the simulator's
allocation API with an idempotency key, persists a `Decision` row in
Postgres, and updates the recommendation to status APPROVED. If the
simulator is down, the circuit breaker catches the call and the UI shows
the error inline — no half-applied state."*

**What you should see:** The button flips to **Approved** with a checkmark.
A toast/banner says "allocation approved". The `decisions_total` counter
on Grafana will increment on the next 5s scrape.

---

### 7. Verify the decision was logged
**URL:** <http://localhost:3000/history> or `/api/decisions`

**Action:** Click **History** in the sidebar.

**Say:** *"Every approval is recorded: operator, time, what was
requested, what the simulator returned, the allocation ID. This is the
audit trail. We never say the model approved something without a human
in the loop."*

**What you should see:** A row with `recommendation_id`, `operator`,
`action=approve`, and a `simulator_response` JSON column.

---

### 8. Show component health
**URL:** <http://localhost:3000/status>

**Action:** Click **System status**.

**Say:** *"We expose the dependency tree: simulator, SSE stream, Postgres,
decision engine. Anything that's degraded shows a yellow/red badge."*

**What you should see:** Four service-health rows, all green by default.
If you've been in-circuit mode they will already be red — that's fine, lean
on it for the next step.

---

### 9. Inject a dependency fault
**URL:** <http://localhost:3000/demo>

**Action:** Go to Demo. Pick fault **Latency**, click **Apply fault**.

**Say:** *"Demo control — let me make the simulator slow on purpose."*

**What you should see:** The simulator service in §8 flips to yellow/red
within ~10 seconds. The "live tick" pill on the dashboard freezes or
slows.

---

### 10. Show the fallback policy activating
**URL:** <http://localhost:3000/recommendations>

**Action:** Go back to Recommendations, click **Refresh**.

**Say:** *"Even with the simulator degraded, the recommendation engine
keeps producing. It uses cached data plus a fallback policy —
`threshold-v1`. Each fallback activation bumps a metric you can see in
Grafana."*

**What you should see:** Recommendations still render. (In
Grafana, the **Fallback policy activations** stat panel ticks up.)

---

### 11. Show the metrics
**URL:** <http://localhost:9090/>

**Action:** Open Prometheus. Type `fuelops_decisions_total`.

**Say:** *"Every action we just took is a metric. The whole system is
Prometheus-instrumented: request latency histograms, decision counter,
fallback activations, SSE connection count, snapshot age. We don't
add metrics at the end — they're emitted at the point of action."*

**What you should see:** A non-empty graph. The `decisions_total{action="approve"}` series has at least one point from step 6.

---

### 12. Show the Grafana dashboard
**URL:** <http://localhost:3001/d/fuelops-main>

**Action:** Open Grafana (admin / admin).

**Say:** *"Ten panels, one decision loop. Request rate, p95, error rate,
SSE count, latency percentiles, status code mix, snapshot freshness,
fallback activations, decisions per second, simulator endpoint latency.
Every panel is queryable; every query points back to a Prometheus metric
emitted by the API."*

**What you should see:** A populated dashboard. The **API p95 latency** stat
is green (< 500 ms). The **Error rate** is green (< 1 %). The **Snapshot
freshness + resilience** time-series shows the fault from step 9 still
visible.

---

### 13. Clear faults and show recovery
**URL:** <http://localhost:3000/demo>

**Action:** Back to Demo. Click **Clear all faults**.

**Say:** *"Clear all faults. The simulator recovers, the circuit breaker
half-opens, the fallback policy deactivates. The decision engine resumes
the primary policy without any operator action."*

**What you should see:** §8 flips back to green within ~10 seconds. The
**Snapshot freshness** panel recovers in Grafana. The fallback counter
stops increasing.

---

### 14. Wrap-up on the kiosk

**Action:** Land on <http://localhost:3000/>.

**Say:** *"That's the loop: Observe, detect, decide, simulate, act, monitor,
recover. The whole thing runs from a single `docker compose up`. We can
hand you a fresh laptop right now and you'll have the same demo in under
five minutes — that's the DevOps story too."*

**What you should see:** Dashboard, healthy pills, fresh tick.

---

## Failure-mode rehearsal (do this once, before you go on stage)

| Failure                              | What to do                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simulator container won't start      | `docker rm -f fuelops-sim && make up`                                                                                                                   |
| API container can't reach Postgres   | Confirm `.env` has `DATABASE_URL=postgresql+psycopg://…?sslmode=require`. Check the Render DB is up.                                                                                                  |
| Grafana shows "no data"              | Hit Prometheus directly first: <http://localhost:9090/api/v1/query?query=up>. If `up{job="fuelops-api"}=0`, the API isn't exposing `/metrics`.         |
| k6 won't install                     | Use the dockerized k6: `docker run --rm -i grafana/k6 run - <loadtest/decision-path.js`                                                                |
| Operator token rejected in the demo  | Check the API: `curl -s http://localhost:8080/api/admin/demo/toggle -H 'X-Operator-Token: local-dev-token' -X POST`.                                    |
| Dashboard says "stale"               | Either the simulator is paused (hit **Run simulation** on Demo) **or** the SSE stream disconnected — wait one event tick.                              |

---

## Q&A — one-liners for likely judge questions

| Question                                                                                       | One-line answer                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Why not use a real ML model?"                                                                 | The brief is an *ops* loop, not a forecasting contest. We use explicit rules + greedy allocation so every line is explainable. The model layer is the only thing we'd swap in v2.     |
| "What if the simulator is wrong / wrong data?"                                                 | The fallback policy (`threshold-v1`) keeps the engine running on cached data; the alert system flags stuck rings; the operator can reject any recommendation.                  |
| "Why is Postgres remote?"                                                                     | Render's free tier beats a local container for the demo: it's persistent across `docker compose down -v`, and the judges can verify by querying the DB if they want.                |
| "Why Next.js server actions instead of a direct API call from the browser?"                     | The `OPERATOR_TOKEN` never leaves the server. The browser hits `/api/...` server actions; those forward with the token as a header to FastAPI.                                         |
| "How do you avoid double-allocating if the operator clicks Approve twice?"                      | Idempotency key per recommendation — the second call hits the AllocationCache and returns the original allocation without re-issuing.                                                |
| "Where is the SLO defined?"                                                                    | Three SLOs (p95 < 500 ms, p99 < 1 s, error rate < 1 %) live as k6 thresholds in `loadtest/decision-path.js`. They're enforced on every load test run.                                   |
| "How would you scale this?"                                                                    | Read paths are stateless; the API is horizontally scalable. The snapshot is built in-memory from the SSE feed — if we needed to scale that, we'd back it with Redis.            |
| "How is the decision engine versioned?"                                                                        | Right now it's in-process (`app/policy.py`) and unit-tested. Adding model versioning is a "Nice" tier — not required by §14/15/18/20/23.                              |

---

## Appendix — URLs cheat sheet

| What                          | URL                                       |
| ----------------------------- | ----------------------------------------- |
| Operator dashboard (frontend) | <http://localhost:3000>                   |
| API docs (Swagger)            | <http://localhost:8080/docs>               |
| API health                    | <http://localhost:8080/health>            |
| Prometheus UI                 | <http://localhost:9090>                   |
| Grafana                       | <http://localhost:3001> (admin / admin)   |
| Grafana dashboard (direct)    | <http://localhost:3001/d/fuelops-main>    |
| Simulator health              | <http://localhost:8000/v1/health>         |

---

## See also

* [`./architecture.md`](./architecture.md)
* [`../loadtest/README.md`](../loadtest/README.md)
* [`../README.md`](../README.md)
* [`./hackathon_guide.md`](./hackathon_guide.md)