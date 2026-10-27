import json
import logging
from fastapi import HTTPException
from .connection import DB_NAME, db_connection
from .events import DEFAULT_CHECKIN_ROLES

# SQL literal for events.checkin_roles' default: every event starts with the
# standard role list. Built from DEFAULT_CHECKIN_ROLES so the two can't drift
# (its labels contain no single quotes, so it embeds as-is).
_DEFAULT_ROLES_SQL = f"'{json.dumps(DEFAULT_CHECKIN_ROLES)}'::jsonb"

logger = logging.getLogger(__name__)

# Advisory-lock key shared by init_db and run_migrations so app processes
# starting at the same time apply schema changes one at a time. Arbitrary,
# but every process must use the same value.
_SCHEMA_LOCK_KEY = 0x53_70_72_6F_63_6B_65_74  # "Sprocket"


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
                # Same lock as run_migrations, so app processes starting at once
                # don't race each other's CREATE TABLE IF NOT EXISTS.
                await conn.execute("SELECT pg_advisory_xact_lock($1)", _SCHEMA_LOCK_KEY)
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
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS attendance_user_timestamp_idx ON attendance (user_id, checkin_time)"
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
                # Backs the ON DELETE SET NULL above: _prune_dead_endpoint deletes
                # subscriptions routinely, and each delete would otherwise scan
                # every delivery log ever written.
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS push_delivery_logs_subscription_idx "
                    "ON push_delivery_logs (push_subscription_id)"
                )
                # Powers the timeout sweep (db.expire_stale_deliveries), which only
                # ever scans rows still in 'sent' -- the partial index keeps that scan
                # small regardless of how many delivered/failed rows accumulate.
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS push_delivery_logs_sent_created_idx "
                    "ON push_delivery_logs (created_at) WHERE status = 'sent'"
                )
                # One row per (user, automated push category) the user turned OFF in
                # Settings -- absence means opted in, so a newly added category
                # defaults to on without a backfill. See db.push.PUSH_CATEGORIES.
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS push_opt_outs (
                        user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        category TEXT NOT NULL,
                        PRIMARY KEY (user_id, category)
                    )
                """)
                # Dedup ledger for the automated reminder sweep (core.push_reminders):
                # a key is claimed before its push goes out, so overlapping sweeps or
                # several server processes never send the same reminder twice.
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS push_reminders_sent (
                        key        TEXT        PRIMARY KEY,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                """)
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS user_tags (
                        user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        tag         TEXT        NOT NULL CHECK (tag ~ '^[a-z0-9_]{1,64}$'),
                        assigned_by TEXT        REFERENCES users(id) ON DELETE SET NULL,
                        assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (user_id, tag)
                    )
                """)
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS user_tags_tag_idx ON user_tags (tag)"
                )
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS events (
                        id            SERIAL PRIMARY KEY,
                        name          TEXT   NOT NULL,
                        start_time    TEXT   NOT NULL,
                        end_time      TEXT,
                        location      TEXT   NOT NULL,
                        event_type    TEXT   NOT NULL,
                        url           TEXT,
                        tba_key       TEXT,
                        checkin_opens TEXT,
                        hidden_tabs   TEXT[] NOT NULL DEFAULT '{}',
                        description   TEXT,
                        checkin_enabled BOOLEAN NOT NULL DEFAULT true,
                        checkin_roles JSONB NOT NULL DEFAULT {_DEFAULT_ROLES_SQL},
                        -- Hub page content (see db.comp_events). The roster is
                        -- event_roster, created by migration 5.
                        links         JSONB,
                        itinerary     JSONB,
                        packing_list  JSONB,
                        instructions  JSONB,
                        -- The hub key (see db.events.hub_key_for): the TBA key, or
                        -- "e<id>" for an event without one.
                        hub_key       TEXT GENERATED ALWAYS AS (COALESCE(tba_key, 'e' || id::text)) STORED,
                        CONSTRAINT events_hub_key_key UNIQUE (hub_key)
                    )
                """.replace("{_DEFAULT_ROLES_SQL}", _DEFAULT_ROLES_SQL))
                # Single-row settings table: `id` can only ever be true.
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS app_config (
                        id                BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
                        prefetch_event_id TEXT    REFERENCES events(hub_key) ON DELETE SET NULL ON UPDATE CASCADE
                    )
                """)
                await conn.execute(
                    "INSERT INTO app_config (prefetch_event_id) SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM app_config)"
                )
                # `bucket` has no CHECK constraint -- it is validated in Python
                # against core.permissions.task_buckets() so a new subteam never
                # needs a migration to become a valid bucket.
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS tasks (
                        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                        title       TEXT        NOT NULL,
                        area        TEXT        NOT NULL DEFAULT 'General',
                        bucket      TEXT        NOT NULL,
                        priority    TEXT        NOT NULL DEFAULT 'med'  CHECK (priority IN ('critical','high','med','low')),
                        status      TEXT        NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','review','done')),
                        assignee_id TEXT        REFERENCES users(id) ON DELETE SET NULL,
                        due_date    DATE,
                        created_by  TEXT        NOT NULL REFERENCES users(id),
                        finished_by TEXT        REFERENCES users(id) ON DELETE SET NULL,
                        reviewed_by TEXT        REFERENCES users(id) ON DELETE SET NULL,
                        event_key   TEXT        REFERENCES events(hub_key) ON DELETE SET NULL ON UPDATE CASCADE,
                        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                """)
                # tasks_event_key_idx and the event_roster table are created in
                # run_migrations, not here: on an existing database `tasks`
                # predates `event_key` (and `events` predates `hub_key`, which
                # event_roster references), and init_db runs before the
                # migrations that add them.
                await conn.execute("CREATE INDEX IF NOT EXISTS tasks_assignee_id_idx ON tasks (assignee_id)")
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS task_contributors (
                        task_id  UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                        user_id  TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (task_id, user_id)
                    )
                """)
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS task_notes (
                        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                        task_id    UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                        author_id  TEXT        REFERENCES users(id) ON DELETE SET NULL,
                        body       TEXT        NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                """)
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS task_notes_task_id_idx ON task_notes (task_id, created_at)"
                )
        except Exception as e:
            logger.error("Failed to initialize schema: %s", e)
            raise HTTPException(status_code=500, detail=f"Failed to initialize schema: {e}")


