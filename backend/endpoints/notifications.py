from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

import db
from core import account_state
from core.permissions import can_edit_authored
from core.security import VALID_ROLES, require_access, require_active

router = APIRouter()

# Authoring (create/edit/view stats) is restricted to leads, captains, and mentors.
require_notifications = require_access(permissions="control_panel.notifications")


def _authorize_notice_edit(actor: dict, notice) -> None:
    """Ensure ``actor`` has the authority to edit/deactivate ``notice``, else 403.

    The ``control_panel.notifications`` capability admits leads, captains, and
    mentors, but a lead must not be able to edit or deactivate a captain's or
    mentor's notice. This enforces same-authority-or-higher on the notice's
    *author*: the author's current role is read from the ``account_state`` cache
    (``created_by`` → role; an unknown/departed author ranks lowest, so any
    author may edit an orphaned notice). Editing one's own notice always holds.
    """
    author_role = account_state.role_of(notice["created_by"])
    if not can_edit_authored(actor.get("role"), author_role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot edit a notice authored by someone more senior",
        )


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
    return [_row_to_summary(r, user) for r in rows]


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
    return _row_to_notification(row, user)


@router.get("/{notification_id}")
async def get_notification_detail(notification_id: str, user: dict = Depends(require_notifications)):
    detail = await db.get_notification_detail(notification_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return {
        "notification": _row_to_notification(detail["notification"], user),
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
    """Cosmetic edit -- fixes typos without disturbing already-recorded responses.

    Beyond the authoring capability, a lead may not edit a notice authored by a
    captain/mentor (see :func:`_authorize_notice_edit`).
    """
    existing = await db.get_notification(notification_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    _authorize_notice_edit(user, existing)
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
    return _row_to_notification(row, user)


@router.post("/{notification_id}/deactivate")
async def deactivate_notification(notification_id: str, user: dict = Depends(require_notifications)):
    """Deactivate a notice. Same author-authority rule as editing applies."""
    existing = await db.get_notification(notification_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    _authorize_notice_edit(user, existing)
    row = await db.deactivate_notification(notification_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return _row_to_notification(row, user)


@router.post("/{notification_id}/respond")
async def respond_to_notification(notification_id: str, body: RespondRequest, user: dict = Depends(require_active)):
    """Record the current user's answer to a notice. Open to any signed-in user.

    Not gated on `control_panel.notifications` -- every user, regardless of role,
    must be able to respond to notices targeted at them. But the response is still
    validated against the notice's own rules so it can't be used to respond to a
    notice you're not addressed by, to an inactive notice, or with options the
    notice never offered:

      * the notice must exist and be **active**;
      * the caller's role must be in the notice's ``target_roles`` (empty =
        everyone), mirroring the audience filter used to surface it in the first
        place;
      * every submitted option must be one of the notice's ``response_options``
        (so a plain acknowledgement, which offers none, accepts only an empty
        answer), and a ``single`` notice accepts at most one option.
    """
    notification = await db.get_notification(notification_id)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if not notification["active"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This notification is no longer active")

    target_roles = notification["target_roles"] or []
    if target_roles and user.get("role") not in target_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This notification is not addressed to you"
        )

    allowed_options = set(notification["response_options"] or [])
    unknown = set(body.response) - allowed_options
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid response option(s): {sorted(unknown)}"
        )
    if notification["response_mode"] == "single" and len(body.response) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This notification accepts only a single response"
        )

    row = await db.upsert_response(notification_id, user["sub"], body.response)
    return {"notification_id": row["notification_id"], "response": row["response"]}


def _row_to_notification(r, viewer: dict) -> dict:
    """Shape a `notifications` row for the frontend, from ``viewer``'s perspective.

    Exposes `created_by_name` (when the row was joined against `users`) and
    `created_by_is_self` instead of making the frontend match the raw
    `created_by` id against the viewer's own id -- the UI only ever needs
    "who" in display terms, not an id to resolve itself. `can_edit` mirrors the
    backend's author-authority rule (:func:`_authorize_notice_edit`) so the UI
    can hide the edit/deactivate controls the endpoint would reject anyway --
    cosmetic only; the endpoint still enforces it.
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
        "created_by_is_self": d["created_by"] == viewer["sub"],
        "can_edit": can_edit_authored(viewer.get("role"), account_state.role_of(d["created_by"])),
        "created_at": d["created_at"].isoformat(),
        "updated_at": d["updated_at"].isoformat(),
    }


def _row_to_summary(r, viewer: dict) -> dict:
    return {
        **_row_to_notification(r, viewer),
        "response_count": r["response_count"],
        "eligible_count": r["eligible_count"],
    }
