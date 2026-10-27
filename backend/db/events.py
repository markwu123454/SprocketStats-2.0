import re
from datetime import datetime, time

from pydantic import BaseModel, field_validator, model_validator

from .connection import DB_NAME, db_connection

# Hub tabs an event may hide. "Overview" is the hub's landing page and is
# never hideable. Mirrors HUB_TABS in frontend/src/pages/events/EventShell.tsx.
HIDEABLE_TABS = ["itinerary", "packing", "roster", "comp", "tasks"]

# `events.start_time`/`end_time`/`checkin_opens` are TEXT holding either a
# bare "YYYY-MM-DD" or a local "YYYY-MM-DDTHH:MM" wall time -- the two forms
# the frontend's parseEventDate understands.
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")


def _validate_schedule_value(v: str | None, field: str) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not (_DATE_RE.fullmatch(v) or _DATETIME_RE.fullmatch(v)):
        raise ValueError(f"{field} must be YYYY-MM-DD or YYYY-MM-DDTHH:MM")
    try:
        datetime.fromisoformat(v)
    except ValueError as e:
        raise ValueError(f"{field} is not a real date") from e
    return v


def _as_start(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _as_end(value: str) -> datetime:
    """A date-only end counts through the end of that day (same rule as the
    frontend's parseEventEndDate)."""
    parsed = datetime.fromisoformat(value)
    return datetime.combine(parsed.date(), time.max) if _DATE_RE.fullmatch(value) else parsed


class EventScheduleUpdate(BaseModel):
    """Body for `PATCH /events/schedule/{event_id}` -- any subset of the
    schedule fields an editor may change. `end` and `checkin_opens` may be
    sent as `null` to clear them; `start` may not. At least one field is
    required; enforced by the endpoint, like `CompEventContentPatch`.

    Cross-field ordering (start <= end, check-in opens no later than the end)
    can only be checked against the stored row when just one side is sent,
    so the endpoint re-runs `check_schedule_order` on the merged result."""

    start: str | None = None
    end: str | None = None
    checkin_opens: str | None = None
    hidden_tabs: list[str] | None = None

    @field_validator("start")
    @classmethod
    def _start_valid(cls, v: str | None) -> str:
        if v is None:
            raise ValueError("start can't be cleared")
        return _validate_schedule_value(v, "start")

    @field_validator("end")
    @classmethod
    def _end_valid(cls, v: str | None) -> str | None:
        return _validate_schedule_value(v, "end")

    @field_validator("checkin_opens")
    @classmethod
    def _checkin_opens_valid(cls, v: str | None) -> str | None:
        return _validate_schedule_value(v, "checkin_opens")

    @field_validator("hidden_tabs")
    @classmethod
    def _hidden_tabs_valid(cls, v: list[str] | None) -> list[str]:
        if v is None:
            raise ValueError("hidden_tabs must be a list")
        unknown = set(v) - set(HIDEABLE_TABS)
        if unknown:
            raise ValueError(f"hidden_tabs may only contain {HIDEABLE_TABS}")
        return [t for t in HIDEABLE_TABS if t in v]

    @model_validator(mode="after")
    def _ordered(self) -> "EventScheduleUpdate":
        check_schedule_order(self.start, self.end, self.checkin_opens)
        return self


def check_schedule_order(start: str | None, end: str | None, checkin_opens: str | None) -> None:
    """Raise ValueError if `end` is before `start`, or check-in opens after
    the event is over. Any side that's missing is skipped."""
    if start and end and _as_end(end) < _as_start(start):
        raise ValueError("end must be on or after start")
    last = end or start
    if checkin_opens and last and _as_start(checkin_opens) > _as_end(last):
        raise ValueError("check-in must open before the event ends")


# Columns update_event_schedule() may set, keyed by the API field name.
_SCHEDULE_COLUMNS = {
    "start": "start_time",
    "end": "end_time",
    "checkin_opens": "checkin_opens",
    "hidden_tabs": "hidden_tabs",
}

_SELECT_EVENT = """
    SELECT id, name, start_time, end_time, location, event_type, url, tba_key,
           checkin_opens, hidden_tabs
    FROM events
"""


async def get_events() -> list[dict]:
    """Return all events ordered for display."""
    async with db_connection(DB_NAME) as conn:
        rows = await conn.fetch(_SELECT_EVENT + " ORDER BY display_order, start_time")
        return [_row_to_event(r) for r in rows]


async def get_event_by_id(event_id: int) -> dict | None:
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(_SELECT_EVENT + " WHERE id = $1", event_id)
        return _row_to_event(row) if row else None


async def update_event_schedule(event_id: int, fields: dict) -> dict | None:
    """Apply a partial update to one `events` row's schedule fields.

    Mirrors `comp_events.update_comp_event_content`'s dynamic-SET-from-whitelist
    pattern; `fields` is keyed by API name (see `_SCHEDULE_COLUMNS`).

    :returns: The updated event in `get_events()`'s shape, or `None` if
        `event_id` doesn't exist.
    :raises ValueError: If `fields` is empty or names an unknown field.
    """
    if not fields:
        raise ValueError("update_event_schedule requires at least one field to set")
    unknown = set(fields) - set(_SCHEDULE_COLUMNS)
    if unknown:
        raise ValueError(f"update_event_schedule got unknown field(s): {sorted(unknown)}")

    set_clauses = []
    params: list = []
    for key, val in fields.items():
        params.append(val)
        set_clauses.append(f"{_SCHEDULE_COLUMNS[key]} = ${len(params)}")
    params.append(event_id)

    query = f"UPDATE events SET {', '.join(set_clauses)} WHERE id = ${len(params)} RETURNING id"
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(query, *params)
    if row is None:
        return None
    return await get_event_by_id(event_id)


def _row_to_event(r) -> dict:
    d = {
        "id":         r["id"],
        "name":       r["name"],
        "start":      r["start_time"],
        "location":   r["location"],
        "type":       r["event_type"],
        "hiddenTabs": list(r["hidden_tabs"] or []),
    }
    if r["end_time"]:
        d["end"] = r["end_time"]
    if r["url"]:
        d["url"] = r["url"]
    if r["tba_key"]:
        d["tbaKey"] = r["tba_key"]
    if r["checkin_opens"]:
        d["checkinOpens"] = r["checkin_opens"]
    return d
