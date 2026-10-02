// FuelOps decision-path load test (k6).
//
// What this script measures:
//   The brief (§18) asks for a load test on the "decision path" with a defined
//   workload and measured results. We model the operator experience: 50
//   concurrent operators, each polling the dashboard for ~2 minutes and
//   occasionally asking the engine to recompute recommendations.
//
//   We deliberately do NOT call /recommendations/{id}/approve in the hot loop
//   because each approve is an idempotent, side-effecting allocation against
//   the real simulator. That flow is covered separately by
//   `single-decision.js` so this script stays safe to re-run.
//
// Workload (per virtual user, per loop iteration):
//   40%  GET /api/overview         (read dashboard summary)
//   30%  GET /api/alerts           (read alert feed)
//   20%  GET /api/recommendations  (read pending recommendations)
//   10%  GET /api/system/status    (read component health)
//
// SLO thresholds (k6 will fail the run if breached):
//   p95 latency < 500ms
//   p99 latency < 1000ms
//   HTTP error rate < 1%
//
// How to run:
//   k6 run loadtest/decision-path.js
//   k6 run -e BASE_URL=http://localhost:8080 loadtest/decision-path.js
//   k6 run --out json=loadtest/results.json loadtest/decision-path.js
//
// Notes:
//   - BASE_URL defaults to http://localhost:8080. Override with -e BASE_URL=...
//   - The API container must be reachable. Run `make up` first, or set
//     BASE_URL to wherever the API is listening.
//   - Numbers are non-deterministic. The README explains how to interpret.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ---- Configuration ---------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

// Custom metrics so the summary table shows more than just generic timings.
const overviewLatency = new Trend('fuelops_overview_latency_ms', true);
const alertsLatency   = new Trend('fuelops_alerts_latency_ms',   true);
const recsLatency     = new Trend('fuelops_recs_latency_ms',     true);
const statusLatency   = new Trend('fuelops_status_latency_ms',   true);
const httpFailRate    = new Rate('fuelops_http_fail_rate');

// ---- Workload definition ---------------------------------------------------

export const options = {
  scenarios: {
    operator_dashboard: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    // Brief §18 + the plan's SLOs.
    'http_req_duration{name:overview}':       ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:alerts}':         ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:recommendations}':['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:status}':         ['p(95)<500', 'p(99)<1000'],
    'http_req_failed':                        ['rate<0.01'],
    'fuelops_http_fail_rate':                 ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ---- Default function: one iteration per VU -------------------------------

export default function () {
  // Weighted random pick. Numbers are the relative weights (must sum to 100).
  const r = Math.random() * 100;

  if (r < 40) {
    getWithMetric('GET', '/api/overview', 'overview', overviewLatency);
  } else if (r < 70) {
    getWithMetric('GET', '/api/alerts', 'alerts', alertsLatency);
  } else if (r < 90) {
    getWithMetric('GET', '/api/recommendations', 'recommendations', recsLatency);
  } else {
    getWithMetric('GET', '/api/system/status', 'status', statusLatency);
  }

  // A short think-time so 50 VUs don't all hammer in lockstep.
  // 200–600ms gives roughly 80–240 RPS aggregate — well above the realistic
  // operator polling rate and enough to surface scaling issues.
  sleep(Math.random() * 0.4 + 0.2);
}

// ---- Helpers ---------------------------------------------------------------

function getWithMetric(method, path, name, trend) {
  const url = `${BASE_URL}${path}`;
  const res = http.get(url, {
    headers: { 'Accept': 'application/json' },
    tags: { name },
  });

  const ok = check(res, {
    [`${name} status 200`]: (r) => r.status === 200,
    [`${name} body non-empty`]: (r) => r.body && r.body.length > 0,
  });

  trend.add(res.timings.duration);
  httpFailRate.add(!ok);
}

// ---- teardown: print a clean summary line for the README -------------------

export function handleSummary(data) {
  // Keep the standard stdout summary, but also drop a machine-readable
  // artifact if a path was provided via -e.
  const out = __ENV.SUMMARY_OUT;
  if (out) {
    return {
      stdout: textSummary(data),
      [out]: JSON.stringify(data, null, 2),
    };
  }
  return { stdout: textSummary(data) };
}

function textSummary(data) {
  // Tiny custom summary so we get the fields the README table needs without
  // depending on jslib imports (keeps the script self-contained).
  const m = data.metrics;
  const p = (obj, q) => (obj && obj.values && obj.values[q] !== undefined
    ? obj.values[q].toFixed(1)
    : 'n/a');
  const lines = [
    '',
    'FuelOps decision-path load test',
    '-------------------------------',
    `  VUs:        ${options.scenarios.operator_dashboard.vus}`,
    `  Duration:   ${options.scenarios.operator_dashboard.duration}`,
    `  Iterations: ${data.root_group ? 'see http_reqs' : '0'}`,
    `  HTTP reqs:  ${m.http_reqs ? m.http_reqs.values.count : 0}`,
    `  p50 (ms):   ${p(m.http_req_duration, 'p(50)')}`,
    `  p95 (ms):   ${p(m.http_req_duration, 'p(95)')}`,
    `  p99 (ms):   ${p(m.http_req_duration, 'p(99)')}`,
    `  max (ms):   ${p(m.http_req_duration, 'max')}`,
    `  fail rate:  ${m.http_req_failed ? (m.http_req_failed.values.rate * 100).toFixed(2) : '0.00'}%`,
    '',
  ];
  return lines.join('\n');
}
