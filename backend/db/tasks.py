import asyncpg
import logging
from fastapi import HTTPException
from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)

# Shared join backing both list_tasks() and get_task() -- every reader needs the
# same four display names (assignee/creator/finisher/reviewer), so there is one
# canonical joined shape rather than a raw variant and a joined variant that
# could drift apart.
_SELECT_TASK = """
    SELECT t.*,
           a.display_name AS assignee_name,
           c.display_name AS created_by_name,
           f.display_name AS finished_by_name,
           r.display_name AS reviewed_by_name
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN users c ON c.id = t.created_by
    LEFT JOIN users f ON f.id = t.finished_by
    LEFT JOIN users r ON r.id = t.reviewed_by
"""

# Columns update_task() is ever allowed to touch. Defensive whitelist so a bug
# building the `fields` dict upstream fails loudly instead of interpolating an
# arbitrary column name into SQL.
_UPDATABLE_COLUMNS = {
    "title",
    "area",
    "bucket",
    "priority",
    "status",
    "assignee_id",
    "due_date",
    "finished_by",
    "reviewed_by",
}


async def list_tasks() -> list[asyncpg.Record]:
    """Return every task, newest first, with assignee/creator/finisher/reviewer names joined in."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(_SELECT_TASK + " ORDER BY t.created_at DESC")
        except Exception as e:
            logger.error("list_tasks failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch tasks")


async def get_task(task_id: str) -> asyncpg.Record | None:
    """Return one task by id with the same joined names as list_tasks(), or None."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(_SELECT_TASK + " WHERE t.id = $1", task_id)
        except Exception as e:
            logger.error("get_task failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch task")


async def list_task_people() -> list[asyncpg.Record]:
    """Return id/display_name/role/approved_by for every onboarded, non-banned user.

    Backs `GET /tasks/people`, which any authenticated user may call and which
    must expose only names -- never email (contrast `db.list_all_users`, which
    is leads-only and does return email). `role` and `approved_by` are included
    only so the caller can apply the same "pending approval" rule
    `core.account_state` uses (a role that doesn't require approval is eligible
    even with a null `approved_by`); the endpoint strips both before returning
    the `Person` shape.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT id, display_name, role, approved_by
                FROM users
                WHERE onboarding_complete = true
                  AND banned_at IS NULL
                ORDER BY display_name ASC
                """
            )
        except Exception as e:
            logger.error("list_task_people failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch people")


async def create_task(
    title: str,
    area: str,
    bucket: str,
    priority: str,
    due_date,
    assignee_id: str | None,
    created_by: str,
) -> asyncpg.Record:
    """Insert a new task and return it in the joined shape callers expect.

    Status always starts at the column default (`todo`) -- creation never takes
    a status, matching the contract (only PATCH/claim/review move it).
    """
    async with db_connection(DB_NAME) as conn:
        try:
            row = await conn.fetchrow(
                """
                INSERT INTO tasks (title, area, bucket, priority, due_date, assignee_id, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
                """,
                title,
                area,
                bucket,
                priority,
                due_date,
                assignee_id,
                created_by,
            )
        except Exception as e:
            logger.error("create_task failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to create task")
    return await get_task(row["id"])


async def update_task(task_id: str, fields: dict) -> asyncpg.Record | None:
    """Apply a partial update to one task and return the joined row, or None if missing.

    `fields` is a column -> new value map for any subset of `_UPDATABLE_COLUMNS`,
    built by the endpoint from the PATCH body plus whatever the review/reopen
    state-transition rules derive alongside it (e.g. clearing `finished_by` when
    reopening to `todo`/`doing`). Built dynamically since a PATCH only touches
    the columns the caller actually named. Always bumps `updated_at`, matching
    the "every mutation bumps updated_at" rule. Raises `ValueError` if `fields`
    is empty or names a column outside the whitelist -- callers should treat an
    empty `fields` dict as a no-op *before* calling this, not rely on it here.

    :param task_id: The task to update.
    :param fields: Column -> new value, restricted to `_UPDATABLE_COLUMNS`.
    :returns: The updated, joined task row, or `None` if `task_id` doesn't exist.
    """
    if not fields:
        raise ValueError("update_task requires at least one field to set")
    unknown = set(fields) - _UPDATABLE_COLUMNS
    if unknown:
        raise ValueError(f"update_task got unknown column(s): {sorted(unknown)}")

    set_clauses = []
    params: list = []
    for col, val in fields.items():
        params.append(val)
        set_clauses.append(f"{col} = ${len(params)}")
    params.append(task_id)

    query = f"UPDATE tasks SET {', '.join(set_clauses)}, updated_at = now() WHERE id = ${len(params)} RETURNING id"
    async with db_connection(DB_NAME) as conn:
        try:
            row = await conn.fetchrow(query, *params)
        except Exception as e:
            logger.error("update_task failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to update task")
    if row is None:
        return None
    return await get_task(task_id)


