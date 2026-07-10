import asyncio
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator

import db
from .auth import VALID_ROLES, require_access, require_active

router = APIRouter()

# Reuses the same capability as dashboard notices -- the leads who can author
# one are trusted to author the other -- but the two features are otherwise
# fully independent: separate tables, separate endpoints, separate page.
# Sending a push never creates a `notifications` row (no dashboard modal), and
# creating a dashboard notice never sends a push.
require_push = require_access(permissions="control_panel.notifications")

# Strong references for fire-and-forget push sends. asyncio.create_task() only
# holds a *weak* reference to the task -- without this, the task object can be
# garbage-collected mid-flight (before the webpush network calls finish),
# silently dropping the send. See asyncio docs' "Important" note on create_task.
_background_tasks: set[asyncio.Task] = set()


def _fire_and_forget(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionRequest(BaseModel):
    """Shape of the browser's `PushSubscription.toJSON()` output."""

    endpoint: str
    keys: PushSubscriptionKeys


class PushUnsubscribeRequest(BaseModel):
    """Unsubscribing only needs the endpoint to know which row to drop."""

    endpoint: str


class PushMessageRequest(BaseModel):
    """A one-off OS push -- independent of the dashboard notice system."""

    title: str
    body: str
    target_roles: list[str] = []

    @field_validator("title", "body")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("This field cannot be empty")
        return v

    @field_validator("target_roles")
    @classmethod
    def _validate_target_roles(cls, v: list[str]) -> list[str]:
        unknown = set(v) - VALID_ROLES
        if unknown:
            raise ValueError(f"Unknown role(s): {sorted(unknown)}")
        return v


class PushDeliveredRequest(BaseModel):
    """Delivery receipt fired by the service worker after handling a push event.

    ``delivery_id`` + ``endpoint`` together are the bearer credential that
    authorizes this update -- see `push_delivered`'s docstring.
    """

    delivery_id: UUID
    endpoint: str


@router.get("/public-key")
async def push_public_key(_: dict = Depends(require_active)):
    """VAPID public key the frontend passes as `applicationServerKey` when
    calling `pushManager.subscribe`. Served from the backend so there's one
    source of truth instead of a key duplicated into frontend env vars.
    """
    return {"public_key": db.VAPID_PUBLIC_KEY}


@router.post("/subscribe")
async def push_subscribe(body: PushSubscriptionRequest, user: dict = Depends(require_active)):
    """Register (or refresh) this browser's push subscription for the current user.

    Open to any signed-in user -- every user, not just push authors, needs to
    be able to opt in to receiving push on this device.
    """
    await db.save_push_subscription(user["sub"], body.endpoint, body.keys.p256dh, body.keys.auth)
    return {"ok": True}


@router.post("/unsubscribe")
async def push_unsubscribe(body: PushUnsubscribeRequest, user: dict = Depends(require_active)):
    """Drop a subscription, e.g. when the user disables push in Settings.

    Scoped to the caller's own subscriptions: the delete matches on
    ``endpoint`` *and* ``user_id``, so a user can only remove a device that is
    registered to them, never someone else's by guessing their endpoint.
    """
    await db.delete_push_subscription(body.endpoint, user["sub"])
    return {"ok": True}


@router.get("")
async def list_push_messages(_: dict = Depends(require_push)):
    """Send history for the Push Notifications page."""
    rows = await db.list_push_messages()
    return [_row_to_message(r) for r in rows]


@router.post("")
async def send_push_message(body: PushMessageRequest, user: dict = Depends(require_push)):
    """Compose and immediately fan out a push to every subscribed device
    matching ``target_roles``. Deliberately does not touch the `notifications`
    table -- this is a push-only send, with no dashboard modal counterpart.

    Order matters here: the push_messages row is created first (the delivery
    logs need its id as a foreign key), then one 'sent' delivery log is
    written per subscription, and only then is the actual fan-out fired --
    still fire-and-forget so the request doesn't wait on every webpush call.
    """
    subs = await db.get_push_subscriptions_for_roles(body.target_roles)
    row = await db.create_push_message(body.title, body.body, body.target_roles, len(subs), user["sub"])
    delivery_ids = await db.create_delivery_logs(row["id"], subs)
    deliveries = [
        {
            "endpoint": s["endpoint"],
            "p256dh": s["p256dh"],
            "auth": s["auth"],
            "delivery_id": delivery_ids[s["endpoint"]],
        }
        for s in subs
        if s["endpoint"] in delivery_ids
    ]
    _fire_and_forget(db.send_web_push(deliveries, body.title, body.body))
    return _row_to_message(row)


@router.post("/delivered")
async def push_delivered(body: PushDeliveredRequest):
    """Best-effort delivery receipt fired by the service worker's `push` handler.

    Deliberately has NO auth dependency. The service worker can fire this long
    after (or without) an active session -- e.g. the user's cookie has expired,
    or they're not signed in on this device tab at all -- and the receipt must
    still land. This is safe to leave open because the (delivery UUID,
    endpoint) pair is an unguessable bearer credential: it's embedded only in
    that one device's encrypted push payload, it scopes the write to exactly
    one row, and the underlying update can only ever transition that row from
    'sent' to 'delivered' -- never create, delete, or touch any other status --
    so there is nothing meaningful to abuse even if a pair were guessed.

    Never errors on a miss: an unknown id, wrong endpoint, or already-resolved
    row just means ``ok`` comes back false. This call is idempotent and its
    caller (the service worker) has no way to react to a failure anyway.
    """
    ok = await db.mark_delivery_delivered(str(body.delivery_id), body.endpoint)
    return {"ok": ok}


@router.get("/{message_id}/deliveries")
async def get_push_deliveries(message_id: UUID, _: dict = Depends(require_push)):
    """Per-user delivery status for one push message's detail modal.

    A user can have several subscribed devices, each with its own delivery
    row -- these are collapsed into one row per user so the modal reflects
    whether *the user* got the notification, not whether any one device did:
    'delivered' only when every device delivered, 'partial' when some (but
    not all) did, 'failed' only when every device failed, and 'sent'
    (pending) otherwise. Rows with no linked user (subscription's owner was
    deleted) can't be grouped, so each is kept as its own entry -- with a
    single device, that's always delivered/failed/sent, never partial.

    ``message_id`` is validated as a UUID by the path type annotation, so a
    malformed id 422s before ever reaching the database.
    """
    rows = await db.list_push_deliveries(str(message_id))

    by_user: dict[str, dict] = {}
    order: list[str] = []
    for r in rows:
        key = r["user_id"] or f"device:{r['id']}"
        if key not in by_user:
            by_user[key] = {
                "id": str(r["id"]), "user_name": r["user_name"], "updated_at": r["updated_at"],
                "delivered": 0, "failed": 0, "sent": 0,
            }
            order.append(key)
        entry = by_user[key]
        entry[r["status"]] += 1
        entry["updated_at"] = max(entry["updated_at"], r["updated_at"])

    summary = {"delivered": 0, "partial": 0, "failed": 0, "pending": 0}
    deliveries = []
    for key in order:
        entry = by_user[key]
        total = entry["delivered"] + entry["failed"] + entry["sent"]
        if entry["delivered"] == total:
            status = "delivered"
        elif entry["delivered"] > 0:
            status = "partial"
        elif entry["failed"] == total:
            status = "failed"
        else:
            status = "sent"
        summary["pending" if status == "sent" else status] += 1
        deliveries.append(
            {
                "id": entry["id"],
                "user_name": entry["user_name"],
                "status": status,
                "updated_at": entry["updated_at"].isoformat(),
            }
        )
    return {"summary": summary, "deliveries": deliveries}


def _row_to_message(r) -> dict:
    d = dict(r)
    return {
        "id": str(d["id"]),
        "title": d["title"],
        "body": d["body"],
        "target_roles": d["target_roles"],
        "sent_count": d["sent_count"],
        "delivered_count": int(d.get("delivered_count") or 0),
        "failed_count": int(d.get("failed_count") or 0),
        "created_by_name": d.get("created_by_name"),
        "created_at": d["created_at"].isoformat(),
    }
