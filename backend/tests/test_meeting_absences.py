"""Meeting absences: visibility rule, endpoints, and push recipients.

No database: the db functions are replaced by in-memory fakes and auth by a
dependency override, same approach as test_meeting_agenda.py.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
import core.push_notify as push_notify
from core.permissions import absence_push_roles, can_view_absence, has_absence_view, tracks_attendance
from core.security import require_active
from endpoints import meeting_hours
from endpoints.meeting_hours import router

NOW = datetime.now(timezone.utc)
FUTURE_ID = str(uuid.uuid4())
PAST_ID = str(uuid.uuid4())
MISSING_ID = str(uuid.uuid4())

USERS = {
    "me": ("Me", "cad_member"),
    "cad-mate": ("Cad Mate", "cad_member"),
    "cad-lead": ("Cad Lead", "cad_lead"),
    "prog-member": ("Prog Member", "programming_member"),
    "captain-1": ("Captain", "captain"),
}


# ── can_view_absence ───────────────────────────────────────────────────────────

def test_lead_sees_own_subteam_only():
    assert can_view_absence("cad_lead", "cad_member")
    assert can_view_absence("cad_lead", "cad_lead")
    assert not can_view_absence("cad_lead", "programming_member")
    assert not can_view_absence("cad_lead", "captain")  # no subteam


def test_captain_and_mentor_see_everyone():
    for viewer in ("captain", "mentor"):
        for absentee in ("cad_member", "programming_lead", "captain", "alumni"):
            assert can_view_absence(viewer, absentee)


def test_member_and_unknown_see_nobody():
    assert not can_view_absence("cad_member", "cad_member")
    assert not can_view_absence("alumni", "cad_member")
    assert not can_view_absence(None, "cad_member")


def test_has_absence_view():
    assert all(has_absence_view(r) for r in ("cad_lead", "captain", "mentor"))
    assert not has_absence_view("cad_member")
    assert not has_absence_view(None)


# ── endpoints ──────────────────────────────────────────────────────────────────

@pytest.fixture
def setup(monkeypatch):
    meetings = {
        FUTURE_ID: {"id": uuid.UUID(FUTURE_ID), "start_time": NOW + timedelta(days=1),
                    "end_time": NOW + timedelta(days=1, hours=2), "meeting_purpose": "Build",
                    "created_by": None, "agenda": ""},
        PAST_ID: {"id": uuid.UUID(PAST_ID), "start_time": NOW - timedelta(days=2),
                  "end_time": NOW - timedelta(days=2) + timedelta(hours=2), "meeting_purpose": None,
                  "created_by": None, "agenda": ""},
    }
    absences: dict[tuple[str, str], dict] = {}

    def joined(a):
        name, role = USERS[a["user_id"]]
        return {**a, "display_name": name, "role": role}

    async def upsert(meeting_id, user_id, reason):
        key = (meeting_id, user_id)
        created = key not in absences
        if created:
            absences[key] = {"meeting_id": uuid.UUID(meeting_id), "user_id": user_id,
                             "created_at": NOW, "updated_at": NOW}
        absences[key]["reason"] = reason
        return absences[key], created

    async def delete(meeting_id, user_id):
        return absences.pop((meeting_id, user_id), None) is not None

    async def list_absences(meeting_ids=None):
        return [joined(a) for (mid, _), a in absences.items() if meeting_ids is None or mid in meeting_ids]

    monkeypatch.setattr(db, "get_meeting_hours", AsyncMock(side_effect=lambda mid: meetings.get(mid)))
    monkeypatch.setattr(db, "list_all_meeting_hours", AsyncMock(side_effect=lambda: list(meetings.values())))
    monkeypatch.setattr(db, "upsert_meeting_absence", upsert)
    monkeypatch.setattr(db, "delete_meeting_absence", delete)
    monkeypatch.setattr(db, "list_meeting_absences", list_absences)
    monkeypatch.setattr(db, "list_active_members", AsyncMock(return_value=[
        {"id": uid, "display_name": name, "role": role, "created_at": NOW - timedelta(days=30), "approved_by": "captain-1"}
        for uid, (name, role) in USERS.items()
    ] + [
        {"id": "pending-lead", "display_name": "Pending", "role": "cad_lead", "created_at": NOW, "approved_by": None},
        {"id": "a-mentor", "display_name": "Mentor", "role": "mentor", "created_at": NOW, "approved_by": "captain-1"},
    ]))
    notify = MagicMock()
    monkeypatch.setattr(meeting_hours, "notify_meeting_absence", notify)

    app = FastAPI()
    app.include_router(router, prefix="/meeting-hours")

    def client(user_id="me"):
        app.dependency_overrides[require_active] = lambda: {"sub": user_id, "role": USERS[user_id][1]}
        return TestClient(app)

    return client, absences, notify


def _put(client, meeting_id=FUTURE_ID, body=None):
    return client.put(f"/meeting-hours/{meeting_id}/absence", json={"reason": "Dentist"} if body is None else body)


def test_create_then_update_pushes_only_on_create(setup):
    client_for, absences, notify = setup
    client = client_for("me")
    resp = _put(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["meeting_id"] == FUTURE_ID and body["user_id"] == "me"
    assert body["display_name"] == "Me" and body["role"] == "cad_member" and body["reason"] == "Dentist"
    notify.assert_called_once()
    meeting, absentee = notify.call_args.args
    assert absentee == {"user_id": "me", "display_name": "Me", "role": "cad_member"}

    resp = _put(client, body={"reason": "  Flu  "})
    assert resp.status_code == 200 and resp.json()["reason"] == "Flu"
    notify.assert_called_once()  # no second push
    assert absences[(FUTURE_ID, "me")]["reason"] == "Flu"


def test_blank_reason_accepted_missing_key_and_too_long_rejected(setup):
    client = setup[0]("me")
    assert _put(client, body={"reason": ""}).json()["reason"] == ""
    assert _put(client, body={"reason": "   "}).status_code == 200
    assert _put(client, body={}).status_code == 422
    assert _put(client, body={"reason": "x" * 500}).status_code == 200
    assert _put(client, body={"reason": "x" * 501}).status_code == 422
    assert _put(client, body={"reason": "x" * 5000}).status_code == 422


def test_ended_unknown_and_malformed_meeting(setup):
    client = setup[0]("me")
    resp = _put(client, PAST_ID)
    assert resp.status_code == 409 and resp.json() == {"detail": "This meeting has already ended"}
    assert _put(client, MISSING_ID).status_code == 404
    assert _put(client, "not-a-uuid").status_code == 404
    assert client.delete(f"/meeting-hours/{PAST_ID}/absence").status_code == 409
    assert client.delete("/meeting-hours/not-a-uuid/absence").status_code == 404


def test_delete(setup):
    client_for, absences, _ = setup
    client = client_for("me")
    assert client.delete(f"/meeting-hours/{FUTURE_ID}/absence").status_code == 404
    _put(client)
    resp = client.delete(f"/meeting-hours/{FUTURE_ID}/absence")
    assert resp.status_code == 200 and resp.json() == {"ok": True}
    assert (FUTURE_ID, "me") not in absences


def test_list_filtering_by_role(setup):
    client_for, _, _ = setup
    for uid in ("me", "cad-mate", "prog-member"):
        _put(client_for(uid))

    def visible(uid):
        return sorted(a["user_id"] for a in client_for(uid).get("/meeting-hours/absences").json())

    assert visible("me") == ["me"]  # members see only their own
    assert visible("prog-member") == ["prog-member"]
    assert visible("cad-lead") == ["cad-mate", "me"]  # own subteam only
    assert visible("captain-1") == ["cad-mate", "me", "prog-member"]


def test_list_is_sorted_by_meeting_start_then_name(setup):
    client_for, _, _ = setup
    # Include an absence on the (already ended) earlier meeting, seeded directly.
    async def seed():
        await db.upsert_meeting_absence(PAST_ID, "cad-mate", "")
    asyncio.run(seed())
    for uid in ("me", "cad-mate"):
        _put(client_for(uid))
    rows = client_for("captain-1").get("/meeting-hours/absences").json()
    assert [(r["meeting_id"], r["display_name"]) for r in rows] == [
        (PAST_ID, "Cad Mate"), (FUTURE_ID, "Cad Mate"), (FUTURE_ID, "Me"),
    ]


# ── push recipients ────────────────────────────────────────────────────────────

def test_absence_push_roles():
    assert absence_push_roles("cad_member") == ["cad_lead"]
    assert absence_push_roles("programming_member") == ["programming_lead"]
    assert absence_push_roles("cad_lead") == ["captain"]
    for role in ("captain", "mentor", "alumni", "visitor", "nonsense", None):
        assert absence_push_roles(role) == []


def _push(monkeypatch, role, viewer_ids=("recipient",)):
    lookup = AsyncMock(return_value=list(viewer_ids))
    notify = AsyncMock()
    monkeypatch.setattr(db, "list_absence_viewer_ids", lookup)
    monkeypatch.setattr(push_notify, "notify_users", notify)
    meeting = {"id": FUTURE_ID, "start_time": datetime(2026, 11, 13, 20, 0, tzinfo=timezone.utc),
               "end_time": datetime(2026, 11, 13, 22, 0, tzinfo=timezone.utc), "meeting_purpose": "Build"}
    asyncio.run(push_notify._notify_absence(meeting, {"user_id": "me", "display_name": "Ava", "role": role}))
    return lookup, notify


def test_member_absence_pushes_only_own_subteam_lead(monkeypatch):
    lookup, notify = _push(monkeypatch, "cad_member")
    roles, excluded = lookup.call_args.args
    assert roles == ["cad_lead"] and excluded == "me"
    args = notify.call_args.args
    assert args[0] == ["recipient"] and args[1] == "meeting_absence" and args[2] == "Absence reported"
    assert args[3] == "Ava will miss Build · Fri, Nov 13"
    assert args[4] == "/meetings" and args[5] == f"absence-{FUTURE_ID}-me"


def test_lead_absence_pushes_captains_only(monkeypatch):
    lookup, notify = _push(monkeypatch, "cad_lead")
    assert lookup.call_args.args[0] == ["captain"]
    notify.assert_called_once()


@pytest.mark.parametrize("role", ["captain", "mentor", "alumni"])
def test_captain_mentor_alumni_absence_pushes_nobody(monkeypatch, role):
    lookup, notify = _push(monkeypatch, role)
    lookup.assert_not_called()
    notify.assert_not_called()


def test_push_body_never_includes_reason(monkeypatch):
    meeting = {"id": FUTURE_ID, "start_time": datetime(2026, 11, 13, 20, 0, tzinfo=timezone.utc),
               "end_time": datetime(2026, 11, 13, 22, 0, tzinfo=timezone.utc), "meeting_purpose": "Build"}
    monkeypatch.setattr(db, "list_absence_viewer_ids", AsyncMock(return_value=["recipient"]))
    notify = AsyncMock()
    monkeypatch.setattr(push_notify, "notify_users", notify)
    absentee = {"user_id": "me", "display_name": "Ava", "role": "cad_member"}
    asyncio.run(push_notify._notify_absence(meeting, absentee))
    assert "Secret" not in str(notify.call_args)


def test_endpoint_passes_no_reason_to_push(setup):
    client_for, _, notify = setup
    _put(client_for("me"), body={"reason": "Secret dentist visit"})
    assert len(notify.call_args.args) == 2
    assert "Secret" not in str(notify.call_args)


# ── attendance overview ────────────────────────────────────────────────────────

def test_tracks_attendance_students_only():
    assert all(tracks_attendance(r) for r in ("cad_member", "cad_lead", "captain"))
    assert not any(tracks_attendance(r) for r in ("mentor", "alumni", "visitor", None))


def test_attendance_forbidden_for_members(setup):
    client, _, _ = setup
    assert client("me").get("/meeting-hours/attendance").status_code == 403


def test_attendance_lead_sees_own_subteam_members(setup):
    client, _, _ = setup
    client("cad-mate").put(f"/meeting-hours/{FUTURE_ID}/absence", json={"reason": "x"})
    client("prog-member").put(f"/meeting-hours/{FUTURE_ID}/absence", json={"reason": "y"})
    body = client("cad-lead").get("/meeting-hours/attendance").json()
    # Pending (unapproved) lead and the untracked mentor are left out.
    assert [m["user_id"] for m in body["members"]] == ["cad-lead", "cad-mate", "me"]
    assert all("created_at" in m for m in body["members"])
    assert [a["user_id"] for a in body["absences"]] == ["cad-mate"]
    assert {m["id"] for m in body["meetings"]} == {FUTURE_ID, PAST_ID}


def test_attendance_captain_sees_every_tracked_member(setup):
    client, _, _ = setup
    ids = [m["user_id"] for m in client("captain-1").get("/meeting-hours/attendance").json()["members"]]
    assert set(ids) == {"me", "cad-mate", "cad-lead", "prog-member", "captain-1"}
