import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

import db
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
