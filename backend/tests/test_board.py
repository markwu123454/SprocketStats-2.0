"""Endpoint tests for the task board (endpoints/board.py).

Same no-database approach as the other endpoint tests: the tasks FakeStore
from test_tasks_endpoints stands in for the tasks tables, plus a small kiosk
table. The board cookie and act tokens are real, so these tests also cover
how a board is set up and who may act on it.
"""

import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from jose import jwt

import db
from core import member_codes as mc
from core import push_notify
from core.security import JWT_ALGORITHM, JWT_SECRET, get_current_user
from endpoints import board as board_mod
from endpoints import kiosk as kiosk_mod
from endpoints.board import router as board_router
from endpoints.kiosk import require_verified_kiosk
from test_tasks_endpoints import FakeStore

LEAD = "lead-1"
CAPTAIN = "captain-1"
MEMBER = "member-1"
OTHER = "member-2"
ALUM = "alum-1"

PEOPLE = {
    # id: (code number, display name, given name, role, email)
    LEAD: (11, "Lena Ortiz", "Lena", "cad_lead", "204811@stu.wvusd.org"),
    CAPTAIN: (7, "Riley Park", "Riley", "captain", "204812@stu.wvusd.org"),
    MEMBER: (42, "Ava Chen", "Ava", "cad_member", "204813@stu.wvusd.org"),
    OTHER: (43, "Ben Ito", "Ben", "manufacturing_member", "204814@stu.wvusd.org"),
    ALUM: (90, "Old Timer", "Old", "alumni", "old.timer@gmail.com"),
}


