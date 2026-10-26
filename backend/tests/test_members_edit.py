"""Endpoint-level tests for who may edit whom through ``PUT /members``.

No real database: ``db.list_all_users`` / ``db.update_users`` are monkeypatched
to an in-memory user table, and ``account_state.assert_active`` (which
``require_roster_access`` re-checks) is stubbed out. Auth is bypassed by
overriding ``get_current_user`` so each test picks the caller directly.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from core import account_state
from core.security import get_current_user
from endpoints.members import router as members_router

USERS = {
    "captain-1": "captain",
    "scout-lead-1": "scouting_lead",
    "cad-lead-1": "cad_lead",
    "cad-lead-2": "cad_lead",
    "cad-member-1": "cad_member",
    "elec-member-1": "electrical_member",
    "alum-1": "alumni",
    "mentor-1": "mentor",
}


@pytest.fixture
def client_as(monkeypatch):
    written: list[list[dict]] = []

    async def list_all_users():
        return [{"id": uid, "role": role} for uid, role in USERS.items()]

    async def update_users(updates):
        written.append(updates)

    async def assert_active(_user_id):
        return None

    monkeypatch.setattr(db, "list_all_users", list_all_users)
    monkeypatch.setattr(db, "update_users", update_users)
    monkeypatch.setattr(account_state, "assert_active", assert_active)

    def make(user_id: str) -> tuple[TestClient, list]:
        app = FastAPI()
        app.include_router(members_router, prefix="/members")
        app.dependency_overrides[get_current_user] = lambda: {"sub": user_id, "role": USERS[user_id]}
        return TestClient(app), written

    return make


def edit(target: str, role: str) -> dict:
    return {"id": target, "name": "New Name", "display_name": "New", "role": role,
            "grade": "junior", "team_year": "year_2"}


def test_lead_can_edit_own_subteam_member(client_as):
    client, written = client_as("cad-lead-1")
    res = client.put("/members", json=[edit("cad-member-1", "cad_member")])
    assert res.status_code == 200
    assert written[0][0]["id"] == "cad-member-1"
    assert written[0][0]["name"] == "New Name"


def test_lead_can_edit_alumni(client_as):
    client, _ = client_as("cad-lead-1")
    assert client.put("/members", json=[edit("alum-1", "alumni")]).status_code == 200


def test_lead_cannot_edit_other_subteam(client_as):
    client, written = client_as("cad-lead-1")
    res = client.put("/members", json=[edit("elec-member-1", "electrical_member")])
    assert res.status_code == 403
    assert written == []


@pytest.mark.parametrize("target", ["cad-lead-2", "cad-lead-1", "captain-1", "mentor-1"])
def test_lead_cannot_edit_leads_self_or_seniors(client_as, target):
    client, written = client_as("cad-lead-1")
    res = client.put("/members", json=[edit(target, USERS[target])])
    assert res.status_code == 403
    assert written == []


@pytest.mark.parametrize("new_role", ["alumni", "cad_lead", "captain", "electrical_member", None])
def test_lead_cannot_change_role(client_as, new_role):
    client, written = client_as("cad-lead-1")
    res = client.put("/members", json=[edit("cad-member-1", new_role)])
    assert res.status_code == 403
    assert written == []


def test_one_out_of_scope_row_rejects_whole_batch(client_as):
    client, written = client_as("cad-lead-1")
    res = client.put("/members", json=[edit("cad-member-1", "cad_member"),
                                       edit("elec-member-1", "electrical_member")])
    assert res.status_code == 403
    assert written == []


def test_unknown_member_is_404(client_as):
    client, _ = client_as("cad-lead-1")
    assert client.put("/members", json=[edit("ghost", "cad_member")]).status_code == 404


@pytest.mark.parametrize("editor", ["captain-1", "scout-lead-1"])
def test_full_managers_can_edit_anyone(client_as, editor):
    client, written = client_as(editor)
    res = client.put("/members", json=[edit("elec-member-1", "cad_lead"), edit("mentor-1", "mentor")])
    assert res.status_code == 200
    assert len(written[0]) == 2


def test_member_cannot_edit(client_as):
    USERS["plain-1"] = "cad_member"
    try:
        client, written = client_as("plain-1")
        assert client.put("/members", json=[edit("cad-member-1", "cad_member")]).status_code == 403
        assert written == []
    finally:
        del USERS["plain-1"]
