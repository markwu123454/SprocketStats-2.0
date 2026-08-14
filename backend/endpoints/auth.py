import json
import logging
import os

# noinspection PyUnresolvedReferences
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, field_validator, model_validator

import db
from core import account_state
from core.permissions import get_permissions_for_role, role_catalog
from core.security import (
    ROLES_WITHOUT_SCHOOL_INFO,
    VALID_GRADES,
    VALID_ROLES,
    VALID_TEAM_YEARS,
    get_current_user,
    issue_jwt,
    require_active,
    set_auth_cookie,
)

logger = logging.getLogger(__name__)

router = APIRouter()

FRONTEND_URL = os.environ.get("FRONTEND_URL")

oauth = OAuth()
oauth.register(
    name="google",
    client_id=os.environ["GOOGLE_CLIENT_ID"],
    client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile", "prompt": "select_account"},
)


def _popup_close_html(*, ok: bool, fallback_path: str) -> HTMLResponse:
    """The page the OAuth popup lands on after Google redirects back.

    Hands the result to the window that opened the popup via ``postMessage``
    and closes itself, so the main app tab never navigates away (see
    ``signInWithGoogle`` in AuthProvider.ts). Falls back to a normal redirect
    of *this* window when there's no ``opener`` -- e.g. the popup got blocked
    and the browser fell back to a same-tab navigation, or ``/auth/login`` was
    opened directly rather than through the popup flow.
    """
    message = json.dumps({"source": "sprocket-auth", "ok": ok})
    target_origin = json.dumps(FRONTEND_URL)
    fallback_url = json.dumps(f"{FRONTEND_URL}{fallback_path}")
    html = f"""<!doctype html>
<html><body style="font-family:sans-serif;text-align:center;padding-top:3rem;color:#666">
<p>{"Signing you in&hellip;" if ok else "Sign-in failed. You can close this window."}</p>
<script>
(function() {{
    try {{
        if (window.opener) {{
            window.opener.postMessage({message}, {target_origin});
            window.close();
            return;
        }}
    }} catch (e) {{}}
    window.location.replace({fallback_url});
}})();
</script>
</body></html>"""
    return HTMLResponse(html)


@router.get("/login")
async def login(request: Request):
    redirect_uri = str(request.url_for("callback"))
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/login-url")
async def login_url(request: Request):
    """Pre-generate the Google OAuth URL without issuing a redirect.

    Stores state/nonce in the session exactly as /login would, so the callback
    validates correctly. The frontend pre-fetches this on login page mount and
    opens the popup directly to accounts.google.com, skipping the backend
    round-trip on click (~400ms saved).
    """
    redirect_uri = str(request.url_for("callback"))
    rv = await oauth.google.create_authorization_url(redirect_uri)
    await oauth.google.save_authorize_data(request, redirect_uri=redirect_uri, **rv)
    return {"url": rv["url"]}


@router.get("/callback", name="callback")
async def callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception:
        logger.warning("OAuth token exchange failed", exc_info=True)
        return _popup_close_html(ok=False, fallback_path="/")

    user_info = token.get("userinfo")
    if not user_info:
        logger.warning("OAuth callback had no userinfo in token response")
        return _popup_close_html(ok=False, fallback_path="/")

    user = await db.upsert_user(user_info)
    user_dict = dict(user)
    user_dict["given_name"] = user_info.get("given_name")
    session_jwt = issue_jwt(user_dict)

    redirect_path = "/onboarding" if not user_dict.get("onboarding_complete") else "/dashboard"
    response = _popup_close_html(ok=True, fallback_path=redirect_path)
    set_auth_cookie(response, session_jwt)
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

    Ban and approval are enforced here via :func:`account_state.assert_active`
    (the same cache-backed check every protected endpoint now runs), which raises
    a distinct 403 detail for "banned" vs "pending approval" so the login screen
    can tell them apart. Because the check reads a periodically-refreshed cache
    rather than the DB, a ban or approval change takes effect within the refresh
    interval fleet-wide, not necessarily on the very next request.

    :param user: The authenticated user's JWT claims.
    :returns: The user's profile fields and their ``permissions`` policy object.
    :raises HTTPException: 403 if the account has been banned or is pending approval.
    """
    await account_state.assert_active(user["sub"])

    pending = await db.get_pending_notifications_for_user(user["sub"], user.get("role"))
    # Not on the JWT (kept out of the signed, decodable-by-anyone-with-the-cookie
    # token since it's a standalone credential -- see endpoints.kiosk), so it's
    # fetched fresh here instead.
    row = await db.get_user(user["sub"])

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
        "offline_code": row["offline_code"] if row else None,
        "permissions": get_permissions_for_role(user.get("role")),
        "pending_notifications": [
            {
                "id": str(n["id"]),
                "title": n["title"],
                "body": n["body"],
                "link": n["link"],
                "hard_block": n["hard_block"],
                "response_options": n["response_options"],
                "response_mode": n["response_mode"],
            }
            for n in pending
        ],
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
    user: dict = Depends(require_active),
):
    updated = await db.update_user_onboarding(user["sub"], body.display_name, body.role, body.grade, body.team_year)
    updated_dict = dict(updated)
    session_jwt = issue_jwt(updated_dict)

    response = JSONResponse({"ok": True})
    set_auth_cookie(response, session_jwt)
    return response
