"""How the ban/approval cache stays current across server processes.

No real database: ``db.load_all_account_state`` is monkeypatched to an in-memory
table, and the cache's clock is moved by rewriting ``_loaded_at``.
"""

import asyncio
import time
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import db
from core import account_state


def _row(uid: str, *, banned: bool = False) -> dict:
    return {
        "id": uid,
        "banned_at": datetime.now(timezone.utc) if banned else None,
        "role": "cad_member",
        "approved_by": None,
        "onboarding_complete": True,
    }


@pytest.fixture
def table(monkeypatch):
    """The users table the cache reloads from, and how many times it reloaded."""
    rows = {"m1": _row("m1")}
    loads = {"count": 0}

    async def load_all_account_state():
        loads["count"] += 1
        return list(rows.values())

    monkeypatch.setattr(db, "load_all_account_state", load_all_account_state)
    monkeypatch.setattr(account_state, "_state", {})
    monkeypatch.setattr(account_state, "_reload", None)
    asyncio.run(account_state.refresh())
    loads["count"] = 0
    return rows, loads


def _age_cache(seconds: float) -> None:
    account_state._loaded_at = time.monotonic() - seconds


def test_a_fresh_cache_is_not_reloaded(table):
    rows, loads = table
    rows["m1"] = _row("m1", banned=True)  # banned on another machine

    asyncio.run(account_state.assert_active("m1"))  # still allowed: cache is fresh

    assert loads["count"] == 0


def test_a_ban_from_another_machine_applies_once_the_cache_is_stale(table):
    rows, loads = table
    rows["m1"] = _row("m1", banned=True)
    _age_cache(account_state.MAX_AGE_SECONDS + 1)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(account_state.assert_active("m1"))

    assert exc.value.detail == "Account banned"
    assert loads["count"] == 1


def test_concurrent_requests_share_one_reload(table):
    _rows, loads = table
    _age_cache(account_state.MAX_AGE_SECONDS + 1)

    async def many():
        await asyncio.gather(*(account_state.assert_active("m1") for _ in range(10)))

    asyncio.run(many())

    assert loads["count"] == 1


def test_a_failed_reload_keeps_the_previous_copy_and_retries_soon(table, monkeypatch):
    _rows, _loads = table
    _age_cache(account_state.MAX_AGE_SECONDS + 1)

    async def broken():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(db, "load_all_account_state", broken)

    asyncio.run(account_state.assert_active("m1"))  # served from the previous copy

    age = time.monotonic() - account_state._loaded_at
    retry_in = account_state.MAX_AGE_SECONDS - age
    assert 0 < retry_in <= account_state.RETRY_AFTER_FAILURE_SECONDS


def test_apply_enforces_a_ban_on_this_machine_at_once(table):
    _rows, loads = table

    account_state.apply("m1", _row("m1", banned=True))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(account_state.assert_active("m1"))
    assert exc.value.detail == "Account banned"
    assert loads["count"] == 0


def test_apply_lifts_a_ban_on_this_machine_at_once(table):
    account_state.apply("m1", _row("m1", banned=True))
    account_state.apply("m1", _row("m1"))

    asyncio.run(account_state.assert_active("m1"))
