from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Decision
from ..schemas import DecisionOut

router = APIRouter(prefix="/api", tags=["decisions"])


@router.get("/decisions", response_model=list[DecisionOut])
async def list_decisions(limit: int = 100, db: Session = Depends(get_db)) -> list[DecisionOut]:
    rows = db.execute(select(Decision).order_by(Decision.id.desc()).limit(limit)).scalars().all()
    out: list[DecisionOut] = []
    for r in rows:
        # Build a friendly response string for the frontend
        req = r.request or {}
        resp = r.simulator_response or {}
        if r.action == "approve":
            qty = req.get("quantity", 0)
            fuel = req.get("fuel_type", "")
            route = req.get("route_id", "")
            response_str = (
                f"Allocation #{resp.get('id')} · {qty:.0f} L {fuel}"
                if resp else f"{qty:.0f} L {fuel}"
            )
        else:
            response_str = "Recommendation rejected"
        out.append(DecisionOut(
            id=r.id,
            recommendation_id=r.recommendation_id,
            decided_at=r.decided_at.isoformat() if r.decided_at else "",
            operator=r.operator,
            action=r.action,
            allocation_id=r.allocation_id,
            outcome=r.outcome,
            response=response_str,
        ))
    return out
