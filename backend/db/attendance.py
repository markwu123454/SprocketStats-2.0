import asyncpg
import logging
from datetime import datetime

from fastapi import HTTPException

from .connection import DB_NAME, get_db_connection, release_db_connection

logger = logging.getLogger(__name__)


async def create_attendance_events(
    user_id: str, source: str | None, check_in: datetime, check_out: datetime
) -> list[asyncpg.Record]:
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetch(
            """
            INSERT INTO attendance (user_id, timestamp_pst, event_type, source)
            VALUES ($1, $2, 'check_in', $4),
                   ($1, $3, 'check_out', $4)
            RETURNING *
            """,
            user_id, check_in, check_out, source,
        )
    except Exception as e:
        logger.error("create_attendance_events failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save attendance")
    finally:
        await release_db_connection(pool, conn)


async def list_attendance_for_user(user_id: str) -> list[asyncpg.Record]:
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetch(
            "SELECT * FROM attendance WHERE user_id = $1 ORDER BY timestamp_pst",
            user_id,
        )
    except Exception as e:
        logger.error("list_attendance_for_user failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch attendance")
    finally:
        await release_db_connection(pool, conn)


async def list_all_attendance() -> list[asyncpg.Record]:
    """Raw check_in/check_out events for every user, joined to display names.

    Pairing consecutive events into durations is left to the caller since it's
    a display concern, not storage.
    """
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetch(
            """
            SELECT a.user_id, a.event_type, a.timestamp_pst, u.display_name, u.given_name
            FROM attendance a
            JOIN users u ON u.id = a.user_id
            ORDER BY a.user_id, a.timestamp_pst
            """
        )
    except Exception as e:
        logger.error("list_all_attendance failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch attendance")
    finally:
        await release_db_connection(pool, conn)


__all__ = ["create_attendance_events", "list_attendance_for_user", "list_all_attendance"]
