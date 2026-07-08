import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator, model_validator

import db
from .auth import require_access

logger = logging.getLogger(__name__)

router = APIRouter()

# Read and write both require this capability (Captains, Mentors, and Scouting
# leads/members today). The gate here is the real enforcement — any Meeting
# page UI is purely cosmetic.
require_meeting_time = require_access(permissions="control_panel.meeting_time")


class MeetingHoursWrite(BaseModel):
    """Body shared by create and update — a full replace of one meeting's fields."""

    start_time: datetime
    end_time: datetime
    meeting_purpose: str | None = None

    @field_validator("meeting_purpose")
    @classmethod
    def _clean_purpose(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) > 128:
            raise ValueError("Meeting purpose must be 128 characters or fewer")
        return v

    @model_validator(mode="after")
    def _validate_range(self) -> "MeetingHoursWrite":
        if self.end_time <= self.start_time:
            raise ValueError("End time must be after start time")
        return self


@router.get("")
async def list_meetings(_: dict = Depends(require_meeting_time)):
    """Every scheduled meeting, for the admin Meeting Hours editor."""
    rows = await db.list_all_meeting_hours()
    return [_row_to_meeting(r) for r in rows]


@router.post("")
async def create_meeting(body: MeetingHoursWrite, user: dict = Depends(require_meeting_time)):
    row = await db.create_meeting_hours(user["sub"], body.start_time, body.end_time, body.meeting_purpose)
    return _row_to_meeting(row)


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


def _row_to_meeting(r) -> dict:
    return {
        "id": str(r["id"]),
        "created_by": r["created_by"],
        "start_time": r["start_time"],
        "end_time": r["end_time"],
        "meeting_purpose": r["meeting_purpose"],
    }
