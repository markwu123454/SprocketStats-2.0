"""Endpoint tests for per-user push category preferences (endpoints/push.py).

The opt-out table is replaced by an in-memory set and auth by a dependency
override, same no-database approach as test_tasks_endpoints.py.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from core.security import require_active
from endpoints.push import router as push_router

USER = {"sub": "user-1", "role": "cad_member"}


@pytest.fixture
def client(monkeypatch):
    opt_outs: dict[str, set[str]] = {}

    async def get_opt_outs(user_id):
        return set(opt_outs.get(user_id, set()))

    async def set_prefs(user_id, prefs):
        mine = opt_outs.setdefault(user_id, set())
        for category, enabled in prefs.items():
            (mine.discard if enabled else mine.add)(category)

    monkeypatch.setattr(db, "get_push_opt_outs", get_opt_outs)
    monkeypatch.setattr(db, "set_push_preferences", set_prefs)

    app = FastAPI()
    app.include_router(push_router, prefix="/push")
    app.dependency_overrides[require_active] = lambda: USER
    return TestClient(app)


def test_everything_defaults_on(client):
    resp = client.get("/push/preferences")
    assert resp.status_code == 200
    assert resp.json() == {"preferences": {c: True for c in db.PUSH_CATEGORIES}}


def test_partial_update_only_touches_sent_categories(client):
    resp = client.put("/push/preferences", json={"preferences": {"meeting_reminder": False}})
    assert resp.status_code == 200
    assert resp.json()["preferences"] == {
        "task_assigned": True, "meeting_reminder": False, "event_reminder": True,
    }

    resp = client.put("/push/preferences", json={"preferences": {"meeting_reminder": True, "task_assigned": False}})
    assert resp.json()["preferences"] == {
        "task_assigned": False, "meeting_reminder": True, "event_reminder": True,
    }


def test_unknown_category_is_rejected(client):
    resp = client.put("/push/preferences", json={"preferences": {"announcements": False}})
    assert resp.status_code == 422
