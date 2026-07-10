"""In-memory cache of per-user account state (ban / approval), timer-refreshed.

Ban and approval change rarely and tolerate seconds of staleness, and the user
table is small (a few hundred rows), so having every request read its own
account state from the DB would be pure overhead. Instead each process keeps the
whole table in memory, primed at startup and reloaded periodically (wired in
``main.lifespan``). The refresh interval is also what propagates a ban/approval
change to the *other* server processes, so it doubles as cross-instance
coherence -- bounded, not instant, which is fine given how seldom bans happen.

There is deliberately no write-through on the mutation endpoints: the periodic
refresh makes every process eventually consistent by construction, so there is
no per-mutation cache bookkeeping to keep in sync (and no bug class from
forgetting it on a new mutation path).

Enforcement (``assert_active``) raises the same 403s ``/auth/me`` historically
raised, so hardening every endpoint on top of this is a dict lookup, not a DB
hit. The one endpoint that must not read the cache is the login flow itself,
which predates any user row.
"""

import logging

from fastapi import HTTPException, status

import db
from permissions import role_requires_approval

logger = logging.getLogger(__name__)

# user_id -> {"banned_at", "role", "approved_by", "onboarding_complete"}.
# Replaced wholesale by refresh(); never mutated in place, so readers always see
# a complete map.
_state: dict[str, dict] = {}


async def refresh() -> None:
    """Reload every user's account state into the cache.

    Builds the replacement dict fully before swapping the module global, so a
    concurrent reader never observes a half-populated map. Errors propagate: the
    startup call fails fast, and the background loop (see ``main``) logs and
    keeps the previous snapshot rather than crashing.
    """
    global _state
    rows = await db.load_all_account_state()
    _state = {
        r["id"]: {
            "banned_at": r["banned_at"],
            "role": r["role"],
            "approved_by": r["approved_by"],
            "onboarding_complete": r["onboarding_complete"],
        }
        for r in rows
    }
    logger.info("account_state refreshed: %d users", len(_state))


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
    ``permissions.can_edit_authored``), where a cache miss safely degrades to
    "no authority" (rank 0). Never hits the DB -- callers tolerate ``None``.
    """
    entry = _state.get(sub)
    return entry["role"] if entry else None
