"""FastAPI app entry point.

- Lifespan: start ingest loop, stop on shutdown.
- CORS for the frontend.
- /metrics exposes Prometheus output.
- /health exposes a JSON liveness probe used by compose healthchecks.
- All operator routes mounted under /api/*.
"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from .config import settings
from .db import init_db, ping_db
from .ingest import run_ingest_loop
from .metrics import REQUEST_LATENCY, render_metrics
from .routes import alerts, decisions, demo, events, overview, recommendations, stations, system

# ---- logging setup -----------------------------------------------------------

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("fuelops.api")


# ---- lifespan ----------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("api.startup", extra={"mock_mode": settings.is_mock})
    init_db()
    ingest_task = asyncio.create_task(run_ingest_loop(), name="ingest-loop")
    try:
        yield
    finally:
        log.info("api.shutdown")
        ingest_task.cancel()
        try:
            await ingest_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="FuelOps API",
    version="0.1.0",
    description="Backend for the Fuel Supply Intelligence & Resilience Platform.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- request-timing middleware ----------------------------------------------


@app.middleware("http")
async def _observe_latency(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    start = time.monotonic()
    response = await call_next(request)
    elapsed = time.monotonic() - start
    endpoint = request.scope.get("route").path if request.scope.get("route") else request.url.path
    REQUEST_LATENCY.labels(
        method=request.method,
        endpoint=endpoint,
        status=str(response.status_code),
    ).observe(elapsed)
    return response


# ---- health & metrics --------------------------------------------------------


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "db": "ok" if ping_db() else "down",
        "simulator": "mock" if settings.is_mock else "real",
    }


@app.get("/metrics")
async def metrics() -> Response:
    body, content_type = render_metrics()
    return Response(content=body, media_type=content_type)


# ---- routes ------------------------------------------------------------------

app.include_router(overview.router)
app.include_router(stations.router)
app.include_router(alerts.router)
app.include_router(recommendations.router)
app.include_router(decisions.router)
app.include_router(events.router)
app.include_router(system.router)
app.include_router(demo.router)


# ---- error envelope ----------------------------------------------------------


@app.exception_handler(Exception)
async def _on_unhandled(request: Request, exc: Exception) -> Response:  # pragma: no cover
    log.exception("api.unhandled", extra={"path": request.url.path})
    return JSONResponse(
        status_code=500,
        content={"detail": {"code": "INTERNAL", "message": str(exc)}},
    )
