// FuelOps single-decision smoke test (k6).
//
// What this script does:
//   Exercises the full happy path ONE time, end-to-end, against the running
//   API + simulator. Used as a "did the wiring stay sane?" smoke check after
//   any change, and as the second half of the load test suite (the heavy
//   read-loop test is `decision-path.js`; this one covers the write path).
//
// Steps:
//   1. POST /api/recommendations/refresh      →  create fresh recs
//   2. GET  /api/recommendations              →  pick the first PENDING id
//   3. POST /api/recommendations/{id}/simulate →  compute expected before/after
//   4. POST /api/recommendations/{id}/approve  →  commit (calls simulator /v1)
//   5. GET  /api/decisions                    →  confirm a row exists
//
// The approve is idempotent — re-running with the same idempotency_key
// returns the original allocation. We pass an explicit key per run so this
// script is safe to re-execute.
//
// How to run:
//   k6 run loadtest/single-decision.js
//   k6 run -e BASE_URL=http://localhost:8080 loadtest/single-decision.js

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const OPERATOR = __ENV.OPERATOR || 'loadtest-operator';
// `Date.now()` is captured at module load. Combined with __VU/__ITER (which
// are only valid inside `default()`), each invocation gets a unique key.
// Date.now is set as the prefix so a long-running batch stays monotonic.
const TS = Date.now();

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    // We're hitting live-write paths against the simulator; allow a bit more
    // headroom than the read-loop test.
    'http_req_failed': ['rate<0.05'],
    'http_req_duration': ['p(95)<2000'],
  },
};

export default function () {
  // Build a run-unique idempotency key inside the function — `__ITER` is only
  // valid in the iteration context, and we want each iteration to have its
  // own key so re-running this script never collides with prior allocations.
  const KEY = `k6-${TS}-${__VU}-${__ITER}`;

  // 1. POST /api/recommendations/refresh
  let res = http.post(
    `${BASE_URL}/api/recommendations/refresh`,
    null,
    { headers: { 'Accept': 'application/json' } },
  );
  check(res, {
    'refresh status is 200 or 503': (r) => r.status === 200 || r.status === 503,
  });
  if (res.status === 503) {
    console.warn('simulator not ready yet; rerun once a snapshot is in store');
    return;
  }
  sleep(0.5);

  // 2. GET /api/recommendations → first id
  res = http.get(`${BASE_URL}/api/recommendations`, {
    headers: { 'Accept': 'application/json' },
  });
  check(res, { 'recommendations status 200': (r) => r.status === 200 });

  const recs = res.json();
  if (!Array.isArray(recs) || recs.length === 0) {
    console.warn('no recommendations to act on; nothing to smoke-test');
    return;
  }
  const rec = recs.find((r) => r.status === 'PENDING') || recs[0];
  const recId = rec.id;
  console.log(`picked recommendation ${recId}, station=${rec.station_id}, fuel=${rec.fuel_type}`);
  sleep(0.5);

  // 3. POST /api/recommendations/{id}/simulate
  res = http.post(
    `${BASE_URL}/api/recommendations/${recId}/simulate`,
    null,
    { headers: { 'Accept': 'application/json' } },
  );
  check(res, {
    'simulate status 200': (r) => r.status === 200,
    'simulate has before/after': (r) => {
      const b = r.json();
      return b && b.before && b.after;
    },
  });
  sleep(0.5);

  // 4. POST /api/recommendations/{id}/approve
  const body = JSON.stringify({
    operator: OPERATOR,
    idempotency_key: KEY,
  });
  res = http.post(
    `${BASE_URL}/api/recommendations/${recId}/approve`,
    body,
    { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } },
  );
  check(res, {
    'approve status 200 or 409 (already decided)': (r) => r.status === 200 || r.status === 409,
    'approve has idempotency_key': (r) => {
      const j = r.json();
      return j && j.detail && j.detail.idempotency_key;
    },
  });
  sleep(0.5);

  // 5. GET /api/decisions → confirm a row exists for our recommendation
  res = http.get(`${BASE_URL}/api/decisions`, {
    headers: { 'Accept': 'application/json' },
  });
  check(res, { 'decisions status 200': (r) => r.status === 200 });

  const decisions = res.json();
  const found = Array.isArray(decisions) && decisions.some((d) => d.recommendation_id === recId);
  check(found, { 'decision row exists for our recommendation': (v) => v });
}