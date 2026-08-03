import asyncpg
import logging
from datetime import datetime, timedelta

from fastapi import HTTPException

from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)

KIOSK_SESSION_MAX_AGE = timedelta(hours=12)


async def create_attendance_entry(
    user_id: str, source: str | None, checkin_time: datetime, checkout_time: datetime
) -> asyncpg.Record:
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                """
                INSERT INTO attendance (user_id, checkin_time, checkout_time, source)
                VALUES ($1, $2, $3, $4)
                RETURNING *
                """,
                user_id, checkin_time, checkout_time, source,
            )
        except Exception as e:
            logger.error("create_attendance_entry failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to save attendance")


async def toggle_kiosk_attendance(user_id: str) -> str | None:
    """Atomically toggle one user's kiosk attendance state.

    Locking the user row serializes scans for the same member across every app
    worker. An open session older than the kiosk limit is discarded before a
    fresh check-in is created.

    :returns: ``"checked_in"``, ``"checked_out"``, or ``None`` if the user was
        deleted between endpoint validation and this transaction.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            async with conn.transaction():
                locked_user_id = await conn.fetchval(
                    "SELECT id FROM users WHERE id = $1 FOR UPDATE",
                    user_id,
                )
                if locked_user_id is None:
                    return None

                # Read the database clock only after the row lock is held. If two
                # scans race, the second request can no longer use a timestamp it
                # captured before the first request's check-in.
                now = await conn.fetchval("SELECT clock_timestamp()")

                open_entry = await conn.fetchrow(
                    """
                    SELECT id, checkin_time
                    FROM attendance
                    WHERE user_id = $1 AND checkout_time IS NULL
                    ORDER BY checkin_time DESC
                    LIMIT 1
                    """,
                    user_id,
                )

                if open_entry is not None and now - open_entry["checkin_time"] < KIOSK_SESSION_MAX_AGE:
                    await conn.execute(
                        "UPDATE attendance SET checkout_time = $2 WHERE id = $1",
                        open_entry["id"],
                        now,
                    )
                    return "checked_out"

                if open_entry is not None:
                    await conn.execute("DELETE FROM attendance WHERE id = $1", open_entry["id"])

                await conn.execute(
                    """
                    INSERT INTO attendance (user_id, checkin_time, checkout_time, source)
                    VALUES ($1, $2, NULL, 'kiosk')
                    """,
                    user_id,
                    now,
                )
                return "checked_in"
        except Exception as e:
            logger.error("toggle_kiosk_attendance failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to update attendance")


async def list_attendance_for_user(user_id: str) -> list[asyncpg.Record]:
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT *
                FROM attendance
                WHERE user_id = $1
                  AND (checkout_time IS NOT NULL OR checkin_time > now() - INTERVAL '12 hours')
                ORDER BY checkin_time
                """,
                user_id,
            )
        except Exception as e:
            logger.error("list_attendance_for_user failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch attendance")


async def list_all_attendance() -> list[asyncpg.Record]:
    """Attendance entries for every user, joined to display names."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT a.user_id, a.checkin_time, a.checkout_time, u.display_name, u.given_name
                FROM attendance a
                JOIN users u ON u.id = a.user_id
                WHERE a.checkout_time IS NOT NULL
                   OR a.checkin_time > now() - INTERVAL '12 hours'
                ORDER BY a.user_id, a.checkin_time
                """
            )
        except Exception as e:
            logger.error("list_all_attendance failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch attendance")


__all__ = [
    "KIOSK_SESSION_MAX_AGE",
    "create_attendance_entry",
    "toggle_kiosk_attendance",
    "list_attendance_for_user",
    "list_all_attendance",
]
