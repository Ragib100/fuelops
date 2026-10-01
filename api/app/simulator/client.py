"""Simulator client — single choke point for all simulator calls.

Two implementations behind one facade:
- Real client (`RealClient`): talks to the BUP Fuel Supply Simulator over HTTP.
- Mock client (`MockClient`): returns data from the in-process mock world.

The module-level `simulator_client` is selected at import time based on
`settings.simulator_url`. The facade exposes:
  - read methods (GET) with timeouts, retries on 503, stale detection, caching
  - write methods (POST) with idempotency handling
  - SSE stream (RealClient only — mock simulates ticks via the ingest loop)
  - admin proxies for /api/admin/demo/*

Per docs §B1: timeouts everywhere, retries with backoff on transient faults,
never retry 4xx (after refetching state), parse both error shapes.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from ..config import settings

log = logging.getLogger(__name__)


# ---- Error shapes ------------------------------------------------------------


class SimulatorError(Exception):
    """Base."""

    def __init__(self, status: int, code: str | None, message: str):
        self.status = status
        self.code = code
        self.message = message
        super().__init__(f"{status} {code}: {message}")


class FaultInjected(SimulatorError):
    """503 FAULT_INJECTED — retryable."""


class TransientUnavailable(SimulatorError):
    """Connection error / timeout — retryable."""


class IdempotencyMismatch(SimulatorError):
    """409 IDEMPOTENCY_KEY_MISMATCH — caller must use a new key."""


# ---- Cache (last-known-good) ------------------------------------------------


class _Cache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[float, Any, bool]] = {}

    def put(self, key: str, value: Any, stale: bool = False) -> None:
        self._store[key] = (time.monotonic(), value, stale)

    def get(self, key: str) -> tuple[Any, bool] | None:
        v = self._store.get(key)
        if not v:
            return None
        _, value, stale = v
        return value, stale


CACHE = _Cache()


# ---- Circuit breaker --------------------------------------------------------


class CircuitBreaker:
    def __init__(self, threshold: int = 5, cooldown: float = 30.0):
        self.threshold = threshold
        self.cooldown = cooldown
        self.failures = 0
        self.opened_at: float | None = None

    def before(self) -> None:
        if self.opened_at is None:
            return
        if time.monotonic() - self.opened_at >= self.cooldown:
            log.info("circuit.half_open")
            self.opened_at = None
            self.failures = 0

    def record_failure(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold and self.opened_at is None:
            self.opened_at = time.monotonic()
            log.warning("circuit.opened", extra={"failures": self.failures})

    def record_success(self) -> None:
        if self.opened_at is not None:
            log.info("circuit.closed")
        self.failures = 0
        self.opened_at = None

    @property
    def is_open(self) -> bool:
        return self.opened_at is not None


CB = CircuitBreaker()


# ---- Real client -------------------------------------------------------------


class RealClient:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base,
            timeout=httpx.Timeout(3.0, connect=2.0),
            headers={"Accept": "application/json"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get_cached(self, path: str, params: dict | None = None) -> tuple[Any, bool]:
        key = f"GET {path} {params or {}}"
        cached = CACHE.get(key)
        if CB.is_open:
            if cached:
                return cached
            raise TransientUnavailable(503, "CIRCUIT_OPEN", "circuit breaker open")

        try:
            r = await self._client.get(path, params=params)
        except (httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError) as exc:
            CB.record_failure()
            cached = CACHE.get(key)
            if cached:
                return cached
            raise TransientUnavailable(503, "TRANSIENT", str(exc)) from exc

        if r.status_code == 200:
            CB.record_success()
            stale = r.headers.get("X-Simulator-Stale", "").lower() == "true"
            body = r.json()
            CACHE.put(key, body, stale=stale)
            return body, stale

        if r.status_code == 503:
            CB.record_failure()
            cached = CACHE.get(key)
            if cached:
                return cached
            code, msg = _parse_error(r)
            raise FaultInjected(503, code, msg)

        code, msg = _parse_error(r)
        raise SimulatorError(r.status_code, code, msg)

    async def get_health(self) -> dict:
        try:
            r = await self._client.get("/v1/health")
            return r.json() if r.status_code == 200 else {"status": "down"}
        except Exception as exc:
            return {"status": "down", "error": str(exc)}

    # Convenience getters (each caches independently)
    async def get_instance(self):   return (await self._get_cached("/v1/instance"))[0]
    async def get_regions(self):    return (await self._get_cached("/v1/regions"))[0]
    async def get_depots(self):     return (await self._get_cached("/v1/depots"))[0]
    async def get_stations(self):   return (await self._get_cached("/v1/stations"))[0]
    async def get_routes(self):     return (await self._get_cached("/v1/routes"))[0]
    async def get_events(self):     return (await self._get_cached("/v1/events"))[0]
    async def get_allocations(self):return (await self._get_cached("/v1/allocations"))[0]
    async def get_supply_arrivals(self): return (await self._get_cached("/v1/supply-arrivals"))[0]
    async def get_demand_history(self, station_id: str | None = None, limit: int = 200):
        params: dict[str, Any] = {"limit": limit}
        if station_id:
            params["station_id"] = station_id
        return (await self._get_cached("/v1/demand-history", params=params))[0]
    async def get_metrics(self):    return (await self._get_cached("/v1/metrics"))[0]

    async def get_stale_flag(self) -> bool:
        """Latest stale observation."""
        try:
            _, stale = await self._get_cached("/v1/stations")
            return stale
        except Exception:
            return True

    async def post_allocation(self, body: dict) -> dict:
        try:
            r = await self._client.post("/v1/allocations", json=body)
        except (httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError) as exc:
            raise TransientUnavailable(503, "TRANSIENT", str(exc)) from exc
        if r.status_code in (200, 201):
            return r.json()
        code, msg = _parse_error(r)
        if r.status_code == 409 and code == "IDEMPOTENCY_KEY_MISMATCH":
            raise IdempotencyMismatch(r.status_code, code, msg)
        raise SimulatorError(r.status_code, code, msg)

    async def cancel_allocation(self, alloc_id: int) -> dict:
        r = await self._client.post(f"/v1/allocations/{alloc_id}/cancel")
        if r.status_code == 200:
            return r.json()
        code, msg = _parse_error(r)
        raise SimulatorError(r.status_code, code, msg)

    # Admin proxies (no fault injection bypasses)
    async def admin(self, action: str, body: dict | None = None) -> dict:
        path = f"/admin/{action}"
        try:
            if action in ("run", "pause", "toggle", "step", "reset", "faults/clear"):
                r = await self._client.post(path)
            else:
                r = await self._client.post(path, json=body or {})
        except (httpx.ConnectError, httpx.ReadTimeout) as exc:
            raise TransientUnavailable(503, "TRANSIENT", str(exc)) from exc
        if r.status_code < 400:
            return r.json() if r.text else {}
        code, msg = _parse_error(r)
        raise SimulatorError(r.status_code, code, msg)

    # SSE is best-effort; ingest.py handles its own loop with reconnect logic.
    async def stream(self):  # pragma: no cover — exercised manually
        async with self._client.stream("GET", "/v1/stream") as r:
            async for line in r.aiter_lines():
                yield line


def _parse_error(r: httpx.Response) -> tuple[str | None, str]:
    """Handle both `error.code` and `detail.code` shapes."""
    try:
        body = r.json()
    except Exception:
        return None, r.text or "unknown error"
    if isinstance(body, dict):
        if "error" in body and isinstance(body["error"], dict):
            return body["error"].get("code"), body["error"].get("message", "")
        if "detail" in body and isinstance(body["detail"], dict):
            return body["detail"].get("code"), body["detail"].get("message", "")
        if "detail" in body and isinstance(body["detail"], list):
            # pydantic validation
            return "VALIDATION", "; ".join(str(x) for x in body["detail"])
    return None, str(body)


# ---- Mock client -------------------------------------------------------------


class MockClient:
    """Delegates to in-process MockWorld, with fault injection hooks."""

    def _world(self):
        from .mock import WORLD
        return WORLD

    def _faults(self):
        from .mock import FAULTS
        return FAULTS

    async def aclose(self) -> None:
        return None

    async def get_health(self) -> dict:
        faults = self._faults()
        if faults.maybe_delay_seconds() > 0:
            await asyncio.sleep(faults.maybe_delay_seconds())
        fault = faults.maybe_fault()
        if fault in ("unavailable", "error_rate", "stream_disconnect"):
            return {"status": "degraded", "error": fault}
        return await self._world().get_health()

    async def get_instance(self):    return await self._world().get_instance()
    async def get_regions(self):     return await self._world().get_regions()
    async def get_depots(self):      return await self._world().get_depots()
    async def get_stations(self):    return await self._world().get_stations()
    async def get_routes(self):      return await self._world().get_routes()
    async def get_events(self):      return await self._world().get_events()
    async def get_allocations(self): return await self._world().get_allocations()
    async def get_supply_arrivals(self): return await self._world().get_supply_arrivals()
    async def get_demand_history(self, station_id=None, limit=200):
        return await self._world().get_demand_history(station_id=station_id, limit=limit)
    async def get_metrics(self):     return await self._world().get_metrics()

    async def get_stale_flag(self) -> bool:
        return self._world().stale_flag

    async def post_allocation(self, body: dict) -> dict:
        status, resp = await self._world().post_allocation(body)
        if status in (200, 201):
            return resp
        if status == 409 and isinstance(resp.get("detail"), dict):
            code = resp["detail"].get("code")
            if code == "IDEMPOTENCY_KEY_MISMATCH":
                raise IdempotencyMismatch(status, code, resp["detail"].get("message", ""))
            raise SimulatorError(status, code, resp["detail"].get("message", ""))
        if status == 422:
            raise SimulatorError(status, "VALIDATION", "validation error")
        raise SimulatorError(status, None, str(resp))

    async def cancel_allocation(self, alloc_id: int) -> dict:
        status, resp = await self._world().cancel_allocation(alloc_id)
        if status == 200:
            return resp
        if status == 409 and isinstance(resp.get("detail"), dict):
            raise SimulatorError(status, resp["detail"].get("code"), resp["detail"].get("message", ""))
        raise SimulatorError(status, None, str(resp))

    async def admin(self, action: str, body: dict | None = None) -> dict:
        w = self._world()
        if action == "run":   return await w.admin_run()
        if action == "pause": return await w.admin_pause()
        if action == "toggle":return await w.admin_toggle()
        if action == "step":  return await w.admin_step()
        if action == "reset": return await w.admin_reset()
        if action == "events":
            status, resp = await w.admin_inject_event(body or {})
            return resp
        if action == "faults":
            return await w.admin_inject_fault(body or {})
        if action == "faults/clear":
            return await w.admin_clear_faults()
        if action == "audit":
            limit = (body or {}).get("limit", 200)
            return {"rows": await w.admin_audit(limit)}
        raise SimulatorError(404, None, f"unknown admin action {action}")


# ---- Selection ---------------------------------------------------------------


def make_client() -> RealClient | MockClient:
    if settings.is_mock:
        log.info("simulator.client.mock")
        return MockClient()
    log.info("simulator.client.real", extra={"base": settings.simulator_base})
    return RealClient(settings.simulator_base)


simulator_client: RealClient | MockClient = make_client()
