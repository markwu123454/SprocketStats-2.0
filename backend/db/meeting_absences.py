import logging

import asyncpg
from fastapi import HTTPException

from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)


async def upsert_meeting_absence(meeting_id: str, user_id: str, reason: str) -> tuple[asyncpg.Record, bool]:
    """Report (or edit) an absence. Returns ``(record, created)``; ``created`` is
    False when an existing report's reason was just updated."""
    async with db_connection(DB_NAME) as conn:
        try:
            row = await conn.fetchrow(
                """
                INSERT INTO meeting_absences (meeting_id, user_id, reason)
                VALUES ($1, $2, $3)
                ON CONFLICT (meeting_id, user_id)
                DO UPDATE SET reason = EXCLUDED.reason, updated_at = now()
                RETURNING *, (xmax = 0) AS created
                """,
                meeting_id, user_id, reason,
            )
            return row, bool(row["created"])
        except Exception as e:
            logger.error("upsert_meeting_absence failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to save absence")


async def delete_meeting_absence(meeting_id: str, user_id: str) -> bool:
    async with db_connection(DB_NAME) as conn:
        try:
            result = await conn.execute(
                "DELETE FROM meeting_absences WHERE meeting_id = $1 AND user_id = $2",
                meeting_id, user_id,
            )
            return result != "DELETE 0"
        except Exception as e:
            logger.error("delete_meeting_absence failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to withdraw absence")


async def list_meeting_absences(meeting_ids: list[str] | None = None) -> list[asyncpg.Record]:
    """Absences joined with the absentee's name and role (banned users skipped)."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT a.meeting_id, a.user_id, a.reason, a.created_at, a.updated_at,
                       u.display_name, u.role
                FROM meeting_absences a
                JOIN users u ON u.id = a.user_id
                WHERE u.banned_at IS NULL
                  AND ($1::uuid[] IS NULL OR a.meeting_id = ANY($1::uuid[]))
                """,
                meeting_ids,
            )
        except Exception as e:
            logger.error("list_meeting_absences failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch absences")


async def list_absence_viewer_ids(roles: list[str], exclude_user_id: str) -> list[str]:
    """Ids of live users holding any of ``roles``, minus one user.

    "Live" mirrors ``account_state._assert_entry_active``: not banned, onboarded
    and approved (every viewer role requires approval). The caller computes
    ``roles`` from ``core.permissions.can_view_absence``.
    """
    if not roles:
        return []
    async with db_connection(DB_NAME) as conn:
        try:
            rows = await conn.fetch(
                "SELECT id FROM users WHERE banned_at IS NULL AND onboarding_complete "
                "AND approved_by IS NOT NULL AND role = ANY($1::text[]) AND id <> $2",
                roles, exclude_user_id,
            )
            return [r["id"] for r in rows]
        except Exception as e:
            logger.error("list_absence_viewer_ids failed: %s", e)
            raise



async def list_active_members() -> list[asyncpg.Record]:
    """Onboarded, unbanned users with the fields the attendance page needs.

    Approval is filtered by the caller (``role_requires_approval`` lives in
    Python), mirroring ``account_state._assert_entry_active``.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                "SELECT id, display_name, role, created_at, approved_by FROM users "
                "WHERE banned_at IS NULL AND onboarding_complete"
            )
        except Exception as e:
            logger.error("list_active_members failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch members")


__all__ = [
    "upsert_meeting_absence",
    "delete_meeting_absence",
    "list_meeting_absences",
    "list_absence_viewer_ids",
    "list_active_members",
]
