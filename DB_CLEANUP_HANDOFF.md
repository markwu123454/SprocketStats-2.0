# SprocketStats DB cleanup: handoff for an agent with Neon MCP

## Your job
Use Neon MCP to inspect the production data. Then decide, with the user, which of the four pending cleanups (A–D) to do and how, and implement them in the backend (and frontend if needed). Nothing destructive runs on production: work on a Neon branch (copy) and ship changes as code that applies at deploy.

## System facts
- Repo `markwu123454/SprocketStats-2.0`. Backend: FastAPI + asyncpg in `backend/`. Frontend: React/TS in `frontend/src`.
- Postgres on Neon through the `-pooler` endpoint (PgBouncer, transaction mode). The asyncpg pool uses `statement_cache_size=0`; keep it. Session-level advisory locks and prepared-statement caching are unsafe there.
- Schema lives in `backend/db/schema.py`, queries in `backend/db/*.py`, routes in `backend/endpoints/*.py`.
- The schema is applied at app startup (`main.py` lifespan: `init_db()` then `run_migrations()`). Deploy = push to `main`, then GitHub Actions runs `flyctl deploy`, so a merge to `main` migrates production.
- Tests: `cd backend && pip install -e ".[test]" && pytest`. They use no database; endpoint tests monkeypatch `db.*` (e.g. `FakeStore` in `tests/test_events_endpoints.py` mimics the JSONB roster). CI runs Python 3.11.

## Current state: branch `ccr-6e0fa883-oof258` (pushed, no PR yet, merged with `main` at e5322bb)
Check whether it has been merged to `main` before starting. If not, land it first and build on it.
- **Versioned migrations.**
  - `run_migrations()` applies `_MIGRATIONS` in `schema.py`, each once, recorded in `schema_migrations(version, name, applied_at)`.
  - Each runs in its own transaction under `pg_advisory_xact_lock(_SCHEMA_LOCK_KEY)`, and `init_db` takes the same lock.
  - A failure raises and stops startup. Before this, failures were logged as a warning and the remaining steps silently skipped.
  - Rules: the list is append-only (never edit or renumber 1–3). Every migration must be idempotent against `init_db`'s schema, because a fresh database gets `init_db`'s schema and then runs every migration. `init_db` must always describe the current end state.
- **Migration 1** is the old every-startup body, including `main`'s `events.checkin_roles` column.
- **Migration 2** drops unused indexes (`attendance_user_id_idx`, `attendance_timestamp_pst_idx`, `notification_responses_notification_idx`, `tasks_status_idx`, `tasks_bucket_idx`). It adds `push_delivery_logs_subscription_idx` and `events_hub_key_idx` on the expression `HUB_KEY_SQL` = `COALESCE(tba_key, 'e' || id::text)`, imported from `db/events.py`.
  - **Gotcha:** migration 2 imports `HUB_KEY_SQL`. If you change `HUB_KEY_SQL` (e.g. to a `hub_key` column), first inline the literal expression in migration 2 so its meaning doesn't change.
- **Migration 3** gives `app_config` a single-row guard (`id BOOLEAN PK DEFAULT true CHECK (id)`) and a FK `prefetch_event_id → comp_events(event_key) ON DELETE SET NULL`. The FK is added `NOT VALID` and only validated if nothing dangles.
- **Query changes:**
  - `RETURNING` replaces the re-SELECT in `update_event_schedule` and `update_comp_event_content`.
  - Recurring meetings are inserted in one statement.
  - `update_users` uses `executemany`.
  - `/auth/me` runs its two lookups concurrently.
- **Verified on local Postgres 16, not yet on Neon:**
  - Upgrading from pre-branch code and from `main` left every table's data identical, and a restart was a no-op.
  - 4 concurrent startups applied each migration once.
  - Rolling back to `main`'s code starts cleanly; it re-creates the dropped indexes, which is harmless.
- **First Neon action:** create a branch of production and run this branch's startup against it. Confirm all 3 migrations apply, and compare the per-table md5 snapshot (below) before and after. That's the remaining proof the branch is safe.

## Pending cleanups (deferred because they change existing data)

### A. Merge `comp_events` into `events` (highest value)
**Why:**
- The two tables are 1:1 through the hub key `COALESCE(tba_key,'e'||id)`, and the hub row is created lazily by `ensure_comp_event`.
- `comp_events.event_name` duplicates `events.name` and drifts when the event is renamed.
- Check-in does about 5 round trips: the schedule is read 3× (`_enforce_check_in_open`, `_event_role_keys`, `_enforce_days_in_range` in `endpoints/events.py`), plus ensure and write.

**Blockers to check:**
- Orphan hubs: `PUT /events/{key}/content` can create a hub with no `events` row.
- `tasks.event_key` (FK to `comp_events.event_key`, ON DELETE SET NULL) and `app_config` both point at the hub key.

