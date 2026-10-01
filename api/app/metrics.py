"""Prometheus metrics exposed at /metrics."""
from __future__ import annotations

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

REGISTRY = CollectorRegistry()

REQUEST_LATENCY = Histogram(
    "fuelops_request_seconds",
    "API request latency",
    ("method", "endpoint", "status"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
    registry=REGISTRY,
)

SIMULATOR_REQUESTS = Counter(
    "fuelops_simulator_requests_total",
    "Calls to the simulator",
    ("endpoint", "outcome"),  # outcome: ok | fault_injected | transient | error
    registry=REGISTRY,
)

SIMULATOR_LATENCY = Histogram(
    "fuelops_simulator_request_seconds",
    "Simulator call latency",
    ("endpoint",),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
    registry=REGISTRY,
)

FALLBACK_ACTIVATIONS = Counter(
    "fuelops_fallback_activations_total",
    "Recommendation fallback activations",
    ("reason",),  # engine_timeout | engine_error | low_confidence
    registry=REGISTRY,
)

RECOMMENDATIONS_GENERATED = Counter(
    "fuelops_recommendations_total",
    "Recommendations generated",
    ("policy",),
    registry=REGISTRY,
)

DECISIONS_MADE = Counter(
    "fuelops_decisions_total",
    "Operator decisions",
    ("action",),  # approve | reject
    registry=REGISTRY,
)

SSE_CONNECTED = Gauge(
    "fuelops_sse_connected",
    "1 if SSE stream is connected, else 0",
    registry=REGISTRY,
)

CIRCUIT_STATE = Gauge(
    "fuelops_circuit_breaker_state",
    "1 if circuit breaker is open, else 0",
    registry=REGISTRY,
)

STALE_DATA = Gauge(
    "fuelops_simulator_stale",
    "1 if last simulator GET was flagged stale, else 0",
    registry=REGISTRY,
)

SNAPSHOT_AGE_TICKS = Gauge(
    "fuelops_snapshot_age_ticks",
    "Ticks since the last snapshot was written",
    registry=REGISTRY,
)


def render_metrics() -> tuple[bytes, str]:
    return generate_latest(REGISTRY), CONTENT_TYPE_LATEST
