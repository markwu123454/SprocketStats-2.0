"""Fan-out of "QR code claimed" notifications to connected kiosks (SSE).

Single machine: an in-memory hub with one ``asyncio.Queue`` per subscriber.

Multi-machine: when ``DATABASE_URL_DIRECT`` (a direct, non-pooled Neon
connection string; pgbouncer does not support LISTEN) is set, events are
published with ``pg_notify`` and every machine LISTENs on a dedicated
connection that feeds its local hub. That connection is held open only while
this process has at least one subscriber, so Neon can still scale to zero.

When LISTEN is configured, local delivery happens *only* through the LISTEN
callback (never also in-memory), so there is no double delivery. If
``pg_notify`` itself fails, publish falls back to in-memory delivery.
"""

import asyncio
import json
import logging
import os
import ssl
from contextlib import asynccontextmanager

import asyncpg
import certifi

from db.connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)

CHANNEL = "qr_events"
DIRECT_DSN_ENV = "DATABASE_URL_DIRECT"
QUEUE_MAXSIZE = 100
RECONNECT_DELAYS = (1, 2, 5, 10, 30)


def _direct_dsn() -> str | None:
    return os.getenv(DIRECT_DSN_ENV) or None


class QrEventHub:
    def __init__(self) -> None:
        # kiosk id -> queues of that kiosk's SSE connections on this machine
        self._subs: dict[str, set[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()
        self._listener: asyncio.Task | None = None

    def _count(self) -> int:
        return sum(len(s) for s in self._subs.values())

    # -- local delivery ------------------------------------------------------
    def deliver_local(self, kiosk_id: str | None, token: str) -> None:
        """Hand an event to local subscribers. ``kiosk_id`` None broadcasts."""
        targets = self._subs.values() if kiosk_id is None else [self._subs.get(kiosk_id, ())]
        for queues in targets:
            for q in list(queues):
                try:
                    q.put_nowait(token)
                except asyncio.QueueFull:
                    logger.warning("qr_events subscriber queue full; dropping event")

    # -- subscription --------------------------------------------------------
    @asynccontextmanager
    async def subscribe(self, kiosk_id: str):
        q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        async with self._lock:
            self._subs.setdefault(kiosk_id, set()).add(q)
            if _direct_dsn() and self._listener is None:
                self._listener = asyncio.create_task(self._listen_loop())
        try:
            yield q
        finally:
            listener = None
            async with self._lock:
                queues = self._subs.get(kiosk_id)
                if queues is not None:
                    queues.discard(q)
                    if not queues:
                        del self._subs[kiosk_id]
                if not self._subs and self._listener is not None:
                    listener, self._listener = self._listener, None
            if listener is not None:
                listener.cancel()
                try:
                    await listener
                except (asyncio.CancelledError, Exception):
                    pass

    # -- publishing ----------------------------------------------------------
    async def publish(self, kiosk_id: str | None, token: str) -> None:
        """Announce a claimed token. Never raises."""
        try:
            if _direct_dsn():
                payload = json.dumps({"kiosk": kiosk_id, "token": token})
                try:
                    async with db_connection(DB_NAME) as conn:
                        await conn.execute("SELECT pg_notify($1, $2)", CHANNEL, payload)
                    return  # delivered locally via our LISTEN, if one is active
                except Exception as e:
                    logger.error("qr_events pg_notify failed, delivering locally: %s", e)
            self.deliver_local(kiosk_id, token)
        except Exception as e:
            logger.error("qr_events publish failed: %s", e)

    # -- LISTEN --------------------------------------------------------------
    def _on_notify(self, _conn, _pid, _channel, payload: str) -> None:
        try:
            data = json.loads(payload)
            self.deliver_local(data.get("kiosk"), data["token"])
        except Exception as e:
            logger.error("qr_events bad notification %r: %s", payload, e)

    async def _listen_loop(self) -> None:
        attempt = 0
        while True:
            conn = None
            try:
                conn = await asyncpg.connect(
                    dsn=_direct_dsn(),
                    ssl=ssl.create_default_context(cafile=certifi.where()),
                    statement_cache_size=0,
                )
                lost = asyncio.Event()
                conn.add_termination_listener(lambda _c: lost.set())
                await conn.add_listener(CHANNEL, self._on_notify)
                attempt = 0
                await lost.wait()
                logger.warning("qr_events LISTEN connection lost; reconnecting")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error("qr_events LISTEN failed: %s", e)
            finally:
                if conn is not None and not conn.is_closed():
                    try:
                        await asyncio.shield(conn.close())
                    except Exception:
                        pass
            await asyncio.sleep(RECONNECT_DELAYS[min(attempt, len(RECONNECT_DELAYS) - 1)])
            attempt += 1


hub = QrEventHub()
