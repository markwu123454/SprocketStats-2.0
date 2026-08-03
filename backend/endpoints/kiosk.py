import os
from typing import Literal

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from jose import JWTError, jwt
from pydantic import BaseModel, Field

import db
from core.permissions import role_requires_approval
from core.security import JWT_ALGORITHM, JWT_SECRET

router = APIRouter()

KIOSK_COOKIE_NAME = "kiosk_auth"
KIOSK_TOKEN_PURPOSE = "attendance_kiosk"
KIOSK_AUTHORIZED_ROLES = frozenset({"captain", "scouting_member", "scouting_lead"})


class VerifyCodeRequest(BaseModel):
    code: str = Field(min_length=1)


class VerifyIdRequest(BaseModel):
    id: str = Field(min_length=1)


class VerifyIdResponse(BaseModel):
    name: str
    status: Literal["checked_in", "checked_out"]


class VerifyCheckinCodeRequest(BaseModel):
    member_code: str = Field(min_length=1)
    admin_code: str = Field(min_length=1)


def _assert_active_user(user: dict) -> None:
    if not user["onboarding_complete"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Onboarding incomplete")
    if user["banned_at"] is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account banned")
    if role_requires_approval(user["role"]) and user["approved_by"] is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account pending approval")


def _assert_kiosk_role(user: dict) -> None:
    if user["role"] not in KIOSK_AUTHORIZED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User cannot authorize an attendance kiosk",
        )


def _issue_kiosk_token(user_id: str) -> str:
    return jwt.encode(
        {"sub": user_id, "purpose": KIOSK_TOKEN_PURPOSE},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


async def require_verified_kiosk(
    kiosk_auth: str | None = Cookie(default=None),
) -> dict:
    if kiosk_auth is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Kiosk verification required",
        )
    try:
        payload = jwt.decode(kiosk_auth, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid kiosk authorization",
        )

    user_id = payload.get("sub")
    if payload.get("purpose") != KIOSK_TOKEN_PURPOSE or not isinstance(user_id, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid kiosk authorization",
        )

    user = await db.get_user(user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid kiosk authorization",
        )
    _assert_active_user(user)
    _assert_kiosk_role(user)
    return user


@router.post("/verify_code")
async def verify_code(body: VerifyCodeRequest, response: Response) -> bool:
    user = await db.get_user_by_offline_code(body.code)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid offline code")

    _assert_active_user(user)
    _assert_kiosk_role(user)
    response.set_cookie(
        key=KIOSK_COOKIE_NAME,
        value=_issue_kiosk_token(user["id"]),
        httponly=True,
        secure=os.environ.get("ENV") == "production",
        samesite="lax",
        path="/",
    )
    return True


@router.post("/verify_id", response_model=VerifyIdResponse)
async def verify_id(
    body: VerifyIdRequest,
    _: dict = Depends(require_verified_kiosk),
) -> VerifyIdResponse:
    user = await db.get_user(body.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    _assert_active_user(user)

    attendance_status = await db.toggle_kiosk_attendance(body.id)
    if attendance_status is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    return VerifyIdResponse(
        name=user["display_name"] or user["given_name"] or "Unknown User",
        status=attendance_status,
    )


@router.post("/verify_checkin_code", response_model=VerifyIdResponse)
async def verify_checkin_code(
    body: VerifyCheckinCodeRequest,
    _: dict = Depends(require_verified_kiosk),
) -> VerifyIdResponse:
    admin = await db.get_user_by_offline_code(body.admin_code)
    if admin is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin code")
    _assert_active_user(admin)
    _assert_kiosk_role(admin)

    member = await db.get_user_by_offline_code(body.member_code)
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    _assert_active_user(member)

    attendance_status = await db.toggle_kiosk_attendance(member["id"])
    if attendance_status is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    return VerifyIdResponse(
        name=member["display_name"] or member["given_name"] or "Unknown User",
        status=attendance_status,
    )


@router.post("/verify_logout")
async def verify_logout(response: Response) -> dict:
    response.delete_cookie(KIOSK_COOKIE_NAME, path="/")
    return {"ok": True}
