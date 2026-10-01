/**
 * Display formatters shared between pages. Pure functions, no imports.
 *
 * `lib/data.ts` previously hardcoded display strings like "5,000 L" inline.
 * Now the backend returns raw numbers and these helpers render them.
 */

const NUM = new Intl.NumberFormat('en-US');

export function fmtLiters(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${NUM.format(Math.round(n))} L`;
}

export function fmtPercent(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  // Accepts either 0..100 (already percentage) or 0..1 (ratio). Auto-detect.
  const pct = n <= 1 ? n * 100 : n;
  return `${pct.toFixed(digits)}%`;
}

export function fmtTick(n: number | null | undefined): string {
  if (n == null) return '—';
  return `Tick ${NUM.format(n)}`;
}

export function fmtTickPadded(n: number | null | undefined): string {
  if (n == null) return '—';
  return String(n).padStart(3, '0');
}

/** Backend `sim_time` is an ISO timestamp (e.g. "2026-01-01T10:45:00"). Returns "10:45 AM". */
export function fmtSimTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** "Today, 10:42" or "Yesterday, 14:08" or "Mar 4, 09:00" depending on age. */
export function fmtRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = now - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtLitersPerTick(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${NUM.format(Math.round(n))} L / tick`;
}

/** Title-case the backend fuel keys for display ("DIESEL" → "Diesel"). */
export function fmtFuel(key: string | null | undefined): string {
  if (!key) return '—';
  const lower = key.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export const FUEL_KEYS = ['DIESEL', 'PETROL', 'OCTANE'] as const;
export const FUEL_DISPLAY = ['Diesel', 'Petrol', 'Octane'] as const;
export type FuelKey = (typeof FUEL_KEYS)[number];

/** Map backend's {DIESEL, PETROL, OCTANE} object → {Diesel, Petrol, Octane} object. */
export function mapFuelObject<T>(
  obj: Record<string, T> | null | undefined,
): Record<(typeof FUEL_DISPLAY)[number], T | undefined> {
  const out: Record<string, T | undefined> = {};
  for (const k of FUEL_KEYS) {
    const display = FUEL_DISPLAY[FUEL_KEYS.indexOf(k)];
    out[display] = obj?.[k];
  }
  return out as Record<(typeof FUEL_DISPLAY)[number], T | undefined>;
}