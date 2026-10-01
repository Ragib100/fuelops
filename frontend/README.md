# FuelOps frontend

Next.js App Router operator interface for the BUP CSE Fest 2026 fuel supply simulation.

## Run locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The interface is populated with sample data in `lib/data.ts`; no backend or simulator is called. Recommendation actions and demo controls are local previews only. Replace the sample data with the operator API once it is available.

Set `BACKEND_URL` to the FastAPI service URL to enable the `/api/*` rewrite. `GET /api/health` is a frontend liveness route.

## Included views

- `/` operations overview
- `/alerts` alert feed with severity filters
- `/recommendations` risk explanations and simulated operator actions
- `/stations/[id]` station inventory and risk detail
- `/network` depots and route availability
- `/history` decision audit trail
- `/status` component health and recent system events
- `/demo` simulator control previews

All visible operational data is illustrative and must not be treated as live simulator state.
