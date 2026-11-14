import asyncio
import json
import os
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field

import db
from core import member_codes, qr_events
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
    """Legacy token from the offline-code setup: names the person, not a kiosk."""
    return jwt.encode(
        {"sub": user_id, "purpose": KIOSK_TOKEN_PURPOSE},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def _issue_registered_kiosk_token(kiosk_id: str, authorized_by: str) -> str:
    """Token for a kiosk set up by scanning a member code: names the kiosk row."""
    return jwt.encode(
        {"sub": kiosk_id, "kind": "kiosk", "by": authorized_by, "purpose": KIOSK_TOKEN_PURPOSE},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def _set_kiosk_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=KIOSK_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=60 * 60 * 24 * 360,
        path="/",
    )


def _registered_kiosk_id(kiosk_auth: str | None) -> str | None:
    """The kiosk id in a registered-kiosk cookie, or None (no cookie, legacy, invalid)."""
    if not kiosk_auth:
        return None
    try:
        payload = jwt.decode(kiosk_auth, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None
    if payload.get("purpose") != KIOSK_TOKEN_PURPOSE or payload.get("kind") != "kiosk":
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) else None


def _display_name(user) -> str:
    return user["display_name"] or user["given_name"] or "Unknown User"


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

    sub = payload.get("sub")
    if payload.get("purpose") != KIOSK_TOKEN_PURPOSE or not isinstance(sub, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid kiosk authorization",
        )

    # Registered kiosks carry their own id; legacy tokens name the person who
    # typed their offline code. Either way the result is that person's user row
    # (old endpoints key off its "id"), plus the kiosk id when there is one.
    kiosk_id: str | None = None
    user_id = sub
    if payload.get("kind") == "kiosk":
        kiosk = await db.get_kiosk(sub)
        if kiosk is None or kiosk["revoked_at"] is not None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Kiosk deauthorized",
            )
        kiosk_id = sub
        user_id = kiosk["authorized_by"]

    user = await db.get_user(user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid kiosk authorization",
        )
    _assert_active_user(user)
    _assert_kiosk_role(user)
    if kiosk_id is not None:
        await db.touch_kiosk(kiosk_id)
    return {**dict(user), "kiosk_id": kiosk_id}


async def require_registered_kiosk(kiosk: dict = Depends(require_verified_kiosk)) -> dict:
    """A kiosk set up by scanning a code. Legacy offline-code kiosks must be set up again."""
    if not kiosk.get("kiosk_id"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Set this kiosk up again",
        )
    return kiosk


@router.post("/verify_code")
async def verify_code(body: VerifyCodeRequest, response: Response) -> bool:
    user = await db.get_user_by_offline_code(body.code)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid offline code")

    _assert_active_user(user)
    _assert_kiosk_role(user)
    _set_kiosk_cookie(response, _issue_kiosk_token(user["id"]))
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
async def verify_logout(response: Response, kiosk_auth: str | None = Cookie(default=None)) -> dict:
    kiosk_id = _registered_kiosk_id(kiosk_auth)
    if kiosk_id is not None:
        await db.revoke_kiosk(kiosk_id)
    response.delete_cookie(KIOSK_COOKIE_NAME, path="/")
    return {"ok": True}


# --- Member codes: the kiosk's camera reads a code on a member's phone ---------

# The same member read again this soon doesn't toggle again. The kiosk already
# treats one continuous appearance as one scan; this only backstops it.
SCAN_REPEAT_GUARD = timedelta(seconds=2)

AUTHORIZE_RATE_WINDOW = 60.0
AUTHORIZE_RATE_LIMIT = 20
_authorize_attempts: dict[str, deque] = defaultdict(deque)


class CodeScanRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    # Unix seconds when the kiosk's camera read the code, on a clock the kiosk
    # keeps corrected against GET /kiosk/clock.
    scanned_at: float
    # Made by the kiosk once per appearance of a phone, so a retry is answered
    # from the stored result instead of toggling again.
    scan_id: uuid.UUID


class CodeScanResponse(BaseModel):
    name: str
    first_name: str
    status: Literal["checked_in", "checked_out"]
    # True when the same member was just scanned and nothing changed.
    repeat: bool = False


