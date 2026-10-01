"""Pydantic schemas for API responses.

These are intentionally permissive — the simulator client sometimes returns
fields we don't model explicitly, and we want to pass them through. Keep the
shapes close to what the frontend already expects (see frontend/lib/data.ts).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class OverviewStation(BaseModel):
    id: str
    name: str
    short: str
    region: str
    profile: str
    status: str
    risk: str
    inventory: dict[str, float]
    capacity: dict[str, float]
    inventory_pct: dict[str, int]


class OverviewDepot(BaseModel):
    id: str
    name: str
    region: str
    status: str
    inventory_l: int
    capacity_l: int
    fill_pct: int
    dispatch_per_tick: int


class OverviewEventBanner(BaseModel):
    type: str
    severity: str
    title: str
    detail: str


class OverviewResponse(BaseModel):
    tick: int | None = None
    sim_time: str | None = None
    status: str | None = None
    as_of: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    kpis: dict[str, Any]
    service_level: float
    unmet_demand_liters: float
    allocation_failures: int
    stations: list[OverviewStation]
    depots: list[OverviewDepot]
    event_banner: OverviewEventBanner | None = None
    stale: bool = False


class AlertOut(BaseModel):
    id: str
    severity: str
    kind: str
    title: str
    detail: str
    station: str | None = None
    color: str
    time: str
    tick: int | None = None


class RecAction(BaseModel):
    depot_id: str
    depot_name: str | None = None
    route_id: str
    quantity_l: int
    eta_ticks: int


class RecommendationOut(BaseModel):
    id: int
    created_tick: int | None
    station: str
    stationId: str
    fuel: str
    risk: str
    ttf: str
    quantity: str
    source: str
    route: str
    eta: str
    confidence: float
    impact: str
    policy: str
    why: str
    signals: list[str]
    alternatives: list[str]
    needs_review: bool


class DecisionOut(BaseModel):
    id: int
    recommendation_id: int | None
    decided_at: str
    operator: str
    action: str
    allocation_id: int | None
    outcome: str | None
    response: str | None


class SystemEventOut(BaseModel):
    id: int
    at: str
    component: str
    level: str
    message: str


class ServiceHealth(BaseModel):
    name: str
    status: str
    latency_ms: int | None = None
    detail: str | None = None


class SystemStatus(BaseModel):
    overall: str
    services: list[ServiceHealth]
    p95_ms: int
    error_rate_pct: float
    fallback_active: bool
    stale: bool
    recent_events: list[SystemEventOut]
    as_of: str


class EventOut(BaseModel):
    id: int
    type: str
    status: str
    start_tick: int
    end_tick: int
    parameters: dict[str, Any] = Field(default_factory=dict)


class StationDetail(BaseModel):
    id: str
    name: str
    region: str
    profile: str
    status: str
    demand_multiplier: float
    inventory: dict[str, float]
    capacity: dict[str, float]
    inventory_pct: dict[str, int]
    forecast: dict[str, float] = Field(default_factory=dict)
    incoming: list[dict[str, Any]] = Field(default_factory=list)
    risk_breakdown: dict[str, Any] = Field(default_factory=dict)
    demand_history: list[dict[str, Any]] = Field(default_factory=list)


class ApproveRequest(BaseModel):
    operator: str = "operator"
    idempotency_key: str | None = None


class SimulateResponse(BaseModel):
    recommendation_id: int
    before: dict[str, Any]
    after: dict[str, Any]


class GenericMessage(BaseModel):
    message: str
    detail: dict[str, Any] | None = None


class RouteOut(BaseModel):
    id: str
    from_depot_id: str
    to_station_id: str
    transit_ticks: int
    max_shipment_l: float
    status: str


class DepotOut(BaseModel):
    id: str
    name: str
    region: str
    status: str
    inventory: dict[str, float]
    capacity: dict[str, float]
    inventory_pct: dict[str, int]
    fill_pct: int
    dispatch_per_tick: int
