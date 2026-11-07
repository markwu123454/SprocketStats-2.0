"""Tests for the per-device send path in db.push (``_send_one`` / ``send_web_push``).

``webpush`` itself is monkeypatched to a scripted fake, so nothing touches the
network; the prune / mark-failed DB helpers are swapped for recorders, and
``asyncio.sleep`` for one that just records the requested backoff -- so the
retry behavior is checked without the test actually waiting.
"""

import json
from email.utils import format_datetime
from datetime import datetime, timedelta, timezone

import pytest
from pywebpush import WebPushException

from db import push

DELIV = {"endpoint": "https://push.example/abc", "p256dh": "p", "auth": "a", "delivery_id": "d-1"}


class FakeResponse:
    def __init__(self, status_code: int, headers: dict | None = None):
        self.status_code = status_code
        self.headers = headers or {}


class Recorder:
    """Scripted webpush stand-in: each call pops the next outcome (None = success)."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls: list[dict] = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0) if self.outcomes else None
        if outcome is not None:
            raise WebPushException(f"Push failed: {outcome.status_code}", response=outcome)


@pytest.fixture
def env(monkeypatch):
    state = {"pruned": [], "failed": [], "sleeps": []}

    async def prune(endpoint):
        state["pruned"].append(endpoint)

    async def mark_failed(delivery_id):
        state["failed"].append(delivery_id)

    async def sleep(seconds):
        state["sleeps"].append(seconds)

    monkeypatch.setattr(push, "_prune_dead_endpoint", prune)
    monkeypatch.setattr(push, "_mark_delivery_failed", mark_failed)
    monkeypatch.setattr(push.asyncio, "sleep", sleep)
    monkeypatch.setattr(push, "VAPID_PRIVATE_KEY", "test-key")

    def use(recorder):
        monkeypatch.setattr(push, "webpush", recorder)
        return recorder

    state["use"] = use
    return state


async def test_send_sets_ttl_urgency_and_timeout(env):
    rec = env["use"](Recorder(None))
    await push._send_one(DELIV, "Title", "Body")

    assert len(rec.calls) == 1
    call = rec.calls[0]
    # pywebpush defaults ttl=0 ("drop unless the device is awake right now").
    assert call["ttl"] == push.PUSH_TTL_SECONDS > 0
    assert call["headers"] == {"Urgency": "high"}
    assert call["timeout"] == push.PUSH_REQUEST_TIMEOUT_SECONDS
    assert json.loads(call["data"]) == {"title": "Title", "body": "Body", "delivery_id": "d-1"}
    assert env["failed"] == []


async def test_payload_carries_url_and_tag_and_omits_missing_delivery_id(env):
    rec = env["use"](Recorder(None))
    untracked = {k: v for k, v in DELIV.items() if k != "delivery_id"}
    await push._send_one(untracked, "T", "B", url="/tasks", tag="task-1")

    assert json.loads(rec.calls[0]["data"]) == {"title": "T", "body": "B", "url": "/tasks", "tag": "task-1"}


async def test_retries_5xx_then_succeeds(env):
    rec = env["use"](Recorder(FakeResponse(503), None))
    await push._send_one(DELIV, "T", "B")

    assert len(rec.calls) == 2
    assert env["sleeps"] == [push.PUSH_RETRY_BASE_SECONDS]
    assert env["failed"] == []


async def test_gives_up_after_max_retries_and_marks_failed(env):
    rec = env["use"](Recorder(*[FakeResponse(500)] * (push.PUSH_MAX_RETRIES + 1)))
    await push._send_one(DELIV, "T", "B")

    assert len(rec.calls) == push.PUSH_MAX_RETRIES + 1
    # Exponential backoff between attempts.
    assert env["sleeps"] == [push.PUSH_RETRY_BASE_SECONDS * 2 ** i for i in range(push.PUSH_MAX_RETRIES)]
    assert env["failed"] == ["d-1"]
    assert env["pruned"] == []


async def test_429_honors_retry_after_seconds(env):
    env["use"](Recorder(FakeResponse(429, {"Retry-After": "7"}), None))
    await push._send_one(DELIV, "T", "B")
    assert env["sleeps"] == [7.0]


async def test_retry_after_http_date_is_parsed_and_capped(env):
    far = format_datetime(datetime.now(timezone.utc) + timedelta(hours=1), usegmt=True)
    env["use"](Recorder(FakeResponse(429, {"Retry-After": far}), None))
    await push._send_one(DELIV, "T", "B")
    assert env["sleeps"] == [push.PUSH_RETRY_AFTER_CAP_SECONDS]


async def test_garbage_retry_after_falls_back_to_backoff(env):
    env["use"](Recorder(FakeResponse(503, {"Retry-After": "soon-ish"}), None))
    await push._send_one(DELIV, "T", "B")
    assert env["sleeps"] == [push.PUSH_RETRY_BASE_SECONDS]


@pytest.mark.parametrize("status", [404, 410])
async def test_gone_endpoint_is_pruned_without_retry(env, status):
    rec = env["use"](Recorder(FakeResponse(status)))
    await push._send_one(DELIV, "T", "B")

    assert len(rec.calls) == 1
    assert env["pruned"] == [DELIV["endpoint"]]
    assert env["failed"] == ["d-1"]
    assert env["sleeps"] == []


async def test_other_4xx_is_not_retried(env):
    rec = env["use"](Recorder(FakeResponse(400)))
    await push._send_one(DELIV, "T", "B")

    assert len(rec.calls) == 1
    assert env["failed"] == ["d-1"]
    assert env["pruned"] == []


async def test_untracked_failure_does_not_mark_any_delivery(env):
    env["use"](Recorder(FakeResponse(400)))
    untracked = {k: v for k, v in DELIV.items() if k != "delivery_id"}
    await push._send_one(untracked, "T", "B")
    assert env["failed"] == []


async def test_send_web_push_is_a_noop_without_vapid_key(env, monkeypatch):
    rec = env["use"](Recorder(None))
    monkeypatch.setattr(push, "VAPID_PRIVATE_KEY", None)
    await push.send_web_push([DELIV], "T", "B")
    assert rec.calls == []
