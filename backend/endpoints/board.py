"""The task board: the team's tasks on a TV in the shop, run from a tablet.

Setting it up: a lead, captain or mentor (anyone holding ``tasks.assign``)
holds their member code up to the board's camera. ``POST /board/authorize``
registers a kiosk row of kind ``board`` and answers with an httponly
``board_auth`` cookie. That is how an attendance kiosk is set up too, but the
board's cookie is a different cookie, and ``require_verified_kiosk`` refuses
board rows, so a board can never check anyone in or out.

Showing tasks needs only the board cookie. Photos that members hid stay
hidden, since a board has no viewer of its own.

Acting as yourself: a member who wants to change something identifies first,
and the board sends the token it gets back in the ``X-Board-Act`` header:

* ``POST /board/act/code``: they hold up their own code. The code proves who
  they are (it works with no signal on the phone), so they act with their
  role's full say over what the board offers.
* ``POST /board/act/email``: they type their email. Anyone can type anyone's
  email, so this only allows self-service: claim, join, leave, move a task
  they're on between to do, in progress and needs review, and add notes. It
  never carries a lead's authority, and reviewing needs a code.

Anyone at the board may turn it off (``POST /board/logout``); setting it up
again takes a lead's code.

Every change goes through the handlers in ``endpoints.tasks``, so the task
rules live in one place; this module only decides who is asking. Creating,
editing, assigning and deleting tasks stay on phones and computers.

Board and act tokens are signed with their own key (derived from
``JWT_SECRET``), so neither can ever pass as a sign-in session.
"""

import hashlib
import logging
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from jose import ExpiredSignatureError, JWTError, jwt
from pydantic import BaseModel, Field

import db
from core.permissions import (
    STUDENT_EMAIL_DOMAIN, can, get_perm, get_permissions_for_role, has_task_authority, role_requires_approval,
    task_buckets,
)
from core.security import JWT_ALGORITHM, JWT_SECRET

from . import tasks as task_endpoints
from .kiosk import CodeScanRequest, _assert_active_user, _check_authorize_rate, _display_name, _first_name, _member_from_code

logger = logging.getLogger(__name__)

router = APIRouter()

BOARD_COOKIE_NAME = "board_auth"
BOARD_TOKEN_PURPOSE = "task_board"
ACT_TOKEN_PURPOSE = "task_board_act"
# Backstop only: the board signs a member out itself after a short idle spell.
ACT_TTL = timedelta(minutes=5)
# Done tasks older than this drop off the board.
DONE_SHOWN_FOR = timedelta(days=7)

EMAIL_RATE_WINDOW = 60.0
EMAIL_RATE_LIMIT = 10
_email_attempts: dict[str, deque] = defaultdict(deque)

# Not JWT_SECRET itself: get_current_user accepts any token signed with that,
# and an email-level act token must never work as the member's own session.
_BOARD_KEY = hashlib.sha256(f"sprocket-task-board|{JWT_SECRET}".encode()).hexdigest()

Level = Literal["code", "email"]

# The board as a viewer: nobody, so every hidden photo stays hidden.
_NO_VIEWER: dict = {}


# --- Tokens -------------------------------------------------------------------

def _issue_board_token(kiosk_id: str) -> str:
    return jwt.encode({"sub": kiosk_id, "purpose": BOARD_TOKEN_PURPOSE}, _BOARD_KEY, algorithm=JWT_ALGORITHM)


def _board_id(board_auth: str | None) -> str | None:
    """The kiosk id in a board cookie, or None when there is no valid one."""
    if not board_auth:
        return None
    try:
        payload = jwt.decode(board_auth, _BOARD_KEY, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None
    sub = payload.get("sub")
    return sub if payload.get("purpose") == BOARD_TOKEN_PURPOSE and isinstance(sub, str) else None


def _issue_act_token(kiosk_id: str, user_id: str, level: Level) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": user_id, "board": kiosk_id, "level": level, "purpose": ACT_TOKEN_PURPOSE, "iat": now, "exp": now + ACT_TTL},
        _BOARD_KEY,
        algorithm=JWT_ALGORITHM,
    )


def _set_board_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=BOARD_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=60 * 60 * 24 * 360,
        path="/",
    )


# --- Who is asking --------------------------------------------------------------

def _is_active(user) -> bool:
    return (
        bool(user["onboarding_complete"])
        and user["banned_at"] is None
        and not (role_requires_approval(user["role"]) and user["approved_by"] is None)
    )


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


