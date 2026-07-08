import os
from datetime import datetime, timedelta, timezone

# noinspection PyUnresolvedReferences
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from jose import ExpiredSignatureError, JWTError, jwt
from pydantic import BaseModel, field_validator, model_validator

import db
from permissions import ROLE_DEFINITIONS, can, get_perm, get_permissions_for_role, role_catalog

router = APIRouter()

FRONTEND_URL = os.environ.get("FRONTEND_URL")
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

oauth = OAuth()
oauth.register(
    name="google",
    client_id=os.environ["GOOGLE_CLIENT_ID"],
    client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile", "prompt": "select_account"},
)


def _issue_jwt(user: dict) -> str:
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


def _set_auth_cookie(response, token: str):
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
    only — it does not enforce any role/permission. Use :func:`require_permission`
    to additionally gate an endpoint on a capability.

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


def require_permission(path: str):
    """Build a FastAPI dependency that enforces a capability on an endpoint.

    Returns a dependency which first authenticates via :func:`get_current_user`,
    resolves the user's policy from their role, and raises 403 unless the policy
    grants a truthy value at ``path``. Attach it to a route to gate access, e.g.::

        @router.get("", dependencies=[Depends(require_permission("labeling.view"))])

    or bind it as ``user: dict = Depends(require_permission("control_panel.view"))``
    to also receive the authenticated user. This covers boolean capability gating
    only; value/threshold checks (e.g. an export row cap) should be done inline in
    the handler with ``permissions.get_perm``.

    :param path: Dotted capability path the caller's role must be granted,
        e.g. ``"control_panel.view"``.
    :returns: A dependency callable returning the authenticated user dict.
    """
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        perms = get_permissions_for_role(user.get("role"))
        if not can(perms, path):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return dependency


@router.get("/login")
async def login(request: Request):
    redirect_uri = str(request.url_for("callback"))
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/callback", name="callback")
async def callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"OAuth error: {exc}")

    user_info = token.get("userinfo")
    if not user_info:
        raise HTTPException(status_code=400, detail="No userinfo in token response")

    user = await db.upsert_user(user_info)
    user_dict = dict(user)
    user_dict["given_name"] = user_info.get("given_name")
    session_jwt = _issue_jwt(user_dict)

    redirect_path = "/onboarding" if not user_dict.get("onboarding_complete") else "/dashboard"
    response = RedirectResponse(url=f"{FRONTEND_URL}{redirect_path}")
    _set_auth_cookie(response, session_jwt)
    return response


@router.post("/logout")
async def logout(_: dict = Depends(get_current_user)):
    response = JSONResponse({"ok": True})
    response.delete_cookie("auth_token", path="/")
    return response


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    """Return the current user's profile plus their resolved role policy.

    ``permissions`` is the full policy object for the user's role (access
    permissions + role attributes such as ``label`` and ``school_info``),
    derived fresh from the role on every call. The frontend reads it to gate UI
    without hardcoding any role rules. Deriving here (rather than baking the
    policy into the JWT) means a change to the policy map takes effect on the
    next request, without waiting for tokens to expire.

    :param user: The authenticated user's JWT claims.
    :returns: The user's profile fields and their ``permissions`` policy object.
    """
    return {
        "id": user["sub"],
        "email": user["email"],
        "name": user.get("name"),
        "given_name": user.get("given_name"),
        "picture": user.get("picture"),
        "display_name": user.get("display_name"),
        "role": user.get("role"),
        "grade": user.get("grade"),
        "team_year": user.get("team_year"),
        "onboarding_complete": user.get("onboarding_complete", False),
        "permissions": get_permissions_for_role(user.get("role")),
    }


@router.get("/roles")
async def roles(_: dict = Depends(get_current_user)):
    """Return the role catalog used by the onboarding role picker.

    During onboarding a user is authenticated but has not yet chosen a role, so
    ``/auth/me`` cannot supply the full list of selectable roles. This exposes
    that catalog (value, display label, and whether the role requires school
    info) from the backend's single source of truth. Authenticated but not
    permission-gated — any signed-in user may read it. The data only changes on
    deploy, so responses are safe to cache client-side.

    :param _: The authenticated user (enforces sign-in; value unused).
    :returns: A list of ``{"value", "label", "school_info_required"}`` entries.
    """
    return role_catalog()


class OnboardingRequest(BaseModel):
    display_name: str
    role: str
    grade: str | None = None
    team_year: str | None = None

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be empty")
        if len(v) > 64:
            raise ValueError("Name must be 64 characters or fewer")
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"Invalid role: {v}")
        return v

    @field_validator("grade")
    @classmethod
    def validate_grade(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_GRADES:
            raise ValueError(f"Invalid grade: {v}")
        return v

    @field_validator("team_year")
    @classmethod
    def validate_team_year(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_TEAM_YEARS:
            raise ValueError(f"Invalid team year: {v}")
        return v

    @model_validator(mode="after")
    def validate_school_info_required(self) -> "OnboardingRequest":
        if self.role not in ROLES_WITHOUT_SCHOOL_INFO:
            if not self.grade:
                raise ValueError("Grade is required for this role")
            if not self.team_year:
                raise ValueError("Team year is required for this role")
        return self


@router.post("/onboarding")
async def complete_onboarding(
    body: OnboardingRequest,
    user: dict = Depends(get_current_user),
):
    updated = await db.update_user_onboarding(user["sub"], body.display_name, body.role, body.grade, body.team_year)
    updated_dict = dict(updated)
    session_jwt = _issue_jwt(updated_dict)

    response = JSONResponse({"ok": True})
    _set_auth_cookie(response, session_jwt)
    return response
