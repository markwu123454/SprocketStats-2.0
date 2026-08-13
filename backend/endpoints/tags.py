import re

from fastapi import APIRouter, Depends, HTTPException, status

import db
from core import account_state
from core.permissions import can, get_permissions_for_role, has_moderation_authority
from core.security import get_current_user, require_access

router = APIRouter()

_TAG_RE = re.compile(r"^[a-z0-9_]{1,64}$")

# Full member management (Captains, Mentors).
require_tag_admin = require_access(permissions="control_panel.members")


async def _require_tag_editor(user: dict = Depends(get_current_user)) -> dict:
    """Admit anyone with roster access: full managers (Captains/Mentors) or
    anyone with moderation authority (Leads). Mirrors require_roster_access in
    endpoints/members.py — keep them in sync if the policy changes."""
    await account_state.assert_active(user["sub"])
    role = user.get("role")
    if can(get_permissions_for_role(role), "control_panel.members") or has_moderation_authority(role):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")


def _validate_tag(tag: str) -> None:
    if not _TAG_RE.match(tag):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tag must be 1–64 lowercase alphanumeric characters or underscores",
        )


# ── Read endpoints (login only) ───────────────────────────────────────────────

@router.get("/assignments")
async def get_all_assignments(_: dict = Depends(get_current_user)):
    """All tag assignments as {user_id: [tag, ...]}. Login required."""
    return await db.get_all_tag_assignments()


@router.get("/user/{user_id}")
async def get_user_tags(user_id: str, _: dict = Depends(get_current_user)):
    """All tags assigned to a user. Login required."""
    return {"user_id": user_id, "tags": await db.get_user_tags(user_id)}


@router.get("/user/{user_id}/has/{tag}")
async def check_user_tag(user_id: str, tag: str, _: dict = Depends(get_current_user)):
    """Whether a user holds a specific tag. Login required."""
    _validate_tag(tag)
    return {"user_id": user_id, "tag": tag, "has_tag": await db.user_has_tag(user_id, tag)}


@router.get("/{tag}/users")
async def get_users_by_tag(tag: str, _: dict = Depends(get_current_user)):
    """Users (id + display_name) holding a tag. Login required."""
    _validate_tag(tag)
    return {"tag": tag, "users": await db.get_users_by_tag(tag)}


# ── Write endpoints (roster-access: Leads + Captains + Mentors) ───────────────

@router.post("/user/{user_id}/{tag}", status_code=status.HTTP_204_NO_CONTENT)
async def assign_tag(user_id: str, tag: str, actor: dict = Depends(_require_tag_editor)):
    """Assign a tag to a user. Requires roster access."""
    _validate_tag(tag)
    target = await db.get_user(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await db.add_user_tag(user_id, tag, assigned_by=actor["sub"])


@router.delete("/user/{user_id}/{tag}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_tag(user_id: str, tag: str, _: dict = Depends(_require_tag_editor)):
    """Remove a tag from a user. Requires roster access."""
    _validate_tag(tag)
    removed = await db.remove_user_tag(user_id, tag)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found on user")
