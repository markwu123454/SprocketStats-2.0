import asyncio
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException

import db
from core import push_notify
from core.external import nexus, tba
from core.permissions import can, get_permissions_for_role
from core.security import get_current_user, require_access, require_active
from db.comp_events import (
    CheckInRequest,
    CompEventContent,
    CompEventContentPatch,
    RosterMember,
    RosterUpdate,
)
from db.events import EventScheduleUpdate, check_schedule_order, is_tba_key, normalize_checkin_roles, role_keys

router = APIRouter()

TEAM_KEY = "frc3473"

# Bound at module level (like require_meeting_time in endpoints/meeting_hours.py)
# so tests can override it directly instead of forging a role on a real user.
require_event_edit = require_access(permissions="events.edit")


def _parse_schedule_date(value: str | None) -> date | None:
    """Parse a `get_event_schedule` TEXT value (bare date or full datetime
    string) into a `date`, or `None` if it's missing/unparseable -- in which
    case the caller treats the range check as not applicable."""
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


async def _enforce_days_in_range(event_key: str, days: list[str]) -> None:
    """422 if any of `days` falls outside `event_key`'s scheduled dates.

    Shared by check-in and the roster-role PATCH so the same lenient rule
    applies either way: looks up the `events` row for this event_key; if
    there isn't one, or its start (and end, defaulting to start when
    end_time is null) don't both parse to dates, the check is skipped
    entirely rather than blocking the request.
    """
    schedule = await db.get_event_schedule(event_key)
    if schedule is None:
        return
    start = _parse_schedule_date(schedule.get("start_time"))
    end_raw = schedule.get("end_time")
    end = _parse_schedule_date(end_raw) if end_raw else start
    if start is None or end is None:
        return
    if any(date.fromisoformat(d) < start or date.fromisoformat(d) > end for d in days):
        raise HTTPException(status_code=422, detail="Days must be within the event's dates")


async def _enforce_check_in_open(event_key: str) -> None:
    """403 if `event_key`'s schedule row turns check-in off, or sets a
    `checkin_opens` time that hasn't arrived yet (read as team-local wall
    time, like reminder pushes). No schedule row, or no `checkin_opens`,
    means check-in isn't time-gated."""
    schedule = await db.get_event_schedule(event_key)
    if schedule is not None and schedule.get("checkin_enabled") is False:
        raise HTTPException(status_code=403, detail="This event doesn't use check-in")
    opens = push_notify.parse_event_start((schedule or {}).get("checkin_opens"))
    if opens is not None and datetime.now(push_notify.TEAM_TZ) < opens:
        raise HTTPException(status_code=403, detail="Check-in isn't open yet")


@router.get("")
async def list_events(_: dict = Depends(get_current_user)):
    return await db.get_events()


