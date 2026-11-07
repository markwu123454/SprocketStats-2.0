"""Automated push notifications: task assignments and scheduled reminders.

Everything here goes through ``db.send_web_push`` like a Control Panel send,
but differs in two ways:

  * Each push has a category (``db.PUSH_CATEGORIES``) that users can opt out
    of in Settings; Control Panel announcements have none.
  * Deliveries aren't logged to ``push_delivery_logs`` -- that table backs the
    Control Panel's per-message delivery stats, and these sends have no
    ``push_messages`` row to hang them off.

The reminder logic is split into pure "what's due" functions
(``due_meeting_reminders`` / ``due_event_reminders``) and the I/O-bound sweep
(``send_due_reminders``) so the timing rules are testable with no database.
"""

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import db
from db.push import VAPID_PRIVATE_KEY

logger = logging.getLogger(__name__)

# Meeting times are stored as TIMESTAMPTZ, but `events.start_time` is a naive
# local string ("2026-03-20" / "2027-01-09T09:00"), and reminder text says
# "today"/"tomorrow" -- both need the team's wall-clock zone.
TEAM_TZ = ZoneInfo(os.environ.get("TEAM_TIMEZONE", "America/Los_Angeles"))

# A meeting's reminder goes out once it's this close to starting.
MEETING_REMINDER_LEAD = timedelta(hours=24)
# Competition events get two pushes: the evening before (time to pack) and
# the morning of the first day. Fixed local times rather than "24h before",
# because most events are stored date-only, and 24h before local midnight
# would be a midnight push.
EVENT_EVE_TIME = time(17, 0)
EVENT_MORNING_TIME = time(7, 0)

# Strong references for fire-and-forget sends. asyncio.create_task() only
# holds a *weak* reference to the task -- without this, the task object can be
# garbage-collected mid-flight (before the webpush network calls finish),
# silently dropping the send. See asyncio docs' "Important" note on create_task.
_background_tasks: set[asyncio.Task] = set()


def fire_and_forget(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


@dataclass(frozen=True)
class Reminder:
    key: str  # dedup key for db.claim_push_reminder; embeds the start time
    title: str
    body: str
    url: str
    tag: str


def _deliveries(subs) -> list[dict]:
    return [{"endpoint": s["endpoint"], "p256dh": s["p256dh"], "auth": s["auth"]} for s in subs]


async def notify_users(
    user_ids: list[str], category: str, title: str, body: str, url: str | None = None, tag: str | None = None
) -> None:
    """Push to every subscribed device of ``user_ids``, minus opt-outs.

    Never raises: callers fire this off after the real work (e.g. a task
    write) has already succeeded, and a push failure must not surface there.
    """
    try:
        subs = await db.get_push_subscriptions_for_users(user_ids, category)
        await db.send_web_push(_deliveries(subs), title, body, url, tag)
    except Exception as e:
        logger.warning("notify_users(%s) failed: %s", category, e)


def notify_users_later(
    user_ids: list[str], category: str, title: str, body: str, url: str | None = None, tag: str | None = None
) -> None:
    """``notify_users`` without making the caller's request wait on webpush."""
    fire_and_forget(notify_users(user_ids, category, title, body, url, tag))


async def _notify_everyone(category: str, reminder: Reminder) -> None:
    subs = await db.get_push_subscriptions_for_roles([], category)
    await db.send_web_push(_deliveries(subs), reminder.title, reminder.body, reminder.url, reminder.tag)


# ── Task assignment ────────────────────────────────────────────────────────────

def notify_task_assigned(task, assignee_id: str, actor: dict, as_contributor: bool = False) -> None:
    """Tell ``assignee_id`` that ``actor`` put them on ``task``.

    No-op when someone assigns themselves (claiming, self-adding) -- they
    already know.
    """
    if assignee_id == actor["sub"]:
        return
    who = actor.get("display_name") or actor.get("name") or "Someone"
    verb = "added you to" if as_contributor else "assigned you"
    body = f"{who} {verb} “{task['title']}”"
    if task["due_date"]:
        body += f" · due {_short_date(task['due_date'])}"
    notify_users_later([assignee_id], "task_assigned", "New task", body, "/tasks", f"task-{task['id']}")


# ── Reminders ──────────────────────────────────────────────────────────────────

def _short_date(d: date) -> str:
    return f"{d:%a, %b} {d.day}"


def _clock(dt: datetime) -> str:
    return dt.strftime("%I:%M %p").lstrip("0")


def _relative_day(d: date, today: date) -> str:
    if d == today:
        return "Today"
    if d == today + timedelta(days=1):
        return "Tomorrow"
    return _short_date(d)


def due_meeting_reminders(meetings, now: datetime) -> list[Reminder]:
    """Reminders for meetings starting within MEETING_REMINDER_LEAD of ``now``.

    ``meetings`` is expected to already be filtered to that window (see
    ``db.list_meetings_starting_between``); it's re-checked here so the rule
    lives in one place.
    """
    reminders = []
    today = now.astimezone(TEAM_TZ).date()
    for m in meetings:
        start = m["start_time"]
        if not (now < start <= now + MEETING_REMINDER_LEAD):
            continue
        start_local = start.astimezone(TEAM_TZ)
        end_local = m["end_time"].astimezone(TEAM_TZ)
        reminders.append(
            Reminder(
                key=f"meeting:{m['id']}:{start.isoformat()}",
                title=m["meeting_purpose"] or "Team meeting",
                body=f"{_relative_day(start_local.date(), today)} · {_clock(start_local)} – {_clock(end_local)}",
                url="/dashboard",
                tag=f"meeting-{m['id']}",
            )
        )
    return reminders


def parse_event_start(value: str | None) -> datetime | None:
    """Parse an ``events.start_time`` string into an aware datetime in TEAM_TZ.

    Date-only values mean local midnight; naive datetimes are local wall time
    (matching how the frontend's ``parseEventDate`` reads them). Returns None
    for anything unparseable, so one bad row can't break the sweep.
    """
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=TEAM_TZ)
    return parsed.astimezone(TEAM_TZ)


