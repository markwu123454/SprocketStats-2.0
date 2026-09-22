"""Endpoint-level tests for the Task Assignments router (endpoints/tasks.py).

Runs with no real database: every `db.*` call the router makes is monkeypatched
to an in-memory FakeStore that mimics the `tasks` + `users` tables' relevant
shape (joins, status defaults) closely enough to exercise the business rules
the endpoints themselves enforce -- assign/reassign authority, the
review-not-by-the-finisher rule, and reopen clearing finished_by/reviewed_by.
Auth is bypassed via a FastAPI dependency override on `require_active` (which
`require_task_access` in endpoints/tasks.py is bound to), so each test picks
the calling user directly instead of forging a JWT cookie.
"""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from core.security import require_active
from endpoints.tasks import router as tasks_router

CAPTAIN = {"sub": "captain-1", "role": "captain"}
MEMBER = {"sub": "member-1", "role": "cad_member"}
LEAD = {"sub": "lead-1", "role": "cad_lead"}


class FakeStore:
    """In-memory stand-in for the `tasks` + `users` tables, shaped like the
    real `db.tasks` functions (see backend/db/tasks.py)."""

    def __init__(self):
        self.tasks: dict[str, dict] = {}
        self.users: dict[str, dict] = {}
        # task id -> ordered list of contributor user ids (earliest first,
        # mirroring `ORDER BY added_at` in the real query).
        self.contributors: dict[str, list[str]] = {}
        self.notes: dict[str, dict] = {}

    def add_user(self, user_id, display_name, role=None, approved_by="approver", banned_at=None,
                 onboarding_complete=True):
        self.users[user_id] = {
            "id": user_id,
            "display_name": display_name,
            "role": role,
            "approved_by": approved_by,
            "banned_at": banned_at,
            "onboarding_complete": onboarding_complete,
        }

    def add_task(self, **overrides) -> str:
        now = datetime.now(timezone.utc)
        task = {
            "id": str(uuid.uuid4()),
            "title": "Task",
            "area": "General",
            "bucket": "general",
            "priority": "med",
            "status": "todo",
            "assignee_id": None,
            "due_date": None,
            "created_by": "creator",
            "finished_by": None,
            "reviewed_by": None,
            "created_at": now,
            "updated_at": now,
        }
        task.update(overrides)
        self.tasks[task["id"]] = task
        return task["id"]

    def _joined(self, t: dict) -> dict:
        d = dict(t)
        d["assignee_name"] = self.users.get(t["assignee_id"], {}).get("display_name") if t["assignee_id"] else None
        d["created_by_name"] = self.users.get(t["created_by"], {}).get("display_name")
        d["finished_by_name"] = self.users.get(t["finished_by"], {}).get("display_name") if t["finished_by"] else None
        d["reviewed_by_name"] = self.users.get(t["reviewed_by"], {}).get("display_name") if t["reviewed_by"] else None
        d["contributors"] = [
            {"id": uid, "display_name": self.users.get(uid, {}).get("display_name")}
            for uid in self.contributors.get(t["id"], [])
        ]
        d["note_count"] = sum(1 for n in self.notes.values() if n["task_id"] == t["id"])
        return d

    def _joined_note(self, n: dict) -> dict:
        d = dict(n)
        d["author_name"] = self.users.get(n["author_id"], {}).get("display_name") if n["author_id"] else None
        return d

    # -- db.tasks-shaped async methods, monkeypatched onto the `db` module --

    async def list_tasks(self):
        return [self._joined(t) for t in self.tasks.values()]

    async def get_task(self, task_id):
        t = self.tasks.get(task_id)
        return self._joined(t) if t else None

    async def list_task_people(self):
        return list(self.users.values())

    async def create_task(self, title, area, bucket, priority, due_date, assignee_id, created_by):
        tid = self.add_task(
            title=title, area=area, bucket=bucket, priority=priority,
            due_date=due_date, assignee_id=assignee_id, created_by=created_by,
        )
        return self._joined(self.tasks[tid])

    async def update_task(self, task_id, fields):
        if not fields:
            raise ValueError("update_task requires at least one field to set")
        t = self.tasks.get(task_id)
        if t is None:
            return None
        t.update(fields)
        t["updated_at"] = datetime.now(timezone.utc)
        return self._joined(t)

    async def claim_task(self, task_id, user_id):
        t = self.tasks.get(task_id)
        if t is None or t["assignee_id"] is not None:
            return None
        t["assignee_id"] = user_id
        if t["status"] == "todo":
            t["status"] = "doing"
        t["updated_at"] = datetime.now(timezone.utc)
        return self._joined(t)

    async def review_task(self, task_id, reviewer_id):
        t = self.tasks.get(task_id)
        if t is None or t["status"] != "review":
            return None
        t["status"] = "done"
        t["reviewed_by"] = reviewer_id
        t["updated_at"] = datetime.now(timezone.utc)
        return self._joined(t)

    async def unreview_task(self, task_id):
        t = self.tasks.get(task_id)
        if t is None or t["status"] != "done":
            return None
        t["status"] = "review"
        t["reviewed_by"] = None
        t["updated_at"] = datetime.now(timezone.utc)
        return self._joined(t)

    async def delete_task(self, task_id):
        return self.tasks.pop(task_id, None) is not None

    async def get_user(self, user_id):
        return self.users.get(user_id)

    async def add_contributor(self, task_id, user_id):
        t = self.tasks.get(task_id)
        if t is None:
            return None
        ids = self.contributors.setdefault(task_id, [])
        if user_id not in ids:
            ids.append(user_id)
        return self._joined(t)

    async def remove_contributor(self, task_id, user_id):
        t = self.tasks.get(task_id)
        if t is None:
            return None
        ids = self.contributors.get(task_id)
        if ids and user_id in ids:
            ids.remove(user_id)
        return self._joined(t)

    async def release_assignee(self, task_id):
        t = self.tasks.get(task_id)
        if t is None:
            return None
        ids = self.contributors.get(task_id, [])
        if ids:
            t["assignee_id"] = ids.pop(0)
        else:
            t["assignee_id"] = None
            if t["status"] == "doing":
                t["status"] = "todo"
        t["updated_at"] = datetime.now(timezone.utc)
        return self._joined(t)

    async def list_task_notes(self, task_id):
        notes = [n for n in self.notes.values() if n["task_id"] == task_id]
        notes.sort(key=lambda n: n["created_at"])
        return [self._joined_note(n) for n in notes]

    async def get_task_note(self, note_id):
        n = self.notes.get(note_id)
        return self._joined_note(n) if n else None

    async def create_task_note(self, task_id, author_id, body):
        nid = str(uuid.uuid4())
        note = {
            "id": nid,
            "task_id": task_id,
            "author_id": author_id,
            "body": body,
            "created_at": datetime.now(timezone.utc),
        }
        self.notes[nid] = note
        return self._joined_note(note)

    async def delete_task_note(self, note_id):
        return self.notes.pop(note_id, None) is not None


