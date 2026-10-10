import asyncio

from fastapi import APIRouter, Depends, HTTPException

import db
from core.external import nexus, tba
from core.security import get_current_user, require_access, require_active
from db.comp_events import (
    CheckInRequest,
    CompEventContent,
    CompEventContentPatch,
    RosterRoleUpdate,
)

router = APIRouter()

TEAM_KEY = "frc3473"

# Bound at module level (like require_meeting_time in endpoints/meeting_hours.py)
# so tests can override it directly instead of forging a role on a real user.
require_event_edit = require_access(permissions="events.edit")


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


@router.get("/{event_key}/check-in")
async def get_check_in_status(event_key: str, user: dict = Depends(require_active)):
    """Whether the calling user is on `event_key`'s roster."""
    on_roster = await db.is_on_roster(event_key, str(user["sub"]))
    if on_roster is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"checked_in": on_roster}


@router.post("/{event_key}/check-in")
async def check_in(
    event_key: str,
    body: CheckInRequest | None = None,
    user: dict = Depends(require_active),
):
    """Self check-in: append the caller to `event_key`'s roster, with their
    chosen role (one of CheckInRequest's self-selectable roles; defaults to
    "attending" with no body or no `role`) and an optional phone number.
    Idempotent -- calling it again just confirms the existing entry (role and
    phone are NOT overwritten) rather than duplicating or changing it."""
    checkin = body or CheckInRequest()
    member = {
        "user_id": str(user["sub"]),
        # display_name is null for an account that hasn't finished onboarding
        # (require_active doesn't check that), but RosterMember.display_name
        # is a required str -- fall back through other JWT claims so the
        # roster entry (and any later PUT /content round-trip of it through
        # CompEventContent) always has a non-empty name.
        "display_name": user.get("display_name") or user.get("name") or user.get("email"),
        "role": checkin.role,
        "phone": checkin.phone,
    }
    roster = await db.add_roster_member(event_key, member)
    if roster is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"checked_in": True, "roster": roster}


@router.patch("/{event_key}/roster/{user_id}")
async def patch_roster_role(
    event_key: str,
    user_id: str,
    body: RosterRoleUpdate,
    _: dict = Depends(require_event_edit),
):
    """Privileged role change: set one roster member's role to one of the
    same ASSIGNABLE_ROLES offered at check-in, leaving their display_name/
    phone and every other entry untouched. Can't move a member to (or off of)
    a role outside that set -- e.g. "chaperone"/"captain"/"lead", which only
    exist via hand-seeding or PUT /content. A roster entry with a null
    user_id (hand-seeded) is never addressable this way."""
    try:
        roster = await db.set_roster_role(event_key, user_id, body.role)
    except db.RosterMemberNotFound:
        raise HTTPException(status_code=404, detail="Roster member not found")
    if roster is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"roster": roster}


@router.patch("/{event_key}/content")
async def patch_content(
    event_key: str,
    body: CompEventContentPatch,
    _: dict = Depends(require_event_edit),
):
    """Edit itinerary/packing_list/instructions one field at a time, without
    touching roster, links, or event_name. Never creates an event."""
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    row = await db.update_comp_event_content(event_key, fields)
    if row is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return row


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

async def get_current_event_info(user: dict) -> dict | None:
    """Prefetch the currently-selected event via get_event_info — the same
    assembly a normal page load hits — instead of duplicating it here."""
    row = await db.get_prefetch_event()
    if not row:
        return None
    try:
        return await get_event_info(row["event_key"], user)
    except HTTPException:
        return None

@router.get("/list_events")
async def list_event_keys(_: dict = Depends(get_current_user)) -> list[str]:
    """Event keys with a hub page. Backs the `event_keys` bootstrap entry so the
    frontend can tell a real event from a 404 without a per-event fetch."""
    return await db.get_comp_event_keys()
