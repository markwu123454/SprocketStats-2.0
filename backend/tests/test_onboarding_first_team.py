"""POST /auth/onboarding: a visitor's own FIRST team. No database: the
onboarding update is faked and records what it was given."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from core.security import require_active
from endpoints.auth import router as auth_router

VISITOR = {"sub": "visitor-1", "email": "guest@example.com", "role": None, "onboarding_complete": False}


@pytest.fixture
def saved(monkeypatch):
    calls: list[tuple] = []

    async def update_user_onboarding(user_id, display_name, role, grade, team_year,
                                     first_program=None, first_team_number=None):
        calls.append((role, first_program, first_team_number))
        return {"id": user_id, "email": "guest@example.com", "display_name": display_name, "role": role,
                "grade": grade, "team_year": team_year, "onboarding_complete": True}

    monkeypatch.setattr(db, "update_user_onboarding", update_user_onboarding)
    return calls


@pytest.fixture
def client(saved):
    app = FastAPI()
    app.include_router(auth_router, prefix="/auth")
    app.dependency_overrides[require_active] = lambda: VISITOR
    return TestClient(app)


def onboard(client, **extra):
    return client.post("/auth/onboarding", json={"display_name": "Guest", "role": "visitor", **extra})


@pytest.mark.parametrize("program", ["FRC", "FTC", "FLL"])
def test_visitor_on_a_team_is_saved(client, saved, program):
    resp = onboard(client, first_program=program, first_team_number=3473)
    assert resp.status_code == 200
    assert saved == [("visitor", program, 3473)]


def test_visitor_not_on_a_team_saves_nothing(client, saved):
    assert onboard(client, first_program=None, first_team_number=None).status_code == 200
    assert saved == [("visitor", None, None)]


def test_older_app_without_the_fields_still_onboards(client, saved):
    assert onboard(client).status_code == 200
    assert saved == [("visitor", None, None)]


@pytest.mark.parametrize("extra", [
    {"first_program": "FRC"},                                   # number missing
    {"first_team_number": 3473},                                # program missing
    {"first_program": "VEX", "first_team_number": 3473},        # not a FIRST program
    {"first_program": "FRC", "first_team_number": 0},
    {"first_program": "FRC", "first_team_number": 1_000_000},
])
def test_invalid_first_team_is_rejected(client, saved, extra):
    assert onboard(client, **extra).status_code == 422
    assert saved == []


def test_only_visitors_may_give_a_first_team(client, saved):
    resp = client.post("/auth/onboarding", json={
        "display_name": "Mentor", "role": "mentor", "first_program": "FRC", "first_team_number": 3473,
    })
    assert resp.status_code == 422
    assert saved == []