async def _migration_0001_legacy(conn) -> None:
    """Every migration that used to re-run on each startup, kept as the baseline
    step. All of it is idempotent, so on a database that already ran it this
    only records the version. The CREATE TABLEs it used to repeat are gone:
    init_db always runs first and owns them."""
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
    await conn.execute("ALTER TABLE meeting_hours ADD COLUMN IF NOT EXISTS meeting_purpose TEXT")
    await conn.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS tba_key TEXT")
    await conn.execute("ALTER TABLE events DROP CONSTRAINT IF EXISTS events_tba_key_key")
    await conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS events_tba_key_idx ON events (tba_key) WHERE tba_key IS NOT NULL"
    )
    # When self check-in opens (null -> no gate), and which hub tabs
    # this event hides -- both edited from the Events page.
    await conn.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS checkin_opens TEXT")
    await conn.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS hidden_tabs TEXT[] NOT NULL DEFAULT '{}'")
    # Intro text for the hub's Overview.
    await conn.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT")
    # Per-event switch for self check-in (outreach etc. may not use it).
    await conn.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS checkin_enabled BOOLEAN NOT NULL DEFAULT true")
    # Per-event check-in roles. The NOT NULL default backfills every
    # existing event with the standard list, same as new events get.
    await conn.execute(
        f"ALTER TABLE events ADD COLUMN IF NOT EXISTS checkin_roles JSONB NOT NULL DEFAULT {_DEFAULT_ROLES_SQL}"
    )
    # Events are listed by date now; the manual ordering column is gone.
    await conn.execute("ALTER TABLE events DROP COLUMN IF EXISTS display_order")
    # Optional link from a task to the event hub it belongs to.
    await conn.execute(
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS event_key TEXT "
        "REFERENCES comp_events(event_key) ON DELETE SET NULL"
    )
    await conn.execute("CREATE INDEX IF NOT EXISTS tasks_event_key_idx ON tasks (event_key)")
    # Widen the priority CHECK for 'critical' ("Perish if not done") on
    # databases created before it existed. Only swaps the constraint
    # when its current definition doesn't already allow it.
    await conn.execute("""
        DO $migration$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'tasks'::regclass
                  AND conname = 'tasks_priority_check'
                  AND pg_get_constraintdef(oid) LIKE '%critical%'
            ) THEN
                ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
                ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check
                    CHECK (priority IN ('critical','high','med','low'));
            END IF;
        END
        $migration$
    """)


