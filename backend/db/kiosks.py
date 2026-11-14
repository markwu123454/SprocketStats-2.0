import logging
import secrets
import uuid
from datetime import datetime, timedelta

import asyncpg
from fastapi import HTTPException

from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)

_KIOSK_ID_DIGITS = "0123456789ABCDEF"


def _new_kiosk_id() -> str:
    return "K-" + "".join(secrets.choice(_KIOSK_ID_DIGITS) for _ in range(6))


async def create_kiosk(authorized_by: str) -> str:
    """Register a kiosk and return its id (``K-`` + 6 hex digits)."""
    async with db_connection(DB_NAME) as conn:
        try:
            for _ in range(5):
                kiosk_id = await conn.fetchval(
                    "INSERT INTO kiosks (id, authorized_by) VALUES ($1, $2) "
                    "ON CONFLICT (id) DO NOTHING RETURNING id",
                    _new_kiosk_id(), authorized_by,
                )
                if kiosk_id:
                    return kiosk_id
        except Exception as e:
            logger.error("create_kiosk failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to register kiosk")
    raise HTTPException(status_code=500, detail="Failed to register kiosk")


async def get_kiosk(kiosk_id: str) -> asyncpg.Record | None:
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow("SELECT * FROM kiosks WHERE id = $1", kiosk_id)
        except Exception as e:
            logger.error("get_kiosk failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to read kiosk")


async def touch_kiosk(kiosk_id: str) -> None:
    """Best-effort last_seen_at update, written at most once a minute."""
    async with db_connection(DB_NAME) as conn:
        try:
            await conn.execute(
                "UPDATE kiosks SET last_seen_at = now() WHERE id = $1 "
                "AND (last_seen_at IS NULL OR last_seen_at < now() - INTERVAL '1 minute')",
                kiosk_id,
            )
        except Exception as e:
            logger.warning("touch_kiosk failed: %s", e)


async def revoke_kiosk(kiosk_id: str) -> None:
    async with db_connection(DB_NAME) as conn:
        try:
            await conn.execute(
                "UPDATE kiosks SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
                kiosk_id,
            )
        except Exception as e:
            logger.error("revoke_kiosk failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to deauthorize kiosk")


async def get_kiosk_scan(scan_id: uuid.UUID) -> asyncpg.Record | None:
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                """
                SELECT s.*, u.display_name, u.given_name
                FROM kiosk_scans s JOIN users u ON u.id = s.user_id
                WHERE s.scan_id = $1
                """,
                scan_id,
            )
        except Exception as e:
            logger.error("get_kiosk_scan failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to read scan")


async def claim_kiosk_scan(
        scan_id: uuid.UUID, kiosk_id: str, user_id: str, method: str, scanned_at: datetime,
) -> bool:
    """Record a scan before acting on it. False if this scan_id already exists,
    so a retried request can't toggle attendance a second time."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchval(
                """
                INSERT INTO kiosk_scans (scan_id, kiosk_id, user_id, method, scanned_at)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (scan_id) DO NOTHING
                RETURNING true
                """,
                scan_id, kiosk_id, user_id, method, scanned_at,
            ) is True
        except Exception as e:
            logger.error("claim_kiosk_scan failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to record scan")


async def finish_kiosk_scan(scan_id: uuid.UUID, result: str) -> None:
    async with db_connection(DB_NAME) as conn:
        try:
            await conn.execute("UPDATE kiosk_scans SET result = $2 WHERE scan_id = $1", scan_id, result)
        except Exception as e:
            logger.error("finish_kiosk_scan failed: %s", e)


async def member_scanned_recently(user_id: str, exclude_scan_id: uuid.UUID, within: timedelta) -> bool:
    """Whether another scan of this member changed their attendance within ``within``."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchval(
                """
                SELECT EXISTS (
                    SELECT 1 FROM kiosk_scans
                    WHERE user_id = $1 AND scan_id <> $2
                      AND result IN ('checked_in', 'checked_out')
                      AND received_at > clock_timestamp() - $3::interval
                )
                """,
                user_id, exclude_scan_id, within,
            )
        except Exception as e:
            logger.error("member_scanned_recently failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to read scans")


__all__ = [
    "create_kiosk",
    "get_kiosk",
    "touch_kiosk",
    "revoke_kiosk",
    "get_kiosk_scan",
    "claim_kiosk_scan",
    "finish_kiosk_scan",
    "member_scanned_recently",
]
