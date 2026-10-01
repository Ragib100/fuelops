# Tech Stack Guide — Fuel Supply Intelligence & Resilience Platform
*(Companion to `hackathon_guide.md` and `simulator_integration_guide.md`. Everything here is a recommendation for an 8-hour, 4-person build, not a requirement of the brief.)*

**Chosen stack at a glance**

| Layer | Choice |
|---|---|
| UI | **Next.js** (App Router, client-rendered dashboard) + TypeScript + Tailwind + shadcn/ui + Recharts + SWR |
| Backend API | **FastAPI** (Python 3.11+), `httpx`, Pydantic v2, SQLAlchemy, `prometheus_client` |
| Decision / ML engine | Separate **FastAPI** service: pandas, numpy, scipy, statsmodels, scikit-learn, PuLP (optional) |
| GenAI (optional) | Claude API for explanations, with template fallback |
| Database | **PostgreSQL 16** |
| Containers | Docker + Docker Compose (simulator included as a service) |
| CI/CD | GitHub Actions |
| Observability | Prometheus + Grafana + cAdvisor (+ Loki/Promtail if time) + JSON logs |
| Load testing | k6 |

---

## Part 1 — Architecture

```
                 ┌────────────────────┐
                 │  BUP Fuel Simulator │  :8000  (organizer image)
                 └─────────┬──────────┘
        REST poll + SSE hints │  ▲ POST /v1/allocations (after operator approval)
                              ▼  │
┌──────────┐  /api/*   ┌────────────────────────────┐   HTTP    ┌──────────────────────┐
│ Next.js  │──────────►│ API service (FastAPI)       │──────────►│ Decision engine      │
│ frontend │◄──────────│ - simulator client + cache  │◄──────────│ (FastAPI, ML+optim.) │
└──────────┘           │ - ingest loop (REST + SSE)  │  timeout/ │ - forecast           │
                       │ - operator endpoints        │  fallback │ - risk + detection   │
                       │ - /health  /metrics         │           │ - allocation         │
                       └───────┬─────────┬───────────┘           │ - what-if simulation │
                               │         │                       │ - explanations       │
                        ┌──────▼───┐  ┌──▼────────────┐          └──────────────────────┘
                        │ Postgres │  │ Prometheus →  │
                        │          │  │ Grafana, Loki │
                        └──────────┘  └───────────────┘
```

**Why the decision engine is a separate container:** you can `docker stop decision-engine` live and show the API falling back to a rule-based policy. That single action demonstrates resilience, observability (fallback counter, alert) and recovery in one go.

**Data flow (Observe → Detect → Predict → Decide → Simulate → Act → Monitor → Recover)**
1. **Observe:** ingest loop pulls simulator state each tick (SSE hint → REST re-fetch) and stores a snapshot.
2. **Detect / Predict:** API asks the decision engine for risk per station and fuel.
3. **Decide:** engine returns ranked recommendations with reasons, confidence and alternatives.
4. **Simulate:** operator clicks "Simulate" → engine runs a what-if forward roll (before vs after).
5. **Act:** operator approves → API posts `POST /v1/allocations` with an idempotency key, logs the decision.
6. **Monitor / Recover:** metrics, alerts, health page; fallback/degraded mode when something fails.

---

## Part 2 — AI / ML / Decision Intelligence (main focus)

### 2.1 Design principles
- **The problem is small and deterministic** (4 stations × 3 fuels = 12 series, 2 depots, 6 routes). Simple, explainable models that update online will beat a heavy model here, and they run in milliseconds (good for load tests and the live demo).
- **Judges score usefulness and engineering, not accuracy** (brief §Primary Engineering Challenge). Prefer a model you can *explain in 30 seconds* and *measure against a baseline*.
- **Every recommendation must be inspectable:** risk reason, signals used, expected impact, confidence, alternatives.
- **Always have a fallback** (model unavailable → rule policy; low confidence → human review).
- **Human stays in the loop:** the engine recommends; the operator approves before any allocation is posted.

### 2.2 Capability map (what to build, in priority order)

| Tier | Capability | Brief category | Technique |
|---|---|---|---|
| **Must** | Demand forecast per station × fuel | Prediction | Seasonal prior + online EWMA correction |
| **Must** | Shortage / stockout risk + hours-to-stockout | Prediction | Forward inventory roll + Monte Carlo |
| **Must** | Allocation recommendation | Decision | Priority-based greedy heuristic |
| **Must** | Fallback policy | Resilience | Threshold (reorder-point) rule |
| **Must** | Human-readable explanation | Decision support / GenAI | Template (LLM optional) |
| **Should** | Confidence score + human-review flag | Decision support | Data volume, recent error, stale flag, MC spread |
| **Should** | What-if simulation (risk before vs after) | Decision support | Same forward roll with proposed shipments |
| **Should** | Anomaly / disruption detection | Detection | Rolling z-score on observed/expected ratio, CUSUM |
| **Should** | Policy vs baseline comparison | Demo / "why useful" | Deterministic reset + step harness |
| **Nice** | Constrained optimization | Decision | LP with PuLP or OR-Tools |
| **Nice** | LLM incident summary / operator Q&A | GenAI | Claude API, grounded on current JSON state |
| **Nice** | Drift detection + model versioning | MLOps | Rolling MAE vs baseline, version tag on each decision |
| **Skip** | Reinforcement learning | Optional | Brief requires proving it beats a heuristic; not worth 8 hours |

