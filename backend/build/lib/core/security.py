"""Request-time authentication and authorization: JWT session handling and the
FastAPI dependencies every protected route gates on.

Split out of the OAuth login/callback routes (``endpoints.auth``) so every other
endpoint module depends on this shared infra directly instead of importing
another routing module for its security layer.
"""

import os
from collections.abc import Callable, Iterable
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException, status
from jose import ExpiredSignatureError, JWTError, jwt

from core import account_state
from core.permissions import (
    ROLE_DEFINITIONS,
    can,
    get_perm,
    get_permissions_for_role,
)

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

# Derived from the single source of truth in permissions.ROLE_DEFINITIONS so the
# valid-role set and the school-info rule can never drift from the policy map.
VALID_ROLES = set(ROLE_DEFINITIONS.keys())
ROLES_WITHOUT_SCHOOL_INFO = {
    role for role, defn in ROLE_DEFINITIONS.items()
    if not get_perm(defn, "school_info.required")
}

VALID_GRADES = {"freshman", "sophomore", "junior", "senior"}
VALID_TEAM_YEARS = {"year_1", "year_2", "year_3", "year_4"}


def issue_jwt(user: dict) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": user["id"],
            "email": user["email"],
            "name": user.get("name"),
            "given_name": user.get("given_name"),
            "picture": user.get("picture"),
            "display_name": user.get("display_name"),
            "role": user.get("role"),
            "grade": user.get("grade"),
            "team_year": user.get("team_year"),
            "onboarding_complete": user.get("onboarding_complete", False),
            "iat": now,
            "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def set_auth_cookie(response, token: str):
    response.set_cookie(
        key="auth_token",
        value=token,
        httponly=True,
        secure=os.environ.get("ENV") == "production",
        samesite="lax",
        max_age=JWT_EXPIRE_MINUTES * 60,
        path="/",
    )


def get_current_user(auth_token: str | None = Cookie(default=None)) -> dict:
    """FastAPI dependency that authenticates the request from the JWT cookie.

    Decodes and validates the ``auth_token`` cookie and returns the JWT claims
    (which include ``sub``, ``email``, ``role``, ...). This checks *authentication*
    only — it does not enforce any role/permission. Use :func:`require_access`
    to additionally gate an endpoint on a role or capability.

    :param auth_token: The ``auth_token`` cookie value, injected by FastAPI.
    :returns: The decoded JWT claims dict for the current user.
    :raises HTTPException: 401 if the token is missing, expired, or invalid.
    """
    if not auth_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        return jwt.decode(auth_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")


async def require_active(user: dict = Depends(get_current_user)) -> dict:
    """Login gate that also rejects banned / pending-approval accounts.

    Equivalent to depending on :func:`get_current_user`, plus the ban/approval
    re-check that historically ran only at ``/auth/me`` -- so a banned or
    not-yet-approved user's still-valid cookie no longer authorises the endpoint.
    The check reads the in-memory ``account_state`` cache, so on the hot path it
    is a dict lookup rather than a DB round-trip. Use this for login-only routes
    that take an action; :func:`require_access` already layers this in for
    role/permission-gated routes.

    :param user: The authenticated user's JWT claims (injected).
    :returns: The same user dict, once confirmed active.
    :raises HTTPException: 401 if unauthenticated; 403 if banned or pending.
    """
    await account_state.assert_active(user["sub"])
    return user


def require_tag(tag: str) -> Callable[..., dict]:
    """Build a dependency that gates on the caller holding a specific tag.

    Tags are not embedded in the JWT, so this always hits the DB — the check
    reflects the current state even if the user's tags changed after login.
    Stacks login + ban/approval enforcement the same way :func:`require_access`
    does.

    :param tag: The tag slug the caller must hold.
    :returns: A dependency returning the authenticated user dict.
    :raises HTTPException: 401 if unauthenticated; 403 if banned, pending, or
        the tag is absent.
    """
    async def dependency(user: dict = Depends(get_current_user)) -> dict:
        await account_state.assert_active(user["sub"])
        import db as _db  # noqa: PLC0415 — lazy to break the core↔db import cycle
        if not await _db.user_has_tag(user["sub"], tag):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Tag '{tag}' required",
            )
        return user
    return dependency


