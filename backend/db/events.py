import re
from datetime import datetime, time

from pydantic import BaseModel, field_validator, model_validator

from .connection import DB_NAME, db_connection

# Hub tabs an event may hide. "Overview" is the hub's landing page and is
# never hideable. Mirrors HUB_TABS in frontend/src/pages/events/EventShell.tsx.
HIDEABLE_TABS = ["itinerary", "packing", "roster", "comp", "tasks"]
MAX_DESCRIPTION = 5000

# ── Check-in roles ──────────────────────────────────────────────────────
#
# Each event has its own list of roles members pick from at check-in, stored
# as [{"key", "label"}]. Roster entries store the `key`, so renaming a role
# (same key, new label) never orphans people already checked in under it.
# Every event starts with DEFAULT_CHECKIN_ROLES -- the column default fills
# it in for new rows and for rows that predate the column. The keys match
# db.comp_events.ASSIGNABLE_ROLES, so existing roster data keeps resolving.
DEFAULT_CHECKIN_ROLES = [
    {"key": "attending",  "label": "Attending"},
    {"key": "drive_team", "label": "Drive Team"},
    {"key": "pit_crew",   "label": "Pit Crew"},
    {"key": "mentor",     "label": "Mentor"},
]
MAX_CHECKIN_ROLES = 20
MAX_ROLE_LABEL = 40
ROLE_KEY_RE = re.compile(r"^[a-z0-9_]{1,40}$")


def _slugify_role(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:40]
    return slug or "role"