def due_event_reminders(events: list[dict], now: datetime) -> list[Reminder]:
    """Eve-of and morning-of reminders that are due at ``now``.

    The eve push is due from EVENT_EVE_TIME the day before until midnight;
    the morning push from EVENT_MORNING_TIME on the first day until that day
    ends. Whichever windows ``now`` falls in are returned -- the
    claim ledger is what stops a reminder repeating on later sweeps.
    ``events`` is ``db.get_events()``'s shape.
    """
    reminders = []
    now_local = now.astimezone(TEAM_TZ)
    for ev in events:
        start = parse_event_start(ev.get("start"))
        if start is None:
            continue
        start_day = start.date()
        url = ev["url"] if (ev.get("url") or "").startswith("/") else "/events"
        base_key = f"event:{ev.get('tbaKey') or ev['name']}:{start.isoformat()}"
        where = f"{ev['name']} · {ev['location']}" if ev.get("location") else ev["name"]

        day_start = datetime.combine(start_day, time(0, 0), TEAM_TZ)
        eve_at = datetime.combine(start_day - timedelta(days=1), EVENT_EVE_TIME, TEAM_TZ)
        # Ends at local midnight, not at `start`: past midnight it's no longer
        # "tomorrow", even if the event itself starts later that day.
        if eve_at <= now_local < day_start:
            reminders.append(Reminder(f"{base_key}:eve", "Event tomorrow", where, url, f"event-{base_key}"))

        morning_at = datetime.combine(start_day, EVENT_MORNING_TIME, TEAM_TZ)
        day_end = day_start + timedelta(days=1)
        if morning_at <= now_local < day_end:
            reminders.append(Reminder(f"{base_key}:day", "Event today", where, url, f"event-{base_key}"))
    return reminders


async def send_due_reminders(now: datetime) -> int:
    """One reminder sweep: claim and send every due meeting/event reminder.

    Returns how many reminders went out. Skipped entirely without VAPID keys,
    so a misconfigured deploy doesn't burn every claim on sends that no-op.
    """
    if not VAPID_PRIVATE_KEY:
        return 0

    meetings = await db.list_meetings_starting_between(now, now + MEETING_REMINDER_LEAD)
    events = await db.get_events()
    due = [("meeting_reminder", r) for r in due_meeting_reminders(meetings, now)]
    due += [("event_reminder", r) for r in due_event_reminders(events, now)]

    sent = 0
    for category, reminder in due:
        if not await db.claim_push_reminder(reminder.key):
            continue
        try:
            await _notify_everyone(category, reminder)
            sent += 1
        except Exception as e:
            logger.warning("reminder %s failed: %s", reminder.key, e)
    await db.prune_push_reminders()
    return sent


__all__ = [
    "fire_and_forget",
    "notify_users",
    "notify_users_later",
    "notify_task_assigned",
    "due_meeting_reminders",
    "due_event_reminders",
    "parse_event_start",
    "send_due_reminders",
]
