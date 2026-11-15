"""The fixed rules of meeting attendance, shared by the leaderboard and the
Control Panel attendance page.

  * ``ATTENDANCE_ACTIVE_FROM`` -- the day the attendance system went live.
    Meetings that start on or after it require a check-in: no check-in is an
    absence, and hours count only for the time actually checked in. Meetings
    before it don't count toward attendance at all (the client ignores them).
  * A meeting's ``hours_multiplier`` (x1.0 to x2.0) scales how much the time
    spent at it is worth: at x2.0, one hour checked in counts as two.
  * Hours count only inside meetings, each stretched by a grace period
    (``db.attendance.MEETING_GRACE``, 30 min) before and after for setup and
    cleanup; time outside that window adds nothing. Within it, a session ended by a kiosk or scanner scan
    (proof the member was in the room) earns full credit; one ended with the
    Check out button, or never checked out, earns ``UNVERIFIED_CREDIT`` of it,
    since nothing proves when the member actually left. A session still open
    while its meeting is running counts in full for now.
"""

from datetime import datetime, timezone

from core.push_notify import TEAM_TZ

# The evening of November 14, 2026 (5:00 PM in the team's timezone), so that
# night's meeting is the first one that requires a check-in.
ATTENDANCE_ACTIVE_FROM = datetime(2026, 11, 14, 17, tzinfo=TEAM_TZ)

MIN_HOURS_MULTIPLIER = 1.0
MAX_HOURS_MULTIPLIER = 2.0

# How each session ended (attendance.checkout_method). "kiosk" covers every
# kiosk, handheld-scanner and kiosk-QR toggle; "legacy" is a session closed
# before the method was recorded, kept at full credit so past hours don't change.
VERIFIED_CHECKOUTS = frozenset({"kiosk", "legacy"})
UNVERIFIED_CREDIT = 0.5


def credit_weight(row, now: datetime) -> float:
    """Share of a ``db.list_meeting_checkins`` span that counts toward hours."""
    method = row["checkout_method"]
    if method is None:
        # Still checked in: full while the meeting runs, unverified once it's over.
        return 1.0 if row["meeting_end"] > now else UNVERIFIED_CREDIT
    return 1.0 if method in VERIFIED_CHECKOUTS else UNVERIFIED_CREDIT


def hours_multiplier(meeting) -> float:
    """A meeting row's multiplier, kept inside the allowed range (x1.0 when unset)."""
    value = meeting.get("hours_multiplier")
    if value is None:
        return MIN_HOURS_MULTIPLIER
    return min(MAX_HOURS_MULTIPLIER, max(MIN_HOURS_MULTIPLIER, float(value)))


def meeting_checkin_seconds(rows, now: datetime | None = None) -> dict[tuple[str, str], float]:
    """Credited seconds each member was checked in during each meeting.

    ``rows`` come from ``db.list_meeting_checkins``: spans already clipped to
    the meeting and ordered by (meeting, user, start). Overlapping spans for
    the same member are merged so time logged twice is counted once, and each
    span is weighted by how its session ended (:func:`credit_weight`).
    """
    now = now or datetime.now(timezone.utc)
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
            totals[key] += (end - start).total_seconds() * credit_weight(row, now)
            current_end = end
    return totals


def credited_seconds_by_member(meetings, checkin_rows, now: datetime | None = None) -> dict[str, float]:
    """Each member's leaderboard total: credited meeting time times each meeting's multiplier."""
    multiplier = {str(m["id"]): hours_multiplier(m) for m in meetings}
    totals: dict[str, float] = {}
    for (meeting_id, user_id), seconds in meeting_checkin_seconds(checkin_rows, now).items():
        totals[user_id] = totals.get(user_id, 0.0) + seconds * multiplier.get(meeting_id, MIN_HOURS_MULTIPLIER)
    return totals
