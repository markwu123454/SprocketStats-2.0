"""What alumni and visitors may reach, enforced on the server.

Visitors need no approval, so anyone with a Google account can be one: they
get the dashboard, settings, event names and dates, and meeting times.
Alumni also get event details, meeting agendas, leaderboards and a read-only
task board. Scouting is closed to both.

No database: the `db.*` calls each route makes are faked, login is overridden
with `get_current_user`, and the ban/approval cache check is stubbed (or made
to raise, for the pending-account tests), so the real role gates run.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import db
from core import account_state
from core.permissions import ROLE_DEFINITIONS, can, get_permissions_for_role, role_requires_approval
from core.security import get_current_user
from endpoints.attendance import router as attendance_router
from endpoints.events import router as events_router
from endpoints.labeling import router as labeling_router
from endpoints.meeting_hours import router as meeting_hours_router
from endpoints.tags import router as tags_router
from endpoints.tasks import router as tasks_router

MEMBER = {"sub": "member-1", "role": "cad_member", "display_name": "Member"}
CAPTAIN = {"sub": "captain-1", "role": "captain", "display_name": "Captain"}
ALUMNI = {"sub": "alum-1", "role": "alumni", "display_name": "Alum"}
VISITOR = {"sub": "visitor-1", "role": "visitor", "display_name": "Guest"}

NOW = datetime.now(timezone.utc)

EVENT = {
    "id": 1, "name": "Regional", "start": "2026-03-20", "end": "2026-03-22", "type": "competition",
    "location": "Somewhere", "url": "https://example.com", "tbaKey": "2026test", "hubKey": "2026test",
    "description": "Bring a jacket", "hiddenTabs": [], "checkinEnabled": True, "checkinRoles": [],
}

MEETING = {
    "id": "8d4f6a3e-2b8f-4c41-9d0c-3f7d2f1d0a11", "created_by": "captain-1",
    "start_time": NOW + timedelta(days=1), "end_time": NOW + timedelta(days=1, hours=2),
    "meeting_purpose": "Build", "hours_multiplier": 1.5, "agenda": "Drivetrain review",
}


# ── The policy itself ───────────────────────────────────────────────────

VISIBILITY = ("meetings.details", "events.details", "leaderboards.view", "scouting.view",
              "tasks.view", "tasks.participate")


def test_visitor_policy_grants_nothing_beyond_schedules():
    perms = get_permissions_for_role("visitor")
    assert not any(can(perms, path) for path in VISIBILITY)
    assert not role_requires_approval("visitor")


def test_alumni_see_everything_but_scouting_and_cannot_change_tasks():
    perms = get_permissions_for_role("alumni")
    assert can(perms, "meetings.details")
    assert can(perms, "events.details")
    assert can(perms, "leaderboards.view")
    assert can(perms, "tasks.view")
    assert not can(perms, "tasks.participate")
    assert not can(perms, "scouting.view")


def test_every_team_role_sees_everything():
    for role in set(ROLE_DEFINITIONS) - {"alumni", "visitor"}:
        perms = get_permissions_for_role(role)
        assert all(can(perms, path) for path in VISIBILITY), role


# ── Endpoints ───────────────────────────────────────────────────────────

@pytest.fixture
def active(monkeypatch):
    """The ban/approval check; passes unless a test gives it a side effect."""
    check = AsyncMock()
    monkeypatch.setattr(account_state, "assert_active", check)
    return check


@pytest.fixture
def app(monkeypatch, active):
    monkeypatch.setattr(db, "get_events", AsyncMock(return_value=[dict(EVENT)]))
    monkeypatch.setattr(db, "get_comp_event", AsyncMock(return_value={"event_key": "2026test", "roster": []}))
    monkeypatch.setattr(db, "get_comp_event_keys", AsyncMock(return_value=["2026test"]))
    monkeypatch.setattr(db, "list_all_attendance", AsyncMock(return_value=[]))
    monkeypatch.setattr(db, "list_meeting_checkins", AsyncMock(return_value=[]))
    monkeypatch.setattr(db, "list_all_meeting_hours", AsyncMock(return_value=[dict(MEETING)]))
    monkeypatch.setattr(db, "list_meeting_absences", AsyncMock(return_value=[]))
    monkeypatch.setattr(db, "list_tasks", AsyncMock(return_value=[]))
    monkeypatch.setattr(db, "list_task_people", AsyncMock(return_value=[
        {"id": "member-1", "display_name": "Member", "role": "cad_member", "approved_by": None},
        {"id": "alum-1", "display_name": "Alum", "role": "alumni", "approved_by": None},
        {"id": "visitor-1", "display_name": "Guest", "role": "visitor", "approved_by": None},
    ]))
    monkeypatch.setattr(db, "get_all_tag_assignments", AsyncMock(return_value={}))
    monkeypatch.setattr(db, "get_user_tags", AsyncMock(return_value=[]))

    fastapi_app = FastAPI()
    fastapi_app.include_router(events_router, prefix="/events")
    fastapi_app.include_router(attendance_router, prefix="/attendance")
    fastapi_app.include_router(labeling_router, prefix="/labeling")
    fastapi_app.include_router(meeting_hours_router, prefix="/meeting-hours")
    fastapi_app.include_router(tags_router, prefix="/tags")
    fastapi_app.include_router(tasks_router, prefix="/tasks")
    return fastapi_app


def _as(app: FastAPI, user: dict) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_visitor_gets_event_names_dates_and_types_only(app):
    events = _as(app, VISITOR).get("/events").json()
    assert events == [{"id": 1, "name": "Regional", "start": "2026-03-20", "end": "2026-03-22", "type": "competition"}]


def test_alumni_get_the_full_schedule(app):
    assert _as(app, ALUMNI).get("/events").json() == [EVENT]


@pytest.mark.parametrize("method, path", [
    ("get", "/events/2026test/info"),
    ("get", "/events/2026test/update"),
    ("get", "/events/list_events"),
    ("get", "/events/2026test/check-in"),
    ("post", "/events/2026test/check-in"),
    ("post", "/events/2026test/check-in/dismiss"),
    ("patch", "/events/2026test/roster/visitor-1"),
])
def test_visitor_cannot_open_event_hubs_or_check_in(app, method, path):
    assert getattr(_as(app, VISITOR), method)(path).status_code == 403


def test_alumni_can_open_event_hubs(app, monkeypatch):
    monkeypatch.setattr("endpoints.events._fetch_live", AsyncMock(return_value=([], None, None)))
    assert _as(app, ALUMNI).get("/events/2026test/info").status_code == 200


def test_visitor_gets_meeting_times_without_agendas(app):
    meetings = _as(app, VISITOR).get("/meeting-hours").json()
    assert len(meetings) == 1
    assert meetings[0].keys() == {"id", "start_time", "end_time", "meeting_purpose"}


def test_alumni_get_meeting_agendas(app):
    assert _as(app, ALUMNI).get("/meeting-hours").json()[0]["agenda"] == "Drivetrain review"


@pytest.mark.parametrize("method, path, body", [
    ("get", "/meeting-hours/absences", None),
    ("put", f"/meeting-hours/{MEETING['id']}/absence", {"reason": "Sick"}),
    ("delete", f"/meeting-hours/{MEETING['id']}/absence", None),
])
def test_visitor_cannot_read_or_report_absences(app, method, path, body):
    client = _as(app, VISITOR)
    resp = client.request(method.upper(), path, json=body)
    assert resp.status_code == 403


def test_leaderboard_is_closed_to_visitors_and_open_to_alumni(app):
    assert _as(app, VISITOR).get("/attendance/leaderboard").status_code == 403
    assert _as(app, ALUMNI).get("/attendance/leaderboard").status_code == 200


@pytest.mark.parametrize("user", [ALUMNI, VISITOR])
def test_scouting_data_is_closed_to_alumni_and_visitors(app, user):
    assert _as(app, user).get("/labeling").status_code == 403


def test_task_board_is_closed_to_visitors(app):
    client = _as(app, VISITOR)
    assert client.get("/tasks").status_code == 403
    assert client.get("/tasks/people").status_code == 403


@pytest.mark.parametrize("method, path, body", [
    ("post", "/tasks", {"title": "X", "bucket": "general"}),
    ("patch", "/tasks/t1", {"status": "doing"}),
    ("post", "/tasks/t1/claim", None),
    ("post", "/tasks/t1/contributors", None),
    ("delete", "/tasks/t1/contributors/me", None),
    ("post", "/tasks/t1/review", None),
    ("delete", "/tasks/t1", None),
    ("post", "/tasks/t1/notes", {"body": "hi"}),
    ("delete", "/tasks/t1/notes/n1", None),
])
def test_alumni_task_board_is_read_only(app, method, path, body):
    client = _as(app, ALUMNI)
    assert client.get("/tasks").status_code == 200
    assert client.request(method.upper(), path, json=body).status_code == 403


def test_people_who_cannot_take_part_are_not_assignable(app):
    people = _as(app, MEMBER).get("/tasks/people").json()
    assert [p["id"] for p in people] == ["member-1"]


def test_tag_reads_need_roster_access_except_your_own(app):
    member = _as(app, MEMBER)
    assert member.get("/tags/assignments").status_code == 403
    assert member.get("/tags/user/captain-1").status_code == 403
    assert member.get("/tags/user/member-1").status_code == 200
    assert _as(app, CAPTAIN).get("/tags/assignments").status_code == 200


@pytest.mark.parametrize("path", [
    "/events", "/meeting-hours", "/attendance/leaderboard", "/attendance/meetings",
    "/events/2026test/info", "/tasks", "/tags/user/captain-1",
])
def test_pending_or_banned_accounts_are_refused(app, active, path):
    active.side_effect = HTTPException(status_code=403, detail="Account pending approval")
    assert _as(app, CAPTAIN).get(path).status_code == 403
