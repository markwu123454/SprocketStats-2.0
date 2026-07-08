import asyncpg
import logging
from datetime import datetime

from fastapi import HTTPException

from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)


async def list_meeting_hours(start: datetime, end: datetime) -> list[asyncpg.Record]:
    async with db_connection(DB_NAME) as conn:
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


__all__ = ["list_meeting_hours"]
