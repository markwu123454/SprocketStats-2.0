import asyncpg
import logging
from fastapi import HTTPException
from .connection import DB_NAME, get_db_connection, release_db_connection

logger = logging.getLogger(__name__)


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
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetch(query, *params)
    except Exception as e:
        logger.error("get_users_by_fields failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch users")
    finally:
        await release_db_connection(pool, conn)

__all__ = ["upsert_user", "get_user", "update_user_onboarding", "get_users_by_fields"]