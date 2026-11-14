"""The fixed rules of meeting attendance, shared by the leaderboard and the
Control Panel attendance page.

  * ``ATTENDANCE_ACTIVE_FROM`` -- the day the attendance system went live.
    Meetings that start on or after it require a check-in: no check-in is an
    absence, and hours count only for the time actually checked in. Meetings
    before it don't count toward attendance at all (the client ignores them).
  * A meeting's ``hours_multiplier`` (x1.0 to x2.0) scales how much the time
    spent at it is worth: at x2.0, one hour checked in counts as two.
"""

from datetime import datetime

from core.push_notify import TEAM_TZ

# The evening of November 14, 2026 (5:00 PM in the team's timezone), so that
# night's meeting is the first one that requires a check-in.
ATTENDANCE_ACTIVE_FROM = datetime(2026, 11, 14, 17, tzinfo=TEAM_TZ)

MIN_HOURS_MULTIPLIER = 1.0
MAX_HOURS_MULTIPLIER = 2.0


def hours_multiplier(meeting) -> float:
    """A meeting row's multiplier, kept inside the allowed range (x1.0 when unset)."""
    value = meeting.get("hours_multiplier")
    if value is None:
        return MIN_HOURS_MULTIPLIER
    return min(MAX_HOURS_MULTIPLIER, max(MIN_HOURS_MULTIPLIER, float(value)))


def meeting_checkin_seconds(rows) -> dict[tuple[str, str], float]:
    """Seconds each member was checked in during each meeting.

    ``rows`` come from ``db.list_meeting_checkins``: spans already clipped to
    the meeting and ordered by (meeting, user, start). Overlapping spans for
    the same member are merged so time logged twice is counted once.
    """
    totals: dict[tuple[str, str], float] = {}
    current_key: tuple[str, str] | None = None
    current_end = None
    for row in rows:
        key = (str(row["meeting_id"]), row["user_id"])
        start, end = row["seg_start"], row["seg_end"]
        if key != current_key:
            current_key, current_end = key, None
            totals.setdefault(key, 0.0)
        if current_end is not None and start < current_end:
            start = current_end
        if end > start:
            totals[key] += (end - start).total_seconds()
            current_end = end
    return totals


def multiplier_bonus_seconds(meetings, checkin_rows) -> dict[str, float]:
    """Extra seconds each member earns from meetings worth more than x1.0.

    Time checked in at a meeting already counts once in a member's hours; this
    is the part the multiplier adds on top (half an hour per hour at x1.5).
    """
    extra = {str(m["id"]): hours_multiplier(m) - 1.0 for m in meetings}
    bonus: dict[str, float] = {}
    for (meeting_id, user_id), seconds in meeting_checkin_seconds(checkin_rows).items():
        gain = extra.get(meeting_id, 0.0) * seconds
        if gain > 0:
            bonus[user_id] = bonus.get(user_id, 0.0) + gain
    return bonus
