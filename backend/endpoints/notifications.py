from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

import db
from .auth import VALID_ROLES, require_access, get_current_user

router = APIRouter()

# Authoring (create/edit/view stats) is restricted to leads, captains, and mentors.
require_notifications = require_access(permissions="control_panel.notifications")


class NotificationWrite(BaseModel):
    """Shared shape for creating and editing a notice.

    ``target_roles`` empty means "everyone"; leads author it by unchecking the
    roles that don't apply (e.g. mentors/alumni for a comp signup) rather than
    hand-picking every included role. ``response_options`` empty means the
    notice is a plain "Got it" acknowledgement.
    """

    title: str
    body: str
    link: str | None = None
    hard_block: bool = False
    target_roles: list[str] = []
    response_options: list[str] = []
    response_mode: str = "single"

    @field_validator("title", "body")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("This field cannot be empty")
        return v

    @field_validator("link")
    @classmethod
    def _clean_link(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("target_roles")
    @classmethod
    def _validate_target_roles(cls, v: list[str]) -> list[str]:
        unknown = set(v) - VALID_ROLES
        if unknown:
            raise ValueError(f"Unknown role(s): {sorted(unknown)}")
        return v

    @field_validator("response_options")
    @classmethod
    def _validate_response_options(cls, v: list[str]) -> list[str]:
        cleaned = [o.strip() for o in v if o.strip()]
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("Response options must be unique")
        return cleaned

    @field_validator("response_mode")
    @classmethod
    def _validate_response_mode(cls, v: str) -> str:
        if v not in ("single", "multi"):
            raise ValueError("response_mode must be 'single' or 'multi'")
        return v


class RespondRequest(BaseModel):
    """A consumer's answer to a notice. Empty list = plain acknowledgement."""

    response: list[str] = []


@router.get("")
async def list_notifications(user: dict = Depends(require_notifications)):
    rows = await db.list_notifications()
    return [_row_to_summary(r, user["sub"]) for r in rows]


@router.post("")
async def create_notification(body: NotificationWrite, user: dict = Depends(require_notifications)):
    row = await db.create_notification(
        body.title,
        body.body,
        body.link,
        body.hard_block,
        body.target_roles,
        body.response_options,
        body.response_mode,
        user["sub"],
    )
    return _row_to_notification(row, user["sub"])


@router.get("/{notification_id}")
async def get_notification_detail(notification_id: str, user: dict = Depends(require_notifications)):
    detail = await db.get_notification_detail(notification_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return {
        "notification": _row_to_notification(detail["notification"], user["sub"]),
        "tally": [{"option": r["option"], "count": r["count"]} for r in detail["tally"]],
        "ack_count": detail["ack_count"],
        "eligible_count": detail["eligible_count"],
        "responses": [
            {
                "id": r["id"],
                "display_name": r["display_name"],
                "email": r["email"],
                "response": r["response"],
                "responded_at": r["responded_at"].isoformat(),
            }
            for r in detail["responses"]
        ],
        "non_responders": [
            {"id": r["id"], "display_name": r["display_name"], "email": r["email"]} for r in detail["non_responders"]
        ],
    }


@router.put("/{notification_id}")
async def update_notification(notification_id: str, body: NotificationWrite, user: dict = Depends(require_notifications)):
    """Cosmetic edit -- fixes typos without disturbing already-recorded responses."""
    row = await db.update_notification(
        notification_id,
        body.title,
        body.body,
        body.link,
        body.hard_block,
        body.target_roles,
        body.response_options,
        body.response_mode,
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return _row_to_notification(row, user["sub"])


@router.post("/{notification_id}/deactivate")
async def deactivate_notification(notification_id: str, user: dict = Depends(require_notifications)):
    row = await db.deactivate_notification(notification_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return _row_to_notification(row, user["sub"])


@router.post("/{notification_id}/respond")
async def respond_to_notification(notification_id: str, body: RespondRequest, user: dict = Depends(get_current_user)):
    """Record the current user's answer to a notice. Open to any signed-in user.

    Not gated on `control_panel.notifications` -- every user, regardless of role,
    must be able to respond to notices targeted at them.
    """
    notification = await db.get_notification(notification_id)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    row = await db.upsert_response(notification_id, user["sub"], body.response)
    return {"notification_id": row["notification_id"], "response": row["response"]}


def _row_to_notification(r, current_user_id: str) -> dict:
    """Shape a `notifications` row for the frontend.

    Exposes `created_by_name` (when the row was joined against `users`) and
    `created_by_is_self` instead of making the frontend match the raw
    `created_by` id against the viewer's own id -- the UI only ever needs
    "who" in display terms, not an id to resolve itself.
    """
    d = dict(r)
    return {
        "id": str(d["id"]),
        "title": d["title"],
        "body": d["body"],
        "link": d["link"],
        "hard_block": d["hard_block"],
        "target_roles": d["target_roles"],
        "response_options": d["response_options"],
        "response_mode": d["response_mode"],
        "active": d["active"],
        "created_by_name": d.get("created_by_name"),
        "created_by_is_self": d["created_by"] == current_user_id,
        "created_at": d["created_at"].isoformat(),
        "updated_at": d["updated_at"].isoformat(),
    }


def _row_to_summary(r, current_user_id: str) -> dict:
    return {**_row_to_notification(r, current_user_id), "response_count": r["response_count"]}