### 2.3 Inputs you can rely on (from the simulator)
- `GET /v1/demand-history?station_id=&limit=` → per tick, per station, per fuel: `demand_liters`, `served_liters`, `unmet_liters`. Use `limit ≤ 2000`.
- `GET /v1/stations`, `/v1/depots` → inventory, capacity, status, `demand_multiplier`, `dispatch_capacity_per_tick`.
- `GET /v1/routes` → `transit_ticks`, `max_shipment`, `status`.
- `GET /v1/supply-arrivals` → scheduled and delayed supply (depot-side inventory forecast).
- `GET /v1/events` → active and scheduled crises (features and explanations).
- `GET /v1/allocations` → in-transit and pending shipments (must count as "incoming" inventory).
- `GET /v1/metrics` → ground-truth `service_level`, `allocation_failures`.
- **Cold start:** at tick 0 there may be little or no history. So the forecaster starts from a **documented prior** (daily rate × hour-of-day factor, see the simulator guide) and learns a correction as data arrives. Check how much history exists at the start of the event.

### 2.4 Demand forecasting

**Approach: seasonal prior × online scale factor (per station and fuel)**

- Prior per tick = `daily_rate / 96 × hour_factor(profile, hour)`.
- Scale factor = EWMA of `observed / prior`. It absorbs regional factor, noise level and `demand_spike` multipliers automatically, so spikes are picked up within a few ticks.
- Forecast for step k = `prior(hour of step k) × scale`.
- Optional refinement: blend with a **learned hour-of-day mean** from history: `w = n / (n + K)`.
- Confidence input: rolling one-step error (sMAPE) per series.

```python
# ml/demand.py
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import numpy as np

DAILY = {  # liters per simulated day, from the simulator guide
    "urban_high": {"DIESEL": 8500,  "PETROL": 10500, "OCTANE": 5600},
    "industrial": {"DIESEL": 14000, "PETROL": 4500,  "OCTANE": 2200},
    "highway":    {"DIESEL": 10500, "PETROL": 11000, "OCTANE": 6200},
    "regional":   {"DIESEL": 7200,  "PETROL": 7600,  "OCTANE": 3600},
}
NOISE = {"urban_high": 0.10, "industrial": 0.08, "highway": 0.12, "regional": 0.10}

def hour_factor(profile: str, h: int) -> float:
    # NOTE: verify boundary hours (e.g. "06-09") against /v1/demand-history
    if profile == "industrial": return 1.55 if 6 <= h <= 17 else 0.45
    if profile == "highway":    return 1.35 if (6 <= h <= 9 or 16 <= h <= 20) else 0.75
    if profile == "urban_high": return 1.45 if (7 <= h <= 9 or 16 <= h <= 20) else 0.70
    if profile == "regional":   return 1.25 if 7 <= h <= 20 else 0.65
    return 1.0

def prior_per_tick(profile: str, fuel: str, hour: int) -> float:
    return DAILY[profile][fuel] / 96.0 * hour_factor(profile, hour)

@dataclass
class DemandForecaster:
    alpha: float = 0.3                      # EWMA weight for new observations
    scale: dict = field(default_factory=dict)   # (station, fuel) -> ratio
    err: dict = field(default_factory=dict)     # (station, fuel) -> rolling sMAPE
    n_obs: dict = field(default_factory=dict)

    def update(self, station, profile, fuel, sim_time: datetime, observed: float):
        key = (station, fuel)
        exp = prior_per_tick(profile, fuel, sim_time.hour) * self.scale.get(key, 1.0)
        if exp > 0:                          # one-step error BEFORE updating (honest metric)
            smape = abs(observed - exp) / ((abs(observed) + abs(exp)) / 2 + 1e-9)
            self.err[key] = 0.9 * self.err.get(key, smape) + 0.1 * smape
        base = prior_per_tick(profile, fuel, sim_time.hour)
        if base > 0:
            r = observed / base
            self.scale[key] = self.alpha * r + (1 - self.alpha) * self.scale.get(key, 1.0)
        self.n_obs[key] = self.n_obs.get(key, 0) + 1

    def forecast(self, station, profile, fuel, sim_time: datetime,
                 tick_minutes: int, horizon: int) -> np.ndarray:
        s = self.scale.get((station, fuel), 1.0)
        out = []
        for k in range(1, horizon + 1):
            t = sim_time + timedelta(minutes=tick_minutes * k)
            out.append(prior_per_tick(profile, fuel, t.hour) * s)
        return np.array(out)

    def warm_start(self, rows):   # rows sorted by tick asc: dicts from /v1/demand-history
        for r in rows:
            ...  # call update(...) with parsed sim_time and demand_liters
```

**Optional upgrade (only if time):** train `GradientBoostingRegressor` on features (hour, station profile, fuel, lagged demand 1/4/16 ticks, current `demand_multiplier`) and compare sMAPE with the seasonal-EWMA model on a hold-out. Keep whichever is better; show the comparison table in the demo. Do not add it unless the baseline is already working.

### 2.5 Shortage risk and time-to-stockout

Roll inventory forward over a horizon (e.g. 32 ticks ≈ 8 h, long enough to cover the 4-tick routes plus reaction time):

`inv[k+1] = inv[k] + arrivals[k] − demand[k]`

