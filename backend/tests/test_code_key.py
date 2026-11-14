"""GET /attendance/code_key: what a member's phone downloads to show its code."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from core import member_codes as mc
from core.security import require_active
from endpoints.attendance import router as attendance_router

MEMBER_ID = "104837261955310428817"


@pytest.fixture
def state(monkeypatch):
    monkeypatch.setenv(mc.KEY_ENV, "test-member-code-key")
    st = {"user": {"id": MEMBER_ID, "onboarding_complete": True, "code_version": 3}, "number": 42}

    async def get_user(uid):
        return st["user"] if uid == st["user"]["id"] else None

    async def ensure_code_number(uid):
        return st["number"]

    monkeypatch.setattr(db, "get_user", get_user)
    monkeypatch.setattr(db, "ensure_code_number", ensure_code_number)
    return st


@pytest.fixture
def client(state):
    app = FastAPI()
    app.include_router(attendance_router, prefix="/attendance")
    app.dependency_overrides[require_active] = lambda: {"sub": MEMBER_ID, "role": "cad_member"}
    return TestClient(app)


def test_returns_number_and_secret(client):
    resp = client.get("/attendance/code_key")
    assert resp.status_code == 200
    body = resp.json()
    assert body["member_id"] == MEMBER_ID
    assert body["code_number"] == 42
    assert body["version"] == 3
    assert body["secret"] == mc.secret_b64(mc.member_secret(MEMBER_ID, 3))
    assert body["step_seconds"] == mc.STEP_SECONDS
    assert resp.headers["cache-control"] == "no-store"


def test_any_account_id_works(client, state):
    # The old format only had room for 21-digit Google ids.
    state["user"] = {**state["user"], "id": "member-1"}
    client.app.dependency_overrides[require_active] = lambda: {"sub": "member-1", "role": "cad_member"}
    assert client.get("/attendance/code_key").status_code == 200


def test_onboarding_required(client, state):
    state["user"] = {**state["user"], "onboarding_complete": False}
    assert client.get("/attendance/code_key").status_code == 403


def test_number_past_four_digits_is_refused(client, state):
    state["number"] = 10_000
    resp = client.get("/attendance/code_key")
    assert resp.status_code == 409