class CheckinRoleIn(BaseModel):
    """One role in a `checkin_roles` update. Omit `key` for a new role (one
    is derived from the label); send an existing role's key to rename it."""

    key: str | None = None
    label: str

    @field_validator("label")
    @classmethod
    def _label_valid(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("role names must not be blank")
        if len(v) > MAX_ROLE_LABEL:
            raise ValueError(f"role names must be {MAX_ROLE_LABEL} characters or fewer")
        return v

    @field_validator("key")
    @classmethod
    def _key_valid(cls, v: str | None) -> str | None:
        if v is not None and not ROLE_KEY_RE.fullmatch(v):
            raise ValueError("invalid role key")
        return v


def normalize_checkin_roles(roles: list[CheckinRoleIn]) -> list[dict]:
    """Validate a full role list and give every role a unique key.

    1..MAX_CHECKIN_ROLES roles, no two with the same name (ignoring case),
    no two sending the same key. New roles get a key slugged from their
    label, suffixed (_2, _3, ...) if it collides with a key already taken.
    """
    if not roles:
        raise ValueError("an event needs at least one check-in role")
    if len(roles) > MAX_CHECKIN_ROLES:
        raise ValueError(f"an event can have at most {MAX_CHECKIN_ROLES} check-in roles")
    labels = [r.label.lower() for r in roles]
    if len(set(labels)) != len(labels):
        raise ValueError("check-in role names must be unique")
    sent_keys = [r.key for r in roles if r.key]
    if len(set(sent_keys)) != len(sent_keys):
        raise ValueError("check-in role keys must be unique")

    taken = set(sent_keys)
    out = []
    for r in roles:
        key = r.key
        if not key:
            base = _slugify_role(r.label)
            key, n = base, 2
            while key in taken:
                key, n = f"{base[:37]}_{n}", n + 1
            taken.add(key)
        out.append({"key": key, "label": r.label})
    return out


def role_keys(roles: list[dict] | None) -> list[str]:
    """Allowed role keys for an event -- its own list, or the defaults when
    there's no schedule row (or an unreadable value) to take them from."""
    source = roles if isinstance(roles, list) and roles else DEFAULT_CHECKIN_ROLES
    return [r["key"] for r in source if isinstance(r, dict) and r.get("key")]

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


MAX_EVENT_TEXT = 120


def _clean_text(v: str, field: str, *, required: bool) -> str:
    v = v.strip()
    if required and not v:
        raise ValueError(f"{field} must not be blank")
    if len(v) > MAX_EVENT_TEXT:
        raise ValueError(f"{field} must be {MAX_EVENT_TEXT} characters or fewer")
    return v


class EventCreate(BaseModel):
    """Body for `POST /events/schedule` -- a new schedule entry. Everything
    else (description, hidden tabs, check-in roles) starts at its default and
    is edited afterwards through the schedule PATCH."""

    name: str
    start: str
    end: str | None = None
    location: str = ""
    type: str
    checkin_opens: str | None = None
    checkin_enabled: bool = True

    @field_validator("name", "type")
    @classmethod
    def _required_text_valid(cls, v: str, info) -> str:
        return _clean_text(v, info.field_name, required=True)

    @field_validator("location")
    @classmethod
    def _location_valid(cls, v: str) -> str:
        return _clean_text(v, "location", required=False)

    @field_validator("start")
    @classmethod
    def _start_valid(cls, v: str) -> str:
        return _validate_schedule_value(v, "start")

    @field_validator("end")
    @classmethod
    def _end_valid(cls, v: str | None) -> str | None:
        return _validate_schedule_value(v, "end")

    @field_validator("checkin_opens")
    @classmethod
    def _checkin_opens_valid(cls, v: str | None) -> str | None:
        return _validate_schedule_value(v, "checkin_opens")

    @model_validator(mode="after")
    def _ordered(self) -> "EventCreate":
        check_schedule_order(self.start, self.end, self.checkin_opens)
        return self


class EventScheduleUpdate(BaseModel):
    """Body for `PATCH /events/schedule/{event_id}` -- any subset of the
    schedule fields an editor may change. `end` and `checkin_opens` may be
    sent as `null` to clear them; `start` may not. At least one field is
    required; enforced by the endpoint, like `CompEventContentPatch`.

    Cross-field ordering (start <= end, check-in opens no later than the end)
    can only be checked against the stored row when just one side is sent,
    so the endpoint re-runs `check_schedule_order` on the merged result."""

    name: str | None = None
    location: str | None = None
    type: str | None = None
    start: str | None = None
    end: str | None = None
    checkin_opens: str | None = None
    hidden_tabs: list[str] | None = None
    # Free text shown at the top of the hub's Overview. Blank/null clears it.
    description: str | None = None
    # False turns self check-in off for this event entirely. `checkin_opens`
    # is kept as-is, so turning it back on restores the old opening time.
    checkin_enabled: bool | None = None
    # The full role list members pick from at check-in (replaces the old one).
    # Each item is shape-checked here; the list as a whole (count, unique
    # names, key assignment) is normalized by the endpoint via
    # `normalize_checkin_roles`.
    checkin_roles: list[CheckinRoleIn] | None = None

    @field_validator("name", "type")
    @classmethod
    def _required_text_valid(cls, v: str | None, info) -> str:
        if v is None:
            raise ValueError(f"{info.field_name} can't be cleared")
        return _clean_text(v, info.field_name, required=True)

    @field_validator("location")
    @classmethod
    def _location_valid(cls, v: str | None) -> str:
        if v is None:
            raise ValueError("location can't be cleared")
        return _clean_text(v, "location", required=False)

    @field_validator("checkin_roles")
    @classmethod
    def _checkin_roles_valid(cls, v: list[CheckinRoleIn] | None) -> list[CheckinRoleIn]:
        if v is None:
            raise ValueError("checkin_roles must be a list")
        return v

    @field_validator("checkin_enabled")
    @classmethod
    def _checkin_enabled_valid(cls, v: bool | None) -> bool:
        if v is None:
            raise ValueError("checkin_enabled must be true or false")
        return v

    @field_validator("description")
    @classmethod
    def _description_valid(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if len(v) > MAX_DESCRIPTION:
            raise ValueError(f"description must be {MAX_DESCRIPTION} characters or fewer")
        return v or None

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


# Every scheduled event has a hub, addressed by its "hub key": the TBA event
# key for competitions, or "e<id>" for events without one (outreach etc.).
# TBA keys always start with a 4-digit year, so the two never collide.
# HUB_KEY_SQL is the same rule as a SQL expression over the `events` table.
# events_hub_key_idx (db/schema.py) indexes this exact expression -- change
# one without the other and hub-key lookups fall back to a full table scan.
HUB_KEY_SQL = "COALESCE(tba_key, 'e' || id::text)"
_TBA_KEY_RE = re.compile(r"^\d{4}[a-z0-9]+$")


def hub_key_for(event_id: int, tba_key: str | None) -> str:
    return tba_key or f"e{event_id}"


def is_tba_key(event_key: str) -> bool:
    """Whether `event_key` is a real TBA event key (worth asking TBA/Nexus
    about), as opposed to an "e<id>" key for a non-competition event."""
    return bool(_TBA_KEY_RE.fullmatch(event_key))


# Columns update_event_schedule() may set, keyed by the API field name.
_SCHEDULE_COLUMNS = {
    "name": "name",
    "location": "location",
    "type": "event_type",
    "start": "start_time",
    "end": "end_time",
    "checkin_opens": "checkin_opens",
    "hidden_tabs": "hidden_tabs",
    "description": "description",
    "checkin_enabled": "checkin_enabled",
    "checkin_roles": "checkin_roles",
}

_EVENT_COLUMNS = """
    id, name, start_time, end_time, location, event_type, url, tba_key,
    checkin_opens, hidden_tabs, description, checkin_enabled, checkin_roles
"""
_SELECT_EVENT = f"SELECT {_EVENT_COLUMNS} FROM events"


async def get_events() -> list[dict]:
    """Return all events in date order. `start_time` is TEXT, but both stored
    forms ("YYYY-MM-DD" / "YYYY-MM-DDTHH:MM") sort chronologically as strings."""
    async with db_connection(DB_NAME) as conn:
        rows = await conn.fetch(_SELECT_EVENT + " ORDER BY start_time, id")
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

    query = f"UPDATE events SET {', '.join(set_clauses)} WHERE id = ${len(params)} RETURNING {_EVENT_COLUMNS}"
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(query, *params)
    return _row_to_event(row) if row else None


async def create_event(body: EventCreate) -> dict:
    """Insert a new `events` row and return it in `get_events()`'s shape."""
    query = f"""
        INSERT INTO events (name, start_time, end_time, location, event_type, checkin_opens, checkin_enabled)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING {_EVENT_COLUMNS}
    """
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(
            query, body.name, body.start, body.end, body.location, body.type,
            body.checkin_opens, body.checkin_enabled,
        )
    return _row_to_event(row)


def _row_to_event(r) -> dict:
    d = {
        "id":         r["id"],
        "name":       r["name"],
        "start":      r["start_time"],
        "location":   r["location"],
        "type":       r["event_type"],
        "hiddenTabs": list(r["hidden_tabs"] or []),
        "checkinEnabled": r["checkin_enabled"] is not False,
        "checkinRoles": r["checkin_roles"] or DEFAULT_CHECKIN_ROLES,
    }
    if r["end_time"]:
        d["end"] = r["end_time"]
    if r["url"]:
        d["url"] = r["url"]
    if r["tba_key"]:
        d["tbaKey"] = r["tba_key"]
    d["hubKey"] = hub_key_for(r["id"], r["tba_key"])
    if r["description"]:
        d["description"] = r["description"]
    if r["checkin_opens"]:
        d["checkinOpens"] = r["checkin_opens"]
    return d
