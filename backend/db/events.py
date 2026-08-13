from .connection import DB_NAME, db_connection


async def get_events() -> list[dict]:
    """Return all events ordered for display."""
    async with db_connection(DB_NAME) as conn:
        rows = await conn.fetch(
            """
            SELECT name, start_time, end_time, location, event_type, url, tba_key
            FROM events
            ORDER BY display_order, start_time
            """
        )
        return [_row_to_event(r) for r in rows]


def _row_to_event(r) -> dict:
    d = {
        "name":     r["name"],
        "start":    r["start_time"],
        "location": r["location"],
        "type":     r["event_type"],
    }
    if r["end_time"]:
        d["end"] = r["end_time"]
    if r["url"]:
        d["url"] = r["url"]
    if r["tba_key"]:
        d["tbaKey"] = r["tba_key"]
    return d
