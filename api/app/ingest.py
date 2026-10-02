"""Background ingest loop.

Bootstrap: GET instance/regions/depots/stations/routes/supply/events/allocations/metrics.
On every tick (driven by SSE hint, or by a periodic poll in mock mode):
  1. Re-fetch state via REST.
  2. Build a Snapshot row (one per tick).
  3. Run alert detection.
  4. Update Prometheus gauges.

Also exposes `latest_snapshot()` for route handlers.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from . import alerts as alerts_mod
from .config import settings
from .db import SessionLocal, init_db
from .metrics import (
    CIRCUIT_STATE,
    SIMULATOR_LATENCY,
    SIMULATOR_REQUESTS,
    SNAPSHOT_AGE_TICKS,
    SSE_CONNECTED,
    STALE_DATA,
)
from .models import Snapshot, SystemEvent
from .simulator.client import (
    FaultInjected,
    SimulatorError,
    TransientUnavailable,
    clear_stale_flag,
    is_data_stale,
    simulator_client,
)
from .simulator.sse import SSEConsumer

log = logging.getLogger(__name__)


class StateStore:
    """Holds the latest fetched snapshot in memory for fast reads."""

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.last_tick: int | None = None
        self.last_sim_time: str | None = None
        self.last_status: str | None = None
        self.last_snapshot: dict[str, Any] = {}
        self.last_metrics: dict[str, Any] = {}
        self.stale: bool = False


STORE = StateStore()


# ---- helpers -----------------------------------------------------------------


async def _timed(endpoint: str, coro):
    """Wrap a simulator call with metrics + outcome classification."""
    import time
    start = time.monotonic()
    try:
        result = await coro
        SIMULATOR_LATENCY.labels(endpoint=endpoint).observe(time.monotonic() - start)
        SIMULATOR_REQUESTS.labels(endpoint=endpoint, outcome="ok").inc()
        return result, None
    except FaultInjected as exc:
        SIMULATOR_REQUESTS.labels(endpoint=endpoint, outcome="fault_injected").inc()
        return None, exc
    except TransientUnavailable as exc:
        SIMULATOR_REQUESTS.labels(endpoint=endpoint, outcome="transient").inc()
        return None, exc
    except SimulatorError as exc:
        SIMULATOR_REQUESTS.labels(endpoint=endpoint, outcome="error").inc()
        return None, exc
    except Exception as exc:
        SIMULATOR_REQUESTS.labels(endpoint=endpoint, outcome="error").inc()
        return None, exc


async def _log_event(component: str, level: str, message: str, payload: dict | None = None) -> None:
    def _write() -> None:
        with SessionLocal() as s:
            s.add(SystemEvent(component=component, level=level, message=message, payload=payload))
            s.commit()
    try:
        await asyncio.to_thread(_write)
    except Exception as exc:
        log.warning("ingest.system_event.write_failed", extra={"error": str(exc)})


# ---- snapshot building -------------------------------------------------------


async def build_snapshot() -> dict[str, Any] | None:
    """Fetch the current world and assemble a snapshot dict.

    Returns None if everything failed (callers should keep the previous
    snapshot and surface a 'degraded' banner).
    """
    results: dict[str, tuple[Any, Exception | None]] = {}
    for ep, fn in [
        ("instance", simulator_client.get_instance),
        ("regions", simulator_client.get_regions),
        ("depots", simulator_client.get_depots),
        ("stations", simulator_client.get_stations),
        ("routes", simulator_client.get_routes),
        ("supply", simulator_client.get_supply_arrivals),
        ("events", simulator_client.get_events),
        ("allocations", simulator_client.get_allocations),
        ("metrics", simulator_client.get_metrics),
    ]:
        value, err = await _timed(ep, fn())
        results[ep] = (value, err)

    first_err = next((err for _, err in results.values() if err), None)
    if first_err and all(err for _, err in results.values()):
        log.warning("ingest.snapshot.total_failure", extra={"error": str(first_err)})
        return None

    snapshot: dict[str, Any] = {}
    for k, (v, err) in results.items():
        if v is not None:
            snapshot[k] = v
        elif err:
            # Use cached value where possible; the client already does this,
            # but if the error is fatal here, leave it out.
            log.debug("ingest.partial", extra={"endpoint": k, "error": str(err)})

    # Read stale flag AFTER all GETs have run, so any 200+stale-header
    # observations have been recorded by RealClient._get_cached. Then
    # reset for the next cycle.
    stale_flag = is_data_stale()
    clear_stale_flag()

    inst = snapshot.get("instance", {}) or {}
    STORE.last_tick = inst.get("tick", STORE.last_tick)
    STORE.last_sim_time = inst.get("sim_time", STORE.last_sim_time)
    STORE.last_status = inst.get("status", STORE.last_status)
    STORE.last_snapshot = snapshot
    STORE.last_metrics = snapshot.get("metrics", {})
    STORE.stale = stale_flag
    STALE_DATA.set(1 if stale_flag else 0)
    return snapshot


async def persist_snapshot(snapshot: dict[str, Any]) -> None:
    tick = snapshot.get("instance", {}).get("tick")
    if tick is None:
        return

    def _write() -> None:
        with SessionLocal() as s:
            row = s.get(Snapshot, tick)
            if row is None:
                row = Snapshot(tick=tick)
            row.sim_time = snapshot.get("instance", {}).get("sim_time")
            row.status = snapshot.get("instance", {}).get("status")
            row.stations = snapshot.get("stations")
            row.depots = snapshot.get("depots")
            row.routes = snapshot.get("routes")
            row.supply_arrivals = snapshot.get("supply")
            row.allocations = snapshot.get("allocations")
            row.events = snapshot.get("events")
            row.metrics = snapshot.get("metrics")
            row.stale = STORE.stale
            s.merge(row)
            s.commit()

    try:
        await asyncio.to_thread(_write)
    except Exception as exc:
        log.warning("ingest.snapshot.persist_failed", extra={"error": str(exc), "type": type(exc).__name__})


# ---- main loop ---------------------------------------------------------------


async def _on_sse_event(ev: dict) -> None:
    etype = ev.get("event")
    if etype == "simulation.tick":
        await refresh_once()


async def refresh_once() -> dict[str, Any] | None:
    snapshot = await build_snapshot()
    if snapshot is None:
        return None
    await persist_snapshot(snapshot)
    tick = snapshot.get("instance", {}).get("tick")
    if tick is not None and STORE.last_tick is not None:
        SNAPSHOT_AGE_TICKS.set(0)
    try:
        await asyncio.to_thread(alerts_mod.recompute_alerts, snapshot)
    except Exception as exc:
        import traceback
        log.warning("ingest.alerts.failed: %s\n%s", exc, traceback.format_exc())
    return snapshot


async def run_ingest_loop() -> None:
    """Long-running task. Bootstrap, then drive on SSE (real) or polling (mock)."""
    init_db()
    await _log_event("ingest", "INFO", "Ingest loop started", {"mode": "mock" if settings.is_mock else "real"})
    await refresh_once()
    SSE_CONNECTED.set(0)

    sse = SSEConsumer(on_event=_on_sse_event)
    if not settings.is_mock:
        await sse.start()

    poll = settings.poll_interval_seconds
    try:
        while True:
            await asyncio.sleep(poll)
            if settings.is_mock:
                await refresh_once()
            else:
                # Safety-net poll (SSE may have silently dropped)
                sse_state = 1 if sse.connected else 0
                SSE_CONNECTED.set(sse_state)
                # Detect circuit-breaker state (mirror gauge)
                from .simulator.client import CB
                CIRCUIT_STATE.set(1 if CB.is_open else 0)
                await refresh_once()
    except asyncio.CancelledError:
        pass
    finally:
        await sse.stop()
        await _log_event("ingest", "INFO", "Ingest loop stopped")