async def _migration_0002_index_cleanup(conn) -> None:
    """Drop indexes no query uses, add two that queries or FK actions need.

    Dropped: attendance_user_id_idx and notification_responses_notification_idx
    (both prefixes of a wider index / unique constraint on the same table),
    attendance_timestamp_pst_idx (no query filters on that pair), and
    tasks_status_idx / tasks_bucket_idx (tasks are only ever filtered by id or
    event_key). Dropping an index never touches table data.
    """
    for index in (
        "attendance_user_id_idx",
        "attendance_timestamp_pst_idx",
        "notification_responses_notification_idx",
        "tasks_status_idx",
        "tasks_bucket_idx",
    ):
        await conn.execute(f"DROP INDEX IF EXISTS {index}")
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS push_delivery_logs_subscription_idx "
        "ON push_delivery_logs (push_subscription_id)"
    )
    # The hub-key rule as it stood at this migration (queries used the bare
    # expression then); migration 4 replaces it with the events.hub_key column.
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS events_hub_key_idx ON events ((COALESCE(tba_key, 'e' || id::text)))"
    )


async def _migration_0003_app_config_guard(conn) -> None:
    """Give app_config its single-row guard and a FK for prefetch_event_id.

    Never rewrites existing values: the guard is skipped (with a warning) if
    the table somehow already has several rows, and the FK is added NOT VALID
    so a prefetch_event_id that already points at a missing hub is kept; the
    FK is only validated when nothing dangles.
    """
    has_pkey = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app_config'::regclass AND contype = 'p')"
    )
    if not has_pkey:
        row_count = await conn.fetchval("SELECT count(*) FROM app_config")
        if row_count <= 1:
            await conn.execute("ALTER TABLE app_config ADD COLUMN IF NOT EXISTS id BOOLEAN NOT NULL DEFAULT true")
            await conn.execute("ALTER TABLE app_config ADD CONSTRAINT app_config_pkey PRIMARY KEY (id)")
            await conn.execute("ALTER TABLE app_config ADD CONSTRAINT app_config_id_check CHECK (id)")
        else:
            logger.warning("app_config has %d rows; leaving it without a single-row guard", row_count)

    has_fkey = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app_config'::regclass AND contype = 'f')"
    )
    if not has_fkey:
        await conn.execute("""
            ALTER TABLE app_config ADD CONSTRAINT app_config_prefetch_event_id_fkey
                FOREIGN KEY (prefetch_event_id) REFERENCES comp_events(event_key)
                ON DELETE SET NULL NOT VALID
        """)
        dangling = await conn.fetchval("""
            SELECT count(*) FROM app_config ac
            WHERE ac.prefetch_event_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM comp_events ce WHERE ce.event_key = ac.prefetch_event_id)
        """)
        if dangling:
            logger.warning("app_config.prefetch_event_id points at a missing event; FK left NOT VALID")
        else:
            await conn.execute("ALTER TABLE app_config VALIDATE CONSTRAINT app_config_prefetch_event_id_fkey")


async def _repoint_hub_fk(conn, table: str, column: str) -> None:
    """Point `table.column`'s FK at events(hub_key), replacing one that still
    targets the old comp_events table. Never rewrites a value: the new FK is
    added NOT VALID and only validated when nothing dangles."""
    current = await conn.fetchrow(
        """
        SELECT c.conname, c.confrelid = 'events'::regclass AS on_events
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.conrelid = $1::regclass AND c.contype = 'f' AND a.attname = $2
        """,
        table,
        column,
    )
    if current and current["on_events"]:
        return
    if current:
        await conn.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{current["conname"]}"')
    name = f"{table}_{column}_fkey"
    await conn.execute(f"""
        ALTER TABLE {table} ADD CONSTRAINT {name}
            FOREIGN KEY ({column}) REFERENCES events(hub_key)
            ON DELETE SET NULL ON UPDATE CASCADE NOT VALID
    """)
    dangling = await conn.fetchval(f"""
        SELECT count(*) FROM {table} t
        WHERE t.{column} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.hub_key = t.{column})
    """)
    if dangling:
        logger.warning("%d %s row(s) point at a hub with no event; %s left NOT VALID", dangling, table, name)
    else:
        await conn.execute(f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}")


