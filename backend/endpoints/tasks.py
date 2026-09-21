from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

import db
from core.permissions import has_task_authority, role_requires_approval, task_buckets
from core.security import require_active

router = APIRouter()

# Every Task Assignments endpoint is open to any authenticated, active user --
# there is no dedicated `tasks.view` gate beyond that, since every role's policy
# grants it (see core.permissions.ROLE_DEFINITIONS). require_active layers in
# the banned/pending-approval re-check on top of plain login, matching the other
# write-capable routers in this codebase.
require_task_access = require_active

_VALID_PRIORITIES = {"high", "med", "low"}
# `done` is deliberately excluded -- it is reachable only through /review, never
# a bare PATCH (see the contract's state-transition rules).
_PATCHABLE_STATUSES = {"todo", "doing", "review"}


class TaskCreate(BaseModel):
    """Body for `POST /tasks`. `assignee_id` is only usable by the authority set."""

    title: str
    bucket: str
    area: str | None = None
    priority: str = "med"
    due_date: date | None = None
    assignee_id: str | None = None


class TaskUpdate(BaseModel):
    """Body for `PATCH /tasks/{id}`. Every field is optional -- only the ones
    actually present in the request are applied (see `exclude_unset` usage in
    the handler), so a field can be explicitly cleared (`null`) without
    disturbing the others."""

    title: str | None = None
    area: str | None = None
    bucket: str | None = None
    priority: str | None = None
    status: str | None = None
    assignee_id: str | None = None
    due_date: date | None = None