async def claim_task(task_id: str, user_id: str) -> asyncpg.Record | None:
    """Assign `user_id` to an unassigned task, bumping `todo` -> `doing`.

    The `WHERE assignee_id IS NULL` guard re-checks at the database level, so
    this is race-safe even though the endpoint already checked the task was
    unassigned before calling -- two simultaneous claims can't both succeed.

    :returns: The updated, joined task row, or `None` if `task_id` doesn't
        exist or was claimed by someone else first (the endpoint disambiguates
        the two via its own pre-check).
    """
    async with db_connection(DB_NAME) as conn:
        try:
            row = await conn.fetchrow(
                """
                UPDATE tasks
                SET assignee_id = $2,
                    status = CASE WHEN status = 'todo' THEN 'doing' ELSE status END,
                    updated_at = now()
                WHERE id = $1 AND assignee_id IS NULL
                RETURNING id
                """,
                task_id,
                user_id,
            )
        except Exception as e:
            logger.error("claim_task failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to claim task")
    if row is None:
        return None
    return await get_task(task_id)


async def review_task(task_id: str, reviewer_id: str) -> asyncpg.Record | None:
    """Mark a task reviewed: `review` -> `done`, `reviewed_by` = `reviewer_id`.

    The `WHERE status = 'review'` guard is race-safe at the database level; the
    endpoint still enforces the "not the finisher" rule and the status
    precondition before calling, since those need a friendlier error than a
    silent no-op.

    :returns: The updated, joined task row, or `None` if `task_id` doesn't
        exist or was no longer in `review`.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            row = await conn.fetchrow(
                """
                UPDATE tasks
                SET status = 'done', reviewed_by = $2, updated_at = now()
                WHERE id = $1 AND status = 'review'
                RETURNING id
                """,
                task_id,
                reviewer_id,
            )
        except Exception as e:
            logger.error("review_task failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to review task")
    if row is None:
        return None
    return await get_task(task_id)


async def unreview_task(task_id: str) -> asyncpg.Record | None:
    """Reopen a done task for re-review: `done` -> `review`, `reviewed_by` cleared.

    `finished_by` is deliberately left untouched -- unlike reopening all the way
    to `todo`/`doing`, unreviewing does not erase who originally finished the
    task, since the review endpoint's "not the finisher" rule still needs it.

    :returns: The updated, joined task row, or `None` if `task_id` doesn't
        exist or wasn't `done`.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            row = await conn.fetchrow(
                """
                UPDATE tasks
                SET status = 'review', reviewed_by = NULL, updated_at = now()
                WHERE id = $1 AND status = 'done'
                RETURNING id
                """,
                task_id,
            )
        except Exception as e:
            logger.error("unreview_task failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to unreview task")
    if row is None:
        return None
    return await get_task(task_id)


async def delete_task(task_id: str) -> bool:
    """Delete a task. Returns whether a row was actually removed."""
    async with db_connection(DB_NAME) as conn:
        try:
            result = await conn.execute("DELETE FROM tasks WHERE id = $1", task_id)
        except Exception as e:
            logger.error("delete_task failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to delete task")
    return result == "DELETE 1"


__all__ = [
    "list_tasks",
    "get_task",
    "list_task_people",
    "create_task",
    "update_task",
    "claim_task",
    "review_task",
    "unreview_task",
    "delete_task",
]
