from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import policy
from ..db import get_db, session_scope
from ..ingest import STORE
from ..metrics import DECISIONS_MADE
from ..models import AllocationCache, Decision, Recommendation
from ..schemas import (
    ApproveRequest,
    GenericMessage,
    RecommendationOut,
    SimulateResponse,
)
from ..simulator.client import (
    IdempotencyMismatch,
    SimulatorError,
    simulator_client,
)

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


FUEL_DISPLAY = {"DIESEL": "Diesel", "PETROL": "Petrol", "OCTANE": "Octane"}


@router.get("", response_model=list[RecommendationOut])
async def list_recommendations() -> list[RecommendationOut]:
    rows = policy.list_pending()
    return [_to_out(r) for r in rows]


@router.post("/refresh", response_model=list[RecommendationOut])
async def refresh_recommendations() -> list[RecommendationOut]:
    snap = STORE.last_snapshot
    if not snap:
        raise HTTPException(status_code=503, detail="no snapshot yet — simulator warming up")
    rows = policy.refresh(snap)
    return [_to_out(r) for r in rows]


@router.post("/{rec_id}/approve", response_model=GenericMessage)
async def approve(rec_id: int, body: ApproveRequest, db: Session = Depends(get_db)) -> GenericMessage:
    rec = db.get(Recommendation, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="recommendation not found")
    if rec.status != "PENDING":
        raise HTTPException(status_code=409, detail=f"recommendation status is {rec.status}")

    payload = rec.payload or {}
    action = payload.get("action") or {}
    request_body = {
        "idempotency_key": body.idempotency_key or f"rec-{rec.id}",
        "source_depot_id": action.get("depot_id"),
        "destination_station_id": rec.station_id,
        "route_id": action.get("route_id"),
        "fuel_type": rec.fuel_type,
        "quantity": float(action.get("quantity_l") or 0),
    }
    try:
        resp = await simulator_client.post_allocation(request_body)
    except IdempotencyMismatch as exc:
        raise HTTPException(status_code=409, detail=exc.message)
    except SimulatorError as exc:
        raise HTTPException(status_code=exc.status, detail={"code": exc.code, "message": exc.message})

    # Persist allocation in cache for idempotent retries
    with session_scope() as s:
        existing = s.query(AllocationCache).filter_by(idempotency_key=request_body["idempotency_key"]).first()
        if not existing:
            s.add(AllocationCache(
                idempotency_key=request_body["idempotency_key"],
                request=request_body,
                response=resp,
            ))

    rec.status = "APPROVED"
    db.add(Decision(
        recommendation_id=rec.id,
        operator=body.operator or "operator",
        action="approve",
        idempotency_key=request_body["idempotency_key"],
        request=request_body,
        simulator_response=resp,
        allocation_id=resp.get("id"),
        outcome=resp.get("status", "PENDING"),
    ))
    db.commit()
    DECISIONS_MADE.labels(action="approve").inc()

    return GenericMessage(message="allocation approved", detail={
        "allocation": resp,
        "idempotency_key": request_body["idempotency_key"],
    })


@router.post("/{rec_id}/reject", response_model=GenericMessage)
async def reject(rec_id: int, body: ApproveRequest, db: Session = Depends(get_db)) -> GenericMessage:
    rec = db.get(Recommendation, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="recommendation not found")
    if rec.status != "PENDING":
        raise HTTPException(status_code=409, detail=f"recommendation status is {rec.status}")
    rec.status = "REJECTED"
    db.add(Decision(
        recommendation_id=rec.id,
        operator=body.operator or "operator",
        action="reject",
        request={"recommendation_id": rec.id},
    ))
    db.commit()
    DECISIONS_MADE.labels(action="reject").inc()
    return GenericMessage(message="recommendation rejected")