- **arrivals** = shipments already IN_TRANSIT or PENDING to that station (from `/v1/allocations`), placed at their `expected_arrival_tick − current_tick`. For PENDING (no expected tick yet) estimate `1 + transit_ticks`.
- **Monte Carlo** (a few hundred samples, seeded so results are reproducible) with multiplicative noise (station profile noise 8–12%) and uncertainty in the scale factor.
- Outputs per (station, fuel): `p_stockout`, `ttf_p50_hours`, `ttf_p10_hours` (pessimistic), expected unmet liters, first stockout tick.
- Risk levels (tunable): CRITICAL `ttf_p10 < lead time` or `p ≥ 0.7`; HIGH `p ≥ 0.4`; MEDIUM `p ≥ 0.15`; LOW otherwise.
- **Lead time** matters: if the home route takes 2 ticks (30 min) and the alternative 4 ticks (1 h), an alert must fire *before* stockout minus transit.

```python
# ml/risk.py
import numpy as np

def stockout_risk(inv, forecast, arrivals, sigma, n=400, scale_sd=0.10, seed=7):
    """inv: float; forecast, arrivals: arrays length H (arrivals[k] lands at step k)."""
    H = len(forecast)
    rng = np.random.default_rng(seed)
    noise = rng.normal(1.0, sigma, (n, H)) * rng.normal(1.0, scale_sd, (n, 1))
    demand = np.clip(forecast[None, :] * noise, 0, None)
    level = inv + np.cumsum(arrivals[None, :] - demand, axis=1)
    hit = level <= 0
    any_hit = hit.any(axis=1)
    first = np.where(any_hit, hit.argmax(axis=1), H)       # step index of first stockout
    unmet = np.clip(-level.min(axis=1), 0, None)            # rough unmet liters
    return {
        "p_stockout": float(any_hit.mean()),
        "ttf_p50_ticks": float(np.percentile(first, 50)),
        "ttf_p10_ticks": float(np.percentile(first, 10)),
        "expected_unmet_l": float(unmet.mean()),
    }
```
Convert ticks to hours with `ticks × tick_minutes / 60`. If the whole horizon is safe, report "no stockout within horizon".

### 2.6 Anomaly and disruption detection

Detect problems the forecaster hasn't been told about (and explain crisis events even before you poll `/v1/events`):

| Signal | Method | Meaning |
|---|---|---|
| Demand anomaly | rolling z-score of `observed / expected` over the last ~16 ticks; alert when `z > 3` or ratio above 1.4 for 3 consecutive ticks | demand spike |
| Sustained shift | CUSUM on the ratio | slow-building spike, missed by z-score |
| Abnormal inventory change | station inventory drop per tick versus forecast demand (delta beyond noise) | leak, outage, data problem |
| Unmet demand | `unmet_liters > 0` in demand-history | stockout has already happened |
| Supply bottleneck | scheduled arrival `DELAYED`, or depot cover ratio (inventory ÷ upcoming regional demand) below threshold | supply chain issue |
| Route / region disruption | any route `DISRUPTED`, station `OUTAGE`, depot `CONSTRAINED`; count stations that lose all routes | regional disruption |
| Data quality | `X-Simulator-Stale: true`, tick not advancing while RUNNING, schema mismatch | integration failure (also an *intelligence-layer* input: lowers confidence) |

Optional named model: `sklearn.ensemble.IsolationForest` over `[ratio, inv_delta_ratio, unmet]` features. A z-score plus CUSUM is easier to explain and needs no training.

### 2.7 Allocation (decision) engine

#### Policy A — Priority-based greedy heuristic (default, build first)
For each tick:
1. Compute risk for all (station, fuel). Keep those at MEDIUM or above.
2. Sort by urgency (smallest `ttf_p10 − lead_time` first, then highest `p_stockout`).
3. For each at-risk series, compute the **needed quantity** at arrival: `need = demand over cover window (e.g. 24 h) + safety stock − (inventory + inflight)`, clipped to station headroom `capacity − inventory − inflight`.
4. Candidate routes to that station where route is `AVAILABLE`, station `OPEN`, depot `OPEN/CONSTRAINED`. Score = transit ticks (lower better) with a penalty for draining the depot's own-region cover.
5. Quantity = `min(need, route.max_shipment, depot inventory − reserve, depot dispatch budget left this tick)`. If `need > max_shipment`, split across ticks or routes.
6. Emit the recommendation with the runner-up route as an alternative; decrement the working copies of depot inventory and dispatch budget so later items don't over-commit.
7. Drop anything below a minimum shipment size (e.g. 500 L) to avoid noise.

```python
# ml/allocate.py  (skeleton)
def recommend(state, risks, cfg):
    recs = []
    depot_inv = {d.id: dict(d.inventory) for d in state.depots}
    dispatch_left = {d.id: d.dispatch_capacity_per_tick - state.committed_dispatch(d.id) for d in state.depots}
    for r in sorted(risks, key=urgency):                    # most urgent first
        if r.level in ("LOW",): continue
        need = min(r.need_liters, r.station_headroom)
        options = [rt for rt in state.routes_to(r.station_id) if state.usable(rt)]
        options.sort(key=lambda rt: (rt.transit_ticks, -depot_inv[rt.source_depot_id][r.fuel]))
        for rt in options:
            q = min(need, rt.max_shipment,
                    depot_inv[rt.source_depot_id][r.fuel] - cfg.reserve(rt.source_depot_id, r.fuel),
                    dispatch_left[rt.source_depot_id])
            if q >= cfg.min_qty:
                recs.append(make_rec(r, rt, round(q), alternatives=options))
                depot_inv[rt.source_depot_id][r.fuel] -= q
                dispatch_left[rt.source_depot_id] -= q
                break
    return recs
```

