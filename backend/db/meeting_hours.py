import asyncpg
import logging
from datetime import datetime

from fastapi import HTTPException

from .connection import DB_NAME, get_db_connection, release_db_connection

logger = logging.getLogger(__name__)


async def list_meeting_hours(start: datetime, end: datetime) -> list[asyncpg.Record]:
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetch(
            """
            SELECT * FROM meeting_hours
            WHERE start_time < $2 AND end_time > $1
            ORDER BY start_time
            """,
            start, end,
        )
    except Exception as e:
        logger.error("list_meeting_hours failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch meeting hours")
    finally:
        await release_db_connection(pool, conn)


__all__ = ["list_meeting_hours"]
