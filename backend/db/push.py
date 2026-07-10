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
    ``notifications.target_roles``. Includes ``s.id``/``s.user_id`` so callers
    can attribute a delivery log row to a subscription and its owner.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth
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


async def create_delivery_logs(push_message_id, subs: list[asyncpg.Record]) -> dict[str, object]:
    """Bulk-insert one 'sent' delivery row per subscription, in one round trip.

    Returns ``{endpoint: delivery_id}`` so the fan-out (``send_web_push``) can
    embed each device's own delivery id in that device's payload.
    """
    if not subs:
        return {}
    async with db_connection(DB_NAME) as conn:
        try:
            rows = await conn.fetch(
                """
                INSERT INTO push_delivery_logs (push_message_id, push_subscription_id, user_id, endpoint)
                SELECT $1, x.sub_id, x.user_id, x.endpoint
                FROM unnest($2::uuid[], $3::text[], $4::text[]) AS x(sub_id, user_id, endpoint)
                RETURNING id, endpoint
                """,
                push_message_id,
                [s["id"] for s in subs],
                [s["user_id"] for s in subs],
                [s["endpoint"] for s in subs],
            )
            return {r["endpoint"]: r["id"] for r in rows}
        except Exception as e:
            logger.error("create_delivery_logs failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to record delivery logs")


async def _mark_delivery_failed(delivery_id) -> None:
    """Mark a delivery row 'failed' after a send error.

    System-side bookkeeping, not a user action -- swallows its own errors like
    ``_prune_dead_endpoint`` so a failed mark never disrupts the rest of a
    fan-out. Scoped to status='sent' so it can't clobber a 'delivered' row that
    raced ahead of us (the service worker's receipt can arrive before we
    finish handling the webpush response).
    """
    async with db_connection(DB_NAME) as conn:
        try:
            await conn.execute(
                "UPDATE push_delivery_logs SET status = 'failed', updated_at = now() "
                "WHERE id = $1 AND status = 'sent'",
                delivery_id,
            )
        except Exception as e:
            logger.warning("_mark_delivery_failed failed for %s: %s", delivery_id, e)