#### Policy B — Constrained optimization (LP with PuLP; build if A works)
Decide all shipments for the current tick jointly, so depots' shared limits are respected.

- Variables: `x[r, f] ≥ 0` liters on route *r* for fuel *f*; `short[s, f] ≥ 0`.
- Minimize: `Σ w[s,f]·short[s,f] + λ·Σ transit_ticks[r]·x[r,f] / 1000` (weights `w` come from risk urgency).
- Constraints:
  - `short[s,f] ≥ need[s,f] − Σ_{r→s} x[r,f]`
  - depot stock: `Σ_{r from d} x[r,f] ≤ inventory[d,f] − reserve[d,f]`
  - dispatch: `Σ_f Σ_{r from d} x[r,f] ≤ dispatch_capacity[d] − committed[d]`
  - route: `x[r,f] ≤ max_shipment[r]`
  - destination headroom: `Σ_{r→s} x[r,f] ≤ capacity[s,f] − inventory[s,f] − inflight[s,f]`
  - unavailable route or closed station: `x = 0`
- Post-process: round to whole liters, drop tiny shipments, split nothing (route cap already enforced).

```python
import pulp
def solve_lp(routes, stations, depots, fuels, need, weight, headroom, depot_stock, dispatch_budget, lam=0.05):
    m = pulp.LpProblem("alloc", pulp.LpMinimize)
    x = {(r.id, f): pulp.LpVariable(f"x_{r.id}_{f}", 0, r.max_shipment if r.usable else 0)
         for r in routes for f in fuels}
    short = {(s, f): pulp.LpVariable(f"s_{s}_{f}", 0) for s in stations for f in fuels}
    m += pulp.lpSum(weight[s, f] * short[s, f] for s in stations for f in fuels) \
         + lam * pulp.lpSum(r.transit_ticks * x[r.id, f] / 1000 for r in routes for f in fuels)
    for s in stations:
        for f in fuels:
            into = [x[r.id, f] for r in routes if r.station_id == s]
            m += short[s, f] >= need[s, f] - pulp.lpSum(into)
            m += pulp.lpSum(into) <= headroom[s, f]
    for d in depots:
        for f in fuels:
            m += pulp.lpSum(x[r.id, f] for r in routes if r.depot_id == d) <= depot_stock[d, f]
        m += pulp.lpSum(x[r.id, f] for r in routes if r.depot_id == d for f in fuels) <= dispatch_budget[d]
    m.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=2))     # hard time limit: never block the API
    return {k: v.value() for k, v in x.items() if (v.value() or 0) > 1}
```
Wrap the solve in a timeout; if it fails or is infeasible, fall back to Policy A. Keep the policy name (`greedy-v1`, `lp-v1`, `threshold-v1`) in every decision record.

#### Policy C — Fallback threshold rule (used when ML/optimizer is unavailable or confidence is too low)
Reorder-point rule, no forecasting required:
- If `inventory / capacity < 35%` for a station-fuel, ship `min(max_shipment, 60% of capacity − inventory)` from the home depot (or the alternate route if the home route is disrupted).
- Same constraint checks as Policy A.
- Mark the recommendation `policy = "threshold-v1 (fallback)"` and increment the fallback metric so the UI and Grafana show it.

### 2.8 What-if simulation ("expected impact of decisions")
Reproduces the brief's example: *"Stockout risk reduced 72% → 19%"*.

- `POST /simulate` with a list of proposed allocations.
- Re-run `stockout_risk` for the affected stations twice: without and with the proposed shipments added to `arrivals`.
- Return: `p_stockout_before/after`, `ttf_before/after`, `expected_unmet_before/after`, and the depot impact (inventory after dispatch, cover ratio).
- Use the same seeded RNG for both runs so the delta reflects the decision, not noise.

### 2.9 Confidence, uncertainty and human review
Confidence per recommendation, in [0, 1]:

```
confidence = 0.9
           × min(1, n_obs / 48)            # enough history?
           × (1 − min(0.5, recent_smape))  # recent forecast error
           × (0.7 if data_stale else 1.0)  # X-Simulator-Stale
           × (0.85 if active_event_changed_recently else 1.0)
```
- `confidence < 0.5` → flag **"Human review requested"** (brief: prediction confidence too low → human review).
- Show the MC spread (p10–p90 time-to-stockout) as the uncertainty band in the UI.
- Regardless of confidence, **every allocation needs operator approval** (brief guardrail: preserve human review for consequential decisions).

### 2.10 Explanations (rule-based first, LLM optional)

Each recommendation is a structured object; the explanation is generated *from it*:

```json
{
  "id": "rec-000123",
  "station_id": "station-mirpur", "fuel": "DIESEL",
  "risk": {"level": "HIGH", "p_stockout": 0.72, "ttf_p50_h": 6.2, "ttf_p10_h": 4.0},
  "signals": ["demand 1.8x baseline (demand_spike active)", "inventory at 23% of capacity", "no shipment in transit"],
  "action": {"depot": "depot-gazipur", "route": "route-gazipur-mirpur", "quantity_l": 5000, "eta_ticks": 2},
  "impact": {"p_stockout_before": 0.72, "p_stockout_after": 0.19, "expected_unmet_saved_l": 3100},
  "confidence": 0.81,
  "alternatives": [{"depot": "depot-patiya", "route": "route-patiya-mirpur", "quantity_l": 5000, "eta_ticks": 4, "why_not": "2 ticks slower"}],
  "policy": "greedy-v1", "model_version": "seasonal-ewma-v1",
  "needs_human_review": false
}
```
- **Template explanation (always available):** built by string formatting from the fields above.
- **LLM explanation (optional, GenAI requirement):** pass only that JSON to Claude and ask for 2–3 plain sentences. The LLM **explains, it never decides or invents numbers**.

