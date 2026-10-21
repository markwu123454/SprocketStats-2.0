"""Timing rules for automated reminders (core.push_notify), with no database.

``due_meeting_reminders`` / ``due_event_reminders`` are pure functions of the
rows and "now", so every window edge is checked directly. The sweep itself
(``send_due_reminders``) is covered with the db calls monkeypatched, mainly to
pin that a claimed reminder is never sent twice.
"""

from datetime import datetime, timedelta, timezone

import pytest

import db
from core import push_notify
from core.push_notify import TEAM_TZ, due_event_reminders, due_meeting_reminders, parse_event_start


def _local(*args) -> datetime:
    return datetime(*args, tzinfo=TEAM_TZ)


def _meeting(start: datetime, hours: float = 2, purpose: str | None = None, mid: str = "m1") -> dict:
    return {"id": mid, "start_time": start, "end_time": start + timedelta(hours=hours), "meeting_purpose": purpose}


# ── Meetings ────────────────────────────────────────────────────────────────

def test_meeting_within_24h_is_due_with_tomorrow_label():
    now = _local(2026, 10, 21, 15, 0)
    [r] = due_meeting_reminders([_meeting(_local(2026, 10, 22, 14, 30), purpose="Build session")], now)
    assert r.title == "Build session"
    assert r.body == "Tomorrow · 2:30 PM – 4:30 PM"
    assert r.key.startswith("meeting:m1:")


def test_meeting_later_today_says_today_and_defaults_title():
    now = _local(2026, 10, 21, 9, 0)
    [r] = due_meeting_reminders([_meeting(_local(2026, 10, 21, 18, 0))], now)
    assert r.title == "Team meeting"
    assert r.body.startswith("Today · 6:00 PM")


def test_meeting_more_than_24h_out_or_already_started_is_not_due():
    now = _local(2026, 10, 21, 12, 0)
    meetings = [
        _meeting(now + timedelta(hours=24, minutes=1), mid="far"),
        _meeting(now - timedelta(minutes=5), mid="started"),
    ]
    assert due_meeting_reminders(meetings, now) == []


def test_rescheduled_meeting_gets_a_new_key():
    now = _local(2026, 10, 21, 12, 0)
    [a] = due_meeting_reminders([_meeting(_local(2026, 10, 22, 9, 0))], now)
    [b] = due_meeting_reminders([_meeting(_local(2026, 10, 22, 10, 0))], now)
    assert a.key != b.key


def test_meeting_time_is_rendered_in_team_timezone():
    now = datetime(2026, 10, 21, 20, 0, tzinfo=timezone.utc)
    start_utc = datetime(2026, 10, 22, 1, 0, tzinfo=timezone.utc)  # 6:00 PM in Los Angeles (PDT)
    [r] = due_meeting_reminders([_meeting(start_utc)], now)
    assert "6:00 PM" in r.body
    assert r.body.startswith("Today")


# ── Events ──────────────────────────────────────────────────────────────────

EVENT = {"name": "Silicon Valley Regional", "start": "2026-03-20", "location": "San Jose, CA",
         "type": "regional", "url": "/events/2026casj", "tbaKey": "2026casj"}


def test_parse_event_start_handles_date_only_naive_and_aware():
    assert parse_event_start("2026-03-20") == _local(2026, 3, 20, 0, 0)
    assert parse_event_start("2027-01-09T09:00") == _local(2027, 1, 9, 9, 0)
    assert parse_event_start("2027-01-09T17:00:00+00:00") == _local(2027, 1, 9, 9, 0)
    assert parse_event_start("not a date") is None
    assert parse_event_start(None) is None


def test_event_eve_reminder_window():
    assert due_event_reminders([EVENT], _local(2026, 3, 19, 16, 59)) == []
    [r] = due_event_reminders([EVENT], _local(2026, 3, 19, 17, 0))
    assert r.title == "Event tomorrow"
    assert r.body == "Silicon Valley Regional · San Jose, CA"
    assert r.url == "/events/2026casj"
    assert r.key.endswith(":eve")


def test_event_morning_of_reminder_window():
    # Midnight to 7am on the day: nothing (eve window closed, morning not open).
    assert due_event_reminders([EVENT], _local(2026, 3, 20, 6, 59)) == []
    [r] = due_event_reminders([EVENT], _local(2026, 3, 20, 7, 0))
    assert r.title == "Event today"
    assert r.key.endswith(":day")
    # Only the first day of a multi-day event.
    assert due_event_reminders([{**EVENT, "end": "2026-03-21"}], _local(2026, 3, 21, 9, 0)) == []


def test_event_starting_late_on_its_day_never_says_tomorrow_that_morning():
    ev = {**EVENT, "start": "2026-03-20T18:00"}
    reminders = due_event_reminders([ev], _local(2026, 3, 20, 8, 0))
    assert [r.title for r in reminders] == ["Event today"]


def test_event_external_url_falls_back_to_events_page_and_bad_rows_are_skipped():
    ev = {**EVENT, "url": "https://example.com/x"}
    bad = {**EVENT, "start": "TBD"}
    [r] = due_event_reminders([ev, bad], _local(2026, 3, 19, 18, 0))
    assert r.url == "/events"


# ── Sweep ───────────────────────────────────────────────────────────────────

@pytest.fixture
def sweep(monkeypatch):
    state = {"claimed": set(), "sent": [], "meetings": [], "events": []}

    async def list_meetings(start, end):
        return state["meetings"]

    async def get_events():
        return state["events"]

    async def claim(key):
        if key in state["claimed"]:
            return False
        state["claimed"].add(key)
        return True

    async def subs_for_roles(roles, category):
        return [{"endpoint": f"https://push.example/{category}", "p256dh": "p", "auth": "a"}]

    async def send(deliveries, title, body, url=None, tag=None):
        state["sent"].append((deliveries[0]["endpoint"], title))

    async def prune():
        pass

    monkeypatch.setattr(push_notify, "VAPID_PRIVATE_KEY", "test-key")
    monkeypatch.setattr(db, "list_meetings_starting_between", list_meetings)
    monkeypatch.setattr(db, "get_events", get_events)
    monkeypatch.setattr(db, "claim_push_reminder", claim)
    monkeypatch.setattr(db, "get_push_subscriptions_for_roles", subs_for_roles)
    monkeypatch.setattr(db, "send_web_push", send)
    monkeypatch.setattr(db, "prune_push_reminders", prune)
    return state


async def test_sweep_sends_each_reminder_once_under_its_category(sweep):
    now = _local(2026, 3, 19, 18, 0)
    sweep["meetings"] = [_meeting(_local(2026, 3, 20, 9, 0))]
    sweep["events"] = [EVENT]

    assert await push_notify.send_due_reminders(now) == 2
    assert sorted(sweep["sent"]) == [
        ("https://push.example/event_reminder", "Event tomorrow"),
        ("https://push.example/meeting_reminder", "Team meeting"),
    ]
    # The next tick finds the same reminders due but already claimed.
    assert await push_notify.send_due_reminders(now + timedelta(minutes=5)) == 0
    assert len(sweep["sent"]) == 2


async def test_sweep_is_skipped_without_vapid_key(sweep, monkeypatch):
    monkeypatch.setattr(push_notify, "VAPID_PRIVATE_KEY", None)
    sweep["events"] = [EVENT]
    assert await push_notify.send_due_reminders(_local(2026, 3, 19, 18, 0)) == 0
    assert sweep["claimed"] == set()
