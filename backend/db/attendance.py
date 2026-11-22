import asyncpg
import logging
from datetime import timedelta

from fastapi import HTTPException

from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)

KIOSK_SESSION_MAX_AGE = timedelta(hours=12)
# Time before a meeting starts and after it ends that still earns hours
# (setup, cleanup, running over). See list_meeting_checkins.
MEETING_GRACE = timedelta(minutes=30)


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
                        "UPDATE attendance SET checkout_time = $2, checkout_method = 'kiosk' WHERE id = $1",
                        open_entry["id"],
                        now,
                    )
                    return "checked_out"

                # Nobody checked out of the old session. Close it as "expired"
                # rather than deleting it: it still earns unverified credit
                # (see core.attendance_rules).
                if open_entry is not None:
                    await conn.execute(
                        "UPDATE attendance SET checkout_time = checkin_time + $2::interval, "
                        "checkout_method = 'expired' WHERE id = $1",
                        open_entry["id"],
                        KIOSK_SESSION_MAX_AGE,
                    )

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
    same as the toggle treats them. Recorded as a ``self`` check-out, which
    earns only unverified credit: nothing proves where the member was.

    :returns: The closed entry, or ``None`` if the user wasn't checked in.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                """
                UPDATE attendance SET checkout_time = clock_timestamp(), checkout_method = 'self'
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
                  AND checkout_method IS DISTINCT FROM 'expired'
                  AND (checkout_time IS NOT NULL OR checkin_time > now() - INTERVAL '12 hours')
                ORDER BY checkin_time
                """,
                user_id,
            )
        except Exception as e:
            logger.error("list_attendance_for_user failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch attendance")


async def list_all_attendance() -> list[asyncpg.Record]:
    """Attendance entries for every unbanned user, joined to display names."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT a.user_id, a.checkin_time, a.checkout_time, u.display_name, u.given_name
                FROM attendance a
                JOIN users u ON u.id = a.user_id AND u.banned_at IS NULL
                WHERE a.checkout_method IS DISTINCT FROM 'expired'
                  AND (a.checkout_time IS NOT NULL OR a.checkin_time > now() - INTERVAL '12 hours')
                ORDER BY a.user_id, a.checkin_time
                """
            )
        except Exception as e:
            logger.error("list_all_attendance failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch attendance")


async def list_meeting_checkins() -> list[asyncpg.Record]:
    """Every attendance entry clipped to each meeting it overlaps.

    Each meeting's window is stretched by ``MEETING_GRACE`` on both sides, so
    setup and cleanup time counts. Where two meetings are closer than twice
    the grace, the gap between them is split at its midpoint, so no minute
    counts toward both.

    One row per (meeting, entry) pair with the overlapping span as
    ``seg_start``/``seg_end``, ordered so a single sweep can merge a member's
    overlapping entries. ``checkout_method`` says how the entry ended
    (``kiosk``, ``self``, ``expired``, ``legacy``, or NULL while still open)
    and ``meeting_end`` (the end of the window, grace included) lets the
    caller tell a live meeting from a finished one. An entry still open counts
    up to now; one left open past the kiosk limit is reported as ``expired``,
    ending at the limit.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                WITH ordered AS (
                    SELECT id, start_time, end_time,
                           LAG(end_time)    OVER (ORDER BY start_time, id) AS prev_end,
                           LEAD(start_time) OVER (ORDER BY start_time, id) AS next_start
                    FROM meeting_hours
                ), windows AS (
                    SELECT id,
                           CASE WHEN prev_end IS NULL THEN start_time - $2::interval
                                WHEN prev_end >= start_time THEN start_time
                                ELSE GREATEST(start_time - $2::interval, prev_end + (start_time - prev_end) / 2)
                           END AS win_start,
                           CASE WHEN next_start IS NULL THEN end_time + $2::interval
                                WHEN next_start <= end_time THEN end_time
                                ELSE LEAST(end_time + $2::interval, end_time + (next_start - end_time) / 2)
                           END AS win_end
                    FROM ordered
                )
                SELECT w.id AS meeting_id, w.win_end AS meeting_end, a.user_id,
                       u.display_name, u.given_name,
                       GREATEST(a.checkin_time, w.win_start) AS seg_start,
                       LEAST(e.end_at, w.win_end) AS seg_end,
                       e.method AS checkout_method
                FROM attendance a
                CROSS JOIN LATERAL (
                    SELECT COALESCE(a.checkout_time, LEAST(now(), a.checkin_time + $1::interval)) AS end_at,
                           CASE WHEN a.checkout_time IS NULL AND a.checkin_time <= now() - $1::interval
                                THEN 'expired' ELSE a.checkout_method END AS method
                ) e
                JOIN windows w ON a.checkin_time < w.win_end AND e.end_at > w.win_start
                -- A banned member's time is hidden while they're banned.
                JOIN users u ON u.id = a.user_id AND u.banned_at IS NULL
                ORDER BY w.id, a.user_id, seg_start
                """,
                KIOSK_SESSION_MAX_AGE,
                MEETING_GRACE,
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
    "MEETING_GRACE",
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