```python
import os, anthropic
client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=8.0, max_retries=1)

SYSTEM = ("You explain fuel-allocation recommendations to an operations team. Use ONLY the JSON given. "
          "Do not invent numbers. 2-3 short sentences. Mention why the station is at risk, the action, and the expected impact. "
          "State that this is a simulated result.")

def explain_llm(rec: dict) -> str:
    r = client.messages.create(model="claude-haiku-4-5-20251001", max_tokens=250,
                               system=SYSTEM, messages=[{"role": "user", "content": json.dumps(rec)}])
    return r.content[0].text
# on any exception or timeout -> return explain_template(rec) and increment llm_fallback counter
```
- Read the API key from an environment variable, never commit it. Check network access at the venue first. Model names change, so confirm the current one in the Anthropic docs.
- Other useful GenAI features that support the operations system (not just a chatbot): an **incident summary** ("Dhaka demand spike since tick 40; Mirpur diesel at risk; 2 recommendations pending") generated from the current snapshot, and a read-only **operator Q&A** grounded on the snapshot JSON.

### 2.11 Evaluation: prove the intelligence is useful
Because the simulator is deterministic, you can run a fair A/B:

```python
def run_episode(policy, steps=192, injected=()):
    sim.reset(); sim.pause()
    for ev in injected: sim.inject_event(ev)
    for _ in range(steps):
        state = fetch_state()
        for a in policy(state): sim.post_allocation(a)   # unique idempotency keys
        sim.step()
    return sim.get_metrics()      # service_level, unmet_demand_liters, allocation_failures, allocation_liters
```
Compare on the same scenario (baseline, plus demand_spike and route_disruption injected):

| Policy | service_level | unmet liters | failures | liters shipped |
|---|---|---|---|---|
| none (do nothing) | | | | |
| threshold-v1 | | | | |
| greedy-v1 | | | | |
| lp-v1 (if built) | | | | |

Also track online: forecast sMAPE per series, alert precision (alerts followed by a real stockout without action), and lead time between alert and would-be stockout. Put the table and one chart in the README and the demo.
*(Run this before the judged demo only: `POST /admin/reset` wipes the world, including your allocations.)*

### 2.12 MLOps-lite (cheap, scores on DevOps and intelligence)
- **Model versioning:** a `model_version` string plus a JSON parameter snapshot (scale factors, alpha, thresholds) saved to a `model_versions` table; every recommendation and decision stores `model_version` and `policy`.
- **Experiment tracking:** the evaluation table above, stored as JSON in the repo (`/experiments/*.json`). MLflow is optional and not worth the setup time.
- **Drift detection:** rolling MAE of the current model versus the prior-only baseline; if the ratio exceeds a threshold, raise a drift alert and (optionally) fall back to prior-only forecasting.
- **Decision audit history:** append-only `decisions` table (inputs hash, recommendation, operator, approval time, simulator response).
- **Reproducibility:** fixed RNG seeds in Monte Carlo; scenario replay via reset + step.

### 2.13 Decision-engine API contract

| Endpoint | Purpose |
|---|---|
| `POST /risk` | State snapshot in, risk per station and fuel out (levels, p, ttf, confidence, signals) |
| `POST /recommend` | State + risks in, ranked recommendations out |
| `POST /simulate` | State + proposed allocations in, before/after impact out |
| `POST /explain` | Recommendation in, template and optional LLM text out |
| `GET /model-info` | `model_version`, policy versions, recent error, drift status |
| `GET /health` | Liveness and model-loaded flag |
| `GET /metrics` | Prometheus metrics (prediction error, confidence, latency, fallback count) |

Stateless where possible: the API sends the snapshot in the request, so the engine can be restarted without losing anything important (the online scale factors are rebuilt with `warm_start` from `/v1/demand-history`).

### 2.14 How the API service uses the engine (resilience)
```
call decision-engine (timeout 1.5 s, 1 retry)
  ├─ ok, confidence ≥ 0.5  → normal recommendation
  ├─ ok, confidence < 0.5  → recommendation flagged "human review requested"
  └─ timeout / 5xx / invalid response
        → increment fallback counter, log event, raise alert,
          compute threshold-v1 recommendation locally in the API, label it "FALLBACK POLICY"
circuit breaker: after N consecutive failures, skip calls for a cool-down and probe /health
```

### 2.15 Suggested ML timeline (about 3–4 hours of one person's time)
| Time | Deliverable |
|---|---|
| 0:00–0:45 | State models and Pydantic schemas; fixtures from the simulator; `demand.py` prior and forecaster |
| 0:45–1:30 | `risk.py` Monte Carlo + risk levels; unit tests with hand-computed cases |
| 1:30–2:30 | Greedy allocator with all constraint checks; fallback threshold policy; recommendation JSON |
| 2:30–3:15 | `/simulate`, confidence score, template explanations; anomaly detection |
| 3:15–4:00 | Evaluation harness and results table; (optional) LLM explanations, PuLP policy |

Get the **end-to-end thin slice** working first (forecast → risk → one recommendation → API → UI) before polishing any model.

---

## Part 3 — Backend API (FastAPI)