@pytest.fixture
def store(monkeypatch):
    fake = FakeStore()
    for name in (
        "list_tasks", "get_task", "list_task_people", "create_task",
        "update_task", "claim_task", "review_task", "unreview_task",
        "delete_task", "get_user", "add_contributor", "remove_contributor",
        "release_assignee", "list_task_notes", "get_task_note",
        "create_task_note", "delete_task_note",
    ):
        monkeypatch.setattr(db, name, getattr(fake, name))
    return fake


@pytest.fixture
def app():
    fastapi_app = FastAPI()
    fastapi_app.include_router(tasks_router, prefix="/tasks")
    return fastapi_app


def _as(app: FastAPI, user: dict) -> TestClient:
    """A TestClient acting as `user` (overrides the require_active/require_task_access gate)."""
    app.dependency_overrides[require_active] = lambda: user
    return TestClient(app)


# ── Review: anyone except the finisher ──────────────────────────────────────

def test_review_forbidden_for_the_finisher(app, store):
    store.add_user("member-1", "Member One", role="cad_member")
    task_id = store.add_task(status="review", finished_by="member-1")

    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/review")
    assert resp.status_code == 403


def test_review_allowed_for_anyone_else(app, store):
    store.add_user("member-1", "Member One", role="cad_member")
    store.add_user("captain-1", "Cap One", role="captain")
    task_id = store.add_task(status="review", finished_by="member-1")

    resp = _as(app, CAPTAIN).post(f"/tasks/{task_id}/review")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "done"
    assert body["reviewed_by"] == "captain-1"


