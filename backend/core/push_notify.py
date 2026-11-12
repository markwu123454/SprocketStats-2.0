"""Automated push notifications: task assignments and scheduled reminders.

Unlike a Control Panel send, which goes straight to ``db.send_web_push``:

  * Each push has a category (``db.PUSH_CATEGORIES``) that users can opt out
    of in Settings; Control Panel announcements have none.
  * Each push is first written to the durable outbox (``db.push_outbox``) and
    sent from there by ``drain_outbox``, which retries with backoff over
    minutes and survives restarts. A drain is kicked off right after queueing,
    so the usual delay is about a second.
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
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import db
from core.permissions import absence_push_roles
from db.push import VAPID_PRIVATE_KEY
from db.push_outbox import OutboxPush

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

# How long an absence / task push stays worth sending if it can't get through.
# Matches the push service's own hold time (db.push.PUSH_TTL_SECONDS).
PUSH_EXPIRY = timedelta(hours=24)

# Outbox drain tuning. A claimed row is reserved for OUTBOX_LEASE_SECONDS; if
# the process dies mid-send, another drain picks the row up after that. Retry
# n waits OUTBOX_RETRY_BASE_SECONDS * 2**(n-1), capped, or the push service's
# Retry-After if longer.
OUTBOX_BATCH_SIZE = 100
OUTBOX_LEASE_SECONDS = 300.0  # > worst-case batch time: 100 sends on a ~12-32 thread pool, 10s timeout each
OUTBOX_RETRY_BASE_SECONDS = 30.0
OUTBOX_RETRY_MAX_SECONDS = 1800.0

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
    key: str  # dedup key for db.claim_reminder_and_enqueue; embeds the start time
    title: str
    body: str
    url: str
    tag: str
    expires_at: datetime  # past this, the reminder is stale and is dropped unsent


# ── Outbox ─────────────────────────────────────────────────────────────────────

def _outbox_retry_delay(attempts: int, retry_after: float | None) -> float:
    """Seconds until the next try of a row that has now failed ``attempts`` times."""
    delay = min(OUTBOX_RETRY_BASE_SECONDS * 2 ** max(attempts - 1, 0), OUTBOX_RETRY_MAX_SECONDS)
    return max(delay, retry_after or 0.0)


_retry_timer: asyncio.TimerHandle | None = None
_retry_at: float | None = None


def _schedule_drain(delay: float) -> None:
    """Drain again in ``delay`` seconds, unless one is already due sooner.

    Only an in-process shortcut for prompt retries: the rows are in the
    database, and the periodic sweep in main.py drains them even if this
    process exits before the timer fires.
    """
    global _retry_timer, _retry_at
    loop = asyncio.get_running_loop()
    at = loop.time() + delay
    if _retry_timer is not None and _retry_at is not None and _retry_at <= at:
        return
    if _retry_timer is not None:
        _retry_timer.cancel()
    _retry_at = at

    def fire():
        global _retry_timer, _retry_at
        _retry_timer = _retry_at = None
        kick_outbox()

    _retry_timer = loop.call_later(delay, fire)


async def _send_row(row) -> tuple[str, float | None]:
    deliv = {"endpoint": row["endpoint"], "p256dh": row["p256dh"], "auth": row["auth"]}
    return await db.send_push_once(deliv, row["title"], row["body"], row["url"], row["tag"])


async def drain_outbox() -> int:
    """Send every due outbox row once. Returns how many the push service accepted.

    Accepted, dead-device and rejected rows are deleted; transient failures are
    rescheduled with backoff until the row's ``expires_at``. Never raises.
    """
    if not VAPID_PRIVATE_KEY:
        return 0
    sent = 0
    soonest_retry: float | None = None
    try:
        while True:
            rows = await db.claim_due_pushes(OUTBOX_BATCH_SIZE, OUTBOX_LEASE_SECONDS)
            if not rows:
                break
            outcomes = await asyncio.gather(*(_send_row(r) for r in rows))
            now = datetime.now(timezone.utc)
            done: list[int] = []
            retry: dict[int, float] = {}
            for row, (outcome, retry_after) in zip(rows, outcomes):
                if outcome == db.PUSH_SENT:
                    sent += 1
                    done.append(row["id"])
                elif outcome == db.PUSH_RETRY:
                    delay = _outbox_retry_delay(row["attempts"], retry_after)
                    if now + timedelta(seconds=delay) >= row["expires_at"]:
                        logger.warning(
                            "push outbox: gave up on a %s push after %d attempt(s): expires before next try",
                            row["category"], row["attempts"],
                        )
                        done.append(row["id"])
                    else:
                        retry[row["id"]] = delay
                        soonest_retry = delay if soonest_retry is None else min(soonest_retry, delay)
                else:  # gone (subscription pruned) or rejected: retrying won't help
                    done.append(row["id"])
            await db.settle_pushes(done, retry)
            if len(rows) < OUTBOX_BATCH_SIZE:
                break
    except Exception as e:
        logger.warning("push outbox drain failed: %s", e)
    if soonest_retry is not None:
        _schedule_drain(soonest_retry)
    return sent


def kick_outbox() -> None:
    """Drain the outbox in the background, without making the caller wait."""
    fire_and_forget(drain_outbox())


async def queue_push(
    user_ids: list[str], category: str, title: str, body: str, url: str | None = None, tag: str | None = None
) -> None:
    """Queue a push to every subscribed device of ``user_ids`` (minus opt-outs) and send it.

    Never raises: callers queue this after the real work (e.g. a task write)
    has already succeeded, and a push failure must not surface there.
    """
    if not VAPID_PRIVATE_KEY or not user_ids:
        return
    push = OutboxPush(category, title, body, url, tag, datetime.now(timezone.utc) + PUSH_EXPIRY, list(user_ids))
    try:
        if await db.enqueue_push(push):
            kick_outbox()
    except Exception as e:
        logger.warning("queue_push(%s) failed: %s", category, e)


def queue_push_later(
    user_ids: list[str], category: str, title: str, body: str, url: str | None = None, tag: str | None = None
) -> None:
    """``queue_push`` without making the caller's request wait on it."""
    fire_and_forget(queue_push(user_ids, category, title, body, url, tag))


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
    queue_push_later([assignee_id], "task_assigned", "New task", body, "/tasks", f"task-{task['id']}")


