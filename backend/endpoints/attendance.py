import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import db
from core import qr_events
from core.attendance_rules import hours_multiplier, multiplier_bonus_seconds
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
        {
            "id": str(r["id"]),
            "start_time": r["start_time"],
            "end_time": r["end_time"],
            "meeting_purpose": r["meeting_purpose"],
        }
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
    # An entry still open (abandoned ones are already filtered out) means the
    # member is checked in right now.
    checked_in: set[str] = set()

    def close_interval(uid: str) -> None:
        start, end = open_interval.pop(uid)
        totals[uid] = totals.get(uid, 0.0) + (end - start).total_seconds()

    for row in rows:
        uid = row["user_id"]
        names[uid] = row["display_name"] or row["given_name"] or "Unknown User"
        start = row["checkin_time"]
        end = row["checkout_time"] or now
        if row["checkout_time"] is None:
            checked_in.add(uid)

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

    # Meetings worth more than x1.0 add their extra on top of the clock time.
    meetings = await db.list_all_meeting_hours()
    if any(hours_multiplier(m) > 1.0 for m in meetings):
        for uid, bonus in multiplier_bonus_seconds(meetings, await db.list_meeting_checkins()).items():
            if uid in totals:
                totals[uid] += bonus

    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    return [
        {
            "user_id": uid,
            "name": names[uid],
            "total_seconds": seconds,
            "checked_in": uid in checked_in,
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


# Attendance is only ever recorded at a kiosk: a card tap, a code countersigned
# there, or the QR below, which proves the member is standing at one. There is
# deliberately no endpoint for a member to submit their own hours.
#
# Checking *out* is the one exception: it can only end a session a kiosk
# started, so it can shorten logged time but never add to it.


@router.post("/checkout")
async def checkout(user: dict = Depends(require_active)):
    row = await db.checkout_attendance(user["sub"])
    if row is None:
        raise HTTPException(status_code=409, detail="You're not checked in")
    return {"id": row["id"], "checkin_time": row["checkin_time"], "checkout_time": row["checkout_time"]}


class QrCheckinRequest(BaseModel):
    token: str = Field(min_length=1, max_length=128)


@router.post("/qr_checkin")
async def qr_checkin(body: QrCheckinRequest, user: dict = Depends(require_active)):
    """Check the signed-in member in/out by claiming a code shown on a kiosk.

    Possessing a live code proves presence at the kiosk, which is what the
    admin countersign used to establish.
    """
    row = await db.get_user(user["sub"])
    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if not row["onboarding_complete"]:
        raise HTTPException(status_code=403, detail="Onboarding incomplete")

    if not await db.claim_kiosk_qr_code(body.token, user["sub"]):
        raise HTTPException(status_code=410, detail="This code expired or was already used")

    attendance_status = await db.toggle_kiosk_attendance(user["sub"])
    if attendance_status is None:
        raise HTTPException(status_code=404, detail="Member not found")
    kiosk_id = await db.set_kiosk_qr_result(body.token, attendance_status)
    if kiosk_id is not None:
        # Best-effort: publish() swallows its own errors.
        await qr_events.hub.publish(kiosk_id, body.token)
    return {
        "name": row["display_name"] or row["given_name"] or "Unknown User",
        "status": attendance_status,
    }
