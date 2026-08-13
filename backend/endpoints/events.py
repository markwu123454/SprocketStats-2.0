import asyncio

from fastapi import APIRouter, Depends, HTTPException

import db
from core.external import nexus, statbotics, tba
from core.security import get_current_user, require_access
from db.comp_events import CompEventContent

router = APIRouter()


@router.get("")
async def list_events(_: dict = Depends(get_current_user)):
    return await db.get_events()


# ── Comp event static content ──────────────────────────────────────────────────

@router.get("/{event_key}/content")
async def get_content(event_key: str, _: dict = Depends(get_current_user)):
    row = await db.get_comp_event(event_key)
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    return row


@router.put("/{event_key}/content")
async def put_content(
    event_key: str,
    body: CompEventContent,
    _: dict = Depends(require_access(permissions="control_panel.upcoming_event")),
):
    return await db.upsert_comp_event(event_key, body)


# ── External API proxies ───────────────────────────────────────────────────────

@router.get("/{event_key}/schedule")
async def get_schedule(event_key: str, _: dict = Depends(get_current_user)):
    return await tba.get(f"/team/frc3473/event/{event_key}/matches")


@router.get("/{event_key}/rankings")
async def get_rankings(event_key: str, _: dict = Depends(get_current_user)):
    return await tba.get(f"/event/{event_key}/rankings")


@router.get("/{event_key}/nexus")
async def get_nexus(event_key: str, _: dict = Depends(get_current_user)):
    status, inspection = await asyncio.gather(
        nexus.get(f"/event/{event_key}"),
        nexus.get(f"/event/{event_key}/inspection"),
        return_exceptions=True,
    )
    return {
        "status": None if isinstance(status, Exception) else status,
        "inspection": None if isinstance(inspection, Exception) else inspection,
    }


@router.get("/{event_key}/teams")
async def get_event_teams(event_key: str, _: dict = Depends(get_current_user)):
    return await statbotics.get("/team_events", params={"event": event_key})
