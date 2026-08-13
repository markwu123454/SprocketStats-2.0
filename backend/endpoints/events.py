import asyncio

from fastapi import APIRouter, Depends, HTTPException

import db
from core.external import nexus, tba
from core.security import get_current_user, require_access
from db.comp_events import CompEventContent

router = APIRouter()

TEAM_KEY = "frc3473"


@router.get("")
async def list_events(_: dict = Depends(get_current_user)):
    return await db.get_events()


# ── Control panel write path ───────────────────────────────────────────────────

@router.put("/{event_key}/content")
async def put_content(
    event_key: str,
    body: CompEventContent,
    _: dict = Depends(require_access(permissions="control_panel.upcoming_event")),
):
    return await db.upsert_comp_event(event_key, body)


# ── Internal helpers ───────────────────────────────────────────────────────────

async def _fetch_nexus(event_key: str) -> dict:
    status, inspection = await asyncio.gather(
        nexus.get(f"/event/{event_key}"),
        nexus.get(f"/event/{event_key}/inspection"),
        return_exceptions=True,
    )
    return {
        "status":     None if isinstance(status, Exception) else status,
        "inspection": None if isinstance(inspection, Exception) else inspection,
    }


async def _fetch_live(event_key: str) -> tuple:
    """Fetch matches, rankings, and nexus in parallel. Each item may be an Exception."""
    return await asyncio.gather(
        tba.get(f"/team/{TEAM_KEY}/event/{event_key}/matches"),
        tba.get(f"/event/{event_key}/rankings"),
        _fetch_nexus(event_key),
        return_exceptions=True,
    )


def _live_payload(matches, rankings, nexus_data) -> dict:
    return {
        "matches":  [] if isinstance(matches, Exception) else (matches or []),
        "rankings": None if isinstance(rankings, Exception) else rankings,
        "nexus":    None if isinstance(nexus_data, Exception) else nexus_data,
    }


# ── Primary endpoints ──────────────────────────────────────────────────────────

@router.get("/{event_key}/info")
async def get_event_info(event_key: str, _: dict = Depends(get_current_user)):
    row = await db.get_comp_event(event_key)
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    matches, rankings, nexus_data = await _fetch_live(event_key)
    return {**row, **_live_payload(matches, rankings, nexus_data)}


@router.get("/{event_key}/update")
async def get_event_update(event_key: str, _: dict = Depends(get_current_user)):
    matches, rankings, nexus_data = await _fetch_live(event_key)
    return _live_payload(matches, rankings, nexus_data)


# ── Bootstrap helper ───────────────────────────────────────────────────────────

async def get_prefetch_event_info() -> dict | None:
    row = await db.get_prefetch_event()
    if not row:
        return None
    matches, rankings, nexus_data = await _fetch_live(row["event_key"])
    return {**row, **_live_payload(matches, rankings, nexus_data)}
