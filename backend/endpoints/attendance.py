import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, model_validator

import db
from .auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


def _week_bounds(now: datetime) -> tuple[datetime, datetime]:
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=7)


@router.get("/meetings")
async def get_meetings(_: dict = Depends(get_current_user)):
    start, end = _week_bounds(datetime.now(timezone.utc))
    rows = await db.list_meeting_hours(start, end)
    return [
        {"id": str(r["id"]), "start_time": r["start_time"], "end_time": r["end_time"]}
        for r in rows
    ]


@router.get("/leaderboard")
async def get_leaderboard(user: dict = Depends(get_current_user)):
    rows = await db.list_all_attendance()

    names: dict[str, str] = {}
    pending_check_in: dict[str, datetime] = {}
    totals: dict[str, float] = {}

    for row in rows:
        uid = row["user_id"]
        names[uid] = row["display_name"] or row["given_name"] or "Unknown User"
        if row["event_type"] == "check_in":
            pending_check_in[uid] = row["timestamp_pst"]
        elif row["event_type"] == "check_out":
            start = pending_check_in.pop(uid, None)
            if start is not None:
                totals[uid] = totals.get(uid, 0.0) + (row["timestamp_pst"] - start).total_seconds()

    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    return [
        {
            "user_id": uid,
            "name": names[uid],
            "total_seconds": seconds,
            "is_current_user": uid == user["sub"],
        }
        for uid, seconds in ranked
    ]


@router.get("/me")
async def get_my_attendance(user: dict = Depends(get_current_user)):
    rows = await db.list_attendance_for_user(user["sub"])
    return [
        {"id": r["id"], "timestamp_pst": r["timestamp_pst"], "event_type": r["event_type"]}
        for r in rows
    ]


class ClockEntry(BaseModel):
    clock_in: datetime
    clock_out: datetime
    source: str

    @model_validator(mode="after")
    def validate_range(self) -> "ClockEntry":
        if self.clock_out <= self.clock_in:
            raise ValueError("clock_out must be after clock_in")
        return self


@router.post("")
async def submit_attendance(entry: ClockEntry, user: dict = Depends(get_current_user)):
    rows = await db.create_attendance_events(user["sub"], entry.source, entry.clock_in, entry.clock_out)
    return [
        {"id": r["id"], "timestamp_pst": r["timestamp_pst"], "event_type": r["event_type"]}
        for r in rows
    ]
