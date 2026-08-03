import asyncpg
import logging
from fastapi import HTTPException
from .connection import DB_NAME, db_connection

logger = logging.getLogger(__name__)


async def upsert_user(user_info: dict) -> asyncpg.Record:
    async with db_connection(DB_NAME) as conn:
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


async def get_user(user_id: str) -> asyncpg.Record | None:
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
        except Exception as e:
            logger.error("get_user failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch user")


async def get_user_by_offline_code(offline_code: str) -> asyncpg.Record | None:
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                "SELECT * FROM users WHERE offline_code = $1",
                offline_code,
            )
        except Exception as e:
            logger.error("get_user_by_offline_code failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch user")


async def update_user_onboarding(
    user_id: str, display_name: str, role: str, grade: str | None, team_year: str | None
) -> asyncpg.Record:
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                """
                UPDATE users
                SET display_name = $2,
                    role         = $3,
                    grade        = $4,
                    team_year    = $5,
                    -- Backfill name/given_name from the onboarding display name when
                    -- Google didn't supply them, so an onboarded user always has both.
                    -- COALESCE keeps any real Google value and never clobbers it.
                    name         = COALESCE(name, $2),
                    given_name   = COALESCE(given_name, $2),
                    onboarding_complete = true
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


async def load_all_account_state() -> list[asyncpg.Record]:
    """Return the ban/approval state of every user, for the in-memory cache.

    Selects only the columns ``account_state`` needs to decide whether a session
    is active (banned or pending approval) -- deliberately not the full profile,
    since this is reloaded on a timer for every user (see ``account_state``).
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                "SELECT id, banned_at, role, approved_by, onboarding_complete FROM users"
            )
        except Exception as e:
            logger.error("load_all_account_state failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to load account state")


async def get_users_by_fields(
    email: list[str] | None = None,
    display_name: list[str] | None = None,
    role: list[str] | None = None,
    team_year: list[str] | None = None,
) -> list[asyncpg.Record]:
    field_map = {
        "email": email,
        "display_name": display_name,
        "role": role,
        "team_year": team_year,
    }
    filters, params = [], []
    for field, values in field_map.items():
        if values:
            params.append(values)
            filters.append(f"{field} = ANY(${len(params)})")

    if not filters:
        return []

    query = f"SELECT * FROM users WHERE {' AND '.join(filters)}"
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(query, *params)
        except Exception as e:
            logger.error("get_users_by_fields failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch users")


async def list_all_users() -> list[asyncpg.Record]:
    """Return every user with the profile fields the Members roster shows.

    Selects only the columns the roster needs (no ``picture``/timestamps) and
    orders by display name so the grid loads in a stable, human-friendly order
    with un-onboarded users (null ``display_name``) sorted last. This exposes
    email for every user, so the endpoint that calls it must stay permission
    gated (see ``endpoints.members``).
    """
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetch(
                """
                SELECT id, email, name, display_name, role, grade, team_year, approved_by, banned_at
                FROM users
                ORDER BY display_name ASC NULLS LAST, email ASC
                """
            )
        except Exception as e:
            logger.error("list_all_users failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to fetch users")


async def update_users(updates: list[dict]) -> None:
    """Bulk-update the editable profile fields for multiple users.

    Writes ``name``, ``display_name``, ``role``, ``grade`` and ``team_year`` for
    each ``{"id", ...}`` entry. All rows are updated in a single transaction, so a
    failure on any row (e.g. a DB constraint) rolls back the whole batch and
    nothing is partially saved. Email is intentionally not updatable here -- it's
    the OAuth identity and the roster edit surface must not change it.

    Changing ``role`` clears any existing ``approved_by``: an approval vouches for
    a specific self-selected role, so a role change invalidates it and it must be
    re-approved.

    :param updates: One dict per user, each with an ``id`` plus the editable
        fields to set (missing fields are written as ``NULL``).
    """
    if not updates:
        return
    async with db_connection(DB_NAME) as conn:
        try:
            async with conn.transaction():
                for u in updates:
                    await conn.execute(
                        """
                        UPDATE users
                        SET name         = $2,
                            display_name = $3,
                            role         = $4,
                            grade        = $5,
                            team_year    = $6,
                            approved_by  = CASE WHEN role IS DISTINCT FROM $4 THEN NULL ELSE approved_by END
                        WHERE id = $1
                        """,
                        u["id"],
                        u.get("name"),
                        u.get("display_name"),
                        u.get("role"),
                        u.get("grade"),
                        u.get("team_year"),
                    )
        except Exception as e:
            logger.error("update_users failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to update users")


async def approve_user(user_id: str, approver_id: str) -> asyncpg.Record | None:
    """Record that ``approver_id`` vouches for ``user_id``'s identity and role."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                "UPDATE users SET approved_by = $2 WHERE id = $1 RETURNING *",
                user_id,
                approver_id,
            )
        except Exception as e:
            logger.error("approve_user failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to approve member")


async def unapprove_user(user_id: str) -> asyncpg.Record | None:
    """Clear a member's approval."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                "UPDATE users SET approved_by = NULL WHERE id = $1 RETURNING *",
                user_id,
            )
        except Exception as e:
            logger.error("unapprove_user failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to unapprove member")


async def ban_user(user_id: str) -> asyncpg.Record | None:
    """Soft-ban a member. Their row and role are untouched; only ``banned_at`` is set."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                "UPDATE users SET banned_at = now() WHERE id = $1 RETURNING *",
                user_id,
            )
        except Exception as e:
            logger.error("ban_user failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to ban member")


async def unban_user(user_id: str) -> asyncpg.Record | None:
    """Lift a member's ban."""
    async with db_connection(DB_NAME) as conn:
        try:
            return await conn.fetchrow(
                "UPDATE users SET banned_at = NULL WHERE id = $1 RETURNING *",
                user_id,
            )
        except Exception as e:
            logger.error("unban_user failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to unban member")


__all__ = [
    "upsert_user",
    "get_user",
    "get_user_by_offline_code",
    "update_user_onboarding",
    "load_all_account_state",
    "get_users_by_fields",
    "list_all_users",
    "update_users",
    "approve_user",
    "unapprove_user",
    "ban_user",
    "unban_user",
]