@router.patch("/schedule/{event_id}")
async def patch_schedule(
    event_id: int,
    body: EventScheduleUpdate,
    _: dict = Depends(require_event_edit),
):
    """Edit one schedule entry's start/end, when check-in opens, and which hub
    tabs it hides. Only the sent fields change; ordering rules are checked
    against the stored row merged with the update."""
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "checkin_roles" in fields:
        try:
            fields["checkin_roles"] = normalize_checkin_roles(body.checkin_roles)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    existing = await db.get_event_by_id(event_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Event not found")
    merged = {"start": existing.get("start"), "end": existing.get("end"), "checkin_opens": existing.get("checkinOpens")}
    merged.update({k: v for k, v in fields.items() if k in merged})
    try:
        check_schedule_order(merged["start"], merged["end"], merged["checkin_opens"])
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    row = await db.update_event_schedule(event_id, fields)
    if row is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return row


# ── Control panel write path ───────────────────────────────────────────────────

@router.put("/{event_key}/content")
async def put_content(
    event_key: str,
    body: CompEventContent,
    _: dict = Depends(require_access(permissions="control_panel.upcoming_event")),
):
    # Clients never see dismissal entries, so a full roster sent back here
    # won't contain them -- carry over the stored ones (for anyone the new
    # roster doesn't list) instead of silently un-dismissing everyone.
    existing = await db.get_comp_event(event_key)
    if existing and body.roster is not None:
        listed = {m.user_id for m in body.roster}
        kept = [
            RosterMember(**e) for e in existing.get("roster") or []
            if db.is_dismissal(e) and e.get("user_id") not in listed
        ]
        body = body.model_copy(update={"roster": body.roster + kept})
    return _with_visible_roster(await db.upsert_comp_event(event_key, body))


async def _event_role_keys(event_key: str) -> list[str]:
    """This event's check-in role keys (the defaults with no schedule row)."""
    schedule = await db.get_event_schedule(event_key)
    return role_keys((schedule or {}).get("checkin_roles"))


def _require_event_role(role: str, keys: list[str]) -> None:
    if role not in keys:
        raise HTTPException(status_code=422, detail="Pick one of this event's check-in roles")


@router.get("/{event_key}/check-in")
async def get_check_in_status(event_key: str, user: dict = Depends(require_active)):
    """Whether the calling user is on `event_key`'s roster, and whether
    they've dismissed its check-in prompt."""
    await db.ensure_comp_event(event_key)
    on_roster = await db.is_on_roster(event_key, str(user["sub"]))
    if on_roster is None:
        raise HTTPException(status_code=404, detail="Event not found")
    dismissed = await db.is_check_in_dismissed(event_key, str(user["sub"]))
    return {"checked_in": on_roster, "dismissed": dismissed}


async def _set_dismissed(event_key: str, user: dict, dismissed: bool) -> dict:
    await db.ensure_comp_event(event_key)
    if await db.get_comp_event(event_key) is None:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.set_check_in_dismissed(event_key, str(user["sub"]), _display_name(user), dismissed)
    # Read back rather than echo `dismissed`: dismissing after checking in is
    # a no-op, so the answer can be False even for a dismiss request.
    return {"dismissed": await db.is_check_in_dismissed(event_key, str(user["sub"]))}


def _display_name(user: dict) -> str:
    # display_name is null for an account that hasn't finished onboarding
    # (require_active doesn't check that), but RosterMember.display_name is a
    # required str -- fall back through other JWT claims so the roster entry
    # (and any later PUT /content round-trip of it through CompEventContent)
    # always has a non-empty name.
    return user.get("display_name") or user.get("name") or user.get("email")


def _with_visible_roster(row: dict) -> dict:
    """A comp_events row as clients see it: dismissal entries left out."""
    return {**row, "roster": db.visible_roster(row.get("roster"))}


@router.post("/{event_key}/check-in/dismiss")
async def dismiss_check_in(event_key: str, user: dict = Depends(require_active)):
    """Hide `event_key`'s check-in prompt for the caller. Idempotent."""
    return await _set_dismissed(event_key, user, True)


@router.delete("/{event_key}/check-in/dismiss")
async def undismiss_check_in(event_key: str, user: dict = Depends(require_active)):
    """Bring back a dismissed check-in prompt. Idempotent."""
    return await _set_dismissed(event_key, user, False)


@router.post("/{event_key}/check-in")
async def check_in(
    event_key: str,
    body: CheckInRequest | None = None,
    user: dict = Depends(require_active),
):
    """Self check-in: append the caller to `event_key`'s roster, with their
    chosen role (one of the event's own check-in roles; with no body or no
    `role`, "attending" if the event has it, else its first role), an
    optional phone number, and the days they expect to attend (omitted/null
    -> not given yet). Idempotent -- calling it again just confirms the
    existing entry (role, phone, and days are NOT overwritten) rather than
    duplicating or changing it."""
    await _enforce_check_in_open(event_key)
    await db.ensure_comp_event(event_key)
    checkin = body or CheckInRequest()
    keys = await _event_role_keys(event_key)
    if "role" in checkin.model_fields_set:
        _require_event_role(checkin.role, keys)
    elif checkin.role not in keys:
        checkin.role = keys[0]
    if checkin.days is not None:
        await _enforce_days_in_range(event_key, checkin.days)
    member = {
        "user_id": str(user["sub"]),
        "display_name": _display_name(user),
        "role": checkin.role,
        "phone": checkin.phone,
        "days": checkin.days,
    }
    roster = await db.add_roster_member(event_key, member)
    if roster is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"checked_in": True, "roster": db.visible_roster(roster)}


@router.patch("/{event_key}/roster/{user_id}")
async def patch_roster_member(
    event_key: str,
    user_id: str,
    body: RosterUpdate,
    user: dict = Depends(require_active),
):
    """Update one roster member's `role` and/or `days` (any subset; at least
    one required). Two independent authorizations, both enforced before
    anything is written:

    - `role` (one of the event's own check-in roles; can't move a member to
      a role outside them, e.g. "chaperone"/"captain"/"lead") requires the
      caller's role to carry `events.edit`.
    - `days` may be changed by the member themselves (`user_id` is their own
      `sub`), or by anyone with `events.edit`.

    Either way, only the sent fields change -- display_name/phone and every
    other entry are untouched. A roster entry with a null user_id
    (hand-seeded) is never addressable this way."""
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    has_event_edit = can(get_permissions_for_role(user.get("role")), "events.edit")
    if "role" in fields and not has_event_edit:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if "days" in fields and user_id != str(user["sub"]) and not has_event_edit:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    if "role" in fields:
        _require_event_role(fields["role"], await _event_role_keys(event_key))
    if "days" in fields:
        await _enforce_days_in_range(event_key, fields["days"])

    try:
        roster = await db.update_roster_member(event_key, user_id, fields)
    except db.RosterMemberNotFound:
        raise HTTPException(status_code=404, detail="Roster member not found")
    if roster is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"roster": db.visible_roster(roster)}


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
    return _with_visible_roster(row)


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
    """Fetch matches, rankings, and nexus in parallel. Each item may be an
    Exception. A non-competition hub ("e<id>" key) has nothing on TBA/Nexus,
    so it skips the calls and gets the empty payload."""
    if not is_tba_key(event_key):
        return [], None, None
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
        # A scheduled event's hub opens even if nobody set it up first.
        await db.ensure_comp_event(event_key)
        row = await db.get_comp_event(event_key)
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    matches, rankings, nexus_data = await _fetch_live(event_key)
    return {**_with_visible_roster(row), **_live_payload(matches, rankings, nexus_data)}


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