def _authorize_edit(user: dict, task) -> None:
    """Ensure `user` may edit/delete `task`, else 403.

    The authority set (tasks.assign) may touch any task; otherwise only the
    task's own creator may.
    """
    if not (has_task_authority(user.get("role")) or task["created_by"] == user["sub"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to edit this task")


async def _validate_assignee(assignee_id: str | None) -> None:
    """Raise 400 if `assignee_id` is non-null and doesn't name a real user."""
    if assignee_id is not None and await db.get_user(assignee_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown assignee_id")


@router.get("")
async def list_tasks(_: dict = Depends(require_task_access)):
    rows = await db.list_tasks()
    return [_row_to_task(r) for r in rows]


@router.get("/people")
async def list_people(_: dict = Depends(require_task_access)):
    """Assignable people: approved, onboarded, non-banned. Names + ids only --
    never email, unlike the leads-only `/members` roster."""
    rows = await db.list_task_people()
    return [
        {"id": r["id"], "display_name": r["display_name"]}
        for r in rows
        if not (role_requires_approval(r["role"]) and r["approved_by"] is None)
    ]


@router.post("")
async def create_task(body: TaskCreate, user: dict = Depends(require_task_access)):
    """Create a task. Anyone may create one; only the authority set may set
    `assignee_id` on creation (403 otherwise)."""
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required")

    area = (body.area or "").strip() or "General"

    if body.bucket not in task_buckets():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown bucket: {body.bucket}")

    priority = body.priority or "med"
    if priority not in _VALID_PRIORITIES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown priority: {priority}")

    if body.assignee_id is not None and not has_task_authority(user.get("role")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only the authority set may assign a task"
        )
    await _validate_assignee(body.assignee_id)

    row = await db.create_task(title, area, body.bucket, priority, body.due_date, body.assignee_id, user["sub"])
    return _row_to_task(row)


@router.patch("/{task_id}")
async def update_task(task_id: str, body: TaskUpdate, user: dict = Depends(require_task_access)):
    """Edit a task. Caller must be in the authority set or the task's creator;
    changing `assignee_id` additionally always requires the authority set, even
    for the task's own creator. `status` can never be set to `done` here --
    only `/tasks/{id}/review` may finish a review.
    """
    existing = await db.get_task(task_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    _authorize_edit(user, existing)

    changes = body.model_dump(exclude_unset=True)
    is_authority = has_task_authority(user.get("role"))

    if "assignee_id" in changes and not is_authority:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only the authority set may assign or reassign tasks"
        )

    if changes.get("status") == "done":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Use /tasks/{id}/review to mark a task done"
        )

    fields: dict = {}

    if "title" in changes:
        title = (changes["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required")
        fields["title"] = title

    if "area" in changes:
        fields["area"] = (changes["area"] or "").strip() or "General"

    if "bucket" in changes:
        bucket = changes["bucket"]
        if bucket not in task_buckets():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown bucket: {bucket}")
        fields["bucket"] = bucket

    if "priority" in changes:
        priority = changes["priority"]
        if priority not in _VALID_PRIORITIES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown priority: {priority}")
        fields["priority"] = priority

    if "due_date" in changes:
        fields["due_date"] = changes["due_date"]

    if "assignee_id" in changes:
        assignee_id = changes["assignee_id"]
        await _validate_assignee(assignee_id)
        fields["assignee_id"] = assignee_id

    if "status" in changes:
        new_status = changes["status"]
        if new_status not in _PATCHABLE_STATUSES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown status: {new_status}")
        fields["status"] = new_status
        if new_status == "review":
            # Only record the finisher the first time a task reaches review --
            # bouncing between review and doing without reopening shouldn't
            # reassign credit for finishing it.
            if existing["finished_by"] is None:
                fields["finished_by"] = user["sub"]
        else:  # todo / doing
            fields["finished_by"] = None
            fields["reviewed_by"] = None

    if not fields:
        return _row_to_task(existing)

    row = await db.update_task(task_id, fields)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return _row_to_task(row)


@router.post("/{task_id}/claim")
async def claim_task(task_id: str, user: dict = Depends(require_task_access)):
    """Claim any unassigned task, in any bucket: assigns the caller to
    themselves and bumps `todo` -> `doing`. Open to every authenticated user."""
    existing = await db.get_task(task_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if existing["assignee_id"] is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Task is already assigned")

    row = await db.claim_task(task_id, user["sub"])
    if row is None:
        # Lost a race with a concurrent claim between the check above and the update.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Task is already assigned")
    return _row_to_task(row)


@router.post("/{task_id}/review")
async def review_task(task_id: str, user: dict = Depends(require_task_access)):
    """Mark an in-review task reviewed (-> `done`). Anyone except the person who
    finished it may do this -- enforced here, not just hidden in the UI."""
    existing = await db.get_task(task_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if existing["status"] != "review":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task is not awaiting review")
    if existing["finished_by"] == user["sub"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You cannot review a task you finished yourself"
        )

    row = await db.review_task(task_id, user["sub"])
    if row is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task is not awaiting review")
    return _row_to_task(row)


@router.post("/{task_id}/unreview")
async def unreview_task(task_id: str, user: dict = Depends(require_task_access)):
    """Reopen a done task for re-review (-> `review`, clears `reviewed_by`).
    Authority set or the task's creator only."""
    existing = await db.get_task(task_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    _authorize_edit(user, existing)
    if existing["status"] != "done":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only a done task can be unreviewed")

    row = await db.unreview_task(task_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only a done task can be unreviewed")
    return _row_to_task(row)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str, user: dict = Depends(require_task_access)):
    """Delete a task. Authority set or the task's creator only."""
    existing = await db.get_task(task_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    _authorize_edit(user, existing)
    await db.delete_task(task_id)


def _row_to_task(r) -> dict:
    """Shape a joined `tasks` row (see `db.tasks._SELECT_TASK`) into the `Task` JSON shape."""
    d = dict(r)
    return {
        "id": str(d["id"]),
        "title": d["title"],
        "area": d["area"],
        "bucket": d["bucket"],
        "priority": d["priority"],
        "status": d["status"],
        "assignee_id": d["assignee_id"],
        "assignee_name": d.get("assignee_name"),
        "due_date": d["due_date"].isoformat() if d["due_date"] else None,
        "created_by": d["created_by"],
        "created_by_name": d.get("created_by_name"),
        "finished_by": d["finished_by"],
        "finished_by_name": d.get("finished_by_name"),
        "reviewed_by": d["reviewed_by"],
        "reviewed_by_name": d.get("reviewed_by_name"),
        "created_at": d["created_at"].isoformat(),
        "updated_at": d["updated_at"].isoformat(),
    }
