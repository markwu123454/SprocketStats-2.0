"""Endpoint-level tests for the check-in and content-PATCH routes on the
Events router (endpoints/events.py).

Runs with no real database: every `db.*` call the router makes is
monkeypatched to an in-memory FakeStore that mimics the `comp_events` table's
relevant shape closely enough to exercise the business rules the endpoints
enforce -- idempotent check-in, roster/links/event_name never touched by the
content PATCH, and the 404-never-creates rule.

Auth is bypassed via a FastAPI dependency override on `require_active` (the
login-only gate on the check-in routes) the same way test_tasks_endpoints.py
does it. The one 403-permissions test exercises the *real* `require_access`
dependency bound to `require_event_edit` instead of overriding it, so it only
overrides `get_current_user` and stubs out the account-state ban/approval
check (irrelevant to what that test is checking).
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


class FakeStore:
    """In-memory stand-in for the `comp_events` table, shaped like the real
    `db.comp_events` functions (see backend/db/comp_events.py)."""

    def __init__(self):
        self.events: dict[str, dict] = {}

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

    # -- db.comp_events-shaped async methods, monkeypatched onto `db` --

    async def get_comp_event(self, event_key):
        row = self.events.get(event_key)
        return dict(row) if row else None

    async def add_roster_member(self, event_key, member):
        row = self.events.get(event_key)
        if row is None:
            return None
        roster = row.setdefault("roster", [])
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

    async def set_roster_role(self, event_key, user_id, role):
        row = self.events.get(event_key)
        if row is None:
            return None
        roster = row.get("roster") or []
        for entry in roster:
            if entry.get("user_id") == user_id:
                entry["role"] = role
                return roster
        raise db.RosterMemberNotFound(user_id)


@pytest.fixture
def store(monkeypatch):
    fake = FakeStore()
    for name in (
        "get_comp_event", "add_roster_member", "is_on_roster", "update_comp_event_content",
        "set_roster_role",
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
        {"user_id": "member-1", "display_name": "Member One", "role": "attending", "phone": None}
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


# ── PATCH roster/{user_id}: privileged role change ──────────────────────

def test_patch_roster_role_changes_only_that_member(app, store):
    store.add_event(
        "2026test",
        roster=[
            {"user_id": "u1", "display_name": "User One",
             "role": "attending", "phone": "555-1111111"},
            {"user_id": "u2", "display_name": "User Two", "role": "pit_crew", "phone": None},
        ],
    )
    resp = _as(app, LEAD).patch("/events/2026test/roster/u1", json={"role": "drive_team"})
    assert resp.status_code == 200
    roster = resp.json()["roster"]
    assert roster[0] == {"user_id": "u1", "display_name": "User One",
                          "role": "drive_team", "phone": "555-1111111"}
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


def test_patch_roster_role_404_unknown_member(app, store):
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One", "role": "attending", "phone": None}],
    )
    resp = _as(app, LEAD).patch("/events/2026test/roster/ghost", json={"role": "mentor"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Roster member not found"


def test_patch_roster_role_404_unknown_event(app, store):
    resp = _as(app, LEAD).patch("/events/does-not-exist/roster/u1", json={"role": "mentor"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Event not found"


def test_patch_roster_role_403_for_role_without_events_edit(app, store, monkeypatch):
    # Same real-dependency approach as test_patch_403_for_role_without_events_edit:
    # override only get_current_user and stub out account_state, so the real
    # require_access/require_event_edit permission check actually runs.
    store.add_event(
        "2026test",
        roster=[{"user_id": "u1", "display_name": "User One", "role": "attending", "phone": None}],
    )

    async def _noop_assert_active(sub):
        return None

    monkeypatch.setattr(account_state, "assert_active", _noop_assert_active)

    fastapi_app = FastAPI()
    fastapi_app.include_router(events_router, prefix="/events")
    fastapi_app.dependency_overrides[get_current_user] = lambda: MEMBER
    client = TestClient(fastapi_app)

    resp = client.patch("/events/2026test/roster/u1", json={"role": "mentor"})
    assert resp.status_code == 403


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
