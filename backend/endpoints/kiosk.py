import asyncio
import json
import os
import secrets
import time
from typing import Literal

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field

import db
from core import qr_events
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
        secure=True,
        samesite="none",
        max_age=60 * 60 * 24 * 360,
        path="/",
    )
    return True


@router.post("/lookup_member")
async def lookup_member(
        body: VerifyCodeRequest,
        _: dict = Depends(require_verified_kiosk),
) -> dict:
    user = await db.get_user_by_offline_code(body.code)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    _assert_active_user(user)
    return {"name": user["display_name"] or user["given_name"] or "Unknown User"}


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


class QrCodeResponse(BaseModel):
    token: str
    url: str
    expires_in: int


class QrStatusRequest(BaseModel):
    tokens: list[str] = Field(max_length=10)


class QrStatusResult(BaseModel):
    token: str
    name: str
    status: Literal["checked_in", "checked_out"]


@router.post("/qr_code", response_model=QrCodeResponse)
async def qr_code(kiosk: dict = Depends(require_verified_kiosk)) -> QrCodeResponse:
    """Mint a short-lived one-time code for the kiosk to render as a QR."""
    token = secrets.token_urlsafe(16)
    await db.create_kiosk_qr_code(token, kiosk["id"])
    base = os.environ["FRONTEND_URL"].rstrip("/")
    return QrCodeResponse(
        token=token,
        url=f"{base}/checkin?t={token}",
        expires_in=int(db.QR_CODE_TTL.total_seconds()),
    )


@router.post("/qr_status", response_model=list[QrStatusResult])
async def qr_status(
        body: QrStatusRequest,
        kiosk: dict = Depends(require_verified_kiosk),
) -> list[QrStatusResult]:
    """Outcomes for any of the kiosk's recent codes that a phone has used."""
    if not body.tokens:
        return []
    rows = await db.list_kiosk_qr_results(kiosk["id"], body.tokens)
    return [
        QrStatusResult(
            token=r["token"],
            name=r["display_name"] or r["given_name"] or "Unknown User",
            status=r["result_status"],
        )
        for r in rows
        if r["result_status"] in ("checked_in", "checked_out")
    ]


SSE_PING_INTERVAL = 20.0  # Fly's proxy drops idle connections
SSE_DISCONNECT_POLL = 5.0


@router.get("/qr_events")
async def qr_events_stream(
        request: Request,
        kiosk: dict = Depends(require_verified_kiosk),
) -> StreamingResponse:
    """SSE: ``claimed`` event whenever one of this kiosk's QR tokens is used."""

    async def stream():
        async with qr_events.hub.subscribe(kiosk["id"]) as queue:
            yield "retry: 3000\n\n"
            last_send = time.monotonic()
            while True:
                if await request.is_disconnected():
                    break
                wait = min(SSE_DISCONNECT_POLL, max(0.0, SSE_PING_INTERVAL - (time.monotonic() - last_send)))
                try:
                    token = await asyncio.wait_for(queue.get(), timeout=wait)
                except asyncio.TimeoutError:
                    if time.monotonic() - last_send >= SSE_PING_INTERVAL:
                        yield ": ping\n\n"
                        last_send = time.monotonic()
                    continue
                yield f"event: claimed\ndata: {json.dumps({'token': token})}\n\n"
                last_send = time.monotonic()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/verify_logout")
async def verify_logout(response: Response) -> dict:
    response.delete_cookie(KIOSK_COOKIE_NAME, path="/")
    return {"ok": True}
