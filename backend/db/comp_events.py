from pydantic import BaseModel
from .connection import DB_NAME, db_connection


class Links(BaseModel):
    tba: str | None = None
    statbotics: str | None = None
    nexus: str | None = None
    youtube: str | None = None
    twitch: str | None = None


class ItineraryItem(BaseModel):
    dt: str
    label: str
    detail: str | None = None


class PackingCategory(BaseModel):
    category: str
    items: list[str]


class Instruction(BaseModel):
    heading: str
    body: str


class RosterMember(BaseModel):
    user_id: str | None = None
    display_name: str
    role: str
    phone: str | None = None


class CompEventContent(BaseModel):
    event_name: str
    links: Links | None = None
    itinerary: list[ItineraryItem] | None = None
    packing_list: list[PackingCategory] | None = None
    instructions: list[Instruction] | None = None
    roster: list[RosterMember] | None = None


async def get_prefetch_event() -> dict | None:
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow("""
            SELECT ce.*
            FROM app_config ac
            JOIN comp_events ce ON ce.event_key = ac.prefetch_event_id
            WHERE ac.prefetch_event_id IS NOT NULL
            LIMIT 1
        """)
        return dict(row) if row else None


async def set_prefetch_event(event_key: str | None) -> None:
    async with db_connection(DB_NAME) as conn:
        await conn.execute("UPDATE app_config SET prefetch_event_id = $1", event_key)


async def get_comp_event(event_key: str) -> dict | None:
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM comp_events WHERE event_key = $1",
            event_key,
        )
        return dict(row) if row else None


async def get_comp_event_keys() -> list[str]:
    """All event_keys with a hub page. Bootstrapped so the frontend can tell
    a real event from a 404 without waiting on a per-event fetch."""
    async with db_connection(DB_NAME) as conn:
        rows = await conn.fetch("SELECT event_key FROM comp_events")
        return [r["event_key"] for r in rows]


async def upsert_comp_event(event_key: str, content: CompEventContent) -> dict:
    data = content.model_dump()
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO comp_events (event_key, event_name, links, itinerary, packing_list, instructions, roster)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (event_key) DO UPDATE SET
                event_name   = EXCLUDED.event_name,
                links        = EXCLUDED.links,
                itinerary    = EXCLUDED.itinerary,
                packing_list = EXCLUDED.packing_list,
                instructions = EXCLUDED.instructions,
                roster       = EXCLUDED.roster
            RETURNING *
            """,
            event_key,
            data["event_name"],
            data.get("links"),
            data.get("itinerary"),
            data.get("packing_list"),
            data.get("instructions"),
            data.get("roster"),
        )
        return dict(row)
