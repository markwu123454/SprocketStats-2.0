import re
from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator

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


# ── Roster role set ─────────────────────────────────────────────────────────
#
# The only roles a user may pick for themselves at check-in, or a privileged
# editor may assign via the roster-role PATCH -- both use the same four.
# Defined once here so CheckInRequest/RosterRoleUpdate can't drift from each
# other. A roster entry can also hold a role outside this set (e.g.
# "chaperone", "captain", "lead" -- see ROLE_ORDER in
# frontend/src/pages/events/RosterPage.tsx), but only via hand-seeding
# (temp_seed.py) or the PUT /content path; neither API route here can set or
# change a role outside ASSIGNABLE_ROLES, and stored data is never validated
# on read.
ASSIGNABLE_ROLES = ["drive_team", "pit_crew", "attending", "mentor"]

# Phone numbers are free-text (no fixed country format), so validation is
# deliberately permissive: digits, spaces, and the usual punctuation, with a
# floor on digit count so "----" can't pass as a phone number.
_PHONE_ALLOWED_CHARS = re.compile(r"^[0-9+\-() .]+$")


class CheckInRequest(BaseModel):
    """Optional body for `POST /{event_key}/check-in`. Omitting the body, or
    omitting `role`, means `"attending"`; omitting/blanking `phone` means
    `None`."""

    role: str = "attending"
    phone: str | None = None

    @field_validator("role")
    @classmethod
    def _role_valid(cls, v: str) -> str:
        if v not in ASSIGNABLE_ROLES:
            raise ValueError(f"role must be one of {ASSIGNABLE_ROLES}")
        return v

    @field_validator("phone")
    @classmethod
    def _phone_valid(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) > 30:
            raise ValueError("phone must be 30 characters or fewer")
        if not _PHONE_ALLOWED_CHARS.fullmatch(v):
            raise ValueError("phone may only contain digits, spaces, and + - ( ) .")
        if sum(c.isdigit() for c in v) < 7:
            raise ValueError("phone must contain at least 7 digits")
        return v


class RosterRoleUpdate(BaseModel):
    """Body for `PATCH /{event_key}/roster/{user_id}` -- sets that member's
    role (one of the same ASSIGNABLE_ROLES offered at check-in) and nothing
    else."""

    role: str

    @field_validator("role")
    @classmethod
    def _role_valid(cls, v: str) -> str:
        if v not in ASSIGNABLE_ROLES:
            raise ValueError(f"role must be one of {ASSIGNABLE_ROLES}")
        return v


class RosterMemberNotFound(Exception):
    """Raised by `set_roster_role` when `event_key` exists but has no roster
    entry with the given `user_id` (a hand-seeded entry with a null `user_id`
    is never addressable this way -- that's intended)."""


class CompEventContent(BaseModel):
    event_name: str
    links: Links | None = None
    itinerary: list[ItineraryItem] | None = None
    packing_list: list[PackingCategory] | None = None
    instructions: list[Instruction] | None = None
    roster: list[RosterMember] | None = None


# ── Stricter item models for the content-PATCH path ────────────────────────
#
# These subclass the item models above rather than tightening them in place,
# so the existing PUT (`CompEventContent`, `upsert_comp_event`) and the rows it
# already wrote (read back as plain dicts via `get_comp_event`, never through
# a model) can never be broken by validation added for the PATCH contract.

