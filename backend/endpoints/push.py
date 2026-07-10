import asyncio

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
    """
    subs = await db.get_push_subscriptions_for_roles(body.target_roles)
    _fire_and_forget(db.send_web_push(subs, body.title, body.body))
    row = await db.create_push_message(body.title, body.body, body.target_roles, len(subs), user["sub"])
    return _row_to_message(row)


def _row_to_message(r) -> dict:
    d = dict(r)
    return {
        "id": str(d["id"]),
        "title": d["title"],
        "body": d["body"],
        "target_roles": d["target_roles"],
        "sent_count": d["sent_count"],
        "created_by_name": d.get("created_by_name"),
        "created_at": d["created_at"].isoformat(),
    }
