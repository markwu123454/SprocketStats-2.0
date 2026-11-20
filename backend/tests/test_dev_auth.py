"""Development-only sign-in (endpoints/dev_auth.py). No database: user rows are faked."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt

import db
import endpoints
from core.security import JWT_ALGORITHM, JWT_SECRET
from endpoints.dev_auth import router as dev_auth_router


def _row(user_id, role, *, display_name="Ava", approved_by="captain-1", banned_at=None):
    return {
        "id": user_id, "email": f"{user_id}@example.com", "name": display_name, "given_name": display_name,
        "display_name": display_name, "picture": None, "role": role, "grade": None, "team_year": None,
        "approved_by": approved_by, "banned_at": banned_at, "onboarding_complete": role is not None,
    }


ROWS = [
    _row("cap", "captain"),
    _row("lead", "cad_lead", approved_by=None),
    _row("gone", "cad_member", banned_at="2026-01-01"),
    _row("new", None, display_name=None),
]


@pytest.fixture
def client(monkeypatch):
    async def list_all_users():
        return ROWS

    async def get_user(user_id):
        return next((r for r in ROWS if r["id"] == user_id), None)

    monkeypatch.setattr(db, "list_all_users", list_all_users)
    monkeypatch.setattr(db, "get_user", get_user)
    app = FastAPI()
    app.include_router(dev_auth_router, prefix="/auth/dev")
    return TestClient(app)


def test_not_mounted_outside_development():
    # The test run has no ENV=development, so the app's router never got these routes.
    paths = [getattr(r, "path", "") for r in endpoints.router.routes]
    assert not any(p.startswith("/auth/dev") for p in paths)


def test_refuses_outside_development_even_if_mounted(client, monkeypatch):
    monkeypatch.setenv("ENV", "production")
    assert client.get("/auth/dev/users").status_code == 404
    assert client.post("/auth/dev/login", json={"user_id": "cap"}).status_code == 404


def test_lists_users_with_how_signing_in_will_go(client, monkeypatch):
    monkeypatch.setenv("ENV", "development")
    users = {u["id"]: u for u in client.get("/auth/dev/users").json()}
    assert users["cap"] == {"id": "cap", "name": "Ava", "role": "captain", "role_label": "Captain", "status": "active"}
    assert users["lead"]["status"] == "pending"
    assert users["gone"]["status"] == "banned"
    assert users["new"]["status"] == "not_onboarded"
    assert users["new"]["name"] == "new@example.com"
    assert all("email" not in u for u in users.values())


def test_login_sets_that_users_session(client, monkeypatch):
    monkeypatch.setenv("ENV", "development")
    resp = client.post("/auth/dev/login", json={"user_id": "cap"})
    assert resp.status_code == 200
    claims = jwt.decode(resp.cookies["auth_token"], JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert claims["sub"] == "cap"
    assert claims["role"] == "captain"


def test_login_unknown_user_is_404(client, monkeypatch):
    monkeypatch.setenv("ENV", "development")
    assert client.post("/auth/dev/login", json={"user_id": "nobody"}).status_code == 404
