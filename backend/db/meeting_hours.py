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


async def list_all_meeting_hours() -> list[asyncpg.Record]:
    """Every scheduled meeting, past and future, for the admin Meeting Hours page."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch("SELECT * FROM meeting_hours ORDER BY start_time")
        except Exception as e:
            logger.error("list_all_meeting_hours failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch meeting hours")


async def create_meeting_hours(
    created_by: str, start_time: datetime, end_time: datetime, meeting_purpose: str | None
) -> asyncpg.Record:
    async with db_connection(DB_NAME) as conn:
        try:
            async with conn.transaction():
                return await conn.fetchrow(
                    """
                    INSERT INTO meeting_hours (created_by, start_time, end_time, meeting_purpose)
                    VALUES ($1, $2, $3, $4)
                    RETURNING *
                    """,
                    created_by, start_time, end_time, meeting_purpose,
                )
        except Exception as e:
            logger.error("create_meeting_hours failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to create meeting")


async def update_meeting_hours(
    meeting_id: str, start_time: datetime, end_time: datetime, meeting_purpose: str | None
) -> asyncpg.Record | None:
    async with db_connection(DB_NAME) as conn:
        try:
            async with conn.transaction():
                return await conn.fetchrow(
                    """
                    UPDATE meeting_hours
                    SET start_time = $2, end_time = $3, meeting_purpose = $4
                    WHERE id = $1
                    RETURNING *
                    """,
                    meeting_id, start_time, end_time, meeting_purpose,
                )
        except Exception as e:
            logger.error("update_meeting_hours failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to update meeting")


async def delete_meeting_hours(meeting_id: str) -> bool:
    async with db_connection(DB_NAME) as conn:
        try:
            async with conn.transaction():
                result = await conn.execute("DELETE FROM meeting_hours WHERE id = $1", meeting_id)
            return result != "DELETE 0"
        except Exception as e:
            logger.error("delete_meeting_hours failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to delete meeting")


__all__ = [
    "list_meeting_hours",
    "list_all_meeting_hours",
    "create_meeting_hours",
    "update_meeting_hours",
    "delete_meeting_hours",
]
