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
                        approved_by         TEXT        REFERENCES users(id),
                        banned_at           TIMESTAMPTZ,
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
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS notifications (
                        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                        title            TEXT        NOT NULL,
                        body             TEXT        NOT NULL,
                        link             TEXT,
                        hard_block       BOOLEAN     NOT NULL DEFAULT false,
                        target_roles     TEXT[]      NOT NULL DEFAULT '{}',
                        response_options TEXT[]      NOT NULL DEFAULT '{}',
                        response_mode    TEXT        NOT NULL DEFAULT 'single' CHECK (response_mode IN ('single', 'multi')),
                        active           BOOLEAN     NOT NULL DEFAULT true,
                        created_by       TEXT        NOT NULL REFERENCES users(id),
                        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
                        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                """)
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS notification_responses (
                        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                        notification_id UUID        NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
                        user_id         TEXT        NOT NULL REFERENCES users(id),
                        response        TEXT[]      NOT NULL DEFAULT '{}',
                        responded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
                        UNIQUE (notification_id, user_id)
                    )
                """)
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS notification_responses_notification_idx "
                    "ON notification_responses (notification_id)"
                )
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS notification_responses_user_idx "
                    "ON notification_responses (user_id)"
                )
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS push_subscriptions (
                        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        endpoint   TEXT        NOT NULL UNIQUE,
                        p256dh     TEXT        NOT NULL,
                        auth       TEXT        NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                """)
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx "
                    "ON push_subscriptions (user_id)"
                )
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS push_messages (
                        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                        title        TEXT        NOT NULL,
                        body         TEXT        NOT NULL,
                        target_roles TEXT[]      NOT NULL DEFAULT '{}',
                        sent_count   INTEGER     NOT NULL DEFAULT 0,
                        created_by   TEXT        NOT NULL REFERENCES users(id),
                        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                """)
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
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES users(id)")
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ")
            # Link functionality was removed from push notifications -- drop the
            # now-unused column from any table created before this change.
            await conn.execute("ALTER TABLE push_messages DROP COLUMN IF EXISTS link")
        except Exception as e:
            logger.warning("Migration warning: %s", e)


__all__ = ["init_db", "run_migrations"]
