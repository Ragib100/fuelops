// This file used to export hardcoded mock data (stations, depots, alerts,
// recommendations, routes, decisions, systemEvents) that powered the UI before
// the live API was wired up.
//
// All data is now fetched from the backend API at request time. Use:
//   - `apiServer(path)` from a server component / server action
//   - `apiClient(path)` from a client component (uses the Next.js /api/* rewrite)
//
// Display formatters live in `lib/format.ts`. Type helpers (Fuel etc.) also live
// there.
//
// This file is intentionally a no-op marker so that any stale imports surface
// as a TypeScript error during the migration window.

export const __deprecated_data_ts = true;
void __deprecated_data_ts;
