import logging
from fastapi import HTTPException
from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)


async def _create_offline_code_functions(conn) -> None:
    """Install the checksum helpers required by ``users.offline_code``."""
    await conn.execute("""
        CREATE OR REPLACE FUNCTION public.damm_check(digits TEXT)
        RETURNS INTEGER
        LANGUAGE plpgsql
        IMMUTABLE STRICT
        AS $function$
        DECLARE
            m INTEGER[][] := ARRAY[
                [0,3,1,7,5,9,8,6,4,2],
                [7,0,9,2,1,5,4,8,6,3],
                [4,2,0,6,8,7,1,3,5,9],
                [1,7,5,0,9,8,3,4,2,6],
                [6,1,2,3,0,4,5,9,7,8],
                [3,6,7,4,2,0,9,5,8,1],
                [5,8,6,9,7,2,0,1,3,4],
                [8,9,4,5,3,6,2,0,1,7],
                [9,4,3,8,6,1,7,2,0,5],
                [2,5,8,1,4,3,6,7,9,0]
            ];
            interim INTEGER := 0;
            i INTEGER;
        BEGIN
            FOR i IN 1..length(digits) LOOP
                interim := m[interim + 1][substr(digits, i, 1)::INTEGER + 1];
            END LOOP;
            RETURN interim;
        END
        $function$
    """)
    await conn.execute("""
        CREATE OR REPLACE FUNCTION public.is_valid_offline_code(code TEXT)
        RETURNS BOOLEAN
        LANGUAGE plpgsql
        IMMUTABLE
        AS $function$
        DECLARE
            id_str TEXT;
            r0 TEXT;
            r1 TEXT;
            r2 TEXT;
            r3 TEXT;
            c0 INTEGER;
            c1 INTEGER;
            c2 INTEGER;
            c3 INTEGER;
        BEGIN
            IF code !~ '^[0-9]{8}$' THEN
                RETURN false;
            END IF;

            id_str := substr(code, 1, 4);
            c0 := substr(code, 5, 1)::INTEGER;
            c1 := substr(code, 6, 1)::INTEGER;
            c2 := substr(code, 7, 1)::INTEGER;
            c3 := substr(code, 8, 1)::INTEGER;

            r0 := substr(id_str, 1, 1) || substr(id_str, 2, 1) || substr(id_str, 3, 1) || substr(id_str, 4, 1);
            r1 := substr(id_str, 2, 1) || substr(id_str, 3, 1) || substr(id_str, 4, 1) || substr(id_str, 1, 1);
            r2 := substr(id_str, 3, 1) || substr(id_str, 4, 1) || substr(id_str, 1, 1) || substr(id_str, 2, 1);
            r3 := substr(id_str, 4, 1) || substr(id_str, 1, 1) || substr(id_str, 2, 1) || substr(id_str, 3, 1);

            RETURN damm_check(r0) = c0
                AND damm_check(r1) = c1
                AND damm_check(r2) = c2
                AND damm_check(r3) = c3;
        END
        $function$
    """)
    await conn.execute("""
        CREATE OR REPLACE FUNCTION public.gen_offline_code()
        RETURNS TEXT
        LANGUAGE plpgsql
        AS $function$
        DECLARE
            id_str TEXT;
            r0 TEXT;
            r1 TEXT;
            r2 TEXT;
            r3 TEXT;
            code TEXT;
            exists_already BOOLEAN;
        BEGIN
            LOOP
                id_str := lpad(floor(random() * 10000)::INTEGER::TEXT, 4, '0');
                r0 := substr(id_str, 1, 1) || substr(id_str, 2, 1) || substr(id_str, 3, 1) || substr(id_str, 4, 1);
                r1 := substr(id_str, 2, 1) || substr(id_str, 3, 1) || substr(id_str, 4, 1) || substr(id_str, 1, 1);
                r2 := substr(id_str, 3, 1) || substr(id_str, 4, 1) || substr(id_str, 1, 1) || substr(id_str, 2, 1);
                r3 := substr(id_str, 4, 1) || substr(id_str, 1, 1) || substr(id_str, 2, 1) || substr(id_str, 3, 1);

                code := id_str
                    || damm_check(r0)::TEXT
                    || damm_check(r1)::TEXT
                    || damm_check(r2)::TEXT
                    || damm_check(r3)::TEXT;

                SELECT EXISTS(SELECT 1 FROM users WHERE offline_code = code)
                INTO exists_already;

                EXIT WHEN NOT exists_already;
            END LOOP;

            RETURN code;
        END
        $function$
    """)


async def _add_users_constraint(conn, name: str, definition: str) -> None:
    """Add a named users constraint when an older database does not have it."""
    await conn.execute(f"""
        DO $migration$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = 'public.users'::regclass
                  AND conname = '{name}'
            ) THEN
                ALTER TABLE users ADD CONSTRAINT {name} {definition};
            END IF;
        END
        $migration$
    """)