def require_access(
    *,
    roles: str | Iterable[str] | None = None,
    permissions: str | Iterable[str] | None = None,
    permissions_mode: str = "all",
) -> Callable[..., dict]:
    """Build one FastAPI dependency that gates on login, role, and permissions.

    This is the general-purpose gate spanning all three access dimensions in a
    single dependency, so a route needs only one ``Depends`` no matter how it is
    restricted:

      * **login** — always enforced. The wrapped :func:`get_current_user` rejects
        an unauthenticated request with 401 before any role/permission check runs.
      * **role** — if ``roles`` is given, the caller's ``role`` claim must be one
        of them, else 403. Omit ``roles`` to allow any authenticated role.
      * **permissions** — if ``permissions`` is given, the caller's role policy
        must grant the capability path(s), else 403. Omit to skip capability
        checks. ``permissions_mode`` selects ``"all"`` (default — every path must
        be granted, AND) or ``"any"`` (at least one, OR).

    Passing neither ``roles`` nor ``permissions`` yields a pure login gate,
    equivalent to depending on :func:`get_current_user` directly. Single values
    may be passed as bare strings; multiple as any iterable of strings.

    Examples::

        # login only
        Depends(require_access())

        # login + must hold one of these roles
        Depends(require_access(roles={"captain", "mentor"}))

        # login + capability
        Depends(require_access(permissions="control_panel.view"))

        # login + role + must have ALL listed capabilities
        Depends(require_access(
            roles="scouting_lead",
            permissions=["control_panel.view", "control_panel.upcoming_event"],
        ))

    Role slugs are validated against :data:`VALID_ROLES` at construction time
    (i.e. on import), so a typo fails fast at startup rather than silently
    locking everyone out at request time. This gate covers boolean capability
    gating only; value/threshold checks (e.g. an export row cap) should still be
    done inline in the handler with ``permissions.get_perm``.

    :param roles: Allowed role slug(s). ``None`` means any authenticated role.
    :param permissions: Dotted capability path(s) the caller's role must be
        granted. ``None`` means no capability check.
    :param permissions_mode: ``"all"`` (default) requires every path; ``"any"``
        requires at least one.
    :returns: A dependency callable returning the authenticated user dict.
    :raises ValueError: If ``permissions_mode`` is invalid or a role slug is
        unknown (raised at construction time, not per request).
    """
    if permissions_mode not in ("all", "any"):
        raise ValueError(f"permissions_mode must be 'all' or 'any', got {permissions_mode!r}")

    allowed_roles: set[str] | None
    if roles is None:
        allowed_roles = None
    else:
        allowed_roles = {roles} if isinstance(roles, str) else set(roles)
        unknown = allowed_roles - VALID_ROLES
        if unknown:
            raise ValueError(f"Unknown role(s) in require_access: {sorted(unknown)}")

    if permissions is None:
        required_paths: list[str] = []
    elif isinstance(permissions, str):
        required_paths = [permissions]
    else:
        required_paths = list(permissions)

    check = all if permissions_mode == "all" else any

    async def dependency(user: dict = Depends(get_current_user)) -> dict:
        # Login is already enforced: get_current_user raised 401 if unauthenticated.
        # Then reject banned / pending-approval accounts (cache-backed, no DB on
        # the hot path) before any role/permission check.
        await account_state.assert_active(user["sub"])
        role = user.get("role")

        if allowed_roles is not None and role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role",
            )

        if required_paths:
            perms = get_permissions_for_role(role)
            if not check(can(perms, path) for path in required_paths):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Insufficient permissions",
                )

        return user

    return dependency
