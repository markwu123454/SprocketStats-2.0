from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
import core.account_state as account_state
from core.security import get_current_user
from endpoints.meeting_hours import router


@pytest.fixture
def setup(monkeypatch):
    row = {"id": "meeting-1", "created_by": "captain-1", "start_time": "2026-11-01T15:00:00Z",
           "end_time": "2026-11-01T18:00:00Z", "meeting_purpose": "Build", "agenda": ""}

    async def update(meeting_id, agenda):
        if meeting_id != row["id"]:
            return None
        row["agenda"] = agenda
        return row.copy()

    monkeypatch.setattr(account_state, "assert_active", AsyncMock())
    monkeypatch.setattr(db, "list_all_meeting_hours", AsyncMock(side_effect=lambda: [row.copy()]))
    monkeypatch.setattr(db, "update_meeting_agenda", AsyncMock(side_effect=update))
    app = FastAPI()
    app.include_router(router, prefix="/meeting-hours")

    def client(role):
        app.dependency_overrides[get_current_user] = lambda: {"sub": "user-1", "role": role}
        return TestClient(app)

    return client, row


def test_lead_can_save_read_and_clear_agenda_but_not_change_time(setup):
    client_for, row = setup
    client = client_for("cad_lead")
    before = row.copy()
    response = client.patch("/meeting-hours/meeting-1/agenda", json={"agenda": "  Plan\nBuild  "})
    assert response.status_code == 200
    assert client.get("/meeting-hours").json()[0]["agenda"] == "Plan\nBuild"
    assert all(row[key] == value for key, value in before.items() if key != "agenda")
    assert client.put("/meeting-hours/meeting-1", json={"start_time": row["start_time"], "end_time": row["end_time"]}).status_code == 403
    assert client.patch("/meeting-hours/meeting-1/agenda", json={"agenda": ""}).json()["agenda"] == ""


def test_member_can_read_but_cannot_save(setup):
    client_for, _ = setup
    client = client_for("cad_member")
    assert client.get("/meeting-hours").status_code == 200
    assert client.patch("/meeting-hours/meeting-1/agenda", json={"agenda": "No"}).status_code == 403
    db.update_meeting_agenda.assert_not_called()


def test_agenda_validation_and_missing_meeting(setup):
    client_for, _ = setup
    client = client_for("captain")
    assert client.patch("/meeting-hours/missing/agenda", json={"agenda": "Plan"}).status_code == 404
    assert client.patch("/meeting-hours/meeting-1/agenda", json={"agenda": "x" * 10001}).status_code == 422
    assert client.patch("/meeting-hours/meeting-1/agenda", json={}).status_code == 422