**Decision rules:**
- 0 orphans and 0 collisions: merge.
- If there are orphans, ask the user. Options:
  1. Create `events` rows for them. They need values for the NOT NULL columns `start_time`, `location` and `event_type`, and they would then appear in the events list.
  2. Archive them, set the referencing tasks' `event_key` to NULL, and drop them.
  3. Don't merge.
- If names drift, `events.name` is what the UI lists. Confirm with the user before discarding `event_name`.

**Implementation sketch:**
- Add `links`, `itinerary`, `packing_list`, `instructions` and `roster` (JSONB) to `events`.
- Add `hub_key TEXT GENERATED ALWAYS AS (COALESCE(tba_key,'e'||id::text)) STORED UNIQUE`.
- Copy the data across. Repoint the FKs on `tasks.event_key` and `app_config.prefetch_event_id` to `events(hub_key)`.
- Rename `comp_events` to `comp_events_legacy`; don't drop it until the user confirms.
- Keep the API response shapes. `GET /events/{key}/info` returns `{**comp_events row, **live}`, and the frontend reads `event_key`, `event_name`, `links`, `itinerary`, `packing_list`, `instructions` and `roster` (`src/lib/eventApi.ts`, `src/pages/events/*.tsx`, `src/components/events/*.tsx`).
- Code to touch:
  - `db/comp_events.py`: `get_comp_event`, `ensure_comp_event`, `get_comp_event_keys`, `upsert_comp_event`, the roster and dismissal functions, `update_comp_event_content`, `get_event_schedule`, `get_prefetch_event`, `set_prefetch_event`.
  - `endpoints/events.py`: collapse the repeated schedule reads.
  - `endpoints/tasks.py` `_validate_event_key`, `backend/temp_seed.py`, and `init_db`.

### B. Move the roster out of JSONB into an `event_roster` table
**Current shape:** `comp_events.roster` is a list of `{user_id, display_name, role, phone, days, dismissed?}`.
- Since e5322bb, a "dismissed check-in prompt" is stored as an entry with `dismissed: true` and `role: null`. `visible_roster()` hides these in responses, and `_IS_DISMISSAL` is the SQL test for them.
- Hand-seeded guest entries (chaperones) have `user_id: null`. `display_name` is a snapshot taken at check-in.

**Why:**
- Every edit rewrites the whole array with `jsonb_agg`.
- There's no FK to `users`, and display names go stale.
- Reads fetch the whole hub row.

**Decision rules:**
- Null-user entries become guest rows with a stored `display_name`.
- Unknown users (not in `users`): ask the user whether to keep them with a `NOT VALID` FK or a nullable `user_id`, or drop them.
- Duplicate entries for the same user in one roster: ask which to keep. Right now `update_roster_member` updates all of them and the check-in guard sees any of them.
- Unexpected keys in entries: preserve them, e.g. in a `extra JSONB` column, or ask.
- Behaviour choice for the user: show live `users.display_name` (with the stored name as fallback) or keep the snapshot.

**Implementation sketch:**
- Table: `event_roster(id uuid pk, event_key → hub ON DELETE CASCADE, user_id text NULL REFERENCES users ON DELETE SET NULL, display_name text, role text NULL, phone text, days text[], dismissed bool NOT NULL DEFAULT false, position int)` with a partial `UNIQUE (event_key, user_id) WHERE user_id IS NOT NULL`.
- Backfill keeping array order in `position`. Rename the old column to `roster_legacy`.
- API responses must keep the same list-of-dicts shape and order.
- `PUT /content` replaces the whole roster: delete and re-insert the rows in one transaction.
- Do this after A if A happens, so the FK targets `events(hub_key)`.
- Code: roster and dismissal functions in `db/comp_events.py`, the check-in/roster/dismiss routes in `endpoints/events.py`, and `FakeStore` in the tests if function signatures change.

### C. `notification_responses`: make `(notification_id, user_id)` the primary key and drop `id` (low value)
- `UNIQUE (notification_id, user_id)` already exists.
- The `id` column is not exposed by any endpoint. Its only use is `COUNT(r.id)` in `db/notifications.py` `list_notifications`; change that to `COUNT(r.user_id)`.
- Dropping `id` loses only meaningless UUIDs. Ask whether it's worth a migration.

### D. `attendance.id` TEXT → UUID (low value)
- Safe only if the check below finds 0 non-UUID ids. The migration is `ALTER COLUMN id DROP DEFAULT`, then `TYPE uuid USING id::uuid`, then `SET DEFAULT gen_random_uuid()`.
- asyncpg will then return `uuid.UUID`. FastAPI serializes it as a string, but wrap it in `str()` in `endpoints/attendance.py` (around lines 85 and 105) for consistency. No endpoint takes an attendance id from the client.

