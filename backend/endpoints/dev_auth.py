"""Development-only sign-in, for testing on a phone (or any device) without Google.

Google sign-in only redirects back to ``localhost`` or a registered domain, so a
phone reaching the dev server over the local network (``npm run dev:phone``, see
CONTRIBUTING.md) has no way to sign in. These routes let it pick any user in the
dev database and get the same session cookie a real sign-in would set.

They exist only when ``ENV=development``: ``endpoints/__init__.py`` mounts this
router only then, and every request checks again, so a deployed server
(``ENV=production``) has no such routes at all. Never run a deployed server with
``ENV=development``; that also opens CORS to every origin.
"""

import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import db
from core.permissions import get_perm, get_permissions_for_role, role_requires_approval
from core.security import issue_jwt, set_auth_cookie


def dev_mode_enabled() -> bool:
    """Whether this server runs in development (``ENV=development``)."""
    return os.environ.get("ENV") == "development"


def _require_dev_mode() -> None:
    # A second check at request time, in case the router is ever mounted by mistake.
    if not dev_mode_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


router = APIRouter(dependencies=[Depends(_require_dev_mode)])


def _status(row) -> str:
    """How signing in as this user will go, so a tester can pick on purpose."""
    if not row["role"]:
        return "not_onboarded"
    if row["banned_at"] is not None:
        return "banned"
    if role_requires_approval(row["role"]) and row["approved_by"] is None:
        return "pending"
    return "active"


@router.get("/users")
async def dev_users():
    """Every user in the dev database, with the role and how signing in as them will go.

    Banned, pending and not-yet-onboarded users are listed too, so those screens
    can be tested. Emails are left out; the name is enough to pick.
    """
    rows = await db.list_all_users()
    return [
        {
            "id": r["id"],
            "name": r["display_name"] or r["name"] or r["email"],
            "role": r["role"],
            "role_label": (get_perm(get_permissions_for_role(r["role"]), "label") or r["role"]) if r["role"] else None,
            "status": _status(r),
        }
        for r in rows
    ]


class DevLoginRequest(BaseModel):
    user_id: str


@router.post("/login")
async def dev_login(body: DevLoginRequest):
    """Sign in as ``user_id``: the session cookie a Google sign-in for them would set."""
    row = await db.get_user(body.user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    response = JSONResponse({"ok": True})
    set_auth_cookie(response, issue_jwt(dict(row)))
    return response