### 3.1 Responsibilities
1. **Simulator client** (single choke point): timeouts, retries with backoff and jitter, error-shape parsing (both `error.code` and `detail.code`), schema validation, stale detection, circuit breaker.
2. **Ingest loop:** SSE listener + safety-net poller; on `simulation.tick` re-fetch stations, depots, routes, events, supply arrivals, allocations, metrics; store a snapshot per tick.
3. **Operator API** for the UI (below).
4. **Orchestration:** call the decision engine, apply fallback, store recommendations and alerts.
5. **Approval flow:** on approve → generate idempotency key → `POST /v1/allocations` → store result → audit log.
6. **Health + metrics** endpoints.

### 3.2 Endpoints (suggested)

| Endpoint | Description |
|---|---|
| `GET /api/overview` | Network state: stations, depots, inventory %, status, tick, service level |
| `GET /api/stations/{id}` | Detail with history, forecast and risk |
| `GET /api/alerts` | Active and recent alerts (shortage, disruption, system) |
| `GET /api/recommendations` | Pending recommendations with explanation and impact |
| `POST /api/recommendations/{id}/simulate` | What-if result |
| `POST /api/recommendations/{id}/approve` | Approve and post the allocation |
| `POST /api/recommendations/{id}/reject` | Reject with reason |
| `GET /api/decisions` | Decision history and audit trail |
| `GET /api/events` | Crisis events (active, scheduled, resolved) |
| `GET /api/system/status` | Component health, p95 latency, error rate, fallback state |
| `GET /health` | Liveness (used by compose and CI) |
| `GET /metrics` | Prometheus metrics |
| `POST /api/admin/demo/*` | (Restricted) proxy to simulator admin: step, run, pause, inject event or fault, clear faults |

Restrict admin and approval endpoints with a simple operator token from an env var (brief: restrict sensitive operator actions).

### 3.3 Libraries
`fastapi`, `uvicorn[standard]`, `httpx`, `pydantic` v2, `pydantic-settings`, `sqlalchemy` 2 + `psycopg`, `alembic` (or create tables at start-up), `sse-starlette` (if you push SSE to the UI), `prometheus-client` or `prometheus-fastapi-instrumentator`, `tenacity` (retries), `structlog` or `python-json-logger`, `pytest`, `respx` (mock httpx).

### 3.4 Resilience behaviors to implement and demo

| Failure | Behavior | Visible signal |
|---|---|---|
| Simulator 503 / error_rate | Retry with backoff; then serve cached state | "Degraded: cached data as of tick N" banner, alert |
| Simulator latency | Timeout, cached state | Latency panel rises in Grafana |
| stale_data header | Mark stale, lower confidence | "Stale data" badge |
| stream_disconnect / SSE drop | Reconnect with backoff + REST re-sync; poller keeps going | Log line, `sse_connected` gauge = 0 |
| Invalid simulator response | Reject, keep last good state, alert | Alert + log |
| Decision engine down | Threshold fallback policy | "FALLBACK POLICY" label, fallback counter |
| Low confidence | Human review flag | Badge on recommendation |
| Database down | Serve in-memory snapshot read-only, queue writes or reject approvals clearly | Health page shows DB unhealthy |
| Simulator reset (tick goes backwards) | Detect and rebuild local state | Log + notice |

---

## Part 4 — Database (PostgreSQL)

Keep the schema small; use JSONB for flexible payloads.

```sql
CREATE TABLE snapshots (          -- one row per tick: full state for replay and charts
  tick int PRIMARY KEY, sim_time timestamptz, taken_at timestamptz DEFAULT now(),
  stations jsonb, depots jsonb, routes jsonb, metrics jsonb, stale boolean DEFAULT false);

CREATE TABLE demand_obs (         -- cached copy of /v1/demand-history for training
  station_id text, fuel_type text, tick int, demand_liters real, served_liters real, unmet_liters real,
  PRIMARY KEY (station_id, fuel_type, tick));

CREATE TABLE alerts (
  id bigserial PRIMARY KEY, created_tick int, created_at timestamptz DEFAULT now(),
  kind text,                       -- shortage | disruption | anomaly | system | fallback
  severity text, station_id text, fuel_type text, message text, payload jsonb,
  resolved_at timestamptz);

CREATE TABLE recommendations (
  id bigserial PRIMARY KEY, created_tick int, station_id text, fuel_type text,
  payload jsonb,                   -- the structured recommendation (risk, signals, action, impact, alternatives)
  policy text, model_version text, confidence real, needs_review boolean,
  status text DEFAULT 'PENDING'); -- PENDING | APPROVED | REJECTED | EXPIRED

CREATE TABLE decisions (          -- append-only audit trail
  id bigserial PRIMARY KEY, recommendation_id bigint, decided_at timestamptz DEFAULT now(),
  operator text, action text,      -- approve | reject
  idempotency_key text UNIQUE, request jsonb, simulator_response jsonb, allocation_id int, outcome text);

CREATE TABLE model_versions (
  version text PRIMARY KEY, created_at timestamptz DEFAULT now(), params jsonb, notes text);

CREATE TABLE system_events (      -- integration failures, recoveries, breaker state changes
  id bigserial PRIMARY KEY, at timestamptz DEFAULT now(), component text, level text, message text, payload jsonb);
```
Indexes on `(station_id, fuel_type, tick)`, `alerts(created_at)`, `decisions(decided_at)`. Because the simulator can be reset, store a `run_id` (changes on reset) or clear tables on reset detection.

Redis is **not** needed; in-memory last-known-good state in the API is enough for degraded mode.

---

## Part 5 — Frontend (Next.js)

