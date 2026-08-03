import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, model_validator

import db
from core.security import get_current_user, require_active

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
    # Rows come back ordered by (user_id, checkin_time), so overlapping/adjacent
    # entries for the same user are merged with a single sweep to avoid
    # double-counting time that was logged more than once.
    rows = await db.list_all_attendance()
    now = datetime.now(timezone.utc)

    names: dict[str, str] = {}
    totals: dict[str, float] = {}
    open_interval: dict[str, tuple[datetime, datetime]] = {}

    def close_interval(uid: str) -> None:
        start, end = open_interval.pop(uid)
        totals[uid] = totals.get(uid, 0.0) + (end - start).total_seconds()

    for row in rows:
        uid = row["user_id"]
        names[uid] = row["display_name"] or row["given_name"] or "Unknown User"
        start = row["checkin_time"]
        end = row["checkout_time"] or now

        current = open_interval.get(uid)
        if current is None:
            open_interval[uid] = (start, end)
        elif start <= current[1]:
            open_interval[uid] = (current[0], max(current[1], end))
        else:
            close_interval(uid)
            open_interval[uid] = (start, end)

    for uid in list(open_interval):
        close_interval(uid)

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
        {"id": r["id"], "checkin_time": r["checkin_time"], "checkout_time": r["checkout_time"]}
        for r in rows
    ]


class ClockEntry(BaseModel):
    checkin_time: datetime
    checkout_time: datetime
    source: str

    @model_validator(mode="after")
    def validate_range(self) -> "ClockEntry":
        if self.checkout_time <= self.checkin_time:
            raise ValueError("checkout_time must be after checkin_time")
        return self


@router.post("")
async def submit_attendance(entry: ClockEntry, user: dict = Depends(require_active)):
    row = await db.create_attendance_entry(user["sub"], entry.source, entry.checkin_time, entry.checkout_time)
    return {"id": row["id"], "checkin_time": row["checkin_time"], "checkout_time": row["checkout_time"]}
