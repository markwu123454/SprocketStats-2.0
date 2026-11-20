"""GET /auth/me. No database: the user row and account-state check are faked."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from core import account_state
from core.security import get_current_user
from endpoints.auth import router as auth_router

CLAIMS = {
    "sub": "user-1", "email": "user-1@example.com", "name": "Ava Chen", "given_name": "Ava",
    "picture": None, "display_name": "Ava", "role": "cad_member", "grade": "junior",
    "team_year": "year_2", "onboarding_complete": True,
}


@pytest.fixture
def client(monkeypatch):
    async def assert_active(_user_id):
        return None

    async def pending(_user_id, _role):
        return []

    async def get_user(user_id):
        # A users row as it is after migration 17: no offline_code column.
        return {"id": user_id, "role": "cad_member", "kiosk_access_until": None, "kiosk_access_no_end": False}

    monkeypatch.setattr(account_state, "assert_active", assert_active)
    monkeypatch.setattr(db, "get_pending_notifications_for_user", pending)
    monkeypatch.setattr(db, "get_user", get_user)
    app = FastAPI()
    app.include_router(auth_router, prefix="/auth")
    app.dependency_overrides[get_current_user] = lambda: CLAIMS
    return TestClient(app)


def test_me_works_without_an_offline_code_column(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 200
    assert resp.json()["id"] == "user-1"
    assert resp.json()["pending_notifications"] == []


# LEGACY-OFFLINE-CODE: delete with the blank field; see NEXT_UPDATE_CLEANUP.md.
def test_me_sends_blank_offline_code_for_old_app_builds(client):
    assert client.get("/auth/me").json()["offline_code"] == ""