def code_for(user_id: str, offset_steps: int = 0) -> str:
    step = int(time.time() // mc.STEP_SECONDS) + offset_steps
    return mc.code_for(mc.member_secret(user_id, 1), PEOPLE[user_id][0], step)


def scan_body(user_id: str) -> dict:
    return {"code": code_for(user_id), "scanned_at": time.time(), "scan_id": str(uuid.uuid4())}


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setenv(mc.KEY_ENV, "test-member-code-key")
    kiosk_mod._authorize_attempts.clear()
    board_mod._email_attempts.clear()

    fake = FakeStore()
    for uid, (number, name, given, role, email) in PEOPLE.items():
        fake.add_user(uid, name, role=role, picture=f"https://photos/{uid}.jpg")
        fake.users[uid].update({"code_number": number, "code_version": 1, "given_name": given, "email": email})
    fake.kiosks = {}

    async def get_user_by_code_number(number):
        return next((u for u in fake.users.values() if u.get("code_number") == number), None)

    async def get_user_by_email(email):
        return next((u for u in fake.users.values() if u.get("email", "").lower() == email.lower()), None)

    async def create_board(authorized_by, bucket):
        kiosk_id = f"K-{len(fake.kiosks):06X}"
        fake.kiosks[kiosk_id] = {
            "id": kiosk_id, "authorized_by": authorized_by, "kind": "board", "bucket": bucket, "revoked_at": None,
        }
        return kiosk_id

    async def get_kiosk(kiosk_id):
        return fake.kiosks.get(kiosk_id)

    async def revoke_kiosk(kiosk_id):
        fake.kiosks[kiosk_id]["revoked_at"] = datetime.now(timezone.utc)

    async def touch_kiosk(kiosk_id):
        return None

    for name in (
        "list_tasks", "get_task", "update_task", "claim_task", "review_task", "get_user",
        "add_contributor", "remove_contributor", "release_assignee", "list_task_notes", "create_task_note",
    ):
        monkeypatch.setattr(db, name, getattr(fake, name))
    for name, fn in {
        "get_user_by_code_number": get_user_by_code_number, "get_user_by_email": get_user_by_email,
        "create_board": create_board, "get_kiosk": get_kiosk, "revoke_kiosk": revoke_kiosk, "touch_kiosk": touch_kiosk,
    }.items():
        monkeypatch.setattr(db, name, fn)
    monkeypatch.setattr(push_notify, "queue_push_later", lambda *a, **k: fake.pushes.append(a))
    return fake


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(board_router, prefix="/board")
    # https, so the Secure board cookie is sent back.
    return TestClient(app, base_url="https://testserver")


@pytest.fixture
def board(store):
    """A board set up by the CAD lead."""
    client = _client()
    assert client.post("/board/authorize", json=scan_body(LEAD)).status_code == 200
    return client


def act(client, user_id, by="code"):
    if by == "code":
        resp = client.post("/board/act/code", json=scan_body(user_id))
    else:
        resp = client.post("/board/act/email", json={"email": PEOPLE[user_id][4]})
    assert resp.status_code == 200, resp.text
    return {"X-Board-Act": resp.json()["token"]}


# --- Setting up -----------------------------------------------------------------

def test_lead_sets_up_board_for_their_subteam(store):
    client = _client()
    resp = client.post("/board/authorize", json=scan_body(LEAD))
    assert resp.status_code == 200
    assert resp.json()["bucket"] == "cad"
    assert resp.json()["authorized_by_name"] == "Lena Ortiz"
    assert "board_auth" in client.cookies
    assert client.get("/board").json()["bucket"] == "cad"


def test_captain_board_shows_every_subteam(store):
    resp = _client().post("/board/authorize", json=scan_body(CAPTAIN))
    assert resp.status_code == 200
    assert resp.json()["bucket"] is None


def test_member_cannot_set_up_a_board(store):
    resp = _client().post("/board/authorize", json=scan_body(MEMBER))
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Ava Chen can't set up a task board. Ask a lead, captain or mentor."
    assert store.kiosks == {}


def test_expired_code_cannot_set_up_a_board(store):
    body = {**scan_body(LEAD), "code": code_for(LEAD, -3)}
    assert _client().post("/board/authorize", json=body).status_code == 409


def test_board_needs_setting_up(store):
    client = _client()
    assert client.get("/board/tasks").status_code == 401
    client.cookies.set("board_auth", "not-a-token")
    assert client.get("/board").json()["detail"] == "Set up this board"


def test_anyone_at_the_board_can_turn_it_off(board, store):
    # No one signed in: the board cookie is enough.
    assert board.post("/board/logout").json() == {"ok": True}
    (kiosk,) = store.kiosks.values()
    assert kiosk["revoked_at"] is not None
    # Even with the old cookie kept, the board is gone.
    stale = _client()
    stale.cookies.set("board_auth", board_mod._issue_board_token(kiosk["id"]))
    assert stale.get("/board").json()["detail"] == "Board deauthorized"


def test_board_stops_when_its_lead_steps_down(board, store):
    store.users[LEAD]["role"] = "cad_member"
    assert board.get("/board").status_code == 401


def test_board_cookie_is_not_a_kiosk_or_a_session(board, store):
    token = board.cookies["board_auth"]
    with pytest.raises(Exception):
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    with pytest.raises(HTTPException):
        get_current_user(auth_token=token)


async def test_attendance_kiosk_refuses_a_board_row(board, store):
    (kiosk_id,) = store.kiosks
    token = kiosk_mod._issue_registered_kiosk_token(kiosk_id, LEAD)
    with pytest.raises(HTTPException) as err:
        await require_verified_kiosk(kiosk_auth=token)
    assert err.value.status_code == 401


# --- Showing tasks ---------------------------------------------------------------

def test_tasks_drop_old_done_and_keep_hidden_photos_hidden(board, store):
    store.users[MEMBER]["hide_picture"] = True
    long_ago = datetime.now(timezone.utc) - timedelta(days=30)
    open_id = store.add_task(title="Open", assignee_id=MEMBER, status="doing")
    recent_id = store.add_task(title="Recent", status="done")
    store.add_task(title="Old", status="done", updated_at=long_ago)

    tasks = {t["id"]: t for t in board.get("/board/tasks").json()}
    assert set(tasks) == {open_id, recent_id}
    assert tasks[open_id]["assignee_name"] == "Ava Chen"
    assert tasks[open_id]["assignee_picture"] is None


def test_notes_are_readable_without_identifying(board, store):
    task_id = store.add_task()
    store.notes["n1"] = {"id": "n1", "task_id": task_id, "author_id": MEMBER, "body": "hi", "created_at": datetime.now(timezone.utc)}
    notes = board.get(f"/board/tasks/{task_id}/notes").json()
    assert [n["body"] for n in notes] == ["hi"]


# --- Acting as yourself --------------------------------------------------------------

def test_changes_need_someone_to_identify(board, store):
    task_id = store.add_task()
    resp = board.post(f"/board/tasks/{task_id}/claim")
    assert resp.status_code == 401
    assert store.tasks[task_id]["assignee_id"] is None


def test_code_identifies_and_claims(board, store):
    task_id = store.add_task()
    resp = board.post("/board/act/code", json=scan_body(MEMBER))
    assert resp.status_code == 200
    body = resp.json()
    assert (body["level"], body["first_name"], body["authority"]) == ("code", "Ava", False)

    claimed = board.post(f"/board/tasks/{task_id}/claim", headers={"X-Board-Act": body["token"]})
    assert claimed.status_code == 200
    assert claimed.json()["assignee_id"] == MEMBER
    assert claimed.json()["status"] == "doing"


def test_students_type_just_their_number(board, store):
    resp = board.post("/board/act/email", json={"email": " 204813 "})
    assert resp.status_code == 200
    assert resp.json()["user_id"] == MEMBER
    assert resp.json()["level"] == "email"


def test_unknown_email(board, store):
    resp = board.post("/board/act/email", json={"email": "nobody"})
    assert resp.status_code == 404


def test_email_tries_are_rate_limited(board, store):
    for _ in range(board_mod.EMAIL_RATE_LIMIT):
        board.post("/board/act/email", json={"email": "nobody"})
    assert board.post("/board/act/email", json={"email": "204813"}).status_code == 429


def test_email_moves_your_own_task(board, store):
    task_id = store.add_task(assignee_id=MEMBER, status="doing")
    resp = board.post(f"/board/tasks/{task_id}/status", json={"status": "review"}, headers=act(board, MEMBER, "email"))
    assert resp.status_code == 200
    assert resp.json()["status"] == "review"
    assert resp.json()["finished_by"] == MEMBER


def test_email_never_carries_a_leads_authority(board, store):
    task_id = store.add_task(assignee_id=OTHER, status="doing")
    by_email = board.post(f"/board/tasks/{task_id}/status", json={"status": "todo"}, headers=act(board, LEAD, "email"))
    assert by_email.status_code == 403
    assert store.tasks[task_id]["status"] == "doing"

    by_code = board.post(f"/board/tasks/{task_id}/status", json={"status": "todo"}, headers=act(board, LEAD))
    assert by_code.status_code == 200
    assert by_code.json()["status"] == "todo"


def test_email_cannot_send_someone_elses_review_back(board, store):
    task_id = store.add_task(assignee_id=OTHER, status="review", finished_by=OTHER)
    resp = board.post(f"/board/tasks/{task_id}/status", json={"status": "doing"}, headers=act(board, MEMBER, "email"))
    assert resp.status_code == 403


def test_reviewing_needs_a_code(board, store):
    task_id = store.add_task(assignee_id=OTHER, status="review", finished_by=OTHER)
    by_email = board.post(f"/board/tasks/{task_id}/review", headers=act(board, MEMBER, "email"))
    assert by_email.status_code == 403
    assert by_email.json()["detail"] == "Show your code to review a task"

    by_code = board.post(f"/board/tasks/{task_id}/review", headers=act(board, MEMBER))
    assert by_code.status_code == 200
    assert by_code.json()["status"] == "done"
    assert by_code.json()["reviewed_by"] == MEMBER


def test_finisher_still_cannot_review_their_own_work(board, store):
    task_id = store.add_task(assignee_id=MEMBER, status="review", finished_by=MEMBER)
    assert board.post(f"/board/tasks/{task_id}/review", headers=act(board, MEMBER)).status_code == 403


def test_join_and_leave(board, store):
    task_id = store.add_task(assignee_id=OTHER, status="doing")
    headers = act(board, MEMBER, "email")
    joined = board.post(f"/board/tasks/{task_id}/join", headers=headers)
    assert [c["id"] for c in joined.json()["contributors"]] == [MEMBER]
    left = board.post(f"/board/tasks/{task_id}/leave", headers=headers)
    assert left.json()["contributors"] == []


def test_note_is_written_by_the_member(board, store):
    task_id = store.add_task()
    resp = board.post(f"/board/tasks/{task_id}/notes", json={"body": " Cut the plate "}, headers=act(board, MEMBER, "email"))
    assert resp.status_code == 200
    assert resp.json()["author_id"] == MEMBER
    assert resp.json()["body"] == "Cut the plate"


def test_alumni_cannot_act(board, store):
    resp = board.post("/board/act/email", json={"email": PEOPLE[ALUM][4]})
    assert resp.status_code == 403


def test_banned_member_cannot_act_or_keep_acting(board, store):
    task_id = store.add_task()
    headers = act(board, MEMBER, "email")
    store.users[MEMBER]["banned_at"] = datetime.now(timezone.utc)
    assert board.post(f"/board/tasks/{task_id}/claim", headers=headers).status_code == 403
    assert board.post("/board/act/email", json={"email": "204813"}).status_code == 403


def test_act_token_is_tied_to_its_board(board, store):
    headers = act(board, MEMBER)
    other = _client()
    assert other.post("/board/authorize", json=scan_body(CAPTAIN)).status_code == 200
    task_id = store.add_task()
    assert other.post(f"/board/tasks/{task_id}/claim", headers=headers).status_code == 401


def test_act_token_is_not_a_session(board, store):
    token = act(board, MEMBER, "email")["X-Board-Act"]
    with pytest.raises(HTTPException):
        get_current_user(auth_token=token)


def test_expired_act_token(board, store):
    (kiosk_id,) = store.kiosks
    past = datetime.now(timezone.utc) - timedelta(minutes=10)
    token = jwt.encode(
        {"sub": MEMBER, "board": kiosk_id, "level": "code", "purpose": board_mod.ACT_TOKEN_PURPOSE,
         "iat": past, "exp": past + timedelta(minutes=5)},
        board_mod._BOARD_KEY, algorithm=JWT_ALGORITHM,
    )
    task_id = store.add_task()
    resp = board.post(f"/board/tasks/{task_id}/claim", headers={"X-Board-Act": token})
    assert resp.status_code == 401
    assert resp.json()["detail"].startswith("Signed out")