class PatchItineraryItem(ItineraryItem):
    @field_validator("label")
    @classmethod
    def _label_valid(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("label must not be blank")
        if len(v) > 200:
            raise ValueError("label must be 200 characters or fewer")
        return v

    @field_validator("dt")
    @classmethod
    def _dt_valid(cls, v: str) -> str:
        try:
            datetime.fromisoformat(v)
        except ValueError as e:
            raise ValueError("dt must be an ISO-8601 datetime") from e
        return v

    @field_validator("detail")
    @classmethod
    def _detail_valid(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 2000:
            raise ValueError("detail must be 2000 characters or fewer")
        return v


class PatchPackingCategory(PackingCategory):
    @field_validator("category")
    @classmethod
    def _category_valid(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("category must not be blank")
        if len(v) > 200:
            raise ValueError("category must be 200 characters or fewer")
        return v

    @field_validator("items")
    @classmethod
    def _items_valid(cls, v: list[str]) -> list[str]:
        cleaned = []
        for item in v:
            item = item.strip()
            if not item:
                raise ValueError("packing items must not be blank")
            if len(item) > 100:
                raise ValueError("packing items must be 100 characters or fewer")
            cleaned.append(item)
        return cleaned


class PatchInstruction(Instruction):
    @field_validator("heading")
    @classmethod
    def _heading_valid(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("heading must not be blank")
        if len(v) > 200:
            raise ValueError("heading must be 200 characters or fewer")
        return v

    @field_validator("body")
    @classmethod
    def _body_valid(cls, v: str) -> str:
        if len(v) > 2000:
            raise ValueError("body must be 2000 characters or fewer")
        return v


class CompEventContentPatch(BaseModel):
    """Body for `PATCH /{event_key}/content` -- any subset of the three
    editable content fields. Deliberately excludes `roster`, `links`, and
    `event_name`, which this route must never touch."""

    itinerary: list[PatchItineraryItem] | None = None
    packing_list: list[PatchPackingCategory] | None = None
    instructions: list[PatchInstruction] | None = None

    @model_validator(mode="after")
    def _no_duplicate_categories(self) -> "CompEventContentPatch":
        if self.packing_list is not None:
            seen: set[str] = set()
            for cat in self.packing_list:
                key = cat.category.lower()
                if key in seen:
                    raise ValueError(f"duplicate packing category: {cat.category}")
                seen.add(key)
        return self


# ── Content columns update whitelist (used by update_comp_event_content) ───
_CONTENT_UPDATABLE_COLUMNS = {"itinerary", "packing_list", "instructions"}


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


# ── Check-in (roster) ───────────────────────────────────────────────────────

async def add_roster_member(event_key: str, member: dict) -> list | None:
    """Idempotently append `member` to an event's roster, atomically.

    One UPDATE does both the append and the duplicate check (`roster @>
    [{"user_id": ...}]` guards against a second check-in from the same user),
    so there is no read-modify-write race between two simultaneous check-ins.
    If the row wasn't touched (either the user is already on the roster, or
    the event doesn't exist), falls back to `get_comp_event` to disambiguate
    those two cases.

    :param member: The full roster entry to append, e.g.
        ``{"user_id": ..., "display_name": ..., "role": "attending", "phone": None}``.
    :returns: The full roster after the append (or after confirming the caller
        was already on it), or `None` if `event_key` doesn't exist.
    """
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(
            """
            UPDATE comp_events
            SET roster = COALESCE(roster, '[]'::jsonb) || $2::jsonb
            WHERE event_key = $1
              AND NOT COALESCE(roster, '[]'::jsonb) @> $3::jsonb
            RETURNING roster
            """,
            event_key,
            [member],
            [{"user_id": member["user_id"]}],
        )
    if row is not None:
        return row["roster"]
    existing = await get_comp_event(event_key)
    return existing["roster"] if existing else None


async def is_on_roster(event_key: str, user_id: str) -> bool | None:
    """Return whether `user_id` already has a roster entry for `event_key`.

    :returns: `True`/`False`, or `None` if the event does not exist.
    """
    row = await get_comp_event(event_key)
    if row is None:
        return None
    roster = row.get("roster") or []
    return any(entry.get("user_id") == user_id for entry in roster)


async def set_roster_role(event_key: str, user_id: str, role: str) -> list | None:
    """Atomically set one roster member's `role`, in place -- no
    read-modify-write.

    Rebuilds the roster array with `jsonb_agg`, replacing only the element
    whose `user_id` matches via `jsonb_set(e, '{role}', ...)`; every other
    entry (and every other field of the matched entry -- display_name,
    phone) passes through unchanged. The `roster @> [{"user_id": ...}]` guard
    both targets the UPDATE and doubles as an existence check, the same way
    `add_roster_member`'s guard does.

    :returns: The full updated roster, or `None` if `event_key` doesn't exist.
    :raises RosterMemberNotFound: If the event exists but no roster entry has
        this `user_id`.
    """
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(
            """
            UPDATE comp_events
            SET roster = (
                SELECT jsonb_agg(
                    CASE WHEN e->>'user_id' = $2 THEN jsonb_set(e, '{role}', to_jsonb($3::text))
                         ELSE e END
                    ORDER BY ord
                )
                FROM jsonb_array_elements(COALESCE(roster, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
            )
            WHERE event_key = $1
              AND COALESCE(roster, '[]'::jsonb) @> $4::jsonb
            RETURNING roster
            """,
            event_key,
            user_id,
            role,
            [{"user_id": user_id}],
        )
    if row is not None:
        return row["roster"]
    existing = await get_comp_event(event_key)
    if existing is None:
        return None
    raise RosterMemberNotFound(user_id)


# ── Control panel write path: itinerary / packing_list / instructions ──────

async def update_comp_event_content(event_key: str, fields: dict) -> dict | None:
    """Apply a partial update to one event's itinerary/packing_list/instructions.

    Mirrors `tasks.update_task`'s dynamic-SET-from-whitelist pattern. Never
    creates a row and never touches `roster`, `links`, or `event_name` -- only
    the columns named in `fields` are set.

    :param event_key: The event to update.
    :param fields: Column -> new value, restricted to
        `_CONTENT_UPDATABLE_COLUMNS`, built by the endpoint from the PATCH
        body's actually-sent fields.
    :returns: The full updated comp_events row (same shape `get_comp_event`
        returns), or `None` if `event_key` doesn't exist.
    :raises ValueError: If `fields` is empty or names a column outside the
        whitelist -- callers should treat an empty `fields` dict as a no-op
        *before* calling this, not rely on it here.
    """
    if not fields:
        raise ValueError("update_comp_event_content requires at least one field to set")
    unknown = set(fields) - _CONTENT_UPDATABLE_COLUMNS
    if unknown:
        raise ValueError(f"update_comp_event_content got unknown column(s): {sorted(unknown)}")

    set_clauses = []
    params: list = []
    for col, val in fields.items():
        params.append(val)
        set_clauses.append(f"{col} = ${len(params)}")
    params.append(event_key)

    query = f"UPDATE comp_events SET {', '.join(set_clauses)} WHERE event_key = ${len(params)} RETURNING event_key"
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(query, *params)
    if row is None:
        return None
    return await get_comp_event(event_key)