def _first_name(user) -> str:
    return user["given_name"] or _display_name(user).split(" ")[0]


def _check_authorize_rate(request: Request) -> None:
    ip = request.headers.get("fly-client-ip") or (request.client.host if request.client else "unknown")
    now = time.monotonic()
    attempts = _authorize_attempts[ip]
    while attempts and now - attempts[0] > AUTHORIZE_RATE_WINDOW:
        attempts.popleft()
    if len(attempts) >= AUTHORIZE_RATE_LIMIT:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts. Wait a minute.")
    attempts.append(now)


async def _member_from_code(body: CodeScanRequest) -> dict:
    """Check a scanned code against the time the kiosk saw it; return the member."""
    if abs(time.time() - body.scanned_at) > member_codes.MAX_SCAN_SKEW_SECONDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kiosk clock is off. Restart the kiosk.")
    parsed = member_codes.parse(body.code)
    if parsed is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a SprocketStats code")
    user = await db.get_user_by_code_number(parsed.code_number)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    secret = member_codes.member_secret(user["id"], user["code_version"])
    if not member_codes.verify(parsed, secret, body.scanned_at):
        offset = member_codes.clock_offset(parsed, secret, body.scanned_at)
        if offset is None:
            detail = "Code not recognized"
        elif offset > 0:
            detail = f"Phone clock is {offset} s fast"
        else:
            detail = "Code expired. Scan again."
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
    return dict(user)


async def _stored_scan(stored) -> CodeScanResponse:
    if stored["result"] in ("checked_in", "checked_out"):
        result, repeat = stored["result"], False
    elif stored["result"] == "repeat":
        result, repeat = await db.kiosk_attendance_status(stored["user_id"]), True
    else:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan already in progress")
    return CodeScanResponse(name=_display_name(stored), first_name=_first_name(stored), status=result, repeat=repeat)


@router.get("/clock")
async def server_clock() -> dict:
    """The server's time, so kiosks and phones can correct their own clocks."""
    return {"server_time": time.time()}


@router.post("/authorize")
async def authorize_kiosk(body: CodeScanRequest, request: Request, response: Response) -> dict:
    """Set up a kiosk from a code shown by a member allowed to authorize kiosks."""
    _check_authorize_rate(request)
    user = await _member_from_code(body)
    _assert_active_user(user)
    name = _display_name(user)
    if user["role"] not in KIOSK_AUTHORIZED_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{name} can't authorize kiosks")
    kiosk_id = await db.create_kiosk(user["id"])
    _set_kiosk_cookie(response, _issue_registered_kiosk_token(kiosk_id, user["id"]))
    return {"kiosk_id": kiosk_id, "authorized_by": name}


@router.post("/scan", response_model=CodeScanResponse)
async def scan_code(
        body: CodeScanRequest,
        kiosk: dict = Depends(require_registered_kiosk),
) -> CodeScanResponse:
    """Check a member in or out from the code the kiosk's camera read."""
    stored = await db.get_kiosk_scan(body.scan_id)
    if stored is not None:
        return await _stored_scan(stored)

    user = await _member_from_code(body)
    _assert_active_user(user)
    scanned_at = datetime.fromtimestamp(body.scanned_at, tz=timezone.utc)
    if not await db.claim_kiosk_scan(body.scan_id, kiosk["kiosk_id"], user["id"], "code", scanned_at):
        stored = await db.get_kiosk_scan(body.scan_id)
        if stored is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan already in progress")
        return await _stored_scan(stored)

    name, first = _display_name(user), _first_name(user)
    if await db.member_scanned_recently(user["id"], body.scan_id, SCAN_REPEAT_GUARD):
        result = await db.kiosk_attendance_status(user["id"])
        await db.finish_kiosk_scan(body.scan_id, "repeat")
        return CodeScanResponse(name=name, first_name=first, status=result, repeat=True)

    result = await db.toggle_kiosk_attendance(user["id"], source="kiosk_code")
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    await db.finish_kiosk_scan(body.scan_id, result)
    return CodeScanResponse(name=name, first_name=first, status=result)
