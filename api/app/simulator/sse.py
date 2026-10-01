"""SSE consumer with auto-reconnect.

For the real simulator, opens `/v1/stream` and dispatches each event into the
ingest loop. Reconnects on disconnect with exponential backoff (the docs say
SSE has no Last-Event-ID replay and the buffer silently drops after 200
events, so we always REST-refetch on reconnect).

For mock mode, there is no real SSE — the ingest loop advances ticks via a
configurable interval (or via admin/step).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from ..config import settings
from .client import simulator_client

log = logging.getLogger(__name__)

EventHandler = Callable[[dict], Awaitable[None]]


class SSEConsumer:
    def __init__(self, on_event: EventHandler):
        self._on_event = on_event
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self.connected = False

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="sse-consumer")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=2.0)
            except asyncio.TimeoutError:
                self._task.cancel()

    async def _run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                await self._connect_and_consume()
                backoff = 1.0
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("sse.error", extra={"error": str(exc)})
                self.connected = False
                await asyncio.wait_for(self._stop.wait(), timeout=backoff)
                backoff = min(backoff * 2, 30.0)

    async def _connect_and_consume(self) -> None:
        # Only RealClient implements `stream()`; mock mode returns immediately
        # (the ingest loop is driven by `ingest.py` polling on its own clock).
        if not hasattr(simulator_client, "stream"):
            self.connected = False
            await asyncio.sleep(60)
            return

        # httpx async streaming
        import httpx

        async with httpx.AsyncClient(
            base_url=settings.simulator_base,
            timeout=httpx.Timeout(None, connect=5.0),
        ) as client:
            async with client.stream("GET", "/v1/stream") as r:
                if r.status_code >= 400:
                    raise RuntimeError(f"SSE returned {r.status_code}")
                self.connected = True
                log.info("sse.connected")
                async for raw in r.aiter_lines():
                    if self._stop.is_set():
                        break
                    if not raw or raw.startswith(":"):
                        continue
                    # Minimal SSE parser — we only need `event:` and `data:` lines.
                    if raw.startswith("event:"):
                        ev_type = raw[6:].strip()
                    elif raw.startswith("data:"):
                        data = raw[5:].strip()
                        try:
                            import json

                            payload = json.loads(data) if data else {}
                        except Exception:
                            payload = {"raw": data}
                        try:
                            await self._on_event({"event": ev_type, "data": payload})
                        except Exception as exc:  # never let handler kill the loop
                            log.warning("sse.handler.error", extra={"error": str(exc)})
                        ev_type = ""