async def _migration_0004_merge_hubs_into_events(conn) -> None:
    """Fold comp_events (hub page content, 1:1 with events by hub key) into
    events, and point tasks/app_config at events.hub_key.

    Where the two names differ, the hub's event_name wins: it's the one the
    event page showed. comp_events is renamed to comp_events_legacy, not
    dropped. A hub with no events row (none on production when this was
    written) stays only there, with a warning, rather than failing startup.
    """
    for column in ("links", "itinerary", "packing_list", "instructions", "roster"):
        await conn.execute(f"ALTER TABLE events ADD COLUMN IF NOT EXISTS {column} JSONB")
    await conn.execute(
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS hub_key TEXT "
        "GENERATED ALWAYS AS (COALESCE(tba_key, 'e' || id::text)) STORED"
    )
    has_unique = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'events'::regclass AND conname = 'events_hub_key_key')"
    )
    if not has_unique:
        await conn.execute("ALTER TABLE events ADD CONSTRAINT events_hub_key_key UNIQUE (hub_key)")
    # The unique constraint's index serves hub-key lookups now.
    await conn.execute("DROP INDEX IF EXISTS events_hub_key_idx")

    has_comp_events = await conn.fetchval("SELECT to_regclass('public.comp_events') IS NOT NULL")
    if has_comp_events:
        await conn.execute("""
            UPDATE events e SET
                name         = ce.event_name,
                links        = ce.links,
                itinerary    = ce.itinerary,
                packing_list = ce.packing_list,
                instructions = ce.instructions,
                roster       = ce.roster
            FROM comp_events ce
            WHERE ce.event_key = e.hub_key
        """)
        orphans = await conn.fetch("""
            SELECT event_key FROM comp_events ce
            WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.hub_key = ce.event_key)
        """)
        if orphans:
            logger.warning(
                "Hubs with no event, kept only in comp_events_legacy: %s",
                ", ".join(r["event_key"] for r in orphans),
            )

    await _repoint_hub_fk(conn, "tasks", "event_key")
    await _repoint_hub_fk(conn, "app_config", "prefetch_event_id")

    if has_comp_events:
        await conn.execute("ALTER TABLE comp_events RENAME TO comp_events_legacy")