async def require_board(board_auth: str | None = Cookie(default=None)) -> dict:
    """The board this request comes from; 401 when it isn't set up (any more)."""
    kiosk_id = _board_id(board_auth)
    if kiosk_id is None:
        raise _unauthorized("Set up this board")
    kiosk = await db.get_kiosk(kiosk_id)
    if kiosk is None or kiosk["revoked_at"] is not None or kiosk.get("kind") != "board":
        raise _unauthorized("Board deauthorized")
    # Like an attendance kiosk, a board runs on the say-so of the member who set
    # it up, so it stops when they can no longer set one up.
    owner = await db.get_user(kiosk["authorized_by"])
    if owner is None or not _is_active(owner) or not has_task_authority(owner["role"]):
        raise _unauthorized("Set up this board again")
    await db.touch_kiosk(kiosk_id)
    return {"kiosk_id": kiosk_id, "bucket": kiosk["bucket"], "authorized_by_name": _display_name(owner)}


def _assert_can_participate(user) -> None:
    if not can(get_permissions_for_role(user["role"]), "tasks.participate"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{_display_name(user)} can't change tasks")


def _acting_user(user, level: Level) -> dict:
    """``user`` in the shape the task handlers take (the JWT claims they read)."""
    row = dict(user)
    return {
        "sub": row["id"],
        # A typed email proves nothing, so it never carries a lead's authority:
        # with no role the task handlers apply the rules for members.
        "role": row["role"] if level == "code" else None,
        "display_name": _display_name(row),
        "picture": None if row.get("hide_picture") else row.get("picture"),
        "level": level,
    }


async def require_board_member(
        board: dict = Depends(require_board),
        x_board_act: str | None = Header(default=None),
) -> dict:
    """The member acting on this board, from the ``X-Board-Act`` token."""
    if not x_board_act:
        raise _unauthorized("Show your code or enter your email first")
    try:
        payload = jwt.decode(x_board_act, _BOARD_KEY, algorithms=[JWT_ALGORITHM])
    except ExpiredSignatureError:
        raise _unauthorized("Signed out. Show your code or enter your email again.")
    except JWTError:
        raise _unauthorized("Show your code or enter your email first")
    level = payload.get("level")
    if (payload.get("purpose") != ACT_TOKEN_PURPOSE or payload.get("board") != board["kiosk_id"]
            or level not in ("code", "email") or not isinstance(payload.get("sub"), str)):
        raise _unauthorized("Show your code or enter your email first")

    # Read fresh every time, so a ban or role change applies at once.
    user = await db.get_user(payload["sub"])
    if user is None:
        raise _unauthorized("Show your code or enter your email first")
    _assert_active_user(user)
    _assert_can_participate(user)
    return {**_acting_user(user, level), "kiosk_id": board["kiosk_id"]}


def _log_action(member: dict, action: str, task_id: str) -> None:
    logger.info("board %s: %s (%s) %s task %s", member["kiosk_id"], member["sub"], member["level"], action, task_id)


# --- Setup ------------------------------------------------------------------------

class BoardInfo(BaseModel):
    kiosk_id: str
    # The subteam the board shows by default; None for every subteam.
    bucket: str | None
    authorized_by_name: str


@router.post("/authorize", response_model=BoardInfo)
async def authorize_board(body: CodeScanRequest, request: Request, response: Response) -> BoardInfo:
    """Set up a board from the code of a member who may assign tasks."""
    _check_authorize_rate(request)
    user = await _member_from_code(body)
    _assert_active_user(user)
    name = _display_name(user)
    if not has_task_authority(user["role"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{name} can't set up a task board. Ask a lead, captain or mentor.",
        )
    subteam = get_perm(get_permissions_for_role(user["role"]), "subteam")
    bucket = subteam if subteam in task_buckets() else None
    kiosk_id = await db.create_board(user["id"], bucket)
    _set_board_cookie(response, _issue_board_token(kiosk_id))
    return BoardInfo(kiosk_id=kiosk_id, bucket=bucket, authorized_by_name=name)


@router.get("", response_model=BoardInfo)
async def board_info(board: dict = Depends(require_board)) -> BoardInfo:
    return BoardInfo(**board)


@router.post("/logout")
async def logout_board(response: Response, board_auth: str | None = Cookie(default=None)) -> dict:
    """Turn this board off (deauthorize it) and forget its cookie.

    Anyone at the board may: it only takes the board off the TV, and setting
    it up again still needs a lead's code.
    """
    kiosk_id = _board_id(board_auth)
    if kiosk_id is not None:
        kiosk = await db.get_kiosk(kiosk_id)
        if kiosk is not None and kiosk.get("kind") == "board":
            await db.revoke_kiosk(kiosk_id)
            logger.info("board %s: turned off", kiosk_id)
    response.delete_cookie(BOARD_COOKIE_NAME, path="/", secure=True, httponly=True, samesite="none")
    return {"ok": True}


# --- Showing tasks ------------------------------------------------------------------

def _shown_on_board(task: dict, done_after: datetime) -> bool:
    return task["status"] != "done" or task["updated_at"] >= done_after


@router.get("/tasks")
async def board_tasks(_: dict = Depends(require_board)) -> list[dict]:
    """Every open task, plus those done in the last week."""
    done_after = datetime.now(timezone.utc) - DONE_SHOWN_FOR
    rows = await db.list_tasks()
    return [task_endpoints._row_to_task(r, _NO_VIEWER) for r in rows if _shown_on_board(r, done_after)]


@router.get("/tasks/{task_id}/notes")
async def board_notes(task_id: str, _: dict = Depends(require_board)) -> list[dict]:
    if await db.get_task(task_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    rows = await db.list_task_notes(task_id)
    return [task_endpoints._row_to_note(r, _NO_VIEWER) for r in rows]


# --- Acting as yourself ----------------------------------------------------------------

class ActResponse(BaseModel):
    token: str
    expires_in: int
    level: Level
    user_id: str
    name: str
    first_name: str
    picture: str | None
    # Their role's authority over tasks applies (code only), so the board can
    # offer moving tasks they aren't on and reviewing their own work.
    authority: bool


class EmailActRequest(BaseModel):
    # Just the part before the @ is enough for a student address.
    email: str = Field(min_length=1, max_length=254)


def _act(user, level: Level, kiosk_id: str) -> ActResponse:
    _assert_active_user(user)
    _assert_can_participate(user)
    acting = _acting_user(user, level)
    logger.info("board %s: %s identified by %s", kiosk_id, acting["sub"], level)
    return ActResponse(
        token=_issue_act_token(kiosk_id, acting["sub"], level),
        expires_in=int(ACT_TTL.total_seconds()),
        level=level,
        user_id=acting["sub"],
        name=acting["display_name"],
        first_name=_first_name(user),
        picture=acting["picture"],
        authority=level == "code" and has_task_authority(user["role"]),
    )


def _check_email_rate(kiosk_id: str) -> None:
    now = time.monotonic()
    attempts = _email_attempts[kiosk_id]
    while attempts and now - attempts[0] > EMAIL_RATE_WINDOW:
        attempts.popleft()
    if len(attempts) >= EMAIL_RATE_LIMIT:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many tries. Wait a minute.")
    attempts.append(now)


@router.post("/act/code", response_model=ActResponse)
async def act_with_code(body: CodeScanRequest, board: dict = Depends(require_board)) -> ActResponse:
    """Identify a member from the code they hold up to the board's camera."""
    user = await _member_from_code(body)
    return _act(user, "code", board["kiosk_id"])


@router.post("/act/email", response_model=ActResponse)
async def act_with_email(body: EmailActRequest, board: dict = Depends(require_board)) -> ActResponse:
    """Identify a member from the email they type, for self-service only."""
    _check_email_rate(board["kiosk_id"])
    email = body.email.strip().lower()
    if "@" not in email:
        email = f"{email}@{STUDENT_EMAIL_DOMAIN}"
    user = await db.get_user_by_email(email)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No member has that email")
    return _act(dict(user), "email", board["kiosk_id"])


# --- Changing tasks ------------------------------------------------------------------------

class StatusChange(BaseModel):
    status: Literal["todo", "doing", "review"]


@router.post("/tasks/{task_id}/claim")
async def claim_task(task_id: str, member: dict = Depends(require_board_member)) -> dict:
    _log_action(member, "claimed", task_id)
    return await task_endpoints.claim_task(task_id, user=member)


@router.post("/tasks/{task_id}/join")
async def join_task(task_id: str, member: dict = Depends(require_board_member)) -> dict:
    _log_action(member, "joined", task_id)
    return await task_endpoints.add_contributor(task_id, None, user=member)


@router.post("/tasks/{task_id}/leave")
async def leave_task(task_id: str, member: dict = Depends(require_board_member)) -> dict:
    _log_action(member, "left", task_id)
    return await task_endpoints.remove_contributor(task_id, "me", user=member)


@router.post("/tasks/{task_id}/status")
async def move_task(task_id: str, body: StatusChange, member: dict = Depends(require_board_member)) -> dict:
    """Move a task between to do, in progress and needs review."""
    if member["level"] == "email":
        existing = await db.get_task(task_id)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
        if not task_endpoints._is_on_task(member, existing):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Show your code to move a task you're not on",
            )
    _log_action(member, f"moved to {body.status}", task_id)
    return await task_endpoints.update_task(task_id, task_endpoints.TaskUpdate(status=body.status), user=member)


@router.post("/tasks/{task_id}/review")
async def review_task(task_id: str, member: dict = Depends(require_board_member)) -> dict:
    if member["level"] != "code":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Show your code to review a task")
    _log_action(member, "reviewed", task_id)
    return await task_endpoints.review_task(task_id, user=member)


@router.post("/tasks/{task_id}/notes")
async def add_note(task_id: str, body: task_endpoints.NoteCreate, member: dict = Depends(require_board_member)) -> dict:
    _log_action(member, "noted on", task_id)
    return await task_endpoints.create_note(task_id, body, user=member)