### 5.1 Setup decisions
- **Next.js (App Router) + TypeScript**, dashboard pages as **client components** (`"use client"`) using **SWR** with polling (e.g. 2–3 s overview, 5 s alerts); avoid fetching live simulator data in server components (caching surprises).
- **Proxy** `/api/*` to the FastAPI service via `rewrites()`; backend URL from env (no hard-coding, no CORS).
- `output: "standalone"` for a small Docker image.
- **Generate TS types** from the FastAPI OpenAPI schema (`openapi-typescript`) so backend and frontend can't drift while four people work in parallel.
- Tailwind + **shadcn/ui** (tables, cards, badges, dialogs, tabs) + **Recharts** (inventory and forecast charts).

```js
// next.config.js
module.exports = {
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.BACKEND_URL}/api/:path*` }];
  },
};
```

### 5.2 Pages and components

| Page | Contents |
|---|---|
| `/` Overview | Tick and sim clock; KPI cards (service level, active alerts, stations at risk, allocations in transit); station cards with inventory bars per fuel (color by risk); depot cards; event banner |
| `/alerts` | Shortage, disruption and system alerts, filterable by severity |
| `/recommendations` | Cards: station and fuel, risk level, time-to-stockout, action, confidence, explanation, alternatives; buttons **Inspect · Simulate · Approve · Reject**; "Human review requested" and "FALLBACK POLICY" badges |
| `/stations/[id]` | Inventory over time, demand vs forecast with uncertainty band, incoming shipments, risk breakdown |
| `/network` | Depot → route → station graph with route status (simple SVG or table is enough) |
| `/history` | Decision audit table (who, what, when, outcome, simulator response) |
| `/status` | Health of API, DB, simulator, decision engine, SSE; p95 latency, error rate, fallback state; recent system events |
| `/demo` (restricted) | Buttons for step, run, pause, inject event, inject fault, clear faults (simulator admin proxy) |

- **Layout-level badges on every page:** "SIMULATED DATA" (brief guardrail) and "as of tick N" plus a "degraded / cached" indicator.
- **Approve dialog:** show quantity, route, ETA, expected impact and confidence; require an explicit click; show the simulator response (success or the 409 error code and its meaning).
- **Error handling in the UI:** when `/api` calls fail, keep the last data on screen with a banner instead of a blank page.

### 5.3 Dockerfile (multi-stage)
```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```
Add `app/api/health/route.ts` returning `{status:"ok"}` for the compose healthcheck.

---

## Part 6 — DevOps, Observability and Testing

### 6.1 Repository layout
```
repo/
├── docker-compose.yml
├── .env.example
├── .github/workflows/ci.yml
├── README.md                      # setup, architecture diagram, assumptions, load-test results
├── docs/                          # architecture.png, resilience evidence, load-test report
├── frontend/                      # Next.js
├── api/                           # FastAPI service (+ tests/)
├── decision-engine/               # ML + optimization service (+ tests/)
├── monitoring/
│   ├── prometheus.yml
│   └── grafana/ (provisioning + dashboards JSON)
├── loadtest/k6.js
└── experiments/                   # policy comparison results (JSON)
```

### 6.2 docker-compose.yml (skeleton)
```yaml
services:
  simulator-api:
    image: asifmahmoud414/bup-fuel-supply-simulator:1.0.0
    environment:
      SIMULATION_SPEED: ${SIMULATION_SPEED:-1}
      TICK_MINUTES: ${TICK_MINUTES:-15}
      SIMULATOR_START_MODE: ${SIMULATOR_START_MODE:-paused}
    ports: ["8000:8000"]

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: fuel
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d fuel"]
      interval: 5s
      retries: 10

  decision-engine:
    build: ./decision-engine
    environment:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request as u; u.urlopen('http://localhost:8100/health')"]
      interval: 5s
      retries: 10

  api:
    build: ./api
    environment:
      SIMULATOR_URL: http://simulator-api:8000
      ENGINE_URL: http://decision-engine:8100
      DATABASE_URL: postgresql+psycopg://${DB_USER}:${DB_PASSWORD}@postgres:5432/fuel
      OPERATOR_TOKEN: ${OPERATOR_TOKEN}
    depends_on:
      postgres: { condition: service_healthy }
      simulator-api: { condition: service_started }
    ports: ["8080:8080"]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request as u; u.urlopen('http://localhost:8080/health')"]
      interval: 5s
      retries: 10

  frontend:
    build: ./frontend
    environment:
      BACKEND_URL: http://api:8080
    depends_on: [api]
    ports: ["3000:3000"]

  prometheus:
    image: prom/prometheus
    volumes: ["./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro"]
    ports: ["9090:9090"]

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    ports: ["8081:8080"]

  grafana:
    image: grafana/grafana
    volumes: ["./monitoring/grafana:/etc/grafana/provisioning"]
    ports: ["3001:3000"]
    depends_on: [prometheus]

volumes:
  pgdata:
```
Notes: `.env` (not committed) holds `DB_USER`, `DB_PASSWORD`, `OPERATOR_TOKEN`, optional `ANTHROPIC_API_KEY`; commit only `.env.example`. Set `SIMULATION_SPEED` low (or start paused and use `/admin/step`) so a simulated day isn't over in 12 seconds. Compose YAML above is a starting point; verify volume paths and image tags when you set it up.

### 6.3 CI/CD (GitHub Actions)
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r api/requirements.txt -r decision-engine/requirements.txt pytest ruff
      - run: ruff check api decision-engine
      - run: pytest api decision-engine -q
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd frontend && npm ci && npm run lint && npm run build
  build-and-smoke:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cp .env.example .env
      - run: docker compose build
      - run: docker compose up -d
      - run: |
          for i in $(seq 1 30); do curl -sf http://localhost:8080/health && break || sleep 3; done
          curl -sf http://localhost:8080/health
          curl -sf http://localhost:3000/api/health
      - run: docker compose down -v
```
This maps directly to *Source Code → Build → Test → Package → Deploy → Health Check → Running Application*. Optional: push images to GHCR with `docker/build-push-action` and tag with the commit SHA (deployment versioning).

