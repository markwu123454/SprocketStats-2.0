import asyncio
import json
import logging
import os

import asyncpg
from fastapi import HTTPException
from pywebpush import WebPushException, webpush

from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)

# Raw, base64url-encoded (no padding) VAPID keypair -- see py_vapid.Vapid.from_string
# for the accepted format. Generate a pair with:
#   python -c "from py_vapid import Vapid; import base64; v=Vapid(); v.generate_keys(); \
#              from cryptography.hazmat.primitives import serialization as s; \
#              priv=v.private_key.private_numbers().private_value.to_bytes(32,'big'); \
#              pub=v.public_key.public_bytes(s.Encoding.X962, s.PublicFormat.UncompressedPoint); \
#              print(base64.urlsafe_b64encode(pub).decode().rstrip('=')); \
#              print(base64.urlsafe_b64encode(priv).decode().rstrip('='))"
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY")
VAPID_CLAIM_EMAIL = os.environ.get("VAPID_CLAIM_EMAIL", "mailto:admin@example.com")


async def save_push_subscription(user_id: str, endpoint: str, p256dh: str, auth: str) -> None:
    """Store (or refresh) a browser's push subscription.

    Upserts on ``endpoint`` rather than ``user_id`` -- a browser can resubscribe
    with the same endpoint after its keys rotate, and a shared device could in
    principle hand the same endpoint to a different signed-in user, so the
    endpoint (which the push service treats as the unique mailbox) is the
    natural conflict target.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            await conn.execute(
                """
                INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (endpoint) DO UPDATE
                    SET user_id = EXCLUDED.user_id,
                        p256dh  = EXCLUDED.p256dh,
                        auth    = EXCLUDED.auth
                """,
                user_id,
                endpoint,
                p256dh,
                auth,
            )
        except Exception as e:
            logger.error("save_push_subscription failed: %s", e)
            raise


async def delete_push_subscription(endpoint: str, user_id: str) -> None:
    """Remove one of ``user_id``'s subscriptions by ``endpoint``.

    Scoped to the owner (``endpoint`` AND ``user_id``) so a user can only drop a
    device registered to them -- an endpoint alone is not proof of ownership, and
    matching on it alone would let any signed-in user unsubscribe another's device.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            await conn.execute(
                "DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2",
                endpoint, user_id,
            )
        except Exception as e:
            logger.error("delete_push_subscription failed: %s", e)
            raise


async def _prune_dead_endpoint(endpoint: str) -> None:
    """Delete a subscription the push service reported as gone (404/410).

    System-side cleanup, not a user action: the endpoint is globally unique and
    already known-dead, so it's removed by endpoint alone -- owner scoping only
    matters to stop a *user* deleting someone else's device. Swallows its own
    errors so a failed prune never disrupts the rest of a fan-out.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            await conn.execute("DELETE FROM push_subscriptions WHERE endpoint = $1", endpoint)
        except Exception as e:
            logger.warning("_prune_dead_endpoint failed for %s: %s", endpoint, e)


async def get_push_subscriptions_for_roles(target_roles: list[str]) -> list[asyncpg.Record]:
    """Subscriptions for active (non-banned) users targeted by ``target_roles``.

    Mirrors the "empty = everyone" convention already used by
    ``notifications.target_roles``.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT s.endpoint, s.p256dh, s.auth
                FROM push_subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE u.banned_at IS NULL
                  AND ($1::text[] = '{}' OR u.role = ANY($1::text[]))
                """,
                target_roles,
            )
        except Exception as e:
            logger.error("get_push_subscriptions_for_roles failed: %s", e)
            raise


async def _send_one(sub: asyncpg.Record, payload: str) -> None:
    """Send to a single subscription; prune it if the push service says it's dead.

    ``webpush`` is a blocking call (it shells out to `requests`), so it runs on
    a worker thread via ``asyncio.to_thread`` rather than blocking the event
    loop. Failures are swallowed here by design -- one bad endpoint in a batch
    must not take down delivery to the rest of the audience.
    """
    try:
        await asyncio.to_thread(
            webpush,
            subscription_info={
                "endpoint": sub["endpoint"],
                "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
            },
            data=payload,
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_CLAIM_EMAIL},
        )
    except WebPushException as e:
        status_code = e.response.status_code if e.response is not None else None
        if status_code in (404, 410):
            # Push service no longer recognizes this endpoint (browser
            # unsubscribed, uninstalled, or the subscription simply expired).
            await _prune_dead_endpoint(sub["endpoint"])
        else:
            logger.warning("send_web_push failed for %s: %s", sub["endpoint"], e)
    except Exception as e:
        logger.warning("send_web_push unexpected error for %s: %s", sub["endpoint"], e)


async def send_web_push(
    subscriptions: list[asyncpg.Record],
    title: str,
    body: str,
) -> None:
    """Best-effort fan-out of one push message to every given subscription.

    No-ops (with a warning) if VAPID keys aren't configured, so a missing env
    var degrades to "no push" instead of a 500 on notification creation.
    """
    if not VAPID_PRIVATE_KEY:
        logger.warning("send_web_push skipped: VAPID_PRIVATE_KEY not configured")
        return
    if not subscriptions:
        return

    payload = json.dumps({"title": title, "body": body})
    await asyncio.gather(*(_send_one(sub, payload) for sub in subscriptions))


async def create_push_message(
    title: str,
    body: str,
    target_roles: list[str],
    sent_count: int,
    created_by: str,
) -> asyncpg.Record:
    """Record a sent push for the Push Notifications history list.

    This is entirely separate from ``notifications`` -- a push message never
    creates a dashboard notice, and vice versa, so the two features can be
    authored, listed, and audited independently.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                """
                INSERT INTO push_messages (title, body, target_roles, sent_count, created_by)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
                """,
                title,
                body,
                target_roles,
                sent_count,
                created_by,
            )
        except Exception as e:
            logger.error("create_push_message failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to record push message")


async def list_push_messages() -> list[asyncpg.Record]:
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT m.*, u.display_name AS created_by_name
                FROM push_messages m
                LEFT JOIN users u ON u.id = m.created_by
                ORDER BY m.created_at DESC
                """
            )
        except Exception as e:
            logger.error("list_push_messages failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch push messages")


__all__ = [
    "VAPID_PUBLIC_KEY",
    "save_push_subscription",
    "delete_push_subscription",
    "get_push_subscriptions_for_roles",
    "send_web_push",
    "create_push_message",
    "list_push_messages",
]
