"""The outbox drain (core.push_notify.drain_outbox), with no database.

The claim/settle db calls and the single-attempt send are replaced by fakes,
so what's checked is the drain's bookkeeping: which rows are finished, which
are rescheduled and when, and that a retry is scheduled in-process.
"""

from datetime import datetime, timedelta, timezone

import pytest

import db
from core import push_notify


def _row(rid, attempts=1, expires_in=timedelta(hours=24), category="meeting_absence"):
    return {
        "id": rid, "category": category, "title": "T", "body": "B", "url": "/meetings", "tag": None,
        "attempts": attempts, "expires_at": datetime.now(timezone.utc) + expires_in,
        "endpoint": f"https://push.example/{rid}", "p256dh": "p", "auth": "a",
    }


@pytest.fixture
def outbox(monkeypatch):
    state = {"batches": [], "outcomes": {}, "settled": [], "scheduled": [], "claims": 0}

    async def claim(limit, lease):
        state["claims"] += 1
        return state["batches"].pop(0) if state["batches"] else []

    async def send(deliv, title, body, url=None, tag=None):
        rid = int(deliv["endpoint"].rsplit("/", 1)[1])
        return state["outcomes"].get(rid, (db.PUSH_SENT, None))

    async def settle(done, retry):
        state["settled"].append((sorted(done), dict(retry)))

    monkeypatch.setattr(push_notify, "VAPID_PRIVATE_KEY", "test-key")
    monkeypatch.setattr(db, "claim_due_pushes", claim)
    monkeypatch.setattr(db, "send_push_once", send)
    monkeypatch.setattr(db, "settle_pushes", settle)
    monkeypatch.setattr(push_notify, "_schedule_drain", lambda delay: state["scheduled"].append(delay))
    return state


async def test_sent_gone_and_rejected_rows_are_finished(outbox):
    outbox["batches"] = [[_row(1), _row(2), _row(3)]]
    outbox["outcomes"] = {2: (db.PUSH_GONE, None), 3: (db.PUSH_REJECTED, None)}
    assert await push_notify.drain_outbox() == 1
    assert outbox["settled"] == [([1, 2, 3], {})]
    assert outbox["scheduled"] == []


async def test_transient_failure_backs_off_and_schedules_a_retry(outbox):
    outbox["batches"] = [[_row(1, attempts=1), _row(2, attempts=3)]]
    outbox["outcomes"] = {1: (db.PUSH_RETRY, None), 2: (db.PUSH_RETRY, None)}
    assert await push_notify.drain_outbox() == 0
    base = push_notify.OUTBOX_RETRY_BASE_SECONDS
    assert outbox["settled"] == [([], {1: base, 2: base * 4})]
    assert outbox["scheduled"] == [base]


async def test_retry_after_longer_than_backoff_wins(outbox):
    outbox["batches"] = [[_row(1)]]
    outbox["outcomes"] = {1: (db.PUSH_RETRY, 300.0)}
    await push_notify.drain_outbox()
    assert outbox["settled"] == [([], {1: 300.0})]


async def test_backoff_is_capped():
    assert push_notify._outbox_retry_delay(50, None) == push_notify.OUTBOX_RETRY_MAX_SECONDS


async def test_row_that_would_expire_before_next_try_is_dropped(outbox):
    outbox["batches"] = [[_row(1, expires_in=timedelta(seconds=10))]]
    outbox["outcomes"] = {1: (db.PUSH_RETRY, None)}
    await push_notify.drain_outbox()
    assert outbox["settled"] == [([1], {})]
    assert outbox["scheduled"] == []


async def test_full_batch_claims_again(outbox, monkeypatch):
    monkeypatch.setattr(push_notify, "OUTBOX_BATCH_SIZE", 2)
    outbox["batches"] = [[_row(1), _row(2)], [_row(3)]]
    assert await push_notify.drain_outbox() == 3
    assert outbox["claims"] == 2


async def test_noop_without_vapid_key(outbox, monkeypatch):
    monkeypatch.setattr(push_notify, "VAPID_PRIVATE_KEY", None)
    outbox["batches"] = [[_row(1)]]
    assert await push_notify.drain_outbox() == 0
    assert outbox["claims"] == 0


async def test_claim_failure_is_swallowed(outbox, monkeypatch):
    async def broken(limit, lease):
        raise RuntimeError("db down")
    monkeypatch.setattr(db, "claim_due_pushes", broken)
    assert await push_notify.drain_outbox() == 0


async def test_queue_push_enqueues_and_kicks(monkeypatch):
    queued, kicks = [], []

    async def enqueue(push):
        queued.append(push)
        return 2

    monkeypatch.setattr(push_notify, "VAPID_PRIVATE_KEY", "test-key")
    monkeypatch.setattr(db, "enqueue_push", enqueue)
    monkeypatch.setattr(push_notify, "kick_outbox", lambda: kicks.append(1))
    await push_notify.queue_push(["u1"], "task_assigned", "New task", "Body", "/tasks", "t")
    [p] = queued
    assert p.user_ids == ["u1"] and p.category == "task_assigned"
    assert timedelta(hours=23) < p.expires_at - datetime.now(timezone.utc) <= push_notify.PUSH_EXPIRY
    assert kicks == [1]


async def test_queue_push_swallows_db_errors(monkeypatch):
    async def enqueue(push):
        raise RuntimeError("db down")

    monkeypatch.setattr(push_notify, "VAPID_PRIVATE_KEY", "test-key")
    monkeypatch.setattr(db, "enqueue_push", enqueue)
    await push_notify.queue_push(["u1"], "task_assigned", "T", "B")


async def test_schedule_drain_keeps_the_sooner_timer(monkeypatch):
    kicks = []
    monkeypatch.setattr(push_notify, "kick_outbox", lambda: kicks.append(1))
    push_notify._schedule_drain(60)
    first = push_notify._retry_timer
    push_notify._schedule_drain(120)  # later: ignored
    assert push_notify._retry_timer is first
    push_notify._schedule_drain(0.01)  # sooner: replaces
    assert push_notify._retry_timer is not first and first.cancelled()
    import asyncio
    await asyncio.sleep(0.05)
    assert kicks == [1] and push_notify._retry_timer is None
