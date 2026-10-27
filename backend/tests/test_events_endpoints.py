"""Endpoint-level tests for the check-in, roster-update, and content-PATCH
routes on the Events router (endpoints/events.py).

Runs with no real database: every `db.*` call the router makes is
monkeypatched to an in-memory FakeStore that mimics the `comp_events` and
`events` tables' relevant shape closely enough to exercise the business rules
the endpoints enforce -- idempotent check-in (role/phone/days all held fixed
on repeat calls), roster/links/event_name never touched by the content PATCH,
the 404-never-creates rule, and the day-range check against a schedule row.

Auth is bypassed via a FastAPI dependency override on `require_active` (the
login-only gate on the check-in and roster-update routes) the same way
test_tasks_endpoints.py does it; the roster-update route's `events.edit`
authorization is plain inline logic, so overriding `require_active` to supply
a real caller is enough to exercise it for real -- no dependency-override
trick needed. The content-PATCH and PUT routes are different: they're gated
by `require_access(...)` instances (one named, `require_event_edit`; one
anonymous), so their permission-denied/round-trip tests instead override only
`get_current_user` and stub out the account-state ban/approval check, letting
the real permission dependency run against a role that does/doesn't hold the
needed capability.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.account_state as account_state
import db
from core.security import get_current_user, require_active
from endpoints.events import require_event_edit
from endpoints.events import router as events_router

MEMBER = {"sub": "member-1", "role": "cad_member", "display_name": "Member One"}
LEAD = {"sub": "lead-1", "role": "cad_lead", "display_name": "Lead One"}
CAPTAIN = {"sub": "captain-1", "role": "captain", "display_name": "Captain One"}


class FakeStore:
    """In-memory stand-in for the `comp_events` and `events` tables, shaped
    like the real `db.comp_events` functions (see backend/db/comp_events.py)."""

    def __init__(self):
        self.events: dict[str, dict] = {}
        # event_key -> {"start_time": ..., "end_time": ...}, mirroring the
        # `events` table row `get_event_schedule` looks up by tba_key.
        self.schedules: dict[str, dict] = {}

    def add_event(self, event_key: str, **overrides) -> str:
        row = {
            "event_key": event_key,
            "event_name": "Test Event",
            "links": None,
            "itinerary": [],
            "packing_list": [],
            "instructions": [],
            "roster": [],
        }
        row.update(overrides)
        self.events[event_key] = row
        return event_key

    def add_schedule(self, event_key: str, start_time: str, end_time: str | None = None,
                     checkin_opens: str | None = None, checkin_enabled: bool = True) -> None:
        self.schedules[event_key] = {"start_time": start_time, "end_time": end_time, "checkin_opens": checkin_opens,
                                     "checkin_enabled": checkin_enabled}

    # -- db.comp_events-shaped async methods, monkeypatched onto `db` --

    async def get_comp_event(self, event_key):
        row = self.events.get(event_key)
        return dict(row) if row else None

    async def upsert_comp_event(self, event_key, content):
        data = content.model_dump()
        row = {
            "event_key": event_key,
            "event_name": data["event_name"],
            "links": data.get("links"),
            "itinerary": data.get("itinerary"),
            "packing_list": data.get("packing_list"),
            "instructions": data.get("instructions"),
            "roster": data.get("roster"),
        }
        self.events[event_key] = row
        return dict(row)

    async def add_roster_member(self, event_key, member):
        row = self.events.get(event_key)
        if row is None:
            return None
        # A NULL roster counts as empty, like the real query's COALESCE.
        if row.get("roster") is None:
            row["roster"] = []
        roster = row["roster"]
        if any(entry.get("user_id") == member["user_id"] for entry in roster):
            return roster
        roster.append(member)
        return roster

    async def is_on_roster(self, event_key, user_id):
        row = self.events.get(event_key)
        if row is None:
            return None
        return any(entry.get("user_id") == user_id for entry in row.get("roster") or [])

    async def update_comp_event_content(self, event_key, fields):
        if not fields:
            raise ValueError("update_comp_event_content requires at least one field to set")
        row = self.events.get(event_key)
        if row is None:
            return None
        row.update(fields)
        return dict(row)

    async def update_roster_member(self, event_key, user_id, fields):
        if not fields:
            raise ValueError("update_roster_member requires at least one field to set")
        row = self.events.get(event_key)
        if row is None:
            return None
        roster = row.get("roster") or []
        for entry in roster:
            if entry.get("user_id") == user_id:
                entry.update(fields)
                return roster
        raise db.RosterMemberNotFound(user_id)

    async def get_event_schedule(self, event_key):
        schedule = self.schedules.get(event_key)
        return dict(schedule) if schedule else None

    async def ensure_comp_event(self, event_key):
        # A schedule row stands in for an `events` row with this tba_key.
        if event_key in self.schedules and event_key not in self.events:
            self.add_event(event_key, itinerary=None, packing_list=None, instructions=None, roster=None)

    # -- db.events-shaped: `events` rows by id, in get_events()'s shape --

    def add_schedule_row(self, event_id: int, **overrides) -> None:
        row = {"id": event_id, "name": "Test Event", "start": "2026-03-19", "end": "2026-03-21",
               "location": "Here", "type": "Competition", "hiddenTabs": []}
        row.update(overrides)
        self.schedule_rows[event_id] = row

    async def get_event_by_id(self, event_id):
        row = self.schedule_rows.get(event_id)
        return dict(row) if row else None

    async def update_event_schedule(self, event_id, fields):
        row = self.schedule_rows.get(event_id)
        if row is None:
            return None
        api_names = {"start": "start", "end": "end", "checkin_opens": "checkinOpens", "hidden_tabs": "hiddenTabs",
                     "description": "description", "checkin_enabled": "checkinEnabled"}
        for key, val in fields.items():
            row[api_names[key]] = val
        return dict(row)


@pytest.fixture
def store(monkeypatch):
    fake = FakeStore()
    fake.schedule_rows = {}
    for name in (
        "get_comp_event", "upsert_comp_event", "add_roster_member", "is_on_roster",
        "update_comp_event_content", "update_roster_member", "get_event_schedule",
        "get_event_by_id", "update_event_schedule", "ensure_comp_event",
    ):
        monkeypatch.setattr(db, name, getattr(fake, name))
    return fake


@pytest.fixture
def app():
    fastapi_app = FastAPI()
    fastapi_app.include_router(events_router, prefix="/events")
    return fastapi_app


def _as(app: FastAPI, user: dict) -> TestClient:
    """A TestClient acting as `user` (overrides the require_active gate used
    by the check-in routes, and the require_event_edit gate used by PATCH)."""
    app.dependency_overrides[require_active] = lambda: user
    app.dependency_overrides[require_event_edit] = lambda: user
    return TestClient(app)


# ── Check-in: GET status ────────────────────────────────────────────────

def test_check_in_status_false_when_not_on_roster(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).get("/events/2026test/check-in")
    assert resp.status_code == 200
    assert resp.json() == {"checked_in": False}


def test_check_in_status_true_when_on_roster(app, store):
    store.add_event("2026test", roster=[{"user_id": "member-1", "display_name": "Member One",
                                          "role": "attending", "phone": None}])
    resp = _as(app, MEMBER).get("/events/2026test/check-in")
    assert resp.status_code == 200
    assert resp.json() == {"checked_in": True}


def test_check_in_status_404_unknown_event(app, store):
    resp = _as(app, MEMBER).get("/events/does-not-exist/check-in")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Event not found"


# ── Check-in: POST (self check-in) ──────────────────────────────────────

def test_check_in_adds_caller_once(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in")
    assert resp.status_code == 200
    body = resp.json()
    assert body["checked_in"] is True
    assert body["roster"] == [
        {"user_id": "member-1", "display_name": "Member One",
         "role": "attending", "phone": None, "days": None}
    ]


def test_check_in_twice_does_not_duplicate(app, store):
    store.add_event("2026test")
    client = _as(app, MEMBER)
    resp1 = client.post("/events/2026test/check-in")
    resp2 = client.post("/events/2026test/check-in")
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert len(resp2.json()["roster"]) == 1
    assert resp2.json()["roster"][0]["user_id"] == "member-1"


def test_check_in_404_unknown_event(app, store):
    resp = _as(app, MEMBER).post("/events/does-not-exist/check-in")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Event not found"


def test_check_in_falls_back_when_display_name_claim_is_none(app, store):
    # An account that hasn't finished onboarding has a null display_name
    # claim (require_active doesn't check onboarding), but the roster entry
    # must still get a non-empty string name -- see RosterMember.display_name.
    store.add_event("2026test")
    user = {"sub": "pending-1", "role": "cad_member", "display_name": None, "name": "Pending User"}
    resp = _as(app, user).post("/events/2026test/check-in")
    assert resp.status_code == 200
    entry = resp.json()["roster"][0]
    assert isinstance(entry["display_name"], str)
    assert entry["display_name"] != ""
    assert entry["display_name"] == "Pending User"


# ── Check-in: chosen role and phone ─────────────────────────────────────

def test_check_in_no_body_defaults_to_attending(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in")
    assert resp.status_code == 200
    entry = resp.json()["roster"][0]
    assert entry["role"] == "attending"
    assert entry["phone"] is None


def test_check_in_body_without_role_defaults_to_attending(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"phone": "555-123-4567"})
    assert resp.status_code == 200
    entry = resp.json()["roster"][0]
    assert entry["role"] == "attending"
    assert entry["phone"] == "555-123-4567"


@pytest.mark.parametrize("role", ["drive_team", "pit_crew", "attending", "mentor"])
def test_check_in_accepts_each_self_selectable_role(app, store, role):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"role": role})
    assert resp.status_code == 200
    assert resp.json()["roster"][0]["role"] == role


def test_check_in_rejects_non_self_selectable_role(app, store):
    # "captain" is a real roster role (hand-seeded data can hold it) but is
    # not one of the four ASSIGNABLE_ROLES -- not self-selectable at check-in,
    # and not settable via the roster-role PATCH either.
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"role": "captain"})
    assert resp.status_code == 422


def test_check_in_blank_phone_becomes_null(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"phone": "   "})
    assert resp.status_code == 200
    assert resp.json()["roster"][0]["phone"] is None


def test_check_in_rejects_bad_phone(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"phone": "not a phone"})
    assert resp.status_code == 422


def test_check_in_rejects_too_few_digits_in_phone(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"phone": "123"})
    assert resp.status_code == 422


def test_check_in_second_call_with_different_role_does_not_change_entry(app, store):
    store.add_event("2026test")
    client = _as(app, MEMBER)
    resp1 = client.post(
        "/events/2026test/check-in", json={"role": "mentor", "phone": "555-000-1111"}
    )
    resp2 = client.post(
        "/events/2026test/check-in", json={"role": "pit_crew", "phone": "555-999-8888"}
    )
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert len(resp2.json()["roster"]) == 1
    entry = resp2.json()["roster"][0]
    assert entry["role"] == "mentor"
    assert entry["phone"] == "555-000-1111"


# ── Check-in: chosen days ────────────────────────────────────────────────

def test_check_in_days_omitted_is_null(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in")
    assert resp.status_code == 200
    assert resp.json()["roster"][0]["days"] is None


def test_check_in_days_stored_sorted_and_deduplicated(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post(
        "/events/2026test/check-in",
        json={"days": ["2026-03-21", "2026-03-20", "2026-03-21"]},
    )
    assert resp.status_code == 200
    assert resp.json()["roster"][0]["days"] == ["2026-03-20", "2026-03-21"]


def test_check_in_days_empty_list_422(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"days": []})
    assert resp.status_code == 422


def test_check_in_days_malformed_date_422(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"days": ["03/20/2026"]})
    assert resp.status_code == 422


def test_check_in_days_datetime_string_422(app, store):
    store.add_event("2026test")
    resp = _as(app, MEMBER).post(
        "/events/2026test/check-in", json={"days": ["2026-03-20T10:00:00"]}
    )
    assert resp.status_code == 422


def test_check_in_days_too_many_422(app, store):
    store.add_event("2026test")
    days = [f"2026-01-{d:02d}" for d in range(1, 33)]  # 32 distinct days
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"days": days})
    assert resp.status_code == 422


def test_check_in_days_out_of_range_422(app, store):
    store.add_event("2026test")
    store.add_schedule("2026test", start_time="2026-03-20", end_time="2026-03-21")
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"days": ["2026-03-22"]})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Days must be within the event's dates"


def test_check_in_days_in_range_accepted(app, store):
    store.add_event("2026test")
    store.add_schedule("2026test", start_time="2026-03-20", end_time="2026-03-21")
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"days": ["2026-03-20"]})
    assert resp.status_code == 200
    assert resp.json()["roster"][0]["days"] == ["2026-03-20"]


def test_check_in_days_range_check_skipped_without_schedule_row(app, store):
    # No store.add_schedule call for this event -- get_event_schedule returns
    # None, so any day is accepted regardless of how far-fetched it is.
    store.add_event("2026test")
    resp = _as(app, MEMBER).post("/events/2026test/check-in", json={"days": ["1999-01-01"]})
    assert resp.status_code == 200
    assert resp.json()["roster"][0]["days"] == ["1999-01-01"]


def test_check_in_days_single_day_event_null_end_accepts_only_that_day(app, store):
    store.add_event("2026test")
    store.add_schedule("2026test", start_time="2026-03-20", end_time=None)
    ok = _as(app, MEMBER).post("/events/2026test/check-in", json={"days": ["2026-03-20"]})
    assert ok.status_code == 200

    store.events["2026test"]["roster"] = []  # reset for the second call
    bad = _as(app, MEMBER).post("/events/2026test/check-in", json={"days": ["2026-03-21"]})
    assert bad.status_code == 422


def test_check_in_repeat_call_keeps_original_days(app, store):
    store.add_event("2026test")
    client = _as(app, MEMBER)
    resp1 = client.post("/events/2026test/check-in", json={"days": ["2026-03-20"]})
    resp2 = client.post("/events/2026test/check-in", json={"days": ["2026-03-21"]})
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert len(resp2.json()["roster"]) == 1
    assert resp2.json()["roster"][0]["days"] == ["2026-03-20"]


# ── PATCH roster/{user_id}: role and/or days ────────────────────────────
#
# The route's dependency is just `require_active` (login) now -- `_as(app,
# user)` supplies the real caller, and the endpoint's own inline
# `events.edit` check runs for real against that user's actual role. No
# dependency-override trick is needed to exercise it, unlike the
# `require_event_edit`-gated content PATCH below.

def test_patch_roster_role_changes_only_role_field(app, store):
    store.add_event(
        "2026test",
        roster=[
            {"user_id": "u1", "display_name": "User One",
             "role": "attending", "phone": "555-1111111", "days": ["2026-03-20"]},
            {"user_id": "u2", "display_name": "User Two", "role": "pit_crew", "phone": None},
        ],
    )
    resp = _as(app, LEAD).patch("/events/2026test/roster/u1", json={"role": "drive_team"})
    assert resp.status_code == 200
    roster = resp.json()["roster"]
    assert roster[0] == {"user_id": "u1", "display_name": "User One", "role": "drive_team",
                          "phone": "555-1111111", "days": ["2026-03-20"]}
    # Order and the other member are untouched.
    assert roster[1] == {"user_id": "u2", "display_name": "User Two",
                          "role": "pit_crew", "phone": None}


@pytest.mark.parametrize("role", ["drive_team", "pit_crew", "attending", "mentor"])
def test_patch_roster_role_accepts_each_assignable_role(app, store, role):
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One", "role": "attending", "phone": None}],
    )
    resp = _as(app, LEAD).patch("/events/2026test/roster/u1", json={"role": role})
    assert resp.status_code == 200
    assert resp.json()["roster"][0]["role"] == role


def test_patch_roster_role_rejects_unknown_role(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One", "role": "attending", "phone": None}],
    )
    resp = _as(app, LEAD).patch("/events/2026test/roster/u1", json={"role": "not_a_role"})
    assert resp.status_code == 422


@pytest.mark.parametrize("role", ["chaperone", "captain", "lead"])
def test_patch_roster_role_rejects_non_assignable_roster_roles(app, store, role):
    # These are real roster roles (hand-seeded data can hold them, see
    # ROLE_ORDER in frontend/src/pages/events/RosterPage.tsx), but a
    # privileged editor can only move a member to one of the four
    # ASSIGNABLE_ROLES, same as self check-in.
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One", "role": "attending", "phone": None}],
    )
    resp = _as(app, LEAD).patch("/events/2026test/roster/u1", json={"role": role})
    assert resp.status_code == 422


def test_patch_roster_404_unknown_member(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One", "role": "attending", "phone": None}],
    )
    resp = _as(app, LEAD).patch("/events/2026test/roster/ghost", json={"role": "mentor"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Roster member not found"


def test_patch_roster_404_unknown_event(app, store):
    resp = _as(app, LEAD).patch("/events/does-not-exist/roster/u1", json={"role": "mentor"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Event not found"


def test_patch_roster_400_empty_body(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One", "role": "attending", "phone": None}],
    )
    resp = _as(app, LEAD).patch("/events/2026test/roster/u1", json={})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "No fields to update"


def test_patch_roster_role_change_403_without_events_edit(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One", "role": "attending", "phone": None}],
    )
    resp = _as(app, MEMBER).patch("/events/2026test/roster/u1", json={"role": "mentor"})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


# ── PATCH roster/{user_id}: days (self-service, or events.edit for anyone) ──

def test_patch_roster_self_can_change_own_days(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "member-1", "display_name": "Member One",
                 "role": "attending", "phone": "555-1111111", "days": ["2026-03-20"]}],
    )
    resp = _as(app, MEMBER).patch(
        "/events/2026test/roster/member-1", json={"days": ["2026-03-21"]}
    )
    assert resp.status_code == 200
    entry = resp.json()["roster"][0]
    assert entry["days"] == ["2026-03-21"]
    # role/phone/display_name untouched by a days-only change.
    assert entry["role"] == "attending"
    assert entry["phone"] == "555-1111111"
    assert entry["display_name"] == "Member One"


def test_patch_roster_self_cannot_change_own_role_without_events_edit(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "member-1", "display_name": "Member One",
                 "role": "attending", "phone": None}],
    )
    resp = _as(app, MEMBER).patch("/events/2026test/roster/member-1", json={"role": "mentor"})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


def test_patch_roster_member_cannot_change_someone_elses_days(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "someone-else", "display_name": "Someone Else",
                 "role": "attending", "phone": None}],
    )
    resp = _as(app, MEMBER).patch(
        "/events/2026test/roster/someone-else", json={"days": ["2026-03-20"]}
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


def test_patch_roster_lead_can_change_someone_elses_days(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One",
                 "role": "attending", "phone": None, "days": None}],
    )
    resp = _as(app, LEAD).patch("/events/2026test/roster/u1", json={"days": ["2026-03-20"]})
    assert resp.status_code == 200
    assert resp.json()["roster"][0]["days"] == ["2026-03-20"]


def test_patch_roster_lead_can_change_role_and_days_together(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One",
                 "role": "attending", "phone": None, "days": None}],
    )
    resp = _as(app, LEAD).patch(
        "/events/2026test/roster/u1", json={"role": "mentor", "days": ["2026-03-20"]}
    )
    assert resp.status_code == 200
    entry = resp.json()["roster"][0]
    assert entry["role"] == "mentor"
    assert entry["days"] == ["2026-03-20"]


def test_patch_roster_combined_fields_fail_together_and_write_nothing(app, store):
    # MEMBER is the roster member (so the days half would be allowed alone),
    # but also wants to change their own role (not allowed without
    # events.edit) in the same request. Both halves must pass -- the role
    # check fails, so nothing is written, including the days half.
    store.add_event(
        "2026test",
        roster=[{"user_id": "member-1", "display_name": "Member One",
                 "role": "attending", "phone": None, "days": ["2026-03-01"]}],
    )
    resp = _as(app, MEMBER).patch(
        "/events/2026test/roster/member-1",
        json={"role": "mentor", "days": ["2026-03-20"]},
    )
    assert resp.status_code == 403
    # Nothing was written.
    assert store.events["2026test"]["roster"][0]["days"] == ["2026-03-01"]
    assert store.events["2026test"]["roster"][0]["role"] == "attending"


def test_patch_roster_days_empty_list_422(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One", "role": "attending", "phone": None}],
    )
    resp = _as(app, LEAD).patch("/events/2026test/roster/u1", json={"days": []})
    assert resp.status_code == 422


def test_patch_roster_days_malformed_422(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One", "role": "attending", "phone": None}],
    )
    resp = _as(app, LEAD).patch("/events/2026test/roster/u1", json={"days": ["not-a-date"]})
    assert resp.status_code == 422


def test_patch_roster_days_out_of_range_422(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One", "role": "attending", "phone": None}],
    )
    store.add_schedule("2026test", start_time="2026-03-20", end_time="2026-03-21")
    resp = _as(app, LEAD).patch("/events/2026test/roster/u1", json={"days": ["2026-03-22"]})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Days must be within the event's dates"


# ── PATCH content: only the sent field changes ──────────────────────────

def test_patch_updates_only_sent_field(app, store):
    store.add_event(
        "2026test",
        event_name="Keep Me",
        links={"tba": "https://example.com"},
        roster=[{"user_id": "someone", "display_name": "Someone",
                 "role": "attending", "phone": None}],
        itinerary=[{"dt": "2026-01-01T09:00:00", "label": "Old", "detail": None}],
        packing_list=[{"category": "Robot", "items": ["Battery"]}],
        instructions=[{"heading": "Old heading", "body": "Old body"}],
    )

    new_itinerary = [{"dt": "2026-01-01T10:00:00", "label": "New", "detail": "Updated"}]
    resp = _as(app, LEAD).patch("/events/2026test/content", json={"itinerary": new_itinerary})
    assert resp.status_code == 200
    body = resp.json()
    assert body["itinerary"] == new_itinerary
    # Untouched fields stay exactly as they were.
    assert body["packing_list"] == [{"category": "Robot", "items": ["Battery"]}]
    assert body["instructions"] == [{"heading": "Old heading", "body": "Old body"}]
    assert body["roster"] == [{"user_id": "someone", "display_name": "Someone",
                                "role": "attending", "phone": None}]
    assert body["event_name"] == "Keep Me"
    assert body["links"] == {"tba": "https://example.com"}


def test_patch_404_unknown_event_and_does_not_create(app, store):
    resp = _as(app, LEAD).patch(
        "/events/does-not-exist/content",
        json={"itinerary": [{"dt": "2026-01-01T09:00:00", "label": "A", "detail": None}]},
    )
    assert resp.status_code == 404
    assert "does-not-exist" not in store.events


def test_patch_400_empty_body(app, store):
    store.add_event("2026test")
    resp = _as(app, LEAD).patch("/events/2026test/content", json={})
    assert resp.status_code == 400


def test_patch_403_for_role_without_events_edit(app, store, monkeypatch):
    # Exercise the real require_access/require_event_edit dependency instead
    # of overriding it: override only get_current_user, and stub out the
    # ban/approval cache check (account_state), which this test isn't about.
    store.add_event("2026test")

    async def _noop_assert_active(sub):
        return None

    monkeypatch.setattr(account_state, "assert_active", _noop_assert_active)

    fastapi_app = FastAPI()
    fastapi_app.include_router(events_router, prefix="/events")
    fastapi_app.dependency_overrides[get_current_user] = lambda: MEMBER
    client = TestClient(fastapi_app)

    resp = client.patch(
        "/events/2026test/content",
        json={"itinerary": [{"dt": "2026-01-01T09:00:00", "label": "A", "detail": None}]},
    )
    assert resp.status_code == 403


# ── PUT content: legacy round-trip keeps roster.days ────────────────────

def test_put_content_round_trip_keeps_roster_days(app, store, monkeypatch):
    # PUT /{event_key}/content is gated by its own anonymous
    # require_access(permissions="control_panel.upcoming_event") dependency
    # (not a named module-level export like require_event_edit), so there's
    # no object to override directly -- same workaround as the 403 tests
    # above: override get_current_user to a role that actually holds that
    # permission (captain), and stub out account_state.
    async def _noop_assert_active(sub):
        return None

    monkeypatch.setattr(account_state, "assert_active", _noop_assert_active)

    fastapi_app = FastAPI()
    fastapi_app.include_router(events_router, prefix="/events")
    fastapi_app.dependency_overrides[get_current_user] = lambda: CAPTAIN
    client = TestClient(fastapi_app)

    body = {
        "event_name": "Test Event",
        "roster": [
            {"user_id": "u1", "display_name": "User One", "role": "attending",
             "phone": None, "days": ["2026-03-20", "2026-03-21"]},
        ],
    }
    resp = client.put("/events/2026test/content", json=body)
    assert resp.status_code == 200
    assert resp.json()["roster"] == [
        {"user_id": "u1", "display_name": "User One", "role": "attending",
         "phone": None, "days": ["2026-03-20", "2026-03-21"]}
    ]


# ── Validation ───────────────────────────────────────────────────────────

def test_patch_422_blank_label(app, store):
    store.add_event("2026test")
    resp = _as(app, LEAD).patch(
        "/events/2026test/content",
        json={"itinerary": [{"dt": "2026-01-01T09:00:00", "label": "   ", "detail": None}]},
    )
    assert resp.status_code == 422


def test_patch_422_unparseable_dt(app, store):
    store.add_event("2026test")
    resp = _as(app, LEAD).patch(
        "/events/2026test/content",
        json={"itinerary": [{"dt": "not-a-date", "label": "A", "detail": None}]},
    )
    assert resp.status_code == 422


# ── Check-in opening time ───────────────────────────────────────────────

def test_check_in_blocked_before_checkin_opens(app, store):
    store.add_event("2026test")
    store.add_schedule("2099test", "2099-03-19")  # unrelated row, ignored
    store.add_schedule("2026test", "2099-03-19", "2099-03-21", checkin_opens="2099-03-01")
    resp = _as(app, MEMBER).post("/events/2026test/check-in")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Check-in isn't open yet"


def test_check_in_allowed_once_checkin_opens(app, store):
    store.add_event("2026test")
    store.add_schedule("2026test", "2099-03-19", "2099-03-21", checkin_opens="2020-01-01T09:00")
    resp = _as(app, MEMBER).post("/events/2026test/check-in")
    assert resp.status_code == 200


def test_check_in_ungated_without_checkin_opens(app, store):
    store.add_event("2026test")
    store.add_schedule("2026test", "2099-03-19", "2099-03-21")
    resp = _as(app, MEMBER).post("/events/2026test/check-in")
    assert resp.status_code == 200


# ── Schedule PATCH ──────────────────────────────────────────────────────

def test_schedule_patch_updates_sent_fields_only(app, store):
    store.add_schedule_row(1)
    resp = _as(app, LEAD).patch("/events/schedule/1", json={
        "checkin_opens": "2026-03-01T18:00", "hidden_tabs": ["comp", "packing"],
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["checkinOpens"] == "2026-03-01T18:00"
    # Normalized to canonical tab order.
    assert body["hiddenTabs"] == ["packing", "comp"]
    assert body["start"] == "2026-03-19"
    assert body["end"] == "2026-03-21"


def test_schedule_patch_moves_dates(app, store):
    store.add_schedule_row(1)
    resp = _as(app, LEAD).patch("/events/schedule/1", json={"start": "2026-04-02T08:00", "end": "2026-04-04"})
    assert resp.status_code == 200
    assert resp.json()["start"] == "2026-04-02T08:00"
    assert resp.json()["end"] == "2026-04-04"


def test_schedule_patch_clears_end_and_checkin(app, store):
    store.add_schedule_row(1, checkinOpens="2026-03-01")
    resp = _as(app, LEAD).patch("/events/schedule/1", json={"end": None, "checkin_opens": None})
    assert resp.status_code == 200
    assert resp.json()["end"] is None
    assert resp.json()["checkinOpens"] is None


def test_schedule_patch_rejects_end_before_start(app, store):
    store.add_schedule_row(1)
    resp = _as(app, LEAD).patch("/events/schedule/1", json={"end": "2026-03-01"})
    assert resp.status_code == 422


def test_schedule_patch_rejects_checkin_after_event(app, store):
    store.add_schedule_row(1)
    resp = _as(app, LEAD).patch("/events/schedule/1", json={"checkin_opens": "2026-03-22"})
    assert resp.status_code == 422


def test_schedule_patch_allows_checkin_on_last_day(app, store):
    store.add_schedule_row(1)
    resp = _as(app, LEAD).patch("/events/schedule/1", json={"checkin_opens": "2026-03-21T15:00"})
    assert resp.status_code == 200


@pytest.mark.parametrize("payload", [
    {"start": None},
    {"start": "March 19"},
    {"start": "2026-02-30"},
    {"hidden_tabs": ["overview"]},
    {"hidden_tabs": None},
])
def test_schedule_patch_rejects_bad_values(app, store, payload):
    store.add_schedule_row(1)
    resp = _as(app, LEAD).patch("/events/schedule/1", json=payload)
    assert resp.status_code == 422


def test_schedule_patch_empty_body_400(app, store):
    store.add_schedule_row(1)
    resp = _as(app, LEAD).patch("/events/schedule/1", json={})
    assert resp.status_code == 400


def test_schedule_patch_unknown_event_404(app, store):
    resp = _as(app, LEAD).patch("/events/schedule/99", json={"hidden_tabs": []})
    assert resp.status_code == 404


def test_schedule_patch_forbidden_for_member(app, store, monkeypatch):
    # Same approach as test_patch_403_for_role_without_events_edit: let the
    # real require_event_edit run against a member's role.
    store.add_schedule_row(1)

    async def _noop_assert_active(sub):
        return None

    monkeypatch.setattr(account_state, "assert_active", _noop_assert_active)

    fastapi_app = FastAPI()
    fastapi_app.include_router(events_router, prefix="/events")
    fastapi_app.dependency_overrides[get_current_user] = lambda: MEMBER
    resp = TestClient(fastapi_app).patch("/events/schedule/1", json={"hidden_tabs": []})
    assert resp.status_code == 403


# ── Scheduled events get a hub on first use ─────────────────────────────

def test_check_in_creates_hub_for_scheduled_event(app, store):
    store.add_schedule("2026sched", "2026-03-19", "2026-03-21", checkin_opens="2020-01-01")
    client = _as(app, MEMBER)
    assert client.get("/events/2026sched/check-in").json() == {"checked_in": False}
    resp = client.post("/events/2026sched/check-in")
    assert resp.status_code == 200
    assert resp.json()["roster"][0]["user_id"] == "member-1"


def test_check_in_still_404_for_unscheduled_event(app, store):
    resp = _as(app, MEMBER).post("/events/nowhere/check-in")
    assert resp.status_code == 404


def test_check_in_works_for_event_without_tba_key(app, store):
    # Outreach-style event: its hub key is "e<id>", not a TBA key.
    store.add_schedule("e12", "2026-03-19")
    resp = _as(app, MEMBER).post("/events/e12/check-in")
    assert resp.status_code == 200


def test_info_for_non_tba_hub_skips_tba(app, store, monkeypatch):
    import endpoints.events as events_mod

    async def _boom(*_a, **_k):
        raise AssertionError("TBA/Nexus should not be called for an e<id> hub")

    monkeypatch.setattr(events_mod.tba, "get", _boom)
    monkeypatch.setattr(events_mod.nexus, "get", _boom)
    store.add_schedule("e12", "2026-03-19")
    app.dependency_overrides[get_current_user] = lambda: MEMBER
    resp = TestClient(app).get("/events/e12/info")
    assert resp.status_code == 200
    assert resp.json()["matches"] == []


# ── Overview description ────────────────────────────────────────────────

def test_schedule_patch_sets_description_trimmed(app, store):
    store.add_schedule_row(1)
    resp = _as(app, LEAD).patch("/events/schedule/1", json={"description": "  Bring water.\n\nMeet at 9.  "})
    assert resp.status_code == 200
    assert resp.json()["description"] == "Bring water.\n\nMeet at 9."


def test_schedule_patch_blank_description_clears(app, store):
    store.add_schedule_row(1, description="Old")
    resp = _as(app, LEAD).patch("/events/schedule/1", json={"description": "   "})
    assert resp.status_code == 200
    assert resp.json()["description"] is None


def test_schedule_patch_rejects_overlong_description(app, store):
    store.add_schedule_row(1)
    resp = _as(app, LEAD).patch("/events/schedule/1", json={"description": "x" * 5001})
    assert resp.status_code == 422


# ── Check-in on/off ─────────────────────────────────────────────────────

def test_check_in_rejected_when_disabled(app, store):
    store.add_event("2026test")
    store.add_schedule("2026test", "2026-03-19", checkin_enabled=False)
    resp = _as(app, MEMBER).post("/events/2026test/check-in")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "This event doesn't use check-in"


def test_schedule_patch_toggles_checkin_and_keeps_opening_time(app, store):
    store.add_schedule_row(1, checkinOpens="2026-03-01")
    client = _as(app, LEAD)
    resp = client.patch("/events/schedule/1", json={"checkin_enabled": False})
    assert resp.status_code == 200
    assert resp.json()["checkinEnabled"] is False
    assert resp.json()["checkinOpens"] == "2026-03-01"
    resp = client.patch("/events/schedule/1", json={"checkin_enabled": True})
    assert resp.json()["checkinEnabled"] is True


def test_schedule_patch_rejects_null_checkin_enabled(app, store):
    store.add_schedule_row(1)
    resp = _as(app, LEAD).patch("/events/schedule/1", json={"checkin_enabled": None})
    assert resp.status_code == 422
