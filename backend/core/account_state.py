"""In-memory cache of per-user account state (ban / approval / role).

Ban and approval change rarely, and the user table is small (a few hundred
rows), so having every request read its own account state from the DB would be
pure overhead. Instead each process keeps the whole table in memory.

Keeping it current across server processes (Fly runs more than one machine):

* **On demand, at most ``MAX_AGE_SECONDS`` old.** The first request to find the
  copy older than that reloads it (one reload at a time, shared by every request
  waiting on it), so a ban made on another machine reaches this one within
  ``MAX_AGE_SECONDS`` of its next request. An idle process makes no queries at
  all, so Neon can still scale to zero; a timer would either keep it awake or
  back off for hours.
* **Written through on this process.** The member endpoints call :func:`apply`
  after a ban, unban, approval or role change, so the machine that made the
  change enforces it on the very next request. Another process catches up on its
  next reload; a new mutation path that forgets :func:`apply` is still bounded by
  the same ``MAX_AGE_SECONDS``.

Enforcement (``assert_active``) raises the same 403s ``/auth/me`` historically
raised, so hardening every endpoint on top of this is a dict lookup, not a DB
hit. The one endpoint that must not read the cache is the login flow itself,
which predates any user row.
"""

import asyncio
import logging
import time

from fastapi import HTTPException, status

import db
from core.permissions import role_requires_approval

logger = logging.getLogger(__name__)

# How old the cache may be before a request reloads it: the longest a ban,
# unban, approval or role change made on another process goes unnoticed here.
MAX_AGE_SECONDS = 30
# After a failed reload, how long to keep serving the previous copy before trying again.
RETRY_AFTER_FAILURE_SECONDS = 5

_FIELDS = ("banned_at", "role", "approved_by", "onboarding_complete")

# user_id -> {"banned_at", "role", "approved_by", "onboarding_complete"}.
# Replaced wholesale, never mutated in place, so readers always see a complete map.
_state: dict[str, dict] = {}
# time.monotonic() of the last successful reload (or, after a failure, the time
# that makes the next attempt wait RETRY_AFTER_FAILURE_SECONDS).
_loaded_at: float = float("-inf")
_reload: asyncio.Task | None = None


async def refresh() -> None:
    """Reload every user's account state into the cache.

    Builds the replacement dict fully before swapping the module global, so a
    concurrent reader never observes a half-populated map. Errors propagate: the
    startup call fails fast; :func:`_ensure_fresh` logs them and keeps the
    previous snapshot.
    """
    global _state, _loaded_at
    rows = await db.load_all_account_state()
    _state = {r["id"]: {f: r[f] for f in _FIELDS} for r in rows}
    _loaded_at = time.monotonic()


async def _reload_logged() -> None:
    global _loaded_at
    try:
        await refresh()
    except Exception as e:
        logger.error("account_state refresh failed, keeping previous snapshot: %s", e)
        _loaded_at = time.monotonic() - MAX_AGE_SECONDS + RETRY_AFTER_FAILURE_SECONDS


async def _ensure_fresh() -> None:
    """Reload the cache if it's older than MAX_AGE_SECONDS, sharing one reload between callers."""
    global _reload
    if time.monotonic() - _loaded_at < MAX_AGE_SECONDS:
        return
    if _reload is None or _reload.done():
        _reload = asyncio.create_task(_reload_logged())
    # shield: one caller's request being cancelled mustn't cancel the reload the others wait on.
    await asyncio.shield(_reload)


def apply(user_id: str, row) -> None:
    """Write a member's new account state through to this process's cache.

    Call after any change to ``banned_at``, ``role``, ``approved_by`` or
    ``onboarding_complete``, with the updated users row (or a mapping holding
    at least those fields), so this process enforces it at once.
    """
    global _state
    _state = {**_state, user_id: {f: row[f] for f in _FIELDS}}


def _assert_entry_active(entry: dict) -> None:
    """Raise the ban/approval 403s for a single resolved state entry."""
    if entry["banned_at"] is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account banned")
    if (
        entry["onboarding_complete"]
        and role_requires_approval(entry["role"])
        and entry["approved_by"] is None
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account pending approval")


async def assert_active(sub: str) -> None:
    """Raise 403 if user ``sub`` is banned or pending approval; return otherwise.

    Reads the in-memory cache (no DB) on the hot path. A ``sub`` absent from the
    cache -- a user created since the last refresh, e.g. mid-onboarding -- falls
    back to a single authoritative DB read, so a cache miss fails safe rather
    than open. A valid session whose user row no longer exists is denied.

    :param sub: The authenticated user id (JWT ``sub`` claim).
    :raises HTTPException: 403 if banned, pending approval, or the row is gone.
    """
    await _ensure_fresh()
    entry = _state.get(sub)
    if entry is None:
        row = await db.get_user(sub)
        if row is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account not found")
        entry = {
            "banned_at": row["banned_at"],
            "role": row["role"],
            "approved_by": row["approved_by"],
            "onboarding_complete": row["onboarding_complete"],
        }
    _assert_entry_active(entry)


def role_of(sub: str) -> str | None:
    """Return the cached role for ``sub``, or ``None`` if not in the cache.

    Used for coarse content-authority comparisons (see
    ``core.permissions.can_edit_authored``), where a cache miss safely degrades to
    "no authority" (rank 0). Never hits the DB -- callers tolerate ``None``.
    """
    entry = _state.get(sub)
    return entry["role"] if entry else None
