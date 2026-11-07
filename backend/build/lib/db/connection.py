import asyncpg
import json
import logging
import os
import ssl
import certifi
from contextlib import asynccontextmanager

from fastapi import HTTPException

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_pools: dict[str, asyncpg.Pool] = {}

DB_NAME = "data"
DB_NAME_LABEL_STUDIO = "label_studio"

_DSN_ENV_VARS: dict[str, str] = {
    DB_NAME: "DATABASE_URL",
    DB_NAME_LABEL_STUDIO: "DATABASE_URL_LABEL_STUDIO",
}


async def _setup_codecs(conn: asyncpg.Connection):
    """Register JSON and JSONB codecs for transparent dict <-> JSON conversion."""
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    await conn.set_type_codec("json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


# noinspection PyUnresolvedReferences
async def _get_pool(db: str) -> asyncpg.Pool:
    """Return the cached pool for db, creating it on first use."""
    pool = _pools.get(db)
    if pool is None:
        env_var = _DSN_ENV_VARS.get(db)
        if env_var is None:
            raise ValueError(f"Unknown database: {db!r}. Known databases: {list(_DSN_ENV_VARS)}")

        dsn = os.getenv(env_var)
        if not dsn:
            raise RuntimeError(f"{env_var} not set")

        pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=0,
            max_size=20,
            init=_setup_codecs,
            ssl=ssl.create_default_context(cafile=certifi.where()),
            command_timeout=30,
            max_inactive_connection_lifetime=300,
            statement_cache_size=0,
        )
        _pools[db] = pool

    return pool


@asynccontextmanager
async def db_connection(db: str):
    """Acquire a pooled connection for db and release it on exit.

    Connection-layer failures (pool creation, acquire) are surfaced as a 500,
    so call sites only need to handle their own query errors. The yield is kept
    out of the acquire try block so those query errors propagate unchanged
    instead of being relabelled as a connection error.
    """
    try:
        pool = await _get_pool(db)
        conn = await pool.acquire()
    except Exception as e:
        logger.error("db connect failed for %s: %s", db, e)
        raise HTTPException(status_code=500, detail="Database unavailable")

    try:
        yield conn
    finally:
        await pool.release(conn)


async def close_pool():
    """Close all open database pools and clear the global cache."""
    for pool in _pools.values():
        await pool.close()
    _pools.clear()


__all__ = [
    "db_connection",
    "close_pool",
    "DB_NAME",
    "DB_NAME_LABEL_STUDIO",
]
