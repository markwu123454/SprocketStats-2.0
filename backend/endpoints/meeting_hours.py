import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

import db
from core.permissions import can_view_absence, has_absence_view, role_requires_approval, tracks_attendance
from core.push_notify import notify_meeting_absence
from core.security import require_access, require_active

logger = logging.getLogger(__name__)

router = APIRouter()

# Scheduling and agenda editing are independently permission-gated.
require_meeting_time = require_access(permissions="control_panel.meeting_time")
require_meeting_agenda = require_access(permissions="control_panel.meeting_agenda")


MAX_RECURRING_OCCURRENCES = 200


def _normalize_purpose(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if len(v) > 128:
        raise ValueError("Meeting purpose must be 128 characters or fewer")
    return v


class MeetingHoursWrite(BaseModel):
    """Body shared by create and update — a full replace of one meeting's fields."""

    start_time: datetime
    end_time: datetime
    meeting_purpose: str | None = None

    @field_validator("meeting_purpose")
    @classmethod
    def _clean_purpose(cls, v: str | None) -> str | None:
        return _normalize_purpose(v)

    @model_validator(mode="after")
    def _validate_range(self) -> "MeetingHoursWrite":
        if self.end_time <= self.start_time:
            raise ValueError("End time must be after start time")
        return self


@router.get("")
async def list_meetings(_: dict = Depends(require_active)):
    """Scheduled meetings and agendas, visible to active signed-in members."""
    rows = await db.list_all_meeting_hours()
    return [_row_to_meeting(r) for r in rows]


MAX_ABSENCE_REASON = 500


class AbsenceWrite(BaseModel):
    # Required key (so the client always sends it) but may be blank.
    reason: str = Field(max_length=MAX_ABSENCE_REASON + 1000)

    @field_validator("reason")
    @classmethod
    def _clean_reason(cls, v: str) -> str:
        v = v.strip()
        if len(v) > MAX_ABSENCE_REASON:
            raise ValueError(f"Reason must be {MAX_ABSENCE_REASON} characters or fewer")
        return v


def _absence_json(r) -> dict:
    return {
        "meeting_id": str(r["meeting_id"]),
        "user_id": r["user_id"],
        "display_name": r["display_name"],
        "role": r["role"],
        "reason": r["reason"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }


async def _open_meeting(meeting_id: str):
    """The meeting, or 404 (unknown / malformed id) or 409 (already ended)."""
    try:
        UUID(meeting_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Meeting not found")
    meeting = await db.get_meeting_hours(meeting_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if meeting["end_time"] <= datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="This meeting has already ended")
    return meeting


# Declared before any `/{meeting_id}` GET route so "absences" is never read as an id.
@router.get("/absences")
async def list_absences(user: dict = Depends(require_active)):
    """The caller's own absences plus every absence their role may view."""
    rows = await db.list_meeting_absences()
    visible = [r for r in rows if r["user_id"] == user["sub"] or can_view_absence(user.get("role"), r["role"])]
    meetings = {str(m["id"]): m["start_time"] for m in await db.list_all_meeting_hours()}
    visible.sort(key=lambda r: (meetings.get(str(r["meeting_id"])) or datetime.max.replace(tzinfo=timezone.utc),
                                r["display_name"] or ""))
    return [_absence_json(r) for r in visible]


@router.get("/attendance")
async def attendance_overview(user: dict = Depends(require_active)):
    """Control Panel attendance data for leads, captains and mentors.

    ``members`` is everyone the viewer may see who is expected at meetings
    (active, approved where required, an attendance-tracked role), with their
    account ``created_at`` -- the client only counts meetings from then on.
    ``absences`` is limited to those members. Meeting check-ins will join this
    payload as a further list so missed meetings and hours attended can be
    derived from the same data.
    """
    viewer_role = user.get("role")
    if not has_absence_view(viewer_role):
        raise HTTPException(status_code=403, detail="Not allowed to view attendance")
    members = [
        m for m in await db.list_active_members()
        if tracks_attendance(m["role"])
        and (m["approved_by"] is not None or not role_requires_approval(m["role"]))
        and can_view_absence(viewer_role, m["role"])
    ]
    member_ids = {m["id"] for m in members}
    absences = [a for a in await db.list_meeting_absences() if a["user_id"] in member_ids]
    return {
        "meetings": [_row_to_meeting(r) for r in await db.list_all_meeting_hours()],
        "members": sorted(
            ({"user_id": m["id"], "display_name": m["display_name"], "role": m["role"], "created_at": m["created_at"]}
             for m in members),
            key=lambda m: (m["display_name"] or "").lower(),
        ),
        "absences": [_absence_json(a) for a in absences],
    }


@router.put("/{meeting_id}/absence")
async def report_absence(meeting_id: str, body: AbsenceWrite, user: dict = Depends(require_active)):
    meeting = await _open_meeting(meeting_id)
    _, created = await db.upsert_meeting_absence(meeting_id, user["sub"], body.reason)
    mine = next(
        r for r in await db.list_meeting_absences([meeting_id]) if r["user_id"] == user["sub"]
    )
    if created:
        notify_meeting_absence(
            meeting,
            {"user_id": user["sub"], "display_name": mine["display_name"], "role": mine["role"]},
        )
    return _absence_json(mine)


@router.delete("/{meeting_id}/absence")
async def withdraw_absence(meeting_id: str, user: dict = Depends(require_active)):
    await _open_meeting(meeting_id)
    if not await db.delete_meeting_absence(meeting_id, user["sub"]):
        raise HTTPException(status_code=404, detail="No absence reported for this meeting")
    return {"ok": True}


@router.post("")
async def create_meeting(body: MeetingHoursWrite, user: dict = Depends(require_meeting_time)):
    row = await db.create_meeting_hours(user["sub"], body.start_time, body.end_time, body.meeting_purpose)
    return _row_to_meeting(row)


class MeetingSlot(BaseModel):
    start_time: datetime
    end_time: datetime

    @model_validator(mode="after")
    def _validate_range(self) -> "MeetingSlot":
        if self.end_time <= self.start_time:
            raise ValueError("End time must be after start time")
        return self


class MeetingHoursBatch(BaseModel):
    """A recurring meeting, already expanded by the client into its occurrences."""

    slots: list[MeetingSlot] = Field(min_length=1, max_length=MAX_RECURRING_OCCURRENCES)
    meeting_purpose: str | None = None

    @field_validator("meeting_purpose")
    @classmethod
    def _clean_purpose(cls, v: str | None) -> str | None:
        return _normalize_purpose(v)


@router.post("/batch")
async def create_meeting_batch(body: MeetingHoursBatch, user: dict = Depends(require_meeting_time)):
    rows = await db.create_meeting_hours_batch(
        user["sub"], [(s.start_time, s.end_time) for s in body.slots], body.meeting_purpose
    )
    return [_row_to_meeting(r) for r in rows]


@router.put("/{meeting_id}")
async def update_meeting(
    meeting_id: str, body: MeetingHoursWrite, _: dict = Depends(require_meeting_time)
):
    row = await db.update_meeting_hours(meeting_id, body.start_time, body.end_time, body.meeting_purpose)
    if row is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return _row_to_meeting(row)


@router.delete("/{meeting_id}")
async def delete_meeting(meeting_id: str, _: dict = Depends(require_meeting_time)):
    deleted = await db.delete_meeting_hours(meeting_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {"ok": True}


class MeetingAgendaWrite(BaseModel):
    agenda: str = Field(max_length=10000)


@router.patch("/{meeting_id}/agenda")
async def update_agenda(
    meeting_id: str, body: MeetingAgendaWrite, _: dict = Depends(require_meeting_agenda)
):
    row = await db.update_meeting_agenda(meeting_id, body.agenda.strip())
    if row is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return _row_to_meeting(row)


def _row_to_meeting(r) -> dict:
    return {
        "id": str(r["id"]),
        "created_by": r["created_by"],
        "start_time": r["start_time"],
        "end_time": r["end_time"],
        "meeting_purpose": r["meeting_purpose"],
        "agenda": r["agenda"],
    }
