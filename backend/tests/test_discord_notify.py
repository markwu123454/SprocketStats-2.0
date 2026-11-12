"""Discord meeting announcements: message shape, config gating, endpoint wiring.

No network: the message builder is pure, the poster's HTTP client is faked,
and the endpoints' notifier is replaced with a recorder.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.account_state as account_state
import core.discord_notify as discord_notify
import db
from core.discord_notify import discord_configured, meetings_created_message, post_meetings_created
from core.security import get_current_user
from endpoints import meeting_hours
from endpoints.meeting_hours import router

ROLE = "123456789012345678"
START = datetime(2027, 1, 12, 0, 0, tzinfo=timezone.utc)  # Mon Jan 11, 4 PM Pacific


def meeting(start: datetime, hours: int = 4, purpose: str | None = "Build Session") -> dict:
    return {"start_time": start, "end_time": start + timedelta(hours=hours), "meeting_purpose": purpose}


# ── message ────────────────────────────────────────────────────────────────────

def test_single_meeting_pings_role_with_local_timestamps():
    body = meetings_created_message([meeting(START)], ROLE, "https://app.example/")
    ts = int(START.timestamp())
    assert body["content"].splitlines() == [
    f"<@&{ROLE}> New meeting: **Build Session**. If you will be absent, click the link to report it.",
    f"<t:{ts}:F> – <t:{ts + 4 * 3600}:t>",
    "<https://app.example/meetings>",
]
    assert body["allowed_mentions"] == {"parse": [], "roles": [ROLE]}


def test_recurring_series_is_one_message_with_cadence():
    series = [meeting(START + timedelta(days=7 * i)) for i in range(6)]
    content = meetings_created_message(list(reversed(series)), ROLE)["content"]
    assert content.count(f"<@&{ROLE}>") == 1
    assert content.splitlines()[0] == f"<@&{ROLE}> New weekly meetings: **Build Session** · 6 dates"
    assert f"Last: <t:{int(series[-1]['start_time'].timestamp())}:D>" in content


def test_irregular_series_has_no_cadence_word():
    series = [meeting(START), meeting(START + timedelta(days=2)), meeting(START + timedelta(days=9))]
    assert "New meetings: **Build Session** · 3 dates" in meetings_created_message(series, ROLE)["content"]


def test_meeting_name_cannot_inject_markdown_or_mentions():
    body = meetings_created_message([meeting(START, purpose="**Hi** @everyone")], ROLE)
    assert "\\*\\*Hi\\*\\* @everyone" in body["content"]
    assert body["allowed_mentions"]["parse"] == []  # @everyone stays plain text


def test_untitled_and_multi_day_meetings():
    content = meetings_created_message([meeting(START, hours=30, purpose=None)], ROLE)["content"]
    assert "**Team meeting**" in content
    assert f"<t:{int(START.timestamp()) + 30 * 3600}:f>" in content  # end shows its own date


# ── config gating & posting ────────────────────────────────────────────────────

@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("DISCORD_MEETING_WEBHOOK_URL", "https://discord.example/api/webhooks/1/abc")
    monkeypatch.setenv("DISCORD_MEMBER_ROLE_ID", ROLE)
    monkeypatch.delenv("FRONTEND_URL", raising=False)


def test_configured_needs_both_and_a_numeric_role(monkeypatch, configured):
    assert discord_configured()
    monkeypatch.setenv("DISCORD_MEMBER_ROLE_ID", "@member")
    assert not discord_configured()
    monkeypatch.setenv("DISCORD_MEMBER_ROLE_ID", ROLE)
    monkeypatch.delenv("DISCORD_MEETING_WEBHOOK_URL")
    assert not discord_configured()


class FakeClient:
    def __init__(self, calls: list, response=None, error=None):
        self.calls, self.response, self.error = calls, response, error

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json):
        self.calls.append((url, json))
        if self.error:
            raise self.error
        return self.response


def test_post_sends_payload(monkeypatch, configured):
    calls: list = []
    monkeypatch.setattr(discord_notify.httpx, "AsyncClient",
                        lambda **_: FakeClient(calls, response=httpx.Response(204)))
    asyncio.run(post_meetings_created([meeting(START)]))
    assert calls[0][0] == "https://discord.example/api/webhooks/1/abc"
    assert calls[0][1]["allowed_mentions"]["roles"] == [ROLE]


def test_post_swallows_discord_errors(monkeypatch, configured):
    calls: list = []
    monkeypatch.setattr(discord_notify.httpx, "AsyncClient",
                        lambda **_: FakeClient(calls, error=httpx.ConnectError("down")))
    asyncio.run(post_meetings_created([meeting(START)]))  # must not raise
    monkeypatch.setattr(discord_notify.httpx, "AsyncClient",
                        lambda **_: FakeClient(calls, response=httpx.Response(429, text="slow down")))
    asyncio.run(post_meetings_created([meeting(START)]))
    assert len(calls) == 2


def test_post_is_a_no_op_when_unconfigured(monkeypatch):
    monkeypatch.delenv("DISCORD_MEETING_WEBHOOK_URL", raising=False)
    calls: list = []
    monkeypatch.setattr(discord_notify.httpx, "AsyncClient", lambda **_: FakeClient(calls))
    asyncio.run(post_meetings_created([meeting(START)]))
    assert calls == []


# ── endpoints ──────────────────────────────────────────────────────────────────

@pytest.fixture
def api(monkeypatch):
    def row(start, end, purpose):
        return {"id": "m-1", "created_by": "captain-1", "start_time": start, "end_time": end,
                "meeting_purpose": purpose, "agenda": ""}

    monkeypatch.setattr(account_state, "assert_active", AsyncMock())
    monkeypatch.setattr(db, "create_meeting_hours", AsyncMock(side_effect=lambda _u, s, e, p: row(s, e, p)))
    monkeypatch.setattr(db, "create_meeting_hours_batch",
                        AsyncMock(side_effect=lambda _u, slots, p: [row(s, e, p) for s, e in slots]))
    notify = MagicMock()
    monkeypatch.setattr(meeting_hours, "notify_meetings_created", notify)
    app = FastAPI()
    app.include_router(router, prefix="/meeting-hours")
    app.dependency_overrides[get_current_user] = lambda: {"sub": "captain-1", "role": "captain"}
    return TestClient(app), notify


SLOT = {"start_time": "2027-01-12T00:00:00Z", "end_time": "2027-01-12T04:00:00Z"}


def test_create_announces_by_default(api):
    client, notify = api
    assert client.post("/meeting-hours", json={**SLOT, "meeting_purpose": "Build"}).status_code == 200
    assert len(notify.call_args.args[0]) == 1


def test_create_can_skip_discord(api):
    client, notify = api
    client.post("/meeting-hours", json={**SLOT, "notify_discord": False})
    notify.assert_not_called()


def test_batch_announces_once_for_the_whole_series(api):
    client, notify = api
    slots = [SLOT, {"start_time": "2027-01-19T00:00:00Z", "end_time": "2027-01-19T04:00:00Z"}]
    client.post("/meeting-hours/batch", json={"slots": slots, "meeting_purpose": "Build"})
    assert notify.call_count == 1 and len(notify.call_args.args[0]) == 2


def test_discord_status_reflects_config(api, monkeypatch, configured):
    client, _ = api
    assert client.get("/meeting-hours/discord").json() == {"enabled": True}
    monkeypatch.delenv("DISCORD_MEETING_WEBHOOK_URL")
    assert client.get("/meeting-hours/discord").json() == {"enabled": False}
