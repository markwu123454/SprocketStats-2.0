"""Bootstrap prefetch endpoint: guards and failure isolation.

No database: every handler the registry calls is replaced on the bootstrap
module with a stub returning a marker, and `account_state.assert_active` is
patched, so the tests check only what bootstrap itself owns -- which keys it
includes, and that one failure never takes the rest down.
"""

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from endpoints import bootstrap as bs

NEW_KEYS = {
    "tasks", "task_people", "meeting_schedule", "meeting_absences",
    "attendance_leaderboard", "roles",
}
ACTIVE_KEYS = {"tasks", "task_people", "meeting_schedule", "meeting_absences"}

MEMBER = {"sub": "member-1", "role": "cad_member"}
CAPTAIN = {"sub": "captain-1", "role": "captain"}

HANDLERS = [
    "list_events", "get_meetings", "get_all_assignments", "get_user_tags",
    "list_members", "get_current_event_info", "list_event_keys", "list_tasks",
    "list_task_people", "list_meeting_schedule", "list_meeting_absences",
    "get_leaderboard", "auth_roles",
]


@pytest.fixture
def handlers(monkeypatch):
    """Stub every handler (marker return value) and make assert_active pass."""
    stubs = {}
    for name in HANDLERS:
        stubs[name] = AsyncMock(return_value=f"{name}-result")
        monkeypatch.setattr(bs, name, stubs[name])
    stubs["assert_active"] = AsyncMock(return_value=None)
    monkeypatch.setattr(bs.account_state, "assert_active", stubs["assert_active"])
    return stubs


async def test_new_keys_present_for_active_user(handlers):
    result = await bs.bootstrap(MEMBER)
    assert NEW_KEYS <= result.keys()
    handlers["assert_active"].assert_awaited_once_with("member-1")
    handlers["list_tasks"].assert_awaited_once_with(None, MEMBER)
    handlers["list_task_people"].assert_awaited_once_with(MEMBER)
    handlers["list_meeting_schedule"].assert_awaited_once_with(MEMBER)
    handlers["list_meeting_absences"].assert_awaited_once_with(MEMBER)
    handlers["get_leaderboard"].assert_awaited_once_with(MEMBER)
    handlers["auth_roles"].assert_awaited_once_with(MEMBER)
    assert result["tasks"] == "list_tasks-result"


async def test_active_keys_absent_when_not_active(handlers):
    handlers["assert_active"].side_effect = HTTPException(status_code=403)
    result = await bs.bootstrap(MEMBER)
    assert not (ACTIVE_KEYS & result.keys())
    for name in ("list_tasks", "list_task_people", "list_meeting_schedule", "list_meeting_absences"):
        handlers[name].assert_not_awaited()
    # Unguarded keys are unaffected.
    assert {"attendance_leaderboard", "roles", "events", "meetings"} <= result.keys()


async def test_members_roster_guard(handlers):
    assert "members" not in await bs.bootstrap(MEMBER)
    handlers["list_members"].assert_not_awaited()
    assert (await bs.bootstrap(CAPTAIN))["members"] == "list_members-result"


async def test_failing_factory_only_drops_its_key(handlers):
    handlers["list_tasks"].side_effect = RuntimeError("boom")
    result = await bs.bootstrap(MEMBER)
    assert "tasks" not in result
    assert (NEW_KEYS - {"tasks"}) <= result.keys()
    assert "events" in result


async def test_factory_raising_synchronously_is_dropped(handlers, monkeypatch):
    def explode(*_a, **_k):
        raise ValueError("sync boom")

    monkeypatch.setattr(bs, "get_leaderboard", explode)
    result = await bs.bootstrap(MEMBER)
    assert "attendance_leaderboard" not in result
    assert "roles" in result