async def _migration_0005_event_roster_table(conn) -> None:
    """Move each event's roster out of the events.roster JSONB array into
    event_roster, one row per entry, keeping the array's order.

    events.roster is renamed to roster_legacy, not dropped, so nothing is
    lost: an entry that isn't an object, or a later entry for a user already
    on the same roster (none on production when this was written), stays
    only there, with a warning. The user_id FK is added NOT VALID and only
    validated when every id is a known user.
    """
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS event_roster (
            id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
            event_key    TEXT    NOT NULL REFERENCES events(hub_key) ON DELETE CASCADE ON UPDATE CASCADE,
            -- Null for a guest added by hand (e.g. a chaperone with no account).
            user_id      TEXT,
            -- The name at check-in. Responses show the user's live
            -- display_name and fall back to this (always, for a guest).
            display_name TEXT    NOT NULL,
            -- Null only on a dismissal.
            role         TEXT,
            phone        TEXT,
            days         TEXT[],
            -- True marks a dismissed check-in prompt, not a check-in.
            dismissed    BOOLEAN NOT NULL DEFAULT false,
            -- Roster order: an event's entries are listed by this.
            position     BIGINT  GENERATED BY DEFAULT AS IDENTITY
        )
    """)
    # One entry per member of an event (guests aside).
    await conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS event_roster_member_idx "
        "ON event_roster (event_key, user_id) WHERE user_id IS NOT NULL"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS event_roster_event_idx ON event_roster (event_key, position)"
    )

    has_roster = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'events'::regclass "
        "AND attname = 'roster' AND NOT attisdropped)"
    )
    if has_roster:
        entries = """
            FROM events e,
                 jsonb_array_elements(CASE WHEN jsonb_typeof(e.roster) = 'array' THEN e.roster ELSE '[]' END)
                     WITH ORDINALITY AS x(entry, ord)
        """
        await conn.execute(f"""
            INSERT INTO event_roster (event_key, user_id, display_name, role, phone, days, dismissed)
            SELECT e.hub_key,
                   x.entry->>'user_id',
                   COALESCE(x.entry->>'display_name', ''),
                   x.entry->>'role',
                   x.entry->>'phone',
                   CASE WHEN jsonb_typeof(x.entry->'days') = 'array'
                        THEN ARRAY(SELECT jsonb_array_elements_text(x.entry->'days')) END,
                   COALESCE((x.entry->>'dismissed')::boolean, false)
            {entries}
            WHERE jsonb_typeof(x.entry) = 'object'
            ORDER BY e.id, x.ord
            ON CONFLICT (event_key, user_id) WHERE user_id IS NOT NULL DO NOTHING
        """)
        total = await conn.fetchval(f"SELECT count(*) {entries}")
        moved = await conn.fetchval("SELECT count(*) FROM event_roster")
        if moved < total:
            logger.warning("%d roster entries kept only in events.roster_legacy", total - moved)
        await conn.execute("ALTER TABLE events RENAME COLUMN roster TO roster_legacy")

    has_user_fk = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'event_roster'::regclass "
        "AND conname = 'event_roster_user_id_fkey')"
    )
    if not has_user_fk:
        await conn.execute("""
            ALTER TABLE event_roster ADD CONSTRAINT event_roster_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID
        """)
        unknown = await conn.fetchval("""
            SELECT count(*) FROM event_roster r
            WHERE r.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id)
        """)
        if unknown:
            logger.warning("%d roster entries name an unknown user; event_roster_user_id_fkey left NOT VALID", unknown)
        else:
            await conn.execute("ALTER TABLE event_roster VALIDATE CONSTRAINT event_roster_user_id_fkey")


# Append-only: never edit or renumber a migration that has shipped. Each must
# be idempotent against init_db's current schema, because a fresh database
# gets that schema first and then runs every migration.
_MIGRATIONS = [
    (1, _migration_0001_legacy),
    (2, _migration_0002_index_cleanup),
    (3, _migration_0003_app_config_guard),
    (4, _migration_0004_merge_hubs_into_events),
    (5, _migration_0005_event_roster_table),
]


async def run_migrations():
    """Apply each migration in `_MIGRATIONS` that hasn't run yet, in order.

    Applied versions are recorded in `schema_migrations`. Each migration runs
    in its own transaction under a transaction-scoped advisory lock -- a
    session-level lock isn't reliable behind a transaction-mode pooler like
    Neon's -- so concurrent app processes apply it exactly once, and a failure
    rolls that step back instead of leaving it half-applied. Failures are
    raised rather than logged and skipped: later steps may depend on earlier
    ones, and starting on a schema the code doesn't expect only defers the
    error to request time.
    """
    async with db_connection(DB_NAME) as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", _SCHEMA_LOCK_KEY)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version    INTEGER     PRIMARY KEY,
                    name       TEXT        NOT NULL,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            """)
        for version, migrate in _MIGRATIONS:
            try:
                async with conn.transaction():
                    await conn.execute("SELECT pg_advisory_xact_lock($1)", _SCHEMA_LOCK_KEY)
                    if await conn.fetchval("SELECT 1 FROM schema_migrations WHERE version = $1", version):
                        continue
                    await migrate(conn)
                    await conn.execute(
                        "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
                        version,
                        migrate.__name__,
                    )
                logger.info("Applied migration %d (%s)", version, migrate.__name__)
            except Exception:
                logger.exception("Migration %d (%s) failed", version, migrate.__name__)
                raise


__all__ = ["init_db", "run_migrations"]
