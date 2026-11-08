"""QR claim notifications: in-memory hub, qr_checkin publishing, SSE endpoint."""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from core import qr_events
from core.security import require_active
from endpoints import kiosk as kiosk_mod
from endpoints.attendance import router as attendance_router
from endpoints.kiosk import require_verified_kiosk, router as kiosk_router


@pytest.fixture(autouse=True)
def memory_only(monkeypatch):
    monkeypatch.delenv(qr_events.DIRECT_DSN_ENV, raising=False)


async def test_hub_delivers_only_to_owning_kiosk():
    hub = qr_events.QrEventHub()
    async with hub.subscribe("k1") as q1, hub.subscribe("k2") as q2:
        await hub.publish("k1", "tok")
        assert await asyncio.wait_for(q1.get(), 1) == "tok"
        assert q2.empty()
    assert hub._subs == {}


async def test_hub_unsubscribes_on_exit_and_does_not_double_deliver():
    hub = qr_events.QrEventHub()
    async with hub.subscribe("k1") as q:
        await hub.publish("k1", "a")
        assert q.qsize() == 1
    assert hub._count() == 0 and hub._listener is None


async def test_publish_never_raises(monkeypatch):
    hub = qr_events.QrEventHub()
    monkeypatch.setenv(qr_events.DIRECT_DSN_ENV, "postgresql://x")

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(qr_events, "db_connection", boom)
    async with hub.subscribe("k1") as q:  # listener task will fail to connect; fine
        await hub.publish("k1", "tok")  # falls back to local delivery
        assert await asyncio.wait_for(q.get(), 1) == "tok"


def _app(kiosk_override=True):
    app = FastAPI()
    app.include_router(kiosk_router, prefix="/kiosk")
    app.include_router(attendance_router, prefix="/attendance")
    if kiosk_override:
        app.dependency_overrides[require_verified_kiosk] = lambda: {"id": "captain-1"}
    app.dependency_overrides[require_active] = lambda: {"sub": "m1", "role": "cad_member"}
    return app


def test_qr_checkin_publishes_claimed_event(monkeypatch):
    published = []

    async def publish(kiosk_id, token):
        published.append((kiosk_id, token))

    async def get_user(uid):
        return {"id": uid, "onboarding_complete": True, "display_name": "Ada", "given_name": None}

    async def claim(t, u):
        return True

    async def toggle(u):
        return "checked_in"

    async def set_result(t, s):
        return "captain-1"

    monkeypatch.setattr(db, "get_user", get_user)
    monkeypatch.setattr(db, "claim_kiosk_qr_code", claim)
    monkeypatch.setattr(db, "toggle_kiosk_attendance", toggle)
    monkeypatch.setattr(db, "set_kiosk_qr_result", set_result)
    monkeypatch.setattr(qr_events.hub, "publish", publish)

    resp = TestClient(_app()).post("/attendance/qr_checkin", json={"token": "abc"})
    assert resp.status_code == 200
    assert published == [("captain-1", "abc")]


def test_qr_events_requires_kiosk_auth():
    resp = TestClient(_app(kiosk_override=False)).get("/kiosk/qr_events")
    assert resp.status_code == 401


async def test_stream_emits_retry_claimed_and_ping(monkeypatch):
    monkeypatch.setattr(kiosk_mod, "SSE_PING_INTERVAL", 0.05)
    monkeypatch.setattr(kiosk_mod, "SSE_DISCONNECT_POLL", 0.05)

    class FakeRequest:
        disconnected = False

        async def is_disconnected(self):
            return self.disconnected

    req = FakeRequest()
    resp = await kiosk_mod.qr_events_stream(req, kiosk={"id": "captain-1"})
    assert resp.media_type == "text/event-stream"
    assert resp.headers["cache-control"] == "no-cache"
    assert resp.headers["x-accel-buffering"] == "no"

    it = resp.body_iterator
    assert await it.__anext__() == "retry: 3000\n\n"
    await qr_events.hub.publish("captain-1", "tok1")
    assert await asyncio.wait_for(it.__anext__(), 1) == 'event: claimed\ndata: {"token": "tok1"}\n\n'
    assert await asyncio.wait_for(it.__anext__(), 1) == ": ping\n\n"
    req.disconnected = True
    with pytest.raises(StopAsyncIteration):
        await asyncio.wait_for(it.__anext__(), 1)
    assert qr_events.hub._count() == 0
