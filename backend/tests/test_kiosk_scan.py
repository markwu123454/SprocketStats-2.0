"""Endpoint tests for camera kiosks: /kiosk/scan, /kiosk/authorize, /kiosk/clock.

Same no-database approach as the other endpoint tests: db functions are
replaced with an in-memory store and kiosk auth is overridden.
"""

import time
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from core import member_codes as mc
from endpoints import kiosk as kiosk_mod
from endpoints.kiosk import require_verified_kiosk, router as kiosk_router

MEMBER_ID = "104837261955310428817"
CAPTAIN_ID = "116094827730581462093"


def _user(uid, number, name, given, role):
    return {
        "id": uid, "code_number": number, "display_name": name, "given_name": given, "role": role,
        "onboarding_complete": True, "banned_at": None, "approved_by": "mentor-1", "code_version": 1,
    }


USERS = {
    MEMBER_ID: _user(MEMBER_ID, 42, "Ava Chen", "Ava", "cad_member"),
    CAPTAIN_ID: _user(CAPTAIN_ID, 7, "Riley Park", "Riley", "captain"),
}


def code_for(member_id: str, offset_steps: int = 0) -> str:
    step = int(time.time() // mc.STEP_SECONDS) + offset_steps
    user = USERS[member_id]
    return mc.code_for(mc.member_secret(member_id, 1), user["code_number"], step)


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setenv(mc.KEY_ENV, "test-member-code-key")
    kiosk_mod._authorize_attempts.clear()
    state = {"scans": {}, "toggles": [], "in": set(), "recent": False, "kiosks": [], "revoked": []}

    async def get_user_by_code_number(number):
        return next((u for u in USERS.values() if u["code_number"] == number), None)

    async def get_kiosk_scan(scan_id):
        row = state["scans"].get(scan_id)
        return None if row is None else {**row, **{k: USERS[row["user_id"]][k] for k in ("display_name", "given_name")}}

    async def claim_kiosk_scan(scan_id, kiosk_id, user_id, method, scanned_at):
        if scan_id in state["scans"]:
            return False
        state["scans"][scan_id] = {"scan_id": scan_id, "user_id": user_id, "kiosk_id": kiosk_id, "result": None}
        return True

    async def finish_kiosk_scan(scan_id, result):
        state["scans"][scan_id]["result"] = result

    async def member_scanned_recently(user_id, exclude_scan_id, within):
        return state["recent"]

    async def kiosk_attendance_status(user_id):
        return "checked_in" if user_id in state["in"] else "checked_out"

    async def toggle(user_id, source="kiosk"):
        state["toggles"].append((user_id, source))
        if user_id in state["in"]:
            state["in"].discard(user_id)
            return "checked_out"
        state["in"].add(user_id)
        return "checked_in"

    async def create_kiosk(authorized_by):
        state["kiosks"].append(authorized_by)
        return "K-ABC123"

    async def revoke_kiosk(kiosk_id):
        state["revoked"].append(kiosk_id)

    for name, fn in {
        "get_user_by_code_number": get_user_by_code_number, "get_kiosk_scan": get_kiosk_scan, "claim_kiosk_scan": claim_kiosk_scan,
        "finish_kiosk_scan": finish_kiosk_scan, "member_scanned_recently": member_scanned_recently,
        "kiosk_attendance_status": kiosk_attendance_status, "toggle_kiosk_attendance": toggle,
        "create_kiosk": create_kiosk, "revoke_kiosk": revoke_kiosk,
    }.items():
        monkeypatch.setattr(db, name, fn)
    return state


def _client(kiosk: dict | None) -> TestClient:
    app = FastAPI()
    app.include_router(kiosk_router, prefix="/kiosk")
    if kiosk is not None:
        app.dependency_overrides[require_verified_kiosk] = lambda: kiosk
    return TestClient(app)


@pytest.fixture
def client(store):
    return _client({"id": CAPTAIN_ID, "kiosk_id": "K-ABC123"})


def scan(client, code, scan_id=None, scanned_at=None):
    return client.post("/kiosk/scan", json={
        "code": code,
        "scanned_at": time.time() if scanned_at is None else scanned_at,
        "scan_id": str(scan_id or uuid.uuid4()),
    })


def test_scan_checks_member_in(client, store):
    resp = scan(client, code_for(MEMBER_ID))
    assert resp.status_code == 200
    assert resp.json() == {"name": "Ava Chen", "first_name": "Ava", "status": "checked_in", "repeat": False}
    assert store["toggles"] == [(MEMBER_ID, "kiosk_code")]


def test_retried_scan_id_does_not_toggle_twice(client, store):
    scan_id = uuid.uuid4()
    first = scan(client, code_for(MEMBER_ID), scan_id)
    again = scan(client, code_for(MEMBER_ID), scan_id)
    assert first.json() == again.json()
    assert len(store["toggles"]) == 1


def test_new_appearance_toggles_again(client, store):
    assert scan(client, code_for(MEMBER_ID)).json()["status"] == "checked_in"
    assert scan(client, code_for(MEMBER_ID)).json()["status"] == "checked_out"
    assert len(store["toggles"]) == 2


def test_repeat_within_guard_changes_nothing(client, store):
    store["in"].add(MEMBER_ID)
    store["recent"] = True
    resp = scan(client, code_for(MEMBER_ID))
    assert resp.json() == {"name": "Ava Chen", "first_name": "Ava", "status": "checked_in", "repeat": True}
    assert store["toggles"] == []


def test_old_code_is_expired(client, store):
    resp = scan(client, code_for(MEMBER_ID, -3))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Code expired. Scan again."


def test_fast_phone_clock_is_named(client, store):
    resp = scan(client, code_for(MEMBER_ID, 3))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Phone clock is 30 s fast"


def test_kiosk_clock_must_be_close(client, store):
    resp = scan(client, code_for(MEMBER_ID), scanned_at=time.time() - 30)
    assert resp.status_code == 400
    assert store["toggles"] == []


def test_code_is_16_digits(store):
    assert len(code_for(MEMBER_ID)) == 16 and code_for(MEMBER_ID).startswith("0042")


def test_unknown_member(client, store):
    resp = scan(client, "9999" + "0" * 12)
    assert resp.status_code == 404


def test_code_for_another_number_is_rejected(client, store):
    # Ava's tag under Riley's number: the tag binds the number, so it fails.
    resp = scan(client, "0007" + code_for(MEMBER_ID)[4:])
    assert resp.status_code == 409
    assert store["toggles"] == []


def test_not_a_member_code(client, store):
    assert scan(client, "hello").status_code == 400


def test_legacy_kiosk_must_be_set_up_again(store):
    legacy = _client({"id": CAPTAIN_ID, "kiosk_id": None})
    resp = scan(legacy, code_for(MEMBER_ID))
    assert resp.status_code == 401
    assert store["toggles"] == []


def test_authorize_with_captain_code_sets_kiosk_cookie(store):
    c = _client(None)
    resp = c.post("/kiosk/authorize", json={
        "code": code_for(CAPTAIN_ID), "scanned_at": time.time(), "scan_id": str(uuid.uuid4()),
    })
    assert resp.status_code == 200
    assert resp.json() == {"kiosk_id": "K-ABC123", "authorized_by": "Riley Park"}
    assert "kiosk_auth=" in resp.headers.get("set-cookie", "")
    assert store["kiosks"] == [CAPTAIN_ID]


def test_authorize_rejects_regular_member(store):
    c = _client(None)
    resp = c.post("/kiosk/authorize", json={
        "code": code_for(MEMBER_ID), "scanned_at": time.time(), "scan_id": str(uuid.uuid4()),
    })
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Ava Chen can't authorize kiosks"
    assert store["kiosks"] == []


def test_authorize_is_rate_limited(store):
    c = _client(None)
    body = {"code": "nope", "scanned_at": time.time(), "scan_id": str(uuid.uuid4())}
    codes = [c.post("/kiosk/authorize", json=body).status_code for _ in range(kiosk_mod.AUTHORIZE_RATE_LIMIT + 1)]
    assert codes[-1] == 429
    assert set(codes[:-1]) == {400}


def test_logout_revokes_registered_kiosk(store):
    c = _client(None)
    token = kiosk_mod._issue_registered_kiosk_token("K-ABC123", CAPTAIN_ID)
    c.cookies.set("kiosk_auth", token)
    assert c.post("/kiosk/verify_logout").json() == {"ok": True}
    assert store["revoked"] == ["K-ABC123"]


def test_clock(store):
    before = time.time()
    server_time = _client(None).get("/kiosk/clock").json()["server_time"]
    assert before - 1 <= server_time <= time.time() + 1
