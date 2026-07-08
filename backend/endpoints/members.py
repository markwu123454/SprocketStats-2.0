from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator

import db
from .auth import VALID_GRADES, VALID_ROLES, VALID_TEAM_YEARS, require_access

router = APIRouter()

# Both the read and the write must hold this capability (Captains + Mentors only).
require_members = require_access(permissions="control_panel.members")


@router.get("")
async def list_members(_: dict = Depends(require_members)):
    """Return the full member roster for the Control Panel Members page.

    This endpoint exposes every user's email (plus role/grade/year/names), so it
    is gated on ``control_panel.members`` — a capability only Captains and Mentors
    hold. The gate is the real enforcement: the frontend section visibility is
    only cosmetic. ``grade``/``team_year`` are null for roles without school info
    (mentor/alumni) and for anyone who hasn't finished onboarding.

    :param _: The authenticated, authorized user (enforces access; value unused).
    :returns: A list of member rows with id, email, name, display_name, role,
        grade, and team_year.
    """
    rows = await db.list_all_users()
    return [_row_to_member(r) for r in rows]


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
    _: dict = Depends(require_members),
):
    """Persist edits made in the Members roster grid.

    Accepts the list of rows the client changed and writes them in a single
    transaction (see ``db.update_users``). Same ``control_panel.members`` gate as
    the read, since editing everyone's role/profile is at least as privileged as
    viewing it.

    :param updates: The changed member rows (validated by :class:`MemberUpdate`).
    :param _: The authenticated, authorized user (enforces access; value unused).
    :returns: ``{"ok": True, "updated": <count>}``.
    """
    await db.update_users([u.model_dump() for u in updates])
    return {"ok": True, "updated": len(updates)}


def _row_to_member(r) -> dict:
    """Shape a DB user record into the member row the grid consumes."""
    return {
        "id": r["id"],
        "email": r["email"],
        "name": r["name"],
        "display_name": r["display_name"],
        "role": r["role"],
        "grade": r["grade"],
        "team_year": r["team_year"],
    }
