import asyncpg
import logging
from datetime import datetime

from fastapi import HTTPException

from .connection import DB_NAME, get_db_connection, release_db_connection

logger = logging.getLogger(__name__)


async def create_attendance_entry(
    user_id: str, source: str | None, checkin_time: datetime, checkout_time: datetime
) -> asyncpg.Record:
    pool, conn = await get_db_connection(DB_NAME)
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
    finally:
        await release_db_connection(pool, conn)


async def list_attendance_for_user(user_id: str) -> list[asyncpg.Record]:
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetch(
            "SELECT * FROM attendance WHERE user_id = $1 ORDER BY checkin_time",
            user_id,
        )
    except Exception as e:
        logger.error("list_attendance_for_user failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch attendance")
    finally:
        await release_db_connection(pool, conn)


async def list_all_attendance() -> list[asyncpg.Record]:
    """Attendance entries for every user, joined to display names."""
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetch(
            """
            SELECT a.user_id, a.checkin_time, a.checkout_time, u.display_name, u.given_name
            FROM attendance a
            JOIN users u ON u.id = a.user_id
            ORDER BY a.user_id, a.checkin_time
            """
        )
    except Exception as e:
        logger.error("list_all_attendance failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch attendance")
    finally:
        await release_db_connection(pool, conn)


__all__ = ["create_attendance_entry", "list_attendance_for_user", "list_all_attendance"]
