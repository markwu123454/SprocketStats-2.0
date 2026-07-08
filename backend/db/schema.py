import logging
from fastapi import HTTPException
from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)


async def init_db():
    async with db_connection(DB_NAME) as conn:
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
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS meeting_hours (
                        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                        created_by  TEXT        NOT NULL REFERENCES users(id),
                        start_time  TIMESTAMPTZ NOT NULL,
                        end_time    TIMESTAMPTZ NOT NULL,
                        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                        CONSTRAINT check_valid_time_range CHECK (end_time > start_time)
                    )
                """)
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS attendance (
                        id            TEXT        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
                        user_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                        checkin_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
                        source        TEXT,
                        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
                        checkout_time TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                """)
                await conn.execute("CREATE INDEX IF NOT EXISTS attendance_user_id_idx ON attendance (user_id)")
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS attendance_user_timestamp_idx ON attendance (user_id, checkin_time)"
                )
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS attendance_timestamp_pst_idx ON attendance (checkin_time, checkout_time)"
                )
        except Exception as e:
            logger.error("Failed to initialize schema: %s", e)
            raise HTTPException(status_code=500, detail=f"Failed to initialize schema: {e}")


async def run_migrations():
    """Lightweight migrations that run on every startup, independent of init_db()."""
    async with db_connection(DB_NAME) as conn:
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


__all__ = ["init_db", "run_migrations"]