## Read-only checks to run on Neon (tested on Postgres 16)
```sql
-- A1 hubs with no events row
SELECT ce.event_key, ce.event_name,
       CASE WHEN jsonb_typeof(ce.roster) = 'array' THEN jsonb_array_length(ce.roster) ELSE 0 END AS roster_n,
       (SELECT count(*) FROM tasks t WHERE t.event_key = ce.event_key) AS tasks_n
FROM comp_events ce
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE COALESCE(e.tba_key, 'e' || e.id::text) = ce.event_key);
-- A2 hub key collisions
SELECT COALESCE(tba_key, 'e' || id::text) AS hub_key, count(*) FROM events GROUP BY 1 HAVING count(*) > 1;
-- A3 name drift
SELECT e.id, e.name, ce.event_name FROM events e
JOIN comp_events ce ON ce.event_key = COALESCE(e.tba_key, 'e' || e.id::text) WHERE e.name IS DISTINCT FROM ce.event_name;
-- A4 prefetch target
SELECT ac.*, EXISTS (SELECT 1 FROM comp_events ce WHERE ce.event_key = ac.prefetch_event_id) AS target_exists FROM app_config ac;
-- B1 rosters that aren't arrays
SELECT event_key, jsonb_typeof(roster) FROM comp_events WHERE roster IS NOT NULL AND jsonb_typeof(roster) <> 'array';
-- B2 roster entry stats
WITH r AS (
  SELECT ce.event_key, x.entry, x.ord
  FROM comp_events ce, jsonb_array_elements(CASE WHEN jsonb_typeof(ce.roster) = 'array' THEN ce.roster ELSE '[]' END) WITH ORDINALITY AS x(entry, ord)
)
SELECT count(*) AS total,
       count(*) FILTER (WHERE jsonb_typeof(entry) <> 'object') AS non_object,
       count(*) FILTER (WHERE entry->>'user_id' IS NULL) AS null_user,
       count(*) FILTER (WHERE entry->>'user_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = entry->>'user_id')) AS unknown_user,
       count(*) FILTER (WHERE entry->'dismissed' = 'true'::jsonb) AS dismissals,
       count(*) FILTER (WHERE entry ? 'days' AND jsonb_typeof(entry->'days') NOT IN ('array', 'null')) AS bad_days
FROM r;
-- B3 duplicate users within one roster
WITH r AS (SELECT ce.event_key, x.entry FROM comp_events ce, jsonb_array_elements(CASE WHEN jsonb_typeof(ce.roster) = 'array' THEN ce.roster ELSE '[]' END) AS x(entry))
SELECT event_key, entry->>'user_id' AS user_id, count(*) FROM r WHERE entry->>'user_id' IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
-- B4 every key used in roster entries
WITH r AS (SELECT x.entry FROM comp_events ce, jsonb_array_elements(CASE WHEN jsonb_typeof(ce.roster) = 'array' THEN ce.roster ELSE '[]' END) AS x(entry))
SELECT k, count(*) FROM r, jsonb_object_keys(CASE WHEN jsonb_typeof(entry) = 'object' THEN entry ELSE '{}' END) AS k GROUP BY 1 ORDER BY 1;
-- C notification_responses constraints
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'notification_responses'::regclass;
-- D attendance ids that aren't UUIDs
SELECT count(*) AS non_uuid_ids FROM attendance WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
-- E index usage (confirms migration 2's drops), table sizes (lock duration), migration state
SELECT relname, indexrelname, idx_scan FROM pg_stat_user_indexes ORDER BY idx_scan, relname;
SELECT relname, n_live_tup, seq_scan, idx_scan FROM pg_stat_user_tables ORDER BY n_live_tup DESC;
SELECT to_regclass('public.schema_migrations') AS has_schema_migrations;
```

Data snapshot for before/after comparison. Repeat this line per table; every table's data should be identical except what a migration intends to change.
```sql
SELECT '<table>', count(*), md5(string_agg(t::text, '|' ORDER BY t::text)) FROM <table> t;
```

## Safety protocol
1. Never run DDL or DML on the production branch. Create a Neon branch from production and point a local run's `DATABASE_URL` at it. Run the app's startup (`init_db` + `run_migrations`), the tests, and the snapshot comparison there.
2. Before writing any lossy migration, report counts to the user (orphans, unknown users, duplicates) along with your proposed handling, and get explicit approval for each lossy choice.
3. Ship changes as new migrations numbered 4 and up. Keep each idempotent and update `init_db` to the new end state. Rename old tables and columns to `*_legacy` instead of dropping them; a later migration drops them once the user confirms.
4. Keep API response shapes stable, or update the frontend in the same PR. Run the frontend tests and typecheck too (`frontend/`).
5. One PR per cleanup (A, then B; C/D optional). Production migrates when the user merges and the deploy runs. Verify on a fresh Neon branch of production right before each merge.

## Suggested order
0. Verify and land `ccr-6e0fa883-oof258`.
1. Run the read-only checks above and report the results to the user.
2. A (merge hubs into events).
3. B (roster table).
4. C and D only if the user wants them.