async def init_db():
    async with db_connection(DB_NAME) as conn:
        try:
            async with conn.transaction():
                await _create_offline_code_functions(conn)
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        id                  TEXT        PRIMARY KEY,
                        email               TEXT        NOT NULL UNIQUE,
                        name                TEXT,
                        given_name          TEXT,
                        picture             TEXT,
                        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
                        last_login          TIMESTAMPTZ NOT NULL DEFAULT now(),
                        display_name        TEXT,
                        role                TEXT,
                        onboarding_complete BOOLEAN     NOT NULL DEFAULT false,
                        grade               TEXT,
                        team_year           TEXT,
                        approved_by         TEXT        REFERENCES users(id),
                        banned_at           TIMESTAMPTZ,
                        offline_code        TEXT        NOT NULL UNIQUE DEFAULT gen_offline_code(),
                        CONSTRAINT onboarded_fields_present CHECK (
                            NOT onboarding_complete
                            OR (
                                name IS NOT NULL
                                AND given_name IS NOT NULL
                                AND display_name IS NOT NULL
                                AND role IS NOT NULL
                            )
                        ),
                        CONSTRAINT users_offline_code_format CHECK (
                            offline_code ~ '^[0-9]{8}$'
                            AND is_valid_offline_code(offline_code)
                        )
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
                        checkout_time TIMESTAMPTZ
                    )
                """)
                await conn.execute("CREATE INDEX IF NOT EXISTS attendance_user_id_idx ON attendance (user_id)")
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS attendance_user_timestamp_idx ON attendance (user_id, checkin_time)"
                )
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS attendance_timestamp_pst_idx ON attendance (checkin_time, checkout_time)"
                )
                await conn.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_open_session_idx "
                    "ON attendance (user_id) WHERE checkout_time IS NULL"
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
                # user_id and endpoint are snapshots, not live references -- they keep
                # a delivery's history intact even after its push_subscriptions row is
                # pruned as dead (see _prune_dead_endpoint in db/push.py, which deletes
                # a subscription outright once the push service reports it 404/410).
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS push_delivery_logs (
                        id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                        push_message_id      UUID        NOT NULL REFERENCES push_messages(id) ON DELETE CASCADE,
                        push_subscription_id UUID        REFERENCES push_subscriptions(id) ON DELETE SET NULL,
                        user_id              TEXT        REFERENCES users(id) ON DELETE SET NULL,
                        endpoint             TEXT        NOT NULL,
                        status               TEXT        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'failed')),
                        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
                        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                """)
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS push_delivery_logs_message_idx "
                    "ON push_delivery_logs (push_message_id)"
                )
                # Powers the timeout sweep (db.expire_stale_deliveries), which only
                # ever scans rows still in 'sent' -- the partial index keeps that scan
                # small regardless of how many delivered/failed rows accumulate.
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS push_delivery_logs_sent_created_idx "
                    "ON push_delivery_logs (created_at) WHERE status = 'sent'"
                )
        except Exception as e:
            logger.error("Failed to initialize schema: %s", e)
            raise HTTPException(status_code=500, detail=f"Failed to initialize schema: {e}")


async def run_migrations():
    """Lightweight migrations that run on every startup, independent of init_db()."""
    async with db_connection(DB_NAME) as conn:
        try:
            await _create_offline_code_functions(conn)
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS given_name TEXT")
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT")
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT")
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS grade TEXT")
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS team_year TEXT")
            await conn.execute(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT false"
            )
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS offline_code TEXT")
            await conn.execute("ALTER TABLE users ALTER COLUMN offline_code SET DEFAULT gen_offline_code()")
            await conn.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_offline_code_format")
            # Backfill one row per statement so gen_offline_code() sees every code
            # assigned earlier in the loop before choosing the next value.
            await conn.execute("""
                DO $migration$
                DECLARE
                    user_row RECORD;
                BEGIN
                    FOR user_row IN
                        SELECT id
                        FROM users
                        WHERE offline_code IS NULL
                           OR NOT is_valid_offline_code(offline_code)
                    LOOP
                        UPDATE users
                        SET offline_code = gen_offline_code()
                        WHERE id = user_row.id;
                    END LOOP;
                END
                $migration$
            """)
            await conn.execute("ALTER TABLE users ALTER COLUMN offline_code SET NOT NULL")
            await _add_users_constraint(conn, "users_offline_code_key", "UNIQUE (offline_code)")
            # Remove the earlier nullable-column implementation after the full
            # UNIQUE constraint is in place; otherwise upgraded databases carry
            # two indexes enforcing the same values.
            await conn.execute("DROP INDEX IF EXISTS users_offline_code_unique_idx")
            await _add_users_constraint(
                conn,
                "onboarded_fields_present",
                "CHECK (NOT onboarding_complete OR "
                "(name IS NOT NULL AND given_name IS NOT NULL "
                "AND display_name IS NOT NULL AND role IS NOT NULL))",
            )
            await _add_users_constraint(
                conn,
                "users_offline_code_format",
                "CHECK (offline_code ~ '^[0-9]{8}$' AND is_valid_offline_code(offline_code))",
            )
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES users(id)")
            await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ")
            await conn.execute("ALTER TABLE attendance ALTER COLUMN checkout_time DROP NOT NULL")
            await conn.execute("ALTER TABLE attendance ALTER COLUMN checkout_time DROP DEFAULT")
            await conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_open_session_idx "
                "ON attendance (user_id) WHERE checkout_time IS NULL"
            )
            # Link functionality was removed from push notifications -- drop the
            # now-unused column from any table created before this change.
            await conn.execute("ALTER TABLE push_messages DROP COLUMN IF EXISTS link")
        except Exception as e:
            logger.warning("Migration warning: %s", e)


__all__ = ["init_db", "run_migrations"]
