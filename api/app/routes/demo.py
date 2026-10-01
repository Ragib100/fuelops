from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

from ..config import settings
from ..schemas import GenericMessage
from ..simulator.client import SimulatorError, simulator_client

router = APIRouter(prefix="/api/admin/demo", tags=["demo"])


def _check_token(token: str | None) -> None:
    expected = settings.operator_token
    if expected and token != expected:
        raise HTTPException(status_code=401, detail="missing or invalid operator token")


async def _dispatch(action: str, body: dict | None) -> GenericMessage:
    try:
        resp = await simulator_client.admin(action, body or {})
    except SimulatorError as exc:
        raise HTTPException(status_code=exc.status, detail={"code": exc.code, "message": exc.message})
    return GenericMessage(message=f"admin {action} ok", detail=resp if isinstance(resp, dict) else {"value": resp})


@router.post("/{action}", response_model=GenericMessage)
async def admin_action(action: str, body: dict | None = None, x_operator_token: str | None = Header(default=None)):
    _check_token(x_operator_token)
    return await _dispatch(action, body)


@router.post("/faults/clear", response_model=GenericMessage)
async def clear_faults(x_operator_token: str | None = Header(default=None)):
    _check_token(x_operator_token)
    return await _dispatch("faults/clear", None)
