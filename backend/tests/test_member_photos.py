"""Hiding your photo from other members: GET /members, GET /auth/me and
PATCH /auth/picture-visibility. No database: db calls are faked."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from core import account_state
from core.security import get_current_user, require_active
from endpoints.auth import router as auth_router
from endpoints.members import router as members_router

CAPTAIN = {"sub": "captain-1", "email": "c@example.com", "role": "captain", "picture": "https://example.com/c.jpg",
           "onboarding_complete": True}


def _row(uid, name, picture):
    # As db.list_all_users returns it: picture already NULL when hidden.
    return {"id": uid, "email": f"{uid}@example.com", "name": name, "display_name": name, "picture": picture,
            "role": "cad_member", "grade": "junior", "team_year": "year_2", "approved_by": "captain-1",
            "banned_at": None, "kiosk_access_until": None, "kiosk_access_no_end": False}


@pytest.fixture
def state(monkeypatch):
    s = {"hide": {"captain-1": True}}

    async def assert_active(_user_id):
        return None

    async def list_all_users():
        return [
            _row("captain-1", "Cap", None),  # hid their photo
            _row("member-1", "Ava", "https://example.com/a.jpg"),
            _row("member-2", "Ben", None),  # hid theirs too
        ]

    async def get_user(uid):
        return {"id": uid, "role": "captain", "hide_picture": s["hide"].get(uid, False),
                "kiosk_access_until": None, "kiosk_access_no_end": False}

    async def pending(_uid, _role):
        return []

    async def set_hide_picture(uid, hide):
        s["hide"][uid] = hide
        return hide

    monkeypatch.setattr(account_state, "assert_active", assert_active)
    for name, fn in {"list_all_users": list_all_users, "get_user": get_user,
                     "get_pending_notifications_for_user": pending, "set_hide_picture": set_hide_picture}.items():
        monkeypatch.setattr(db, name, fn)
    return s


@pytest.fixture
def client(state):
    app = FastAPI()
    app.include_router(members_router, prefix="/members")
    app.include_router(auth_router, prefix="/auth")
    app.dependency_overrides[get_current_user] = lambda: CAPTAIN
    app.dependency_overrides[require_active] = lambda: CAPTAIN
    return TestClient(app)


def test_roster_withholds_hidden_photos_but_shows_your_own(client):
    rows = {m["id"]: m["picture"] for m in client.get("/members").json()}
    assert rows == {
        "captain-1": "https://example.com/c.jpg",  # the viewer's own, from their claims
        "member-1": "https://example.com/a.jpg",
        "member-2": None,
    }


def test_setting_round_trips_through_auth_me(client, state):
    assert client.get("/auth/me").json()["hide_picture"] is True

    resp = client.patch("/auth/picture-visibility", json={"hide_picture": False})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "hide_picture": False}
    assert state["hide"]["captain-1"] is False
    assert client.get("/auth/me").json()["hide_picture"] is False


def test_setting_requires_a_boolean(client):
    assert client.patch("/auth/picture-visibility", json={}).status_code == 422
