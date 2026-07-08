import asyncpg
import logging
from fastapi import HTTPException
from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)


async def create_notification(
    title: str,
    body: str,
    link: str | None,
    hard_block: bool,
    target_roles: list[str],
    response_options: list[str],
    response_mode: str,
    created_by: str,
) -> asyncpg.Record:
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                """
                INSERT INTO notifications
                    (title, body, link, hard_block, target_roles, response_options, response_mode, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
                """,
                title,
                body,
                link,
                hard_block,
                target_roles,
                response_options,
                response_mode,
                created_by,
            )
        except Exception as e:
            logger.error("create_notification failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to create notification")


async def list_notifications() -> list[asyncpg.Record]:
    """Return every notice for the Control Panel list, newest first.

    Joins a live response count and the author's display name so the list grid
    doesn't need a round-trip per row.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT n.*,
                       COUNT(r.id)      AS response_count,
                       u.display_name   AS created_by_name
                FROM notifications n
                LEFT JOIN notification_responses r ON r.notification_id = n.id
                LEFT JOIN users u ON u.id = n.created_by
                GROUP BY n.id, u.display_name
                ORDER BY n.created_at DESC
                """
            )
        except Exception as e:
            logger.error("list_notifications failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch notifications")


async def get_notification(notification_id: str) -> asyncpg.Record | None:
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow("SELECT * FROM notifications WHERE id = $1", notification_id)
        except Exception as e:
            logger.error("get_notification failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch notification")


async def update_notification(
    notification_id: str,
    title: str,
    body: str,
    link: str | None,
    hard_block: bool,
    target_roles: list[str],
    response_options: list[str],
    response_mode: str,
) -> asyncpg.Record | None:
    """Cosmetic edit only -- never touches existing notification_responses rows.

    Response text already recorded on a response stays exactly as the user chose
    it, even if `response_options` changes afterward (see `response` being
    denormalized text, not a live reference).
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                """
                UPDATE notifications
                SET title            = $2,
                    body             = $3,
                    link             = $4,
                    hard_block       = $5,
                    target_roles     = $6,
                    response_options = $7,
                    response_mode    = $8,
                    updated_at       = now()
                WHERE id = $1
                RETURNING *
                """,
                notification_id,
                title,
                body,
                link,
                hard_block,
                target_roles,
                response_options,
                response_mode,
            )
        except Exception as e:
            logger.error("update_notification failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to update notification")


async def deactivate_notification(notification_id: str) -> asyncpg.Record | None:
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                "UPDATE notifications SET active = false WHERE id = $1 RETURNING *",
                notification_id,
            )
        except Exception as e:
            logger.error("deactivate_notification failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to deactivate notification")


async def get_pending_notifications_for_user(user_id: str, role: str | None) -> list[asyncpg.Record]:
    """Active notices targeted at ``role`` that ``user_id`` hasn't responded to yet.

    "Pending" is computed live from `notifications` + `notification_responses` --
    there's no denormalized per-user list to keep in sync. Hard-blocking notices
    sort first, oldest first within each group, so a mandatory notice can't be
    stuck behind a queue of optional ones.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT * FROM notifications
                WHERE active = true
                  AND (target_roles = '{}' OR $2 = ANY(target_roles))
                  AND NOT EXISTS (
                      SELECT 1 FROM notification_responses
                      WHERE notification_id = notifications.id AND user_id = $1
                  )
                ORDER BY hard_block DESC, created_at ASC
                """,
                user_id,
                role,
            )
        except Exception as e:
            logger.error("get_pending_notifications_for_user failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch pending notifications")


async def upsert_response(notification_id: str, user_id: str, response: list[str]) -> asyncpg.Record:
    """Record (or change) a user's response to a notice.

    Upserts on (notification_id, user_id) so a user can change their answer
    (e.g. "not sure" -> "coming") by responding again while the notice is active.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                """
                INSERT INTO notification_responses (notification_id, user_id, response)
                VALUES ($1, $2, $3)
                ON CONFLICT (notification_id, user_id) DO UPDATE
                    SET response     = EXCLUDED.response,
                        responded_at = now()
                RETURNING *
                """,
                notification_id,
                user_id,
                response,
            )
        except Exception as e:
            logger.error("upsert_response failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to record response")


async def get_notification_detail(notification_id: str) -> dict | None:
    """Everything the Control Panel detail/stats view needs for one notice.

    Eligible audience size is computed live from `users` filtered by
    `target_roles` (empty = everyone) -- there's no separate "delivered"
    tracking table, since any active targeted user sees the notice on their next
    `/auth/me` fetch by definition.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            notification = await conn.fetchrow(
                """
                SELECT n.*, u.display_name AS created_by_name
                FROM notifications n
                LEFT JOIN users u ON u.id = n.created_by
                WHERE n.id = $1
                """,
                notification_id,
            )
            if notification is None:
                return None

            target_roles = notification["target_roles"]

            tally = await conn.fetch(
                """
                SELECT unnest(response) AS option, COUNT(*) AS count
                FROM notification_responses
                WHERE notification_id = $1
                GROUP BY option
                """,
                notification_id,
            )
            ack_count = await conn.fetchval(
                "SELECT COUNT(*) FROM notification_responses WHERE notification_id = $1 AND response = '{}'",
                notification_id,
            )
            eligible_count = await conn.fetchval(
                """
                SELECT COUNT(*) FROM users
                WHERE banned_at IS NULL AND ($1::text[] = '{}' OR role = ANY($1::text[]))
                """,
                target_roles,
            )
            responses = await conn.fetch(
                """
                SELECT u.id, u.display_name, u.email, r.response, r.responded_at
                FROM notification_responses r
                JOIN users u ON u.id = r.user_id
                WHERE r.notification_id = $1
                ORDER BY r.responded_at DESC
                """,
                notification_id,
            )
            non_responders = await conn.fetch(
                """
                SELECT u.id, u.display_name, u.email
                FROM users u
                WHERE u.banned_at IS NULL
                  AND ($1::text[] = '{}' OR u.role = ANY($1::text[]))
                  AND NOT EXISTS (
                      SELECT 1 FROM notification_responses r
                      WHERE r.notification_id = $2 AND r.user_id = u.id
                  )
                ORDER BY u.display_name ASC NULLS LAST, u.email ASC
                """,
                target_roles,
                notification_id,
            )

            return {
                "notification": notification,
                "tally": tally,
                "ack_count": ack_count,
                "eligible_count": eligible_count,
                "responses": responses,
                "non_responders": non_responders,
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error("get_notification_detail failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch notification detail")


__all__ = [
    "create_notification",
    "list_notifications",
    "get_notification",
    "update_notification",
    "deactivate_notification",
    "get_pending_notifications_for_user",
    "upsert_response",
    "get_notification_detail",
]
