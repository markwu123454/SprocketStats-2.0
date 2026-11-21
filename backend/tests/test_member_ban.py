"""``POST/DELETE /members/{id}/ban`` take effect on this machine at once.

No real database: the ban queries and ``db.get_user`` are monkeypatched, and
``account_state.assert_active`` is the real one, reading the in-memory cache, so
the test sees exactly what the next request from the banned member would.
"""

import asyncio
import time
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import db
from core import account_state
from core.security import get_current_user
from endpoints.members import router as members_router


def _row(uid: str, role: str, *, banned: bool = False) -> dict:
    return {"id": uid, "role": role, "approved_by": "captain-1", "onboarding_complete": True,
            "banned_at": datetime.now(timezone.utc) if banned else None}


@pytest.fixture
def client(monkeypatch):
    users = {"captain-1": _row("captain-1", "captain"), "member-1": _row("member-1", "cad_member")}

    async def get_user(uid):
        return users.get(uid)

    async def ban_user(uid):
        users[uid] = _row(uid, users[uid]["role"], banned=True)
        return users[uid]

    async def unban_user(uid):
        users[uid] = _row(uid, users[uid]["role"])
        return users[uid]

    monkeypatch.setattr(db, "get_user", get_user)
    monkeypatch.setattr(db, "ban_user", ban_user)
    monkeypatch.setattr(db, "unban_user", unban_user)
    # A cache loaded before the ban, and fresh, so only the write-through can change it.
    monkeypatch.setattr(account_state, "_state", {uid: dict(r) for uid, r in users.items()})
    monkeypatch.setattr(account_state, "_loaded_at", time.monotonic())

    app = FastAPI()
    app.include_router(members_router, prefix="/members")
    app.dependency_overrides[get_current_user] = lambda: {"sub": "captain-1", "role": "captain"}
    return TestClient(app)


def test_a_ban_blocks_the_member_on_their_next_request(client):
    assert client.post("/members/member-1/ban").status_code == 200

    with pytest.raises(HTTPException) as exc:
        asyncio.run(account_state.assert_active("member-1"))
    assert exc.value.detail == "Account banned"


def test_an_unban_lets_the_member_back_in_on_their_next_request(client):
    client.post("/members/member-1/ban")

    assert client.delete("/members/member-1/ban").status_code == 200

    asyncio.run(account_state.assert_active("member-1"))
