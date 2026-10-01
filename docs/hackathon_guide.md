# BUP CSE Fest 2026 — Hackathon Finals
## Fuel Supply Intelligence & Resilience Platform
**Tagline:** Build. Deploy. Observe. Respond.
**Organized by:** BUP Computer Programming Club, in association with Poridhi.io

> **Companion file:** `simulator_integration_guide.md` (full simulator API, rules, world data, and integration tips).

> **Final line of the brief:** *"Your job is not only to build the system. Your job is to keep it working."*

---

## 1. The Challenge in One Paragraph

Build and operate an intelligent **decision-support platform** for a **simulated fuel supply network in Bangladesh**. The system must help an operations team:

- understand fuel availability,
- identify emerging shortages,
- respond to disruptions,
- recommend allocation decisions,
- and **remain usable when parts of the system fail**.

**This is not only a machine-learning challenge.** It has three equal pillars:

| Application Development | AI / Decision Intelligence | DevOps & Reliability |
|---|---|---|
| Build the operator experience | Predict, detect, optimize | Ship, observe, recover |

---

## 2. Challenge at a Glance

| Item | Requirement |
|---|---|
| Core goal | A working fuel operations decision-support platform on top of the organizer-provided simulator |
| Must include | Operator-facing app, backend, intelligence component, deployment, observability, resilience, load testing |
| Intelligence | At least **one** meaningful AI / ML / optimization / detection capability. RL is optional |
| Environment | All teams integrate with the **same BUP Fuel Supply Simulator** |
| Hackathon dynamic | Organizers may introduce **surprise domain and engineering events** during development or judging |
| Deployment | Must be **reproducibly runnable**, preferably containerized |
| Judging focus | Working product, decision usefulness, architecture, DevOps, resilience, observability, live demo |

---

## 3. Executive Summary (What the System Must Be Able To Do)

The simulated network has interconnected supply points, depots, transport routes, regions, fuel stations and customer demand. A problem at one stage cascades:

- A delayed shipment → lower depot inventory
- A demand spike → regional shortage
- A route failure → an otherwise valid allocation becomes impossible

Your platform must be capable of:

1. observing the current simulated fuel network;
2. identifying emerging shortages and operational risks;
3. helping operators decide how constrained fuel should be allocated;
4. responding to unexpected disruptions;
5. exposing the reasoning behind important recommendations;
6. remaining observable and usable during application or service failures;
7. demonstrating measurable system performance under load.

> The platform operates **entirely against the BUP Fuel Supply Simulator**. No real fuel infrastructure is accessed or controlled.

---

## 4. The Core Engineering Loop

Your solution should demonstrate the complete loop:

```
Observe → Detect → Predict → Decide → Simulate → Act → Monitor → Recover
```

**Emphasis:** NOT the highest ML accuracy. Judges must be able to **interact with and observe a working system.**

---

## 5. The Scenario (Domain Model)

```
Import / Supply
      ↓
Port / Arrival
      ↓
Depot / Storage
      ↓
Distribution / Transport
      ↓
Fuel Stations
      ↓
Customer Demand
```

- Primary fuel categories: **Diesel, Petrol, Octane**
- You may model additional operational concepts if useful.

---

## 6. The Organizer-Provided Simulator

- All teams get the same **BUP Fuel Supply Simulator**. **You do NOT build your own simulator.**
- It provides: depots and stations; inventory by fuel type; regional demand; incoming supply; transport routes and travel constraints; supply delays; operational events and crisis conditions.
- You interact through **documented APIs**. The brief showed conceptual endpoints; the **actual** simulator API (see `simulator_integration_guide.md` for full detail) is:

```
GET  /v1/health  /v1/instance  /v1/regions  /v1/depots  /v1/stations  /v1/routes
GET  /v1/supply-arrivals  /v1/events  /v1/allocations  /v1/metrics
GET  /v1/demand-history?station_id=&limit=
GET  /v1/stream                     (SSE — hint only, always re-GET via REST)
POST /v1/allocations                (the ONLY domain write; idempotency_key in body)
POST /v1/allocations/{id}/cancel    (PENDING only)
Admin (bypass faults): /admin/run|pause|toggle|step|reset, /admin/events, /admin/faults, /admin/faults/clear, /admin/audit
```