# ── Meeting absences ───────────────────────────────────────────────────────────

async def absence_push(meeting, absentee: dict) -> OutboxPush | None:
    """The push to queue when ``absentee`` reports a new absence from ``meeting``.

    Goes to the absentee's lead(s) or, for a lead, the captain(s); None when
    nobody should be told (or push isn't configured). ``absentee`` carries
    ``user_id``, ``display_name`` and ``role``. The caller hands the result to
    ``db.upsert_meeting_absence`` so it is queued in the same transaction as
    the absence, then calls ``kick_outbox``.
    """
    if not VAPID_PRIVATE_KEY:
        return None
    roles = absence_push_roles(absentee["role"])
    if not roles:
        return None
    recipient_ids = await db.list_absence_viewer_ids(roles, absentee["user_id"])
    if not recipient_ids:
        return None
    start_local = meeting["start_time"].astimezone(TEAM_TZ)
    # The reason is deliberately not in the push: it can be sensitive and a lock
    # screen is public. Recipients read it on the Meetings page.
    who = absentee["display_name"] or "Someone"
    body = f"{who} will miss {meeting['meeting_purpose'] or 'Team meeting'} · {_short_date(start_local.date())}"
    return OutboxPush(
        "meeting_absence", "Absence reported", body, "/meetings",
        f"absence-{meeting['id']}-{absentee['user_id']}",
        # Past the meeting's end the news is moot; otherwise the usual expiry.
        min(meeting["end_time"], datetime.now(timezone.utc) + PUSH_EXPIRY),
        recipient_ids,
    )


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
                expires_at=start,
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
            reminders.append(Reminder(f"{base_key}:eve", "Event tomorrow", where, url, f"event-{base_key}", day_start))

        morning_at = datetime.combine(start_day, EVENT_MORNING_TIME, TEAM_TZ)
        day_end = day_start + timedelta(days=1)
        if morning_at <= now_local < day_end:
            reminders.append(Reminder(f"{base_key}:day", "Event today", where, url, f"event-{base_key}", day_end))
    return reminders


async def send_due_reminders(now: datetime) -> int:
    """One reminder sweep: claim and queue every due meeting/event reminder.

    Returns how many reminders were queued. Each claim commits together with
    its queued push, so a crash can't burn a claim without the push being owed.
    Skipped entirely without VAPID keys, so a misconfigured deploy doesn't burn
    every claim on sends that no-op.
    """
    if not VAPID_PRIVATE_KEY:
        return 0

    meetings = await db.list_meetings_starting_between(now, now + MEETING_REMINDER_LEAD)
    events = await db.get_events()
    due = [("meeting_reminder", r) for r in due_meeting_reminders(meetings, now)]
    due += [("event_reminder", r) for r in due_event_reminders(events, now)]

    queued = 0
    for category, r in due:
        push = OutboxPush(category, r.title, r.body, r.url, r.tag, r.expires_at)  # user_ids=None: everyone
        try:
            if await db.claim_reminder_and_enqueue(r.key, push):
                queued += 1
        except Exception as e:
            logger.warning("reminder %s failed: %s", r.key, e)
    await db.prune_push_reminders()
    if queued:
        kick_outbox()
    return queued


__all__ = [
    "fire_and_forget",
    "drain_outbox",
    "kick_outbox",
    "queue_push",
    "queue_push_later",
    "notify_task_assigned",
    "absence_push",
    "due_meeting_reminders",
    "due_event_reminders",
    "parse_event_start",
    "send_due_reminders",
]