### 6.4 Metrics to expose (custom, on top of HTTP metrics)

| Layer | Metric (Prometheus name suggestion) |
|---|---|
| Application | request rate, latency histogram, error rate (from instrumentator); `simulator_requests_total{status}`, `simulator_request_seconds` |
| System | CPU and memory per container (cAdvisor) |
| Integration | `sse_connected` (0/1), `simulator_stale` (0/1), `circuit_breaker_state{target}`, `cache_age_ticks` |
| Intelligence | `forecast_smape{station,fuel}`, `model_confidence` (histogram), `shortage_alerts_total{severity}`, `recommendations_total{policy}`, `decisions_total{action}`, `fallback_activations_total{reason}`, `engine_request_seconds`, `drift_ratio` |
| Business | `service_level` (from `/v1/metrics`), `unmet_demand_liters`, `allocation_failures` |

Grafana panels: request rate, p95 latency, error rate, container CPU/memory, alerts by severity, fallback activations, model confidence and forecast error, service level, circuit-breaker and SSE status. Provision the dashboard from JSON so it appears on `docker compose up`.

**Logging:** structured JSON with `event`, `component`, `tick`, `station`, `policy`, `trace_id`. Log every decision, integration failure, fallback activation and recovery (brief: logs of important actions, integration failures, decision events, recoveries).

### 6.5 Load test (k6)
Pick one or two paths: `GET /api/overview` (dashboard backend) and `POST /api/recommendations/refresh` or the decision engine `/recommend` (decision API).

```js
import http from "k6/http";
import { check, sleep } from "k6";
export const options = {
  stages: [{ duration: "30s", target: 20 }, { duration: "1m", target: 50 }, { duration: "30s", target: 0 }],
  thresholds: { http_req_failed: ["rate<0.02"], http_req_duration: ["p(95)<500"] },
};
export default function () {
  const r = http.get(`${__ENV.BASE}/api/overview`);
  check(r, { "200": (x) => x.status === 200 });
  sleep(1);
}
```
Run: `docker run --rm -i --network host -e BASE=http://localhost:8080 grafana/k6 run - < loadtest/k6.js`. Record avg, p50, p95, p99, throughput, error rate, concurrency, and CPU/memory (Grafana screenshot). Then find the limit (raise VUs until latency or errors climb) and write what you observed, since the brief cares about understanding limits, not a benchmark number.

### 6.6 Testing (small but real)
- **Unit tests:** hour factors, forecaster update, risk roll (hand-computed case), allocator constraint checks (route cap, dispatch cap, headroom, disrupted route), idempotency-key generation.
- **Contract tests:** simulator client against recorded fixtures with `respx`, including error shapes (`error` vs `detail`), 503, stale header, and malformed JSON.
- **Smoke test in CI:** health endpoints after `docker compose up`.
- **Chaos checklist (manual, for the demo):** stop `decision-engine`; inject `unavailable`, `error_rate`, `latency`, `stale_data`, `stream_disconnect`; stop `postgres`; each with the expected UI and metric signal.

### 6.7 Security and hygiene
- No secrets in code or repo; `.env.example` only; `.gitignore` for `.env`.
- Validate all input with Pydantic (quantity > 0, enums, ids that exist); validate all simulator responses.
- Operator token on approve and admin routes; UI labeled as simulated; approvals logged with operator identity.
- Document configuration and assumptions in the README (brief requirement).

---

## Part 7 — Suggested Task Split (4 people, 8 hours)

| Person | Owns | First deliverable (by hour 2) |
|---|---|---|
| **Backend** | Simulator client, ingest loop, DB, operator API, approval flow, health and metrics | `/api/overview` returning real simulator data; snapshots stored |
| **ML / decision engine** | Part 2 in full | `/risk` and `/recommend` returning JSON on fixture data |
| **Frontend** | Next.js pages, approve dialog, status page, badges | Overview page rendering mock data from generated types |
| **DevOps** | Compose, Dockerfiles, CI, Prometheus and Grafana, k6, failure-injection scripts, README and diagram | `docker compose up` brings up everything with health checks green |

**Integration points to agree in hour 0:** the recommendation JSON shape (section 2.10), the engine API contract (2.13), the `/api/*` endpoints (3.2), and the OpenAPI type generation step.

**Cut list if time runs short (in order):** LLM explanations → LP policy → anomaly model beyond z-score → Loki → `/network` page → GBM forecast. Never cut: fallback policy, health/status page, Grafana dashboard, load-test evidence, live failure demo.

---

## Part 8 — Using AI Coding Agents (optional)
If you use coding agents, put the three guides (`hackathon_guide.md`, `simulator_integration_guide.md`, `tech_stack_guide.md`) into an `.agents/` folder at the repo root and add a short `AGENTS.md` pointing to them, plus the conventions above (ports, env vars, JSON shapes). Give each agent one module and the contract it must satisfy, then review and test everything yourselves; generated code still has to pass the tests and the live demo.
