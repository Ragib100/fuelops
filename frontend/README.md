# FuelOps Frontend

The operator dashboard for the Fuel Supply Intelligence & Resilience Platform.

This is the [Next.js 14](https://nextjs.org/) (App Router) UI that consumes the
FastAPI backend at `../api`. It renders the operator control room: live network
KPIs, station inventory, shortage alerts, fuel-shipment recommendations, an
audit trail of past decisions, and a demo controls panel for the simulator.

```
+----------+        +-----------------+        +-----------------+
|  Next.js |  HTTP  |  FuelOps API     |  HTTP  |  BUP Simulator  |
| frontend | <-----  |  (../api)       | <-----  |  (Docker)      |
+----------+   ------------------+--------------------+
                                  |
                                  | Postgres
                                  v
                          +-----------------+
                          |  snapshots /    |
                          |  alerts /       |
                          |  decisions      |
                          +-----------------+
```

---

## Table of contents

1. [What this app does (in plain English)](#1-what-this-app-does-in-plain-english)
2. [Install + run](#2-install--run)
3. [Configuration (`.env.local`)](#3-configuration-envlocal)
4. [Every page, what it shows, and where the data comes from](#4-every-page-what-it-shows-and-where-the-data-comes-from)
5. [Server actions (the buttons that change things)](#5-server-actions-the-buttons-that-change-things)
6. [How data flows through the rewrite proxy](#6-how-data-flows-through-the-rewrite-proxy)
7. [Project layout](#7-project-layout)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. What this app does (in plain English)

A control-room dashboard for a fuel-supply operator. Open it in a browser and
you see:

- **A live map of every station and depot** with current inventory %, fill bars,
  and a risk badge per station.
- **A ticker at the top** showing the current simulator tick — it bumps up
  every 15 simulated minutes when the simulator is running.
- **Alerts** when a station is projected to run dry, when a route is
  disrupted, or when a depot is constrained.
- **Recommendations** the engine has generated to fix problems (move X liters
  of fuel from depot A to station B). Each one shows the *why*, the signals it
  used, alternative routes, and confidence. You can approve or reject.
- **A history page** showing every decision you've ever made on this run, with
  the simulator's response (allocation id, fuel quantity, ETA).
- **A demo controls page** to pause / run / reset the simulator, inject crisis
  events, and trigger fault-injection scenarios.

The data on every screen comes from the backend API at request time. When you
click "Approve allocation", the frontend calls a **server action** that
forwards the request to the backend, which forwards it to the simulator, which
actually creates the fuel shipment. The whole round trip is logged.

If the backend or simulator is unreachable, the layout's degraded banner
lights up yellow and pages render whatever the last cached snapshot contained.

---

## 2. Install + run

### Prerequisites

| Thing            | Why                                | Tested version |
|------------------|------------------------------------|----------------|
| **Node.js**      | Runs the dev server / builds       | 18+ (20 OK)    |
| **pnpm** *(or npm/yarn)* | Installs dependencies      | 10.x           |
| **Backend running** | Provides all the data           | see `../api/README.md` |
| **(Optional) Simulator running** | The backend can use mock data if not, but live data is better | Docker |

### Install + start

```bash
cd frontend
pnpm install                    # or `npm install`
cp .env.example .env.local      # then edit .env.local with your values
pnpm dev                        # → http://localhost:3000
```

That's it. Open <http://localhost:3000>. Every page is server-rendered against
the live API; nothing is mock data anymore.

### Production build

```bash
pnpm build
pnpm start                       # serves the built app
```

---

## 3. Configuration (`.env.local`)

| Variable                       | Required | Default                  | What it does |
|--------------------------------|----------|--------------------------|--------------|
| `BACKEND_URL`                  | yes (for live data) | _(none)_ | Where the FastAPI backend lives. Used by server components and server actions. If unset, the frontend falls back to relative URLs (which still work if the `/api/*` rewrite proxy is active — see below). |
| `NEXT_PUBLIC_OPERATOR_TOKEN`   | yes (for demo page) | _(none)_ | Shared secret sent as `X-Operator-Token` for `/api/admin/demo/*` calls. **NEXT_PUBLIC_** prefix means it's inlined into the browser bundle. Don't put anything you wouldn't want leaked here — for the hackathon demo it's the same shared dev secret the API uses (`local-dev-token`). |

`.env.local` is gitignored by default (Next.js convention + our repo
`.gitignore` rule). `.env.example` is the committed template.

---

## 4. Every page, what it shows, and where the data comes from

| Page                  | What it shows                                                   | API call (server-side) |
|-----------------------|----------------------------------------------------------------|------------------------|
| `/` (Overview)        | KPIs, network inventory table, priority alerts, depot cards, active disruptions | `GET /api/overview`, `GET /api/alerts` |
| `/alerts`             | Filterable alert feed (Critical / Warning / Info)              | `GET /api/alerts` |
| `/recommendations`    | Each fuel-shipment recommendation with signals, alternatives, why, and an Approve / Reject button | `GET /api/recommendations` (initial); server actions for everything else |
| `/stations/[id]`      | Station detail — risk ring, inventory per fuel, forecast, incoming shipments | `GET /api/stations/{id}` |
| `/network`            | Depots, supply routes grouped by source depot, station list, resilience insight | `GET /api/routes`, `GET /api/overview` |
| `/history`            | Append-only audit trail of every approve/reject decision       | `GET /api/decisions?limit=100` |
| `/status`             | Component health (API / DB / Simulator / Decision engine / SSE), p95 latency, error rate, fallback policy state, recent system events | `GET /api/system/status` |
| `/demo`               | Run/pause/toggle/step/reset the simulator, inject crisis events, inject faults | `POST /api/admin/demo/*` (with `X-Operator-Token`) |
| `/api/health`         | Next.js route handler — returns `{status:"ok"}` (frontend liveness only) | (frontend-only) |

### Layout chrome (always visible)

- **Topbar**: breadcrumb, **simulator status pill** (LIVE / PAUSED / STALE), **tick pill**, alert count badge.
- **Sidebar**: nav grouped by Operations / Network / System, simulator status card, operator card.
- **Degraded banner**: appears above the page when the backend reports `fallback_active: true` or the simulator component is unhealthy.

---

## 5. Server actions (the buttons that change things)

Most pages just display data. Two pages have buttons that mutate server state:

| Action              | Where called from              | API call it makes                                  |
|---------------------|--------------------------------|----------------------------------------------------|
| `refreshRecommendations()` | "Generate recommendations" button on `/recommendations` | `POST /api/recommendations/refresh` |
| `approveRecommendation(id)` | "Approve allocation" button on a rec card  | `POST /api/recommendations/{id}/approve` |
| `rejectRecommendation(id)` | "Reject" button on a rec card              | `POST /api/recommendations/{id}/reject` |
| `simulateRecommendation(id)` | "Simulate" button on a rec card           | `POST /api/recommendations/{id}/simulate` |

Demo page actions (`/demo`):

| Button                | API call                                              |
|-----------------------|-------------------------------------------------------|
| Run / Pause / Toggle  | `POST /api/admin/demo/run` / `pause` / `toggle`       |
| Step back / forward   | `POST /api/admin/demo/step`                            |
| Reset run             | `POST /api/admin/demo/reset`                           |
| Inject event          | `POST /api/admin/demo/events`                          |
| Apply fault           | `POST /api/admin/demo/faults`                          |
| Clear all faults      | `POST /api/admin/demo/faults/clear`                    |

All `/api/admin/demo/*` calls include the `X-Operator-Token` header.

After any mutation, `revalidatePath()` is called so Next.js refetches the
relevant pages on the next request.

---

## 6. How data flows through the rewrite proxy

Two ways the frontend talks to the backend:

### Server-side fetches (most pages)

```ts
// inside a server component or server action
import { apiServer } from '@/lib/api';
const data = await apiServer<T>('/api/overview');
```

This reads `process.env.BACKEND_URL` and makes an absolute request directly
to the backend. Bypasses the browser entirely.

### Client-side fetches (demo page buttons, where you need the operator token)

```ts
// inside a 'use client' component
const res = await fetch('/api/admin/demo/run', {
  method: 'POST',
  headers: { 'X-Operator-Token': process.env.NEXT_PUBLIC_OPERATOR_TOKEN ?? '' },
});
```

This uses Next.js's `/api/*` rewrite (see `next.config.js`):

```js
async rewrites() {
  return process.env.BACKEND_URL
    ? [{ source: '/api/:path*', destination: `${process.env.BACKEND_URL}/api/:path*` }]
    : [];
}
```

Browser → `localhost:3000/api/admin/demo/run` → rewrite → `localhost:8080/api/admin/demo/run`. The backend URL never leaks to the client.

---

## 7. Project layout

```
frontend/
├── README.md                       # You are here
├── package.json                    # deps + scripts
├── tsconfig.json                   # strict TS, "@/*" path alias
├── next.config.js                  # /api/* rewrite proxy
├── .env.example                    # committed template
├── .env.local                      # gitignored — your local values
├── .gitignore
└── app/
    ├── layout.tsx                  # async server component — fetches /api/system/status,
    │                               #   passes tick + degraded + alertCount to <Shell>
    ├── page.tsx                    # /  (Overview)
    ├── stations/[id]/page.tsx      # /stations/[id]
    ├── alerts/
    │   ├── page.tsx                # server: fetches /api/alerts
    │   └── client.tsx              # client: filter buttons
    ├── recommendations/
    │   ├── page.tsx                # server: fetches /api/recommendations
    │   ├── client.tsx              # client: expand/approve/reject/simulate
    │   └── actions.ts              # 'use server' actions → POST to API
    ├── network/page.tsx            # /network (server)
    ├── history/page.tsx            # /history (server)
    ├── status/page.tsx             # /status (server)
    ├── demo/
    │   ├── page.tsx                # server: bootstraps initial sim state
    │   └── client.tsx              # client: all the buttons
    └── api/health/route.ts         # Next.js route handler — `{status:"ok"}`
└── components/
    ├── shell.tsx                   # App-level chrome — sidebar + topbar + degraded banner
    ├── ui.tsx                       # PageHeading, SectionTitle, Tag, StationLink
    └── actions.tsx                 # (legacy) ActionButton, FilterButtons — kept for reuse
└── lib/
    ├── api.ts                      # apiServer() + apiClient() fetch wrappers
    ├── format.ts                   # fmtLiters, fmtPercent, fmtTick, fmtSimTime, mapFuelObject
    └── data.ts                     # (stub — see comment)
```

---

## 8. Troubleshooting

**Page renders an "API offline" warning**
→ Backend is not reachable. Check `BACKEND_URL` in `.env.local`, and confirm
the API is running (`curl http://localhost:8080/health` should return `{"status":"ok",...}`).

**Status pill says "STALE DATA" or banner is yellow**
→ Backend is alive but simulator is degraded. Visit `/status` to see which
service is unhealthy. If you injected a fault from `/demo`, click "Clear all
faults" to recover.

**Clicking "Approve allocation" returns an error toast**
→ Most likely the recommendation status changed (someone else approved it, or
the simulator rejected the allocation). Refresh `/recommendations` and try a
different one. The simulator's response is shown in the toast.

**Topbar tick isn't moving**
→ Simulator is paused. Go to `/demo` and click "Run simulation" (or use the
play icon at the top of the overview strip).

**`.env.local` changes not taking effect**
→ Next.js dev server picks up `.env.local` on startup. Restart `pnpm dev`.

**`/api/*` returns 404 from the browser**
→ Either `BACKEND_URL` is unset (no rewrite registered) or the backend isn't
running. Both must be true.

---

## Cheat sheet

```bash
# Start the backend (separate terminal)
cd ../api && source .venv/bin/activate
uvicorn app.main:app --reload --port 8080

# Start the frontend
pnpm dev                                 # → http://localhost:3000
```

```bash
# Stop everything
# Ctrl+C the dev servers; backend and frontend both die cleanly
```