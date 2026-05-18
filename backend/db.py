import asyncpg
import json
import logging
import dotenv
from fastapi import HTTPException
import os, ssl
import certifi

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

dotenv.load_dotenv()
_pools: dict[str, asyncpg.Pool] = {}
DB_NAME = "data"

_sentinel = object()


async def _setup_codecs(conn: asyncpg.Connection):
    """Register JSON and JSONB codecs for transparent dict <-> JSON conversion."""
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    await conn.set_type_codec("json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def get_db_connection(db: str) -> tuple[asyncpg.Pool, asyncpg.Connection]:
    pool = _pools.get(db)
    if pool is None:
        dsn = os.getenv("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL not set")

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


# =================== Schema Init ===================

async def init_db():
    pool, conn = await get_db_connection(DB_NAME)
    try:
        async with conn.transaction():
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id                  TEXT        PRIMARY KEY,
                    email               TEXT        NOT NULL UNIQUE,
                    name                TEXT,
                    given_name          TEXT,
                    picture             TEXT,
                    display_name        TEXT,
                    role                TEXT,
                    grade               TEXT,
                    team_year           TEXT,
                    onboarding_complete BOOLEAN     NOT NULL DEFAULT false,
                    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
                    last_login          TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            """)
    except Exception as e:
        logger.error("Failed to initialize schema: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to initialize schema: {e}")
    finally:
        await release_db_connection(pool, conn)


async def run_migrations():
    """Lightweight migrations that run on every startup, independent of init_db()."""
    pool, conn = await get_db_connection(DB_NAME)
    try:
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS given_name TEXT")
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT")
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT")
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS grade TEXT")
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS team_year TEXT")
        await conn.execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT false"
        )
    except Exception as e:
        logger.warning("Migration warning: %s", e)
    finally:
        await release_db_connection(pool, conn)


# =================== Users ===================

async def upsert_user(user_info: dict) -> asyncpg.Record:
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetchrow(
            """
            INSERT INTO users (id, email, name, given_name, picture, last_login)
            VALUES ($1, $2, $3, $4, $5, now())
            ON CONFLICT (id) DO UPDATE
                SET email      = EXCLUDED.email,
                    name       = EXCLUDED.name,
                    given_name = EXCLUDED.given_name,
                    picture    = EXCLUDED.picture,
                    last_login = now()
            RETURNING *
            """,
            user_info["sub"],
            user_info["email"],
            user_info.get("name"),
            user_info.get("given_name"),
            user_info.get("picture"),
        )
    except Exception as e:
        logger.error("upsert_user failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save user")
    finally:
        await release_db_connection(pool, conn)


async def get_user(user_id: str) -> asyncpg.Record | None:
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
    except Exception as e:
        logger.error("get_user failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch user")
    finally:
        await release_db_connection(pool, conn)


async def update_user_onboarding(
    user_id: str, display_name: str, role: str, grade: str, team_year: str
) -> asyncpg.Record:
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetchrow(
            """
            UPDATE users
            SET display_name = $2, role = $3, grade = $4, team_year = $5, onboarding_complete = true
            WHERE id = $1
            RETURNING *
            """,
            user_id,
            display_name,
            role,
            grade,
            team_year,
        )
    except Exception as e:
        logger.error("update_user_onboarding failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to update user onboarding")
    finally:
        await release_db_connection(pool, conn)