async def _send_one(deliv: dict, title: str, body: str) -> None:
    """Send to a single device; prune it if the push service says it's dead.

    ``webpush`` is a blocking call (it shells out to `requests`), so it runs on
    a worker thread via ``asyncio.to_thread`` rather than blocking the event
    loop. Failures are swallowed here by design -- one bad endpoint in a batch
    must not take down delivery to the rest of the audience -- but they still
    flip that device's delivery row to 'failed' so the sender can see it.
    """
    payload = json.dumps({"title": title, "body": body, "delivery_id": str(deliv["delivery_id"])})
    try:
        await asyncio.to_thread(
            webpush,
            subscription_info={
                "endpoint": deliv["endpoint"],
                "keys": {"p256dh": deliv["p256dh"], "auth": deliv["auth"]},
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
            await _prune_dead_endpoint(deliv["endpoint"])
        else:
            logger.warning("send_web_push failed for %s: %s", deliv["endpoint"], e)
        await _mark_delivery_failed(deliv["delivery_id"])
    except Exception as e:
        logger.warning("send_web_push unexpected error for %s: %s", deliv["endpoint"], e)
        await _mark_delivery_failed(deliv["delivery_id"])


async def send_web_push(
    deliveries: list[dict],
    title: str,
    body: str,
) -> None:
    """Best-effort fan-out of one push message to every given device.

    Each item in ``deliveries`` carries ``endpoint``/``p256dh``/``auth`` (from
    the subscription) plus ``delivery_id`` (from ``create_delivery_logs``) so
    the per-device payload can embed the id the service worker echoes back via
    ``POST /push/delivered``.

    No-ops (with a warning) if VAPID keys aren't configured, so a missing env
    var degrades to "no push" instead of a 500 on notification creation.
    """
    if not VAPID_PRIVATE_KEY:
        logger.warning("send_web_push skipped: VAPID_PRIVATE_KEY not configured")
        return
    if not deliveries:
        return

    await asyncio.gather(*(_send_one(deliv, title, body) for deliv in deliveries))


async def mark_delivery_delivered(delivery_id, endpoint: str) -> bool:
    """Flip one delivery row from 'sent' to 'delivered'. Returns whether a row matched.

    Scoped to (id, endpoint, status='sent') -- see the ``/push/delivered``
    endpoint's docstring for why that pair is safe to accept from an
    unauthenticated caller.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            result = await conn.execute(
                """
                UPDATE push_delivery_logs SET status = 'delivered', updated_at = now()
                WHERE id = $1 AND endpoint = $2 AND status = 'sent'
                """,
                delivery_id,
                endpoint,
            )
            return result.split(" ")[-1] != "0"
        except Exception as e:
            logger.error("mark_delivery_delivered failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to update delivery status")


async def expire_stale_deliveries() -> int:
    """Fail any delivery still 'sent' 10+ minutes after it was sent.

    Not every device reliably fires the 'delivered' receipt (e.g. the push
    arrives while the device is offline and is later dropped by the push
    service without ever reaching the service worker), so this periodic sweep
    (see ``main.py``) is what eventually resolves those rows to 'failed'.
    Returns the number of rows updated, parsed from the UPDATE command tag.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            result = await conn.execute(
                """
                UPDATE push_delivery_logs
                SET status = 'failed', updated_at = now()
                WHERE status = 'sent' AND created_at < now() - interval '10 minutes'
                """
            )
            return int(result.split(" ")[-1])
        except Exception as e:
            logger.error("expire_stale_deliveries failed: %s", e)
            raise


async def list_push_deliveries(push_message_id) -> list[asyncpg.Record]:
    """Per-device delivery rows for a push message's detail modal.

    Includes ``user_id`` (not just the joined ``user_name``) so the caller can
    group a user's multiple devices into a single row -- the modal shows
    delivery status per user, not per device.

    The CASE mirrors ``expire_stale_deliveries``'s 10-minute timeout so a
    delivery that's due to be swept already reads as 'failed' in the window
    between sweeps, instead of sitting as 'sent' for up to a minute longer.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT d.id,
                       CASE WHEN d.status = 'sent' AND d.created_at < now() - interval '10 minutes'
                            THEN 'failed' ELSE d.status END AS status,
                       d.user_id, d.endpoint, d.updated_at, d.created_at,
                       u.display_name AS user_name
                FROM push_delivery_logs d
                LEFT JOIN users u ON u.id = d.user_id
                WHERE d.push_message_id = $1
                ORDER BY u.display_name NULLS LAST, d.created_at
                """,
                push_message_id,
            )
        except Exception as e:
            logger.error("list_push_deliveries failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch push deliveries")


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
    """Send history for the Push Notifications page, with live delivery tallies.

    ``delivered_count``/``failed_count`` are computed the same way as
    ``list_push_deliveries``'s per-row status (including the 10-minute
    timeout window), just aggregated per message instead of per device.
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT m.*, u.display_name AS created_by_name,
                       COUNT(*) FILTER (WHERE d.status = 'delivered') AS delivered_count,
                       COUNT(*) FILTER (
                           WHERE d.status = 'failed'
                              OR (d.status = 'sent' AND d.created_at < now() - interval '10 minutes')
                       ) AS failed_count
                FROM push_messages m
                LEFT JOIN users u ON u.id = m.created_by
                LEFT JOIN push_delivery_logs d ON d.push_message_id = m.id
                GROUP BY m.id, u.display_name
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
    "create_delivery_logs",
    "send_web_push",
    "mark_delivery_delivered",
    "expire_stale_deliveries",
    "list_push_deliveries",
    "create_push_message",
    "list_push_messages",
]
