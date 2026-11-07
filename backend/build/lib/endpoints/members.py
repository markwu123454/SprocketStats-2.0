from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

import db
from core import account_state
from core.permissions import can, can_role_moderate, get_permissions_for_role, has_moderation_authority
from core.security import VALID_GRADES, VALID_ROLES, VALID_TEAM_YEARS, get_current_user

router = APIRouter()

async def require_roster_access(user: dict = Depends(get_current_user)) -> dict:
    """Gate the roster, profile edits, and the moderation (approve/ban) actions.

    Admits anyone who can either fully manage members (``control_panel.members``,
    i.e. Captains/Mentors/Scouting Lead) or moderate at least someone (Leads,
    via their ``can_moderate`` spec). This only decides who may reach the roster at all —
    the per-target scope (who may approve/ban/edit whom) is enforced separately in
    each handler through :func:`_authorize_moderation` / :func:`_authorize_edits`.
    Leads get the full roster read (Mentor emails are masked for everyone — see
    :func:`list_members`) but may only edit their own subteam's members, and not
    their role.

    Unlike the capability-gated routes (which flow through ``require_access``),
    this guard is built directly on ``get_current_user``, so it re-checks
    ban/approval itself via ``account_state.assert_active`` — otherwise a banned
    or pending-approval Captain/Lead could still moderate.
    """
    await account_state.assert_active(user["sub"])
    role = user.get("role")
    if can(get_permissions_for_role(role), "control_panel.members") or has_moderation_authority(role):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")


