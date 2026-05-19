import logging
from fastapi import HTTPException
from .connection import DB_NAME, get_db_connection, release_db_connection

logger = logging.getLogger(__name__)


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

__all__ = ["init_db", "run_migrations"]