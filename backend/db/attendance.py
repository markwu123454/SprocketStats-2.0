import asyncpg
import logging
from datetime import timedelta

from fastapi import HTTPException

from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)

KIOSK_SESSION_MAX_AGE = timedelta(hours=12)


async def toggle_kiosk_attendance(user_id: str, source: str = "kiosk") -> str | None:
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
                    VALUES ($1, $2, NULL, $3)
                    """,
                    user_id,
                    now,
                    source,
                )
                return "checked_in"
        except Exception as e:
            logger.error("toggle_kiosk_attendance failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to update attendance")


async def kiosk_attendance_status(user_id: str) -> str:
    """``"checked_in"`` if the member has a live kiosk session, else ``"checked_out"``.
    Sessions older than the kiosk limit count as over, the same as the toggle."""
    async with db_connection(DB_NAME) as conn:
        try:
            open_now = await conn.fetchval(
                """
                SELECT EXISTS (
                    SELECT 1 FROM attendance
                    WHERE user_id = $1 AND checkout_time IS NULL
                      AND checkin_time > clock_timestamp() - $2::interval
                )
                """,
                user_id,
                KIOSK_SESSION_MAX_AGE,
            )
            return "checked_in" if open_now else "checked_out"
        except Exception as e:
            logger.error("kiosk_attendance_status failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to read attendance")


async def checkout_attendance(user_id: str) -> asyncpg.Record | None:
    """Close the user's open kiosk session, if they have a live one.

    Never opens a session: checking in still requires being at a kiosk.
    Abandoned open entries (older than the kiosk limit) are left alone, the
    same as the toggle treats them.

    :returns: The closed entry, or ``None`` if the user wasn't checked in.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                """
                UPDATE attendance SET checkout_time = clock_timestamp()
                WHERE id = (
                    SELECT id FROM attendance
                    WHERE user_id = $1 AND checkout_time IS NULL
                      AND checkin_time > clock_timestamp() - $2::interval
                    ORDER BY checkin_time DESC
                    LIMIT 1
                    FOR UPDATE
                )
                RETURNING id, checkin_time, checkout_time
                """,
                user_id,
                KIOSK_SESSION_MAX_AGE,
            )
        except Exception as e:
            logger.error("checkout_attendance failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to check out")


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


async def list_meeting_checkins() -> list[asyncpg.Record]:
    """Every attendance entry clipped to each meeting it overlaps.

    One row per (meeting, entry) pair with the overlapping span as
    ``seg_start``/``seg_end``, ordered so a single sweep can merge a member's
    overlapping entries. An entry still open counts up to now; abandoned open
    entries (older than the kiosk limit) are skipped, as everywhere else.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT m.id AS meeting_id, a.user_id,
                       GREATEST(a.checkin_time, m.start_time) AS seg_start,
                       LEAST(COALESCE(a.checkout_time, now()), m.end_time) AS seg_end
                FROM meeting_hours m
                JOIN attendance a
                  ON a.checkin_time < m.end_time
                 AND COALESCE(a.checkout_time, now()) > m.start_time
                WHERE a.checkout_time IS NOT NULL
                   OR a.checkin_time > now() - INTERVAL '12 hours'
                ORDER BY m.id, a.user_id, seg_start
                """
            )
        except Exception as e:
            logger.error("list_meeting_checkins failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch attendance")


QR_CODE_TTL = timedelta(seconds=30)


async def create_kiosk_qr_code(token: str, kiosk_user_id: str) -> None:
    async with db_connection(DB_NAME) as conn:
        try:
            # Opportunistic cleanup keeps the table tiny without a scheduler.
            await conn.execute(
                "DELETE FROM kiosk_qr_codes WHERE expires_at < now() - INTERVAL '10 minutes'"
            )
            await conn.execute(
                "INSERT INTO kiosk_qr_codes (token, kiosk_user_id, expires_at) "
                "VALUES ($1, $2, now() + $3)",
                token, kiosk_user_id, QR_CODE_TTL,
            )
        except Exception as e:
            logger.error("create_kiosk_qr_code failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to create check-in code")


async def claim_kiosk_qr_code(token: str, user_id: str) -> bool:
    """Atomically claim an unexpired, unused code. False if it can't be claimed."""
    async with db_connection(DB_NAME) as conn:
        try:
            row = await conn.fetchrow(
                """
                UPDATE kiosk_qr_codes SET used_by = $2, used_at = now()
                WHERE token = $1 AND used_at IS NULL AND expires_at > now()
                RETURNING token
                """,
                token, user_id,
            )
            return row is not None
        except Exception as e:
            logger.error("claim_kiosk_qr_code failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to claim check-in code")


async def set_kiosk_qr_result(token: str, attendance_status: str) -> str | None:
    """Record the outcome; returns the owning kiosk's user id, or None on failure."""
    async with db_connection(DB_NAME) as conn:
        try:
            row = await conn.fetchrow(
                "UPDATE kiosk_qr_codes SET result_status = $2 WHERE token = $1 "
                "RETURNING kiosk_user_id",
                token, attendance_status,
            )
            return row["kiosk_user_id"] if row else None
        except Exception as e:
            logger.error("set_kiosk_qr_result failed: %s", e)
            return None


async def list_kiosk_qr_results(kiosk_user_id: str, tokens: list[str]) -> list[asyncpg.Record]:
    """Claimed codes among ``tokens`` that belong to this kiosk's authorizer."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT c.token, c.result_status, u.display_name, u.given_name
                FROM kiosk_qr_codes c
                LEFT JOIN users u ON u.id = c.used_by
                WHERE c.kiosk_user_id = $1 AND c.token = ANY($2::text[]) AND c.used_at IS NOT NULL
                """,
                kiosk_user_id, tokens,
            )
        except Exception as e:
            logger.error("list_kiosk_qr_results failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to read check-in results")


__all__ = [
    "KIOSK_SESSION_MAX_AGE",
    "QR_CODE_TTL",
    "create_kiosk_qr_code",
    "claim_kiosk_qr_code",
    "set_kiosk_qr_result",
    "list_kiosk_qr_results",
    "toggle_kiosk_attendance",
    "kiosk_attendance_status",
    "checkout_attendance",
    "list_attendance_for_user",
    "list_all_attendance",
    "list_meeting_checkins",
]