@router.post("/{rec_id}/simulate", response_model=SimulateResponse)
async def simulate(rec_id: int) -> SimulateResponse:
    with session_scope() as s:
        rec = s.get(Recommendation, rec_id)
        if not rec:
            raise HTTPException(status_code=404, detail="recommendation not found")
        payload = rec.payload or {}
    snap = STORE.last_snapshot or {}
    stations = {x["id"]: x for x in (snap.get("stations") or [])}
    st = stations.get(rec.station_id)
    if not st:
        raise HTTPException(status_code=503, detail="station not in snapshot")
    fuel = rec.fuel_type
    inv = st["inventory"].get(fuel, 0)
    cap = st["capacity"].get(fuel, 1)
    qty = float((payload.get("action") or {}).get("quantity_l") or 0)
    daily = {
        "urban_high": {"DIESEL": 8500, "PETROL": 10500, "OCTANE": 5600},
        "industrial": {"DIESEL": 14000, "PETROL": 4500, "OCTANE": 2200},
        "highway":    {"DIESEL": 10500, "PETROL": 11000, "OCTANE": 6200},
        "regional":   {"DIESEL": 7200,  "PETROL": 7600,  "OCTANE": 3600},
    }.get(st["demand_profile"], {}).get(fuel, 0) * st.get("demand_multiplier", 1.0)

    def _risk(inv_l: float) -> dict:
        if daily <= 0:
            return {"p_stockout": 0.0, "hours_to_stockout": 999.0, "coverage_pct": 100}
        hts = (inv_l / daily) * 24.0
        p = max(0.0, 1.0 - hts / 48.0) ** 1.5
        return {
            "p_stockout": round(p, 3),
            "hours_to_stockout": round(hts, 2),
            "coverage_pct": int(round(100 * inv_l / cap)) if cap else 0,
        }

    return SimulateResponse(
        recommendation_id=rec_id,
        before=_risk(inv),
        after=_risk(inv + qty),
    )


# ---- helpers ----------------------------------------------------------------


def _to_out(row: dict) -> RecommendationOut:
    p = row["payload"]
    action = p.get("action", {})
    risk = p.get("risk", {})
    impact = p.get("impact", {})
    fuel = row["fuel"]
    fuel_label = FUEL_DISPLAY.get(fuel, fuel.title())
    ttf = risk.get("hours_to_stockout", 0.0)
    qty = action.get("quantity_l", 0)
    eta = action.get("eta_ticks", 0)
    depot_id = action.get("depot_id", "")
    route_id = action.get("route_id", "")
    impact_str = ""
    if "stockout_risk_before" in impact and "stockout_risk_after" in impact:
        b = int(round(impact["stockout_risk_before"] * 100))
        a = int(round(impact["stockout_risk_after"] * 100))
        impact_str = f"Stockout risk {b}% → {a}%"
    elif "expected_risk_reduction_pct" in impact:
        impact_str = f"Risk reduction {impact['expected_risk_reduction_pct']}%"

    alternatives = []
    for alt in p.get("alternatives", []):
        if isinstance(alt, dict):
            alternatives.append(f"{alt.get('route_id', '?')} · {alt.get('transit_ticks', '?')} ticks")
        else:
            alternatives.append(str(alt))

    return RecommendationOut(
        id=row["id"],
        created_tick=row["created_tick"],
        station=p.get("station_name", row["station_id"]),
        stationId=row["station_id"],
        fuel=fuel_label,
        risk=p.get("risk_level", "MEDIUM"),
        ttf=f"{ttf:.1f} h",
        quantity=f"{qty:,} L",
        source=depot_id.replace("depot-", "").title(),
        route=route_id.replace("route-", "").replace("-", " → "),
        eta=f"{eta} ticks · {eta * 15} min",
        confidence=row["confidence"],
        impact=impact_str or "—",
        policy=row["policy"],
        why=p.get("why", ""),
        signals=p.get("signals", []),
        alternatives=alternatives,
        needs_review=row["needs_review"],
    )
