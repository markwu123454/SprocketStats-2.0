"""Durable queue for automated category pushes (absences, task assignments, reminders).

A push is written here first -- one row per recipient device -- and only then
sent, so a server restart, a push-service outage or a network error delays it
instead of losing it. ``core.push_notify.drain_outbox`` sends due rows; a row
is deleted once the push service accepts it (from then on the push service
holds it for an offline device, see ``PUSH_TTL_SECONDS``), when the device
turns out to be gone, or when the push stops being worth sending
(``expires_at``).

Claiming a row pushes its ``next_attempt_at`` forward by a lease, in the same
statement that selects it (``FOR UPDATE SKIP LOCKED``), so several server
processes -- or overlapping drains in one -- never send a row twice, and a row
claimed by a process that then died is picked up again once the lease runs out.
"""

import logging
from dataclasses import dataclass
from datetime import datetime

import asyncpg

from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OutboxPush:
    """One push to queue. ``user_ids=None`` means every subscribed user."""

    category: str
    title: str
    body: str
    url: str | None
    tag: str | None
    expires_at: datetime
    user_ids: list[str] | None = None


async def enqueue_push_conn(conn: asyncpg.Connection, push: OutboxPush) -> int:
    """Queue ``push`` for each subscribed device of its recipients, on ``conn``.

    Takes a connection so the caller can do it in the same transaction as the
    write the push is about. Skips banned users and anyone opted out of the
    category, like ``get_push_subscriptions_for_roles``. Returns rows queued.
    """
    if push.user_ids is not None and not push.user_ids:
        return 0
    status = await conn.execute(
        """
        INSERT INTO push_outbox (subscription_id, category, title, body, url, tag, expires_at)
        SELECT s.id, $2, $3, $4, $5, $6, $7
        FROM push_subscriptions s
        JOIN users u ON u.id = s.user_id
        WHERE u.banned_at IS NULL
          AND ($1::text[] IS NULL OR s.user_id = ANY($1::text[]))
          AND NOT EXISTS (
              SELECT 1 FROM push_opt_outs o
              WHERE o.user_id = s.user_id AND o.category = $2
          )
        """,
        push.user_ids, push.category, push.title, push.body, push.url, push.tag, push.expires_at,
    )
    return int(status.rsplit(" ", 1)[-1])


async def enqueue_push(push: OutboxPush) -> int:
    """``enqueue_push_conn`` on its own connection."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await enqueue_push_conn(conn, push)
        except Exception as e:
            logger.error("enqueue_push(%s) failed: %s", push.category, e)
            raise


async def claim_reminder_and_enqueue(key: str, push: OutboxPush) -> bool:
    """Claim reminder ``key`` and queue its push in one transaction.

    Returns False if the key was already claimed. Because the claim and the
    queued rows commit together, a crash can't leave a reminder claimed but
    never sent.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            async with conn.transaction():
                claimed = await conn.fetchval(
                    "INSERT INTO push_reminders_sent (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING true",
                    key,
                )
                if not claimed:
                    return False
                await enqueue_push_conn(conn, push)
                return True
        except Exception as e:
            logger.error("claim_reminder_and_enqueue(%s) failed: %s", key, e)
            raise


async def claim_due_pushes(limit: int, lease_seconds: float) -> list[asyncpg.Record]:
    """Drop expired rows, then claim up to ``limit`` due ones for sending.

    Each claimed row's ``attempts`` goes up by one and its ``next_attempt_at``
    moves ``lease_seconds`` ahead, so nobody else claims it meanwhile. The
    caller must settle every row it gets (``settle_pushes``).
    """
    async with db_connection(DB_NAME) as conn:
        try:
            expired = await conn.fetch(
                "DELETE FROM push_outbox WHERE expires_at <= now() RETURNING category, attempts"
            )
            for row in expired:
                logger.warning(
                    "push outbox: gave up on a %s push after %d attempt(s): expired",
                    row["category"], row["attempts"],
                )
            return await conn.fetch(
                """
                UPDATE push_outbox o
                SET attempts = o.attempts + 1,
                    next_attempt_at = now() + make_interval(secs => $2)
                FROM push_subscriptions s
                WHERE s.id = o.subscription_id
                  AND o.id IN (
                      SELECT id FROM push_outbox
                      WHERE next_attempt_at <= now()
                      ORDER BY next_attempt_at
                      LIMIT $1
                      FOR UPDATE SKIP LOCKED
                  )
                RETURNING o.id, o.category, o.title, o.body, o.url, o.tag, o.attempts,
                          o.expires_at, s.endpoint, s.p256dh, s.auth
                """,
                limit, float(lease_seconds),
            )
        except Exception as e:
            logger.error("claim_due_pushes failed: %s", e)
            raise


async def settle_pushes(done_ids: list[int], retry: dict[int, float]) -> None:
    """Delete finished rows and reschedule the rest, in one round trip each.

    ``retry`` maps row id to seconds from now until its next attempt.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            if done_ids:
                await conn.execute("DELETE FROM push_outbox WHERE id = ANY($1::bigint[])", done_ids)
            if retry:
                await conn.execute(
                    """
                    UPDATE push_outbox o
                    SET next_attempt_at = now() + make_interval(secs => x.delay)
                    FROM unnest($1::bigint[], $2::float8[]) AS x(id, delay)
                    WHERE o.id = x.id
                    """,
                    list(retry.keys()), list(retry.values()),
                )
        except Exception as e:
            # Not raised: an unsettled row just comes due again once its lease
            # runs out, so the worst case is a duplicate push, not a lost one.
            logger.error("settle_pushes failed: %s", e)


__all__ = [
    "OutboxPush",
    "enqueue_push_conn",
    "enqueue_push",
    "claim_reminder_and_enqueue",
    "claim_due_pushes",
    "settle_pushes",
]