- **Runs as a Docker image — you never build a simulator.** Image: `asifmahmoud414/bup-fuel-supply-simulator:1.0.0` (public on Docker Hub, about 54 MB). Port 8000, Swagger at `/docs`, console at `/admin`. One instance per participant; don't modify its source.
  - Docker Hub currently lists **only the `1.0.0` tag** (no `latest`), so always reference `:1.0.0` explicitly.
  - The repository was updated a few days before the event under that same tag, so **run `docker pull` again right before the event and before the demo**. Record the digest (`docker image inspect --format '{{index .RepoDigests 0}}' asifmahmoud414/bup-fuel-supply-simulator:1.0.0`) in the README, but don't pin by digest: judges run your submission against the published image.
  - Pull it ahead of time so you are not depending on venue Wi-Fi.
- **World is small and fixed:** 2 regions, 2 depots (Gazipur, Patiya), 4 stations (Mirpur, Tongi, Karnaphuli, Cox's Bazar), 6 routes, 3 fuels, 15-min ticks. Deterministic: same seed + actions + events → identical state.
- **Crisis events map to the brief:** `shipment_delay`, `demand_spike`, `depot_constraint`, `route_disruption` / `station_outage`, plus `supply_shortfall`. **API faults** (`latency`, `unavailable`, `error_rate`, `stale_data`, `stream_disconnect`) are how organizers can attack your simulator dependency.
- `GET /v1/metrics` gives ground-truth `service_level` and `allocation_failures` — your headline KPIs.

**How to approach it:**
- Write a dedicated **simulator client/adapter** module (single place that calls the simulator).
- Validate every response (schema check). Invalid response → reject input + raise alert (see Resilience).
- Add timeouts, retries and caching in this client.
- Store snapshots/history in your own database so you can forecast, replay and show history.

---

## 7. What Your Team Must Build

A complete **end-to-end platform** that handles:
- data collection and management,
- analysis,
- decision-making support,
- applications and operator tools,
- monitoring.

---

## 8. Application Requirement (Operator UI)

A usable operator-facing app is **mandatory**. **A notebook alone is NOT a complete submission.** A web app is recommended; other interfaces are accepted if they meaningfully support the operations workflow.

The UI should include a **meaningful subset** of:

- [ ] current fuel inventory
- [ ] depot and station status
- [ ] regional fuel demand
- [ ] shortage alerts
- [ ] projected shortage risk
- [ ] incoming supply
- [ ] disruptions
- [ ] recommended allocations
- [ ] expected impact of decisions
- [ ] system alerts
- [ ] decision history
- [ ] service health

**How to do it:** Dashboard with (a) network overview/map or table, (b) alerts panel, (c) recommendation panel with "Inspect / Simulate / Approve" buttons, (d) decision history table, (e) system status page.

---

## 9. Intelligence Requirement

Implement **at least one** meaningful capability. Choose techniques that fit your architecture.

**Prediction**
- demand forecasting
- shortage prediction
- stockout probability
- estimated supply arrival
- transport delay prediction

**Detection**
- anomalous demand
- abnormal inventory changes
- supply-chain bottlenecks
- emerging regional disruptions

**Decision Intelligence**
- constrained optimization
- heuristic allocation
- priority-based allocation
- reinforcement learning
- mathematical optimization
- hybrid policies

**Generative AI**
- incident explanation
- supply-chain state summarization
- operator investigation assistance
- human-readable decision explanations

> LLMs should **support the operational system**, not merely be a chatbot bolted onto the app.

**How to do it (practical, hackathon-sized):**
- *Forecast:* moving average / exponential smoothing / simple regression on `demand-history` → hours-to-stockout = current inventory ÷ forecast demand rate.
- *Detection:* z-score / rolling-window threshold on demand and inventory changes.
- *Allocation:* priority-based / greedy heuristic (or LP with a solver) that moves fuel from depots with surplus to stations at risk, respecting route availability and capacity.
- *GenAI (optional):* an LLM that turns the structured alert/recommendation into a plain-language explanation.
- Always keep a **rule-based fallback** (needed for resilience below).

---

## 10. Reinforcement Learning (OPTIONAL)

If used, formulate as:

- **State:** inventory, demand, predicted shortage, available supply, route availability
- **Action:** allocate quantity, select destination, select route, delay allocation
- **Reward:** reduce unmet demand, reduce transport cost, reduce stockouts, maintain service level

**Rule:** if you use RL, you must **demonstrate why it beats a reasonable rule-based/heuristic baseline.** Otherwise, skip it.

---

## 11. Decision Support (Inspectable Recommendations)

Important recommendations must be **inspectable**. Example from the brief:

```
ALERT
Station: DHAKA-021
Fuel: Diesel

Projected Stockout: 6.2 hours
Current Inventory:  8,400 L
Expected Demand:    11,900 L

Recommended Allocation:
5,000 L from DEPOT-03

Expected Result:
Stockout risk reduced 72% → 19%
```

Where appropriate, show:
- **why** an area is at risk,
- **which signals** influenced the recommendation,
- **expected impact**,
- **confidence / uncertainty**,
- **alternative actions**.

Human operators must remain able to inspect important decisions (and, per guardrails, **review consequential decisions**).

---

## 12. Crisis and Event Handling

Organizers may change the simulated environment during the hackathon.

| Scenario | Example Condition | What Your System Should Show |
|---|---|---|
| Shipment delay | Incoming fuel arrives later than expected | Warning, shortage impact, decision response, recovery |
| Demand spike | One or more regions have elevated demand | Risk change, forecast/detection response, allocation adaptation |
| Depot constraint | Inventory or capacity reduced | Constraint handling, reallocation, service impact |
| Regional disruption | A route/region temporarily unavailable | Alternative allocation and recovery behavior |
| Combined crisis | Two or more disruptions together | End-to-end resilience and failure boundaries |

Demonstrate how your system **detects, evaluates, responds, explains, and monitors recovery.**

**How to do it:** Poll `GET /v1/events` (plus `/v1/stations`, `/v1/routes`, `/v1/supply-arrivals`) after every `simulation.tick` SSE hint — SSE does **not** announce crisis events. On a new/active event, re-run risk detection + allocation; show a banner on the UI; log the event and the system response; show recovery metrics afterwards. Note: `shipment_delay` and `supply_shortfall` are one-shot (not auto-undone), while demand spike, route disruption, station outage and depot constraint revert when they resolve. To rehearse, inject events with `POST /admin/events`.

---

## 13. Application Resilience

Define what happens when something goes wrong:

| Failure | Required Behavior |
|---|---|
| ML model unavailable | → **Fallback allocation policy** |
| Invalid simulator response | → **Reject input + raise alert** |
| Prediction confidence too low | → **Human review requested** |
| Backend dependency unavailable | → **Retry / cached state / degraded mode** |

Encouraged mechanisms: fallback logic, graceful degradation, retries, timeout handling, health checks, cached state, validation, circuit breakers, rollback.

> Sophisticated fault-tolerance infrastructure is NOT mandatory — **clear, demonstrable behavior matters more.**

**How to do it:** 
- For the *simulator-dependency* failures, use the simulator's own `POST /admin/faults` (`unavailable`, `error_rate`, `latency`, `stale_data`, `stream_disconnect`) and `POST /admin/faults/clear` — no need to build this yourself. Handle all five: backoff + retry, circuit breaker, cached last-known-good state, stale-data badge (`X-Simulator-Stale: true`), SSE reconnect + REST re-sync.
- For *your own* services (prediction/decision engine), build a "chaos" toggle/endpoint (e.g. `POST /admin/fail/{service}` on your backend, restricted) or just `docker stop` the container, so you can show the UI switching to the fallback policy / degraded mode with an alert.
- Invalid simulator response → reject + alert; low confidence → human review flag.

---

## 14. DevOps Requirement

- **Minimum:** a reproducible launch, e.g.

```bash
docker compose up
```
  or an equivalent documented deployment process.

- Demonstrate a basic delivery workflow:

```
Source Code → Build → Test → Package → Deploy → Health Check → Running Application
```

- **CI/CD strongly encouraged:** GitHub Actions, GitLab CI, Jenkins, or equivalent.

**How to do it:**
- One `docker-compose.yml` with services: frontend, backend API, prediction/decision service, database, (optional) Redis, Prometheus, Grafana, Loki.
- `.env.example` for configuration (no real secrets committed).
- GitHub Actions workflow: lint → test → build Docker images → (push image) → deploy/compose up → hit `/health`.
- Health check in each container (`HEALTHCHECK` / compose `healthcheck`).

### Advanced DevOps (optional — only if it improves your solution)
Kubernetes, Helm, Infrastructure as Code, Terraform, GitOps, automated rollback, blue/green deployment, canary deployment, autoscaling, distributed services, service discovery, queue-based processing.

> Do not add infrastructure complexity unless it genuinely helps.

---

## 15. Observability Requirement

You must be able to show what the system is doing.

| Layer | Examples |
|---|---|
| Application | request rate, latency, error rate, service availability |
| System | CPU, memory, resource utilization |
| Intelligence | prediction error, model confidence, shortage-alert rate, decision frequency, fallback activation |
| Logs | important actions, integration failures, decision events, recoveries |

- Distributed tracing is optional.
- Suggested tools: **Prometheus, Grafana, OpenTelemetry, Loki, ELK, Jaeger** (or equivalents). Free to choose.

**How to do it:** Expose `/metrics` from the backend (Prometheus client), scrape with Prometheus, build a Grafana dashboard (request rate, p95 latency, error rate, CPU/mem via cAdvisor or node-exporter, custom counters for alerts/decisions/fallbacks), use structured JSON logs.

---

## 16. Health and Status

Expose health of important components. Example from the brief:

```
SYSTEM STATUS
Backend API          Healthy
Database             Healthy
Fuel Simulator       Healthy
Prediction Service   Healthy
Decision Engine      Healthy

p95 Latency          164 ms
Error Rate           0.4%
```

Judges must be able to tell whether the system itself is healthy → build a **System Status page** in the UI backed by `/health` endpoints.

---

## 17. Data

- Primary data comes from the **organizer-provided simulator**.
- You may also use public datasets, synthetic data, derived features, generated historical data, or extra context — **document any external/generated data**.
- **Focus your time on building.** You are not required to create a whole fuel dataset from scratch.

---

## 18. Load Testing

Load-test **at least one meaningful application path**: prediction API, decision API, simulator integration, dashboard backend, or an end-to-end decision request.

Report relevant measurements:
- average latency
- p50 latency
- p95 latency
- p99 latency (where available)
- throughput
- error rate
- concurrency
- resource usage

> Emphasis: understand the **behavior and limits** of your system, not hit an arbitrary benchmark.

**How to do it:** Use k6, Locust, or Apache Bench/hey. Define the workload (e.g. 50 concurrent users for 2 min on `POST /decide`), record the results table, screenshot Grafana during the test, and note where it starts degrading.

---

## 19. Security and Engineering Hygiene (minimum)

- do not hard-code secrets
- validate external input
- handle failed requests appropriately
- document required configuration
- avoid exposing credentials
- restrict sensitive operator actions where appropriate

Enterprise-grade security is **not** expected.

---

## 20. Required Deliverables (MUST HAVE)

| # | Deliverable | Details |
|---|---|---|
| 1 | Working Application | Runnable end-to-end platform |
| 2 | Source Repository | Code, setup instructions, dependencies, deployment instructions |
| 3 | Simulator Integration | Must interact with the official BUP Fuel Supply Simulator |
| 4 | Intelligence Component | At least one meaningful AI/ML/optimization/detection/decision-support capability |
| 5 | Operator Interface | Usable interface with meaningful operational info |
| 6 | Architecture Diagram | simulator → data/backend → intelligence → decision → application → monitoring |
| 7 | Deployment | Reproducible deployment method |
| 8 | Observability Evidence | Logs, metrics, dashboards, alerts, or equivalent |
| 9 | Resilience Demonstration | Evidence of how the app responds to at least one meaningful failure |
| 10 | Load-Test Evidence | Workload definition + measured results |
| 11 | Final Demo | Live or judge-supervised demonstration |

## 21. Recommended Deliverables (nice to have)

- CI/CD
- automated tests
- experiment tracking
- model versioning
- decision audit history
- deployment versioning
- simulation replay
- scenario configuration
- automated fallback
- rollback

## 22. Optional Advanced Work

reinforcement learning · multi-agent decision systems · optimization + ML hybrids · uncertainty-aware allocation · counterfactual simulation · automated incident detection · policy rollback · drift detection · event-driven architecture · streaming systems · Kubernetes deployment · autoscaling · generative-AI operations assistants

> **Complexity itself will not guarantee a higher score.** The implementation must meaningfully contribute to the solution.

---

## 23. Suggested Demonstration Story (Plan Your Demo Around This)

1. Normal operations
2. Operator dashboard
3. Demand starts increasing
4. System detects risk
5. Intelligence layer predicts shortage
6. Allocation recommendation generated
7. Operator inspects recommendation
8. Allocation is simulated
9. Crisis event occurs
10. System adapts
11. Application or dependency failure is injected
12. Monitoring detects failure
13. Fallback / recovery activates
14. Operations continue

---

## 24. Evaluation Criteria (How You Are Scored)

| Criterion | Weight | What Is Assessed |
|---|---|---|
| Working Product & User Experience | **20%** | Functional app, operational workflow, usability, completeness |
| Intelligence & Decision Quality | **20%** | Usefulness and quality of AI/ML/optimization/detection; appropriate methodology |
| Architecture & Integration | **15%** | Backend engineering, simulator integration, component design, technical coherence |
| DevOps & Engineering Quality | **15%** | Deployment, automation, testing, maintainability, engineering practices |
| Resilience & Incident Response | **10%** | Failure handling, crisis response, fallback behavior, recovery |
| Observability & Performance | **10%** | Monitoring, metrics, logs, health visibility, load testing |
| Demo & Problem Understanding | **10%** | Clear explanation, understanding of constraints, effective demonstration |
| **Total** | **100%** | |

**Takeaway:** 40% is product + intelligence; **50% is engineering/DevOps/resilience/observability/demo**. A simple model inside a well-engineered, observable, resilient system beats a fancy model in a fragile one.

---

## 25. Constraints and Guardrails

- operate **only** against the simulation environment
- do **not** interact with real fuel infrastructure
- do **not** execute real purchases or dispatches
- do **not** use real credentials or private operational systems
- **distinguish simulated results from real-world fuel conditions** (label the UI as "Simulated")
- **document important assumptions**
- **preserve human review** for consequential simulated decisions (operator approves before `POST /allocations`)

---

## 26. Success Criteria

```
Useful Application
+ Meaningful Intelligence
+ Reliable Backend
+ Deployment
+ Observability
+ Resilience
+ Measured Performance
= Operational AI System
```

The strongest solutions are **not** the most complicated model — they turn intelligence into a **working engineered system**.

---

## 27. Final Challenge Statement

> Build an intelligent Fuel Supply Operations Platform that can **observe** a simulated fuel network, **identify** emerging risks, **recommend or simulate** operational decisions, **withstand** disruptions, and remain **observable and usable when components fail**.

Integrate with the official BUP Fuel Supply Simulator and build the application, backend, intelligence layer, deployment workflow, and operational tooling around it. **During the hackathon, the environment may change.**

---

# Appendix A — Suggested Architecture

```
┌──────────────────┐
│ BUP Fuel Simulator│  (organizer image, :8000, /v1 REST + SSE)
└────────┬─────────┘
         │ REST poll + SSE hints (timeouts, retries, validation, circuit breaker)
┌────────▼─────────┐        ┌───────────────┐
│ Backend API      │◄──────►│ Database      │ (snapshots, decisions, audit)
│ + Simulator client│        └───────────────┘
└───┬──────────┬───┘
    │          │
┌───▼────┐ ┌───▼────────────┐
│Prediction│ │ Decision Engine │ (optimizer/heuristic + fallback)
│/Detection│ └───┬────────────┘
└───┬────┘     │
    └────┬─────┘
         │
┌────────▼─────────┐        ┌──────────────────────────┐
│ Operator Web UI  │        │ Monitoring: Prometheus,   │
│ (dashboard,      │        │ Grafana, Loki, health     │
│ alerts, approve) │        │ endpoints                 │
└──────────────────┘        └──────────────────────────┘
```

# Appendix B — 8-Hour Plan for a Team of 4 (Suggestion)

> The brief itself doesn't specify the duration or team split; adjust to the actual event timing.

| Role | Focus |
|---|---|
| **A — Backend/Integration** | Simulator client, DB, REST API, validation, retries/caching, `/health` |
| **B — Intelligence** | Forecast + detection + allocation heuristic/optimizer + fallback policy + explanations |
| **C — Frontend** | Dashboard, alerts, recommendation inspect/approve, history, status page |
| **D — DevOps** | Docker/compose, CI/CD, Prometheus/Grafana/Loki, load test, failure-injection toggle, README |

| Time | Milestone |
|---|---|
| Hour 0–1 | Start the simulator (`docker compose up`), skim `/docs`, agree on API contracts and data schema, repo + compose skeleton (simulator as a service), CI stub |
| Hour 1–3 | Simulator client working, first dashboard view, basic forecast + risk alert |
| Hour 3–5 | Allocation recommendation + inspect/simulate/approve flow, metrics + Grafana, health page |
| Hour 5–6 | Event handling (delay/spike/disruption), fallback + degraded mode, failure injection |
| Hour 6–7 | Load test + evidence, architecture diagram, README, CI green |
| Hour 7–8 | Demo rehearsal following the 14-step story, fix bugs, freeze code |

# Appendix C — Final Submission Checklist

- [ ] `docker compose up` launches everything from a clean clone
- [ ] Simulator image `asifmahmoud414/bup-fuel-supply-simulator:1.0.0` pulled and cached locally; no custom simulator built
- [ ] Integrated with the **official** simulator APIs (`/v1/*` reads, SSE, `POST /v1/allocations` with idempotency keys)
- [ ] Simulator faults handled (`unavailable`, `error_rate`, `latency`, `stale_data`, `stream_disconnect`) and 409 allocation errors handled/explained
- [ ] Ground-truth KPIs shown from `/v1/metrics` (service level, allocation failures); policy compared against a baseline via deterministic reset + step
- [ ] Operator UI: inventory, alerts, projected risk, recommendation + expected impact, history
- [ ] At least one intelligence capability + fallback policy
- [ ] Explainable alert (risk reason, signals, impact, confidence, alternatives)
- [ ] Crisis events handled (delay, spike, depot constraint, regional disruption, combined)
- [ ] Failure handling shown: ML down, invalid simulator response, low confidence, backend dependency down
- [ ] Metrics + logs + dashboard + health/status page
- [ ] Load test executed and results documented (avg, p50, p95, p99, throughput, error rate, concurrency, resource usage)
- [ ] No hard-coded secrets; `.env.example`; input validation; config documented
- [ ] Architecture diagram included
- [ ] Assumptions and any external/generated data documented
- [ ] UI clearly labeled as **simulated**; human approval for consequential decisions
- [ ] CI/CD pipeline (Build → Test → Package → Deploy → Health Check)
- [ ] Demo rehearsed with the 14-step story, including live failure injection