def test_review_requires_review_status(app, store):
    task_id = store.add_task(status="todo")
    resp = _as(app, CAPTAIN).post(f"/tasks/{task_id}/review")
    assert resp.status_code == 400


def test_review_unknown_task_404(app, store):
    resp = _as(app, CAPTAIN).post("/tasks/does-not-exist/review")
    assert resp.status_code == 404


# ── Reopening clears finished_by and reviewed_by ────────────────────────────

def test_reopen_to_doing_clears_finished_and_reviewed_by(app, store):
    task_id = store.add_task(status="done", finished_by="member-1", reviewed_by="captain-1")

    resp = _as(app, CAPTAIN).patch(f"/tasks/{task_id}", json={"status": "doing"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "doing"
    assert body["finished_by"] is None
    assert body["reviewed_by"] is None


def test_reopen_to_todo_clears_finished_and_reviewed_by(app, store):
    task_id = store.add_task(status="review", finished_by="member-1", reviewed_by=None)

    resp = _as(app, CAPTAIN).patch(f"/tasks/{task_id}", json={"status": "todo"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "todo"
    assert body["finished_by"] is None


def test_moving_to_review_sets_finished_by_once(app, store):
    # created_by="member-1" -- MEMBER needs edit rights on this task (creator
    # or authority) to PATCH it at all; this isolates the finished_by behavior.
    task_id = store.add_task(status="doing", finished_by=None, created_by="member-1")

    resp = _as(app, MEMBER).patch(f"/tasks/{task_id}", json={"status": "review"})
    assert resp.status_code == 200
    assert resp.json()["finished_by"] == "member-1"


def test_moving_to_review_does_not_overwrite_existing_finished_by(app, store):
    # Bouncing doing -> review again (without reopening first) must not
    # reassign credit for finishing the task to whoever nudges it this time.
    task_id = store.add_task(status="doing", finished_by="original-finisher", created_by="member-1")

    resp = _as(app, MEMBER).patch(f"/tasks/{task_id}", json={"status": "review"})
    assert resp.status_code == 200
    assert resp.json()["finished_by"] == "original-finisher"


# ── done is only reachable through /review, never a bare PATCH ─────────────

def test_patch_cannot_set_status_done(app, store):
    task_id = store.add_task(status="review")
    resp = _as(app, CAPTAIN).patch(f"/tasks/{task_id}", json={"status": "done"})
    assert resp.status_code == 400


# ── Assign/reassign always requires tasks.assign, even for the creator ─────

def test_patch_assignee_change_forbidden_for_creator_without_authority(app, store):
    store.add_user("target-1", "Target One", role="cad_member")
    task_id = store.add_task(created_by="member-1")

    resp = _as(app, MEMBER).patch(f"/tasks/{task_id}", json={"assignee_id": "target-1"})
    assert resp.status_code == 403


def test_patch_assignee_change_allowed_for_authority(app, store):
    store.add_user("target-1", "Target One", role="cad_member")
    task_id = store.add_task(created_by="member-1")

    resp = _as(app, LEAD).patch(f"/tasks/{task_id}", json={"assignee_id": "target-1"})
    assert resp.status_code == 200
    assert resp.json()["assignee_id"] == "target-1"


def test_patch_non_assignee_fields_allowed_for_creator_without_authority(app, store):
    task_id = store.add_task(created_by="member-1", title="Old title")
    resp = _as(app, MEMBER).patch(f"/tasks/{task_id}", json={"title": "New title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New title"


def test_patch_forbidden_for_non_creator_non_authority(app, store):
    task_id = store.add_task(created_by="someone-else")
    resp = _as(app, MEMBER).patch(f"/tasks/{task_id}", json={"title": "Hijacked"})
    assert resp.status_code == 403


def test_patch_rejects_unknown_bucket(app, store):
    task_id = store.add_task(created_by="member-1")
    resp = _as(app, MEMBER).patch(f"/tasks/{task_id}", json={"bucket": "not_a_bucket"})
    assert resp.status_code == 400


def test_patch_rejects_blank_title(app, store):
    task_id = store.add_task(created_by="member-1")
    resp = _as(app, MEMBER).patch(f"/tasks/{task_id}", json={"title": "   "})
    assert resp.status_code == 400


# ── Claim ─────────────────────────────────────────────────────────────────

def test_claim_assigns_self_and_bumps_todo_to_doing(app, store):
    task_id = store.add_task(status="todo", assignee_id=None)
    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/claim")
    assert resp.status_code == 200
    body = resp.json()
    assert body["assignee_id"] == "member-1"
    assert body["status"] == "doing"


def test_claim_conflict_when_already_assigned(app, store):
    task_id = store.add_task(status="todo", assignee_id="someone-else")
    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/claim")
    assert resp.status_code == 409


def test_claim_unknown_task_404(app, store):
    resp = _as(app, MEMBER).post("/tasks/does-not-exist/claim")
    assert resp.status_code == 404


# ── /tasks/people never leaks email, and filters pending-approval users ────

def test_people_excludes_pending_approval_and_never_returns_email(app, store):
    # cad_member does not require approval -- eligible even with approved_by None.
    store.add_user("m1", "Member One", role="cad_member", approved_by=None)
    # cad_lead requires approval -- excluded while approved_by is still None.
    store.add_user("l1", "Pending Lead", role="cad_lead", approved_by=None)
    store.add_user("l2", "Approved Lead", role="cad_lead", approved_by="someone")

    resp = _as(app, MEMBER).get("/tasks/people")
    assert resp.status_code == 200
    people = resp.json()
    assert {p["id"] for p in people} == {"m1", "l2"}
    for p in people:
        assert set(p.keys()) == {"id", "display_name"}


# ── Create ───────────────────────────────────────────────────────────────

def test_create_open_to_anyone(app, store):
    resp = _as(app, MEMBER).post("/tasks", json={"title": "New task", "bucket": "cad"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "New task"
    assert body["bucket"] == "cad"
    assert body["created_by"] == "member-1"
    assert body["status"] == "todo"


def test_create_requires_authority_to_set_assignee(app, store):
    store.add_user("target-1", "Target One", role="cad_member")
    resp = _as(app, MEMBER).post(
        "/tasks", json={"title": "T", "bucket": "cad", "assignee_id": "target-1"}
    )
    assert resp.status_code == 403


def test_create_allows_authority_to_set_assignee(app, store):
    store.add_user("target-1", "Target One", role="cad_member")
    resp = _as(app, CAPTAIN).post(
        "/tasks", json={"title": "T", "bucket": "cad", "assignee_id": "target-1"}
    )
    assert resp.status_code == 200
    assert resp.json()["assignee_id"] == "target-1"


def test_create_rejects_unknown_assignee(app, store):
    resp = _as(app, CAPTAIN).post("/tasks", json={"title": "T", "bucket": "cad", "assignee_id": "ghost"})
    assert resp.status_code == 400


def test_create_rejects_blank_title(app, store):
    resp = _as(app, MEMBER).post("/tasks", json={"title": "   ", "bucket": "cad"})
    assert resp.status_code == 400


def test_create_rejects_unknown_bucket(app, store):
    resp = _as(app, MEMBER).post("/tasks", json={"title": "T", "bucket": "not_a_bucket"})
    assert resp.status_code == 400


def test_create_rejects_unknown_priority(app, store):
    resp = _as(app, MEMBER).post("/tasks", json={"title": "T", "bucket": "cad", "priority": "urgent"})
    assert resp.status_code == 400


def test_create_defaults_blank_area_to_general(app, store):
    resp = _as(app, MEMBER).post("/tasks", json={"title": "T", "bucket": "cad", "area": "  "})
    assert resp.status_code == 200
    assert resp.json()["area"] == "General"


# ── Unreview ────────────────────────────────────────────────────────────────

def test_unreview_requires_done_status(app, store):
    task_id = store.add_task(status="review", created_by="member-1")
    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/unreview")
    assert resp.status_code == 400


def test_unreview_forbidden_for_non_authority_non_creator(app, store):
    task_id = store.add_task(
        status="done", created_by="someone-else", finished_by="member-1", reviewed_by="captain-1"
    )
    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/unreview")
    assert resp.status_code == 403


def test_unreview_keeps_finished_by_but_clears_reviewed_by(app, store):
    task_id = store.add_task(
        status="done", created_by="member-1", finished_by="other-user", reviewed_by="captain-1"
    )
    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/unreview")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "review"
    assert body["reviewed_by"] is None
    assert body["finished_by"] == "other-user"


def test_unreview_allowed_for_authority_non_creator(app, store):
    task_id = store.add_task(status="done", created_by="someone-else", reviewed_by="someone-else")
    resp = _as(app, CAPTAIN).post(f"/tasks/{task_id}/unreview")
    assert resp.status_code == 200


# ── Delete ──────────────────────────────────────────────────────────────────

def test_delete_forbidden_for_non_authority_non_creator(app, store):
    task_id = store.add_task(created_by="someone-else")
    resp = _as(app, MEMBER).delete(f"/tasks/{task_id}")
    assert resp.status_code == 403


def test_delete_allowed_for_creator(app, store):
    task_id = store.add_task(created_by="member-1")
    resp = _as(app, MEMBER).delete(f"/tasks/{task_id}")
    assert resp.status_code == 204
    assert task_id not in store.tasks


def test_delete_allowed_for_authority(app, store):
    task_id = store.add_task(created_by="someone-else")
    resp = _as(app, CAPTAIN).delete(f"/tasks/{task_id}")
    assert resp.status_code == 204


def test_delete_unknown_task_404(app, store):
    resp = _as(app, CAPTAIN).delete("/tasks/does-not-exist")
    assert resp.status_code == 404


# ── List ──────────────────────────────────────────────────────────────────

def test_list_tasks_open_to_any_authenticated_user(app, store):
    store.add_task(title="A")
    store.add_task(title="B")
    resp = _as(app, MEMBER).get("/tasks")
    assert resp.status_code == 200
    assert {t["title"] for t in resp.json()} == {"A", "B"}


# ── Contributors: add/remove ────────────────────────────────────────────────

def test_add_contributor_member_can_add_self(app, store):
    store.add_user("member-1", "Member One", role="cad_member")
    task_id = store.add_task(assignee_id="assignee-1", status="doing")

    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/contributors")
    assert resp.status_code == 200
    assert resp.json()["contributors"] == [{"id": "member-1", "display_name": "Member One"}]


def test_add_contributor_requires_assignee(app, store):
    task_id = store.add_task(assignee_id=None, status="todo")
    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/contributors")
    assert resp.status_code == 400


def test_add_contributor_rejected_for_done_task(app, store):
    task_id = store.add_task(assignee_id="assignee-1", status="done")
    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/contributors")
    assert resp.status_code == 400


def test_add_contributor_conflict_when_caller_is_assignee(app, store):
    task_id = store.add_task(assignee_id="member-1", status="doing")
    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/contributors")
    assert resp.status_code == 409


def test_add_contributor_twice_is_idempotent(app, store):
    store.add_user("member-1", "Member One", role="cad_member")
    task_id = store.add_task(assignee_id="assignee-1", status="doing")

    resp1 = _as(app, MEMBER).post(f"/tasks/{task_id}/contributors")
    resp2 = _as(app, MEMBER).post(f"/tasks/{task_id}/contributors")
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp2.json()["contributors"] == [{"id": "member-1", "display_name": "Member One"}]


def test_contributor_can_leave(app, store):
    store.add_user("member-1", "Member One", role="cad_member")
    task_id = store.add_task(assignee_id="assignee-1", status="doing")
    store.contributors[task_id] = ["member-1"]

    resp = _as(app, MEMBER).delete(f"/tasks/{task_id}/contributors/me")
    assert resp.status_code == 200
    assert resp.json()["contributors"] == []


# ── Contributors: the authority set may add/remove OTHER people ────────────

def test_lead_adds_another_member_as_contributor(app, store):
    store.add_user("member-1", "Member One", role="cad_member")
    task_id = store.add_task(assignee_id="assignee-1", status="doing")

    resp = _as(app, LEAD).post(f"/tasks/{task_id}/contributors", json={"user_id": "member-1"})
    assert resp.status_code == 200
    assert resp.json()["contributors"] == [{"id": "member-1", "display_name": "Member One"}]


def test_member_cannot_add_someone_else_as_contributor(app, store):
    store.add_user("other-1", "Other One", role="cad_member")
    task_id = store.add_task(assignee_id="assignee-1", status="doing")

    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/contributors", json={"user_id": "other-1"})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Only the authority set may add other people as contributors"


def test_lead_adds_unknown_user_as_contributor(app, store):
    task_id = store.add_task(assignee_id="assignee-1", status="doing")

    resp = _as(app, LEAD).post(f"/tasks/{task_id}/contributors", json={"user_id": "ghost"})
    assert resp.status_code == 400


def test_lead_adds_the_assignee_as_contributor_conflicts(app, store):
    store.add_user("assignee-1", "Assignee One", role="cad_member")
    task_id = store.add_task(assignee_id="assignee-1", status="doing")

    resp = _as(app, LEAD).post(f"/tasks/{task_id}/contributors", json={"user_id": "assignee-1"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "That person is already the assignee"


def test_lead_removes_another_contributor(app, store):
    store.add_user("member-1", "Member One", role="cad_member")
    task_id = store.add_task(assignee_id="assignee-1", status="doing")
    store.contributors[task_id] = ["member-1"]

    resp = _as(app, LEAD).delete(f"/tasks/{task_id}/contributors/member-1")
    assert resp.status_code == 200
    assert resp.json()["contributors"] == []


def test_member_cannot_remove_other_contributor(app, store):
    store.add_user("other-1", "Other One", role="cad_member")
    task_id = store.add_task(assignee_id="assignee-1", status="doing")
    store.contributors[task_id] = ["other-1"]

    resp = _as(app, MEMBER).delete(f"/tasks/{task_id}/contributors/other-1")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Only the authority set may remove other contributors"
    assert store.contributors[task_id] == ["other-1"]


# ── Unassigning (PATCH assignee_id=null) and reassigning ────────────────────

def test_unassign_with_no_contributors_moves_doing_to_todo(app, store):
    task_id = store.add_task(assignee_id="member-1", status="doing", created_by="member-1")

    resp = _as(app, CAPTAIN).patch(f"/tasks/{task_id}", json={"assignee_id": None})
    assert resp.status_code == 200
    body = resp.json()
    assert body["assignee_id"] is None
    assert body["status"] == "todo"


def test_unassign_review_task_stays_in_review(app, store):
    task_id = store.add_task(assignee_id="member-1", status="review", created_by="member-1")

    resp = _as(app, CAPTAIN).patch(f"/tasks/{task_id}", json={"assignee_id": None})
    assert resp.status_code == 200
    body = resp.json()
    assert body["assignee_id"] is None
    assert body["status"] == "review"


def test_unassign_with_contributors_promotes_earliest(app, store):
    store.add_user("c1", "Contributor One", role="cad_member")
    store.add_user("c2", "Contributor Two", role="cad_member")
    task_id = store.add_task(assignee_id="member-1", status="doing", created_by="member-1")
    store.contributors[task_id] = ["c1", "c2"]

    resp = _as(app, CAPTAIN).patch(f"/tasks/{task_id}", json={"assignee_id": None})
    assert resp.status_code == 200
    body = resp.json()
    assert body["assignee_id"] == "c1"
    assert body["status"] == "doing"
    assert body["contributors"] == [{"id": "c2", "display_name": "Contributor Two"}]


def test_reassign_to_contributor_removes_them_from_contributor_list(app, store):
    store.add_user("target-1", "Target One", role="cad_member")
    task_id = store.add_task(assignee_id="member-1", status="doing", created_by="member-1")
    store.contributors[task_id] = ["target-1"]

    resp = _as(app, CAPTAIN).patch(f"/tasks/{task_id}", json={"assignee_id": "target-1"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["assignee_id"] == "target-1"
    assert body["contributors"] == []


# ── Notes ────────────────────────────────────────────────────────────────

def test_notes_empty_list_and_zero_count(app, store):
    task_id = store.add_task()

    resp = _as(app, MEMBER).get(f"/tasks/{task_id}/notes")
    assert resp.status_code == 200
    assert resp.json() == []

    task_resp = _as(app, MEMBER).get("/tasks")
    assert task_resp.status_code == 200
    task = next(t for t in task_resp.json() if t["id"] == task_id)
    assert task["note_count"] == 0


def test_notes_listed_oldest_first(app, store):
    task_id = store.add_task()
    store.notes["n1"] = {
        "id": "n1", "task_id": task_id, "author_id": "member-1", "body": "first",
        "created_at": datetime(2024, 1, 1, tzinfo=timezone.utc),
    }
    store.notes["n2"] = {
        "id": "n2", "task_id": task_id, "author_id": "member-1", "body": "second",
        "created_at": datetime(2024, 1, 2, tzinfo=timezone.utc),
    }

    resp = _as(app, MEMBER).get(f"/tasks/{task_id}/notes")
    assert resp.status_code == 200
    assert [n["body"] for n in resp.json()] == ["first", "second"]


def test_list_notes_unknown_task_404(app, store):
    resp = _as(app, MEMBER).get("/tasks/does-not-exist/notes")
    assert resp.status_code == 404


def test_create_note_strips_and_bumps_note_count(app, store):
    store.add_user("member-1", "Member One", role="cad_member")
    task_id = store.add_task()

    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/notes", json={"body": "  hello  "})
    assert resp.status_code == 200
    body = resp.json()
    assert body["body"] == "hello"
    assert body["task_id"] == task_id
    assert body["author_id"] == "member-1"
    assert body["author_name"] == "Member One"

    task_resp = _as(app, MEMBER).get("/tasks")
    task = next(t for t in task_resp.json() if t["id"] == task_id)
    assert task["note_count"] == 1


def test_create_note_rejects_blank_body(app, store):
    task_id = store.add_task()
    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/notes", json={"body": "   "})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Note can't be empty"


def test_create_note_rejects_too_long_body(app, store):
    task_id = store.add_task()
    resp = _as(app, MEMBER).post(f"/tasks/{task_id}/notes", json={"body": "x" * 2001})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Note is too long"


def test_create_note_unknown_task_404(app, store):
    resp = _as(app, MEMBER).post("/tasks/does-not-exist/notes", json={"body": "hi"})
    assert resp.status_code == 404


def test_delete_own_note(app, store):
    task_id = store.add_task()
    store.notes["n1"] = {
        "id": "n1", "task_id": task_id, "author_id": "member-1", "body": "mine",
        "created_at": datetime.now(timezone.utc),
    }

    resp = _as(app, MEMBER).delete(f"/tasks/{task_id}/notes/n1")
    assert resp.status_code == 204
    assert "n1" not in store.notes


def test_member_cannot_delete_someone_elses_note(app, store):
    task_id = store.add_task()
    store.notes["n1"] = {
        "id": "n1", "task_id": task_id, "author_id": "other-1", "body": "not mine",
        "created_at": datetime.now(timezone.utc),
    }

    resp = _as(app, MEMBER).delete(f"/tasks/{task_id}/notes/n1")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "You can only delete your own notes"
    assert "n1" in store.notes


def test_lead_can_delete_someone_elses_note(app, store):
    task_id = store.add_task()
    store.notes["n1"] = {
        "id": "n1", "task_id": task_id, "author_id": "other-1", "body": "not mine",
        "created_at": datetime.now(timezone.utc),
    }

    resp = _as(app, LEAD).delete(f"/tasks/{task_id}/notes/n1")
    assert resp.status_code == 204
    assert "n1" not in store.notes


def test_delete_note_wrong_task_404(app, store):
    task_id = store.add_task()
    other_task_id = store.add_task()
    store.notes["n1"] = {
        "id": "n1", "task_id": other_task_id, "author_id": "member-1", "body": "elsewhere",
        "created_at": datetime.now(timezone.utc),
    }

    resp = _as(app, MEMBER).delete(f"/tasks/{task_id}/notes/n1")
    assert resp.status_code == 404
    assert "n1" in store.notes


def test_delete_unknown_note_404(app, store):
    task_id = store.add_task()
    resp = _as(app, MEMBER).delete(f"/tasks/{task_id}/notes/does-not-exist")
    assert resp.status_code == 404
