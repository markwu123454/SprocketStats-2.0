import asyncpg
import json
import logging
import os
import ssl
import certifi

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
async def get_db_connection(db: str) -> tuple[asyncpg.Pool, asyncpg.Connection]:
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
            min_size=1,
            max_size=20,
            init=_setup_codecs,
            ssl=ssl.create_default_context(cafile=certifi.where()),
            command_timeout=30,
            max_inactive_connection_lifetime=300,
            statement_cache_size=0,
        )
        _pools[db] = pool

    conn = await pool.acquire()
    return pool, conn


async def release_db_connection(pool: asyncpg.Pool, conn: asyncpg.Connection):
    await pool.release(conn)


async def close_pool():
    """Close all open database pools and clear the global cache."""
    for pool in _pools.values():
        await pool.close()
    _pools.clear()


__all__ = [
    "get_db_connection",
    "release_db_connection",
    "close_pool",
    "DB_NAME",
    "DB_NAME_LABEL_STUDIO",
]