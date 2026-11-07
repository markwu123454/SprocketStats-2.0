from .connection import DB_NAME, db_connection


async def get_user_tags(user_id: str) -> list[str]:
    async with db_connection(DB_NAME) as conn:
        rows = await conn.fetch(
            "SELECT tag FROM user_tags WHERE user_id = $1 ORDER BY tag",
            user_id,
        )
        return [r["tag"] for r in rows]


async def user_has_tag(user_id: str, tag: str) -> bool:
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(
            "SELECT 1 FROM user_tags WHERE user_id = $1 AND tag = $2",
            user_id, tag,
        )
        return row is not None


async def get_users_by_tag(tag: str) -> list[dict]:
    async with db_connection(DB_NAME) as conn:
        rows = await conn.fetch(
            """
            SELECT u.id, u.display_name
            FROM user_tags ut
            JOIN users u ON u.id = ut.user_id
            WHERE ut.tag = $1
            ORDER BY u.display_name
            """,
            tag,
        )
        return [{"id": r["id"], "display_name": r["display_name"]} for r in rows]


async def add_user_tag(user_id: str, tag: str, assigned_by: str) -> None:
    async with db_connection(DB_NAME) as conn:
        await conn.execute(
            """
            INSERT INTO user_tags (user_id, tag, assigned_by)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, tag) DO NOTHING
            """,
            user_id, tag, assigned_by,
        )


async def get_all_tag_assignments() -> dict[str, list[str]]:
    """Return all tag assignments grouped by user_id."""
    async with db_connection(DB_NAME) as conn:
        rows = await conn.fetch("SELECT user_id, tag FROM user_tags ORDER BY user_id, tag")
        result: dict[str, list[str]] = {}
        for r in rows:
            result.setdefault(r["user_id"], []).append(r["tag"])
        return result


async def remove_user_tag(user_id: str, tag: str) -> bool:
    async with db_connection(DB_NAME) as conn:
        result = await conn.execute(
            "DELETE FROM user_tags WHERE user_id = $1 AND tag = $2",
            user_id, tag,
        )
        return result == "DELETE 1"
