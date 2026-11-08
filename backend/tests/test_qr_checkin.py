"""Endpoint tests for QR check-in: kiosk mints codes, a member's phone claims one.

The code table is an in-memory dict and auth is overridden, same no-database
approach as the other endpoint tests.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from core.security import require_active
from endpoints.attendance import router as attendance_router
from endpoints.kiosk import require_verified_kiosk, router as kiosk_router

KIOSK = {"id": "captain-1"}
MEMBER = {"sub": "member-1", "role": "cad_member"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://app.example/")
    codes: dict[str, dict] = {}
    toggles: list[str] = []

    async def create(token, kiosk_user_id):
        codes[token] = {"kiosk": kiosk_user_id, "used": False, "status": None}

    async def claim(token, user_id):
        c = codes.get(token)
        if c is None or c["used"]:
            return False
        c["used"] = True
        return True

    async def set_result(token, st):
        codes[token]["status"] = st
        return codes[token]["kiosk"]

    async def results(kiosk_user_id, tokens):
        return [
            {"token": t, "result_status": c["status"], "display_name": "Ada", "given_name": None}
            for t, c in codes.items()
            if t in tokens and c["kiosk"] == kiosk_user_id and c["used"]
        ]

    async def get_user(uid):
        return {"id": uid, "onboarding_complete": True, "display_name": "Ada", "given_name": None}

    async def toggle(uid):
        toggles.append(uid)
        return "checked_in"

    monkeypatch.setattr(db, "create_kiosk_qr_code", create)
    monkeypatch.setattr(db, "claim_kiosk_qr_code", claim)
    monkeypatch.setattr(db, "set_kiosk_qr_result", set_result)
    monkeypatch.setattr(db, "list_kiosk_qr_results", results)
    monkeypatch.setattr(db, "get_user", get_user)
    monkeypatch.setattr(db, "toggle_kiosk_attendance", toggle)

    app = FastAPI()
    app.include_router(kiosk_router, prefix="/kiosk")
    app.include_router(attendance_router, prefix="/attendance")
    app.dependency_overrides[require_verified_kiosk] = lambda: KIOSK
    app.dependency_overrides[require_active] = lambda: MEMBER
    c = TestClient(app)
    c.toggles = toggles
    return c


def test_full_flow_and_single_use(client):
    code = client.post("/kiosk/qr_code").json()
    assert code["url"] == f"https://app.example/checkin?t={code['token']}"

    assert client.post("/kiosk/qr_status", json={"tokens": [code["token"]]}).json() == []

    resp = client.post("/attendance/qr_checkin", json={"token": code["token"]})
    assert resp.status_code == 200
    assert resp.json() == {"name": "Ada", "status": "checked_in"}

    seen = client.post("/kiosk/qr_status", json={"tokens": [code["token"]]}).json()
    assert seen == [{"token": code["token"], "name": "Ada", "status": "checked_in"}]

    # A screenshot of the same code can't be replayed.
    again = client.post("/attendance/qr_checkin", json={"token": code["token"]})
    assert again.status_code == 410
    assert client.toggles == ["member-1"]


def test_unknown_code_rejected(client):
    resp = client.post("/attendance/qr_checkin", json={"token": "nope"})
    assert resp.status_code == 410
    assert client.toggles == []
