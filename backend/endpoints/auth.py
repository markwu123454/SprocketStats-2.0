import os
from datetime import datetime, timedelta, timezone

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from jose import ExpiredSignatureError, JWTError, jwt

import db

router = APIRouter()

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

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
            "iat": now,
            "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def get_current_user(session: str | None = Cookie(default=None)) -> dict:
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        return jwt.decode(session, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")


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
    # given_name comes from Google's userinfo, not stored in DB, so pull from token
    user_dict = dict(user)
    user_dict["given_name"] = user_info.get("given_name")
    session_jwt = _issue_jwt(user_dict)

    response = RedirectResponse(url=f"{FRONTEND_URL}/dashboard")
    response.set_cookie(
        key="session",
        value=session_jwt,
        httponly=True,
        secure=os.environ.get("ENV") == "production",
        samesite="lax",
        max_age=JWT_EXPIRE_MINUTES * 60,
        path="/",
    )
    return response


@router.post("/logout")
async def logout(_: dict = Depends(get_current_user)):
    response = JSONResponse({"ok": True})
    response.delete_cookie("session", path="/")
    return response


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {
        "id": user["sub"],
        "email": user["email"],
        "name": user.get("name"),
        "given_name": user.get("given_name"),
        "picture": user.get("picture"),
    }