async def _authorize_moderation(actor: dict, user_id: str, *, self_error: str | None = None) -> None:
    """Ensure ``actor`` may moderate the target ``user_id``, else raise.

    Enforces the shared approve/ban scope (:func:`permissions.can_role_moderate`)
    against the target's *current* role, and optionally forbids acting on oneself.
    Captains/Mentors clear any target; a Lead only clears their own subteam's
    members and alumni. Raises 400 (self), 404 (no such member), or 403 (out of
    scope). This authorises the *action*; it deliberately does not check whether
    ``actor`` is themselves approved (that stays a ``/auth/me``-only concern).
    """
    if self_error is not None and user_id == actor["sub"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=self_error)
    target = await db.get_user(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    if not can_role_moderate(actor.get("role"), target["role"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This member is outside your moderation scope",
        )


@router.get("")
async def list_members(user: dict = Depends(require_roster_access)):
    """Return the full member roster for the Control Panel Members page.

    This endpoint exposes every user's email (plus role/grade/year/names). It is
    gated on :func:`require_roster_access` — Captains, Mentors and the Scouting
    Lead (who fully manage members) plus Leads (who moderate their own subteam).
    All of them see the whole roster; scope only limits *which rows they can act on*, enforced per action.
    The gate is the real enforcement; frontend section visibility is cosmetic.
    ``grade``/``team_year`` are null for roles without school info (mentor/alumni)
    and for anyone who hasn't finished onboarding.

    One exception: a Mentor's email is always masked (``null``), whoever is
    viewing — Captains and Mentors included. Mentors are often adult volunteers
    reachable at a personal (non-org) address, so it isn't shared through the app.

    :param user: The authenticated, authorized user (enforces access; value unused).
    :returns: A list of member rows with id, email, name, display_name, role,
        grade, and team_year.
    """
    rows = await db.list_all_users()
    return [_row_to_member(r, mask_email=r["role"] == "mentor") for r in rows]


async def _authorize_edits(actor: dict, updates: list["MemberUpdate"]) -> None:
    """Ensure ``actor`` may apply every profile edit in ``updates``, else raise.

    Holders of ``control_panel.members`` (Captains, Mentors, Scouting Lead) may
    edit anyone, role included. Everyone else — Leads — may only edit members in
    their moderation scope (:func:`permissions.can_role_moderate`: their own
    subteam's members and alumni), and may change their names, grade and team
    year but never their role. The check covers the whole batch up front, so one
    disallowed row rejects the Save before anything is written. Raises 404 (no
    such member) or 403.
    """
    role = actor.get("role")
    if can(get_permissions_for_role(role), "control_panel.members"):
        return
    current = {r["id"]: r["role"] for r in await db.list_all_users()}
    for u in updates:
        if u.id not in current:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
        if not can_role_moderate(role, current[u.id]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This member is outside your editing scope",
            )
        if u.role != current[u.id]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can't change a member's role",
            )


class MemberUpdate(BaseModel):
    """One editable member row coming back from the roster grid.

    Email is deliberately absent — it's the OAuth identity and is read-only in the
    UI, so it can never be changed through this surface. Text fields are trimmed
    and empty-to-null normalised; role/grade/team_year are validated against the
    same canonical sets used at onboarding so the roster can't introduce values
    onboarding would reject.
    """

    id: str
    name: str | None = None
    display_name: str | None = None
    role: str | None = None
    grade: str | None = None
    team_year: str | None = None

    @field_validator("name", "display_name")
    @classmethod
    def _clean_text(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) > 64:
            raise ValueError("Name must be 64 characters or fewer")
        return v

    @field_validator("role")
    @classmethod
    def _validate_role(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_ROLES:
            raise ValueError(f"Invalid role: {v}")
        return v

    @field_validator("grade")
    @classmethod
    def _validate_grade(cls, v: str | None) -> str | None:
        if not v:
            return None
        if v not in VALID_GRADES:
            raise ValueError(f"Invalid grade: {v}")
        return v

    @field_validator("team_year")
    @classmethod
    def _validate_team_year(cls, v: str | None) -> str | None:
        if not v:
            return None
        if v not in VALID_TEAM_YEARS:
            raise ValueError(f"Invalid team year: {v}")
        return v


@router.put("")
async def update_members(
    updates: list[MemberUpdate],
    user: dict = Depends(require_roster_access),
):
    """Persist edits made in the Members roster grid.

    Accepts the list of rows the client changed and writes them in a single
    transaction (see ``db.update_users``). Captains, Mentors and the Scouting Lead
    may edit anyone; Leads only their own subteam's members and alumni, and not
    their role (see :func:`_authorize_edits`).

    :param updates: The changed member rows (validated by :class:`MemberUpdate`).
    :param user: The authenticated editor (scope is checked per row).
    :returns: ``{"ok": True, "updated": <count>}``.
    """
    await _authorize_edits(user, updates)
    await db.update_users([u.model_dump() for u in updates])
    return {"ok": True, "updated": len(updates)}


@router.post("/{user_id}/approve")
async def approve_member(user_id: str, user: dict = Depends(require_roster_access)):
    """Sign off on a member's identity and self-selected role.

    The approver is taken from the authenticated session (never the request
    body), so approval can't be forged as someone else. A member can't approve
    themselves, and the target must be within the approver's moderation scope
    (Captains/Mentors: anyone; Leads: their own subteam's members + alumni).

    :param user_id: The member being approved.
    :param user: The authenticated approver.
    :returns: ``{"id", "approved_by"}``.
    """
    await _authorize_moderation(user, user_id, self_error="You cannot approve yourself")
    row = await db.approve_user(user_id, user["sub"])
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return {"id": row["id"], "approved_by": row["approved_by"]}


@router.delete("/{user_id}/approve")
async def unapprove_member(user_id: str, user: dict = Depends(require_roster_access)):
    """Clear a member's approval.

    Same moderation scope as approving — a Lead can only unapprove within their
    own subteam.

    :param user_id: The member to unapprove.
    :param user: The authenticated user (must have the target in scope).
    :returns: ``{"id", "approved_by"}`` (``approved_by`` is always ``None``).
    """
    await _authorize_moderation(user, user_id)
    row = await db.unapprove_user(user_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return {"id": row["id"], "approved_by": row["approved_by"]}


@router.post("/{user_id}/ban")
async def ban_member(user_id: str, user: dict = Depends(require_roster_access)):
    """Soft-ban a member: their row and role stay intact, only ``banned_at`` is set.

    Enforcement happens in ``/auth/me`` (the only endpoint that re-checks the DB
    on every call), so an already-open session isn't cut off mid-request; the ban
    takes effect the next time the client re-fetches the current user. A member
    can't ban themselves, and the target must be within the actor's moderation
    scope (same rule as approving).

    :param user_id: The member being banned.
    :param user: The authenticated actor.
    :returns: ``{"id", "banned_at"}``.
    """
    await _authorize_moderation(user, user_id, self_error="You cannot ban yourself")
    row = await db.ban_user(user_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return {"id": row["id"], "banned_at": row["banned_at"].isoformat() if row["banned_at"] else None}


@router.delete("/{user_id}/ban")
async def unban_member(user_id: str, user: dict = Depends(require_roster_access)):
    """Lift a member's ban.

    Same moderation scope as banning.

    :param user_id: The member to unban.
    :param user: The authenticated actor (must have the target in scope).
    :returns: ``{"id", "banned_at"}`` (``banned_at`` is always ``None``).
    """
    await _authorize_moderation(user, user_id)
    row = await db.unban_user(user_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return {"id": row["id"], "banned_at": None}


def _row_to_member(r, *, mask_email: bool = False) -> dict:
    """Shape a DB user record into the member row the grid consumes.

    :param mask_email: When true, return ``None`` for email instead of the real
        address (used to hide every Mentor's email).
    """
    return {
        "id": r["id"],
        "email": None if mask_email else r["email"],
        "name": r["name"],
        "display_name": r["display_name"],
        "role": r["role"],
        "grade": r["grade"],
        "team_year": r["team_year"],
        "approved_by": r["approved_by"],
        "banned_at": r["banned_at"].isoformat() if r["banned_at"] else None,
    }
