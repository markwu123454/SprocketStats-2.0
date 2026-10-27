import re
from datetime import date, datetime

import asyncpg
from pydantic import BaseModel, field_validator, model_validator

from .connection import DB_NAME, db_connection
from .events import ROLE_KEY_RE


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
    # None only on a dismissal entry (see `dismissed`).
    role: str | None = None
    phone: str | None = None
    # Dates the member expects to attend, as "YYYY-MM-DD" strings, or `None`
    # if never given. No validation here -- this field only exists so the
    # legacy PUT /content round-trip (CompEventContent.model_dump()) doesn't
    # silently drop `days` off of roster entries that already have it; the
    # actual validation lives on CheckInRequest/RosterUpdate below.
    days: list[str] | None = None
    # True marks a dismissal, not a check-in: the member hid this event's
    # check-in prompt. See `visible_roster` and the dismissal functions below.
    dismissed: bool = False


# ── Roster role set ─────────────────────────────────────────────────────────
#
# The roles a user may pick at check-in, or a privileged editor may assign
# via the roster-role PATCH, are each event's own `events.checkin_roles`
# (see db.events). These four are the keys every event starts with, and the
# fallback for an event with no schedule row. A roster entry can also hold a
# role outside its event's set (e.g. "chaperone", "captain", "lead", or a
# role later removed from the event), but neither API route here can set
# one, and stored data is never validated on read.
ASSIGNABLE_ROLES = ["drive_team", "pit_crew", "attending", "mentor"]

# Phone numbers are free-text (no fixed country format), so validation is
# deliberately permissive: digits, spaces, and the usual punctuation, with a
# floor on digit count so "----" can't pass as a phone number.
_PHONE_ALLOWED_CHARS = re.compile(r"^[0-9+\-() .]+$")

# Strict "YYYY-MM-DD" shape -- checked before date.fromisoformat so a full
# datetime string (or any other ISO-8601 variant Python's parser is lenient
# about) is rejected rather than silently truncated.
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _validate_days(v: list[str] | None, *, allow_none: bool) -> list[str] | None:
    """Shared `days` validation for CheckInRequest and RosterUpdate.

    1-31 entries, each exactly "YYYY-MM-DD" and a real calendar date;
    duplicates removed and the result sorted ascending (which, for this
    fixed-width form, is also chronological order). `None` is passed through
    unchanged when `allow_none` (check-in, where omitting `days` is valid and
    means "not given yet"); otherwise (the roster-role PATCH, where `days`
    can't be cleared) `None` -- whether defaulted or sent explicitly as
    `null` -- is rejected the same as an empty list.

    The lenient in-range-of-the-event check is a separate, async step (it
    needs a DB lookup) -- see `endpoints.events._enforce_days_in_range`.
    """
    if v is None:
        if allow_none:
            return None
        raise ValueError("days must not be empty")
    if not v:
        raise ValueError("days must not be empty")
    if len(v) > 31:
        raise ValueError("days must have at most 31 entries")
    cleaned: list[str] = []
    for d in v:
        if not isinstance(d, str) or not _DAY_RE.fullmatch(d):
            raise ValueError(f"invalid day {d!r}: must be in YYYY-MM-DD form")
        try:
            date.fromisoformat(d)
        except ValueError as e:
            raise ValueError(f"invalid day {d!r}: must be in YYYY-MM-DD form") from e
        cleaned.append(d)
    return sorted(set(cleaned))


def _validate_role_key(v: str) -> str:
    if not ROLE_KEY_RE.fullmatch(v):
        raise ValueError("role must be a role key")
    return v


class CheckInRequest(BaseModel):
    """Optional body for `POST /{event_key}/check-in`. Omitting the body, or
    omitting `role`, means `"attending"` (or the event's first role when it
    has no "attending"); omitting/blanking `phone` means `None`;
    omitting/nulling `days` means `None` (no days chosen yet).

    `role` is only shape-checked here -- whether it's one of *this event's*
    check-in roles needs a DB lookup, so the endpoint checks that."""

    role: str = "attending"
    phone: str | None = None
    days: list[str] | None = None

    @field_validator("role")
    @classmethod
    def _role_valid(cls, v: str) -> str:
        return _validate_role_key(v)

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

    @field_validator("days")
    @classmethod
    def _days_valid(cls, v: list[str] | None) -> list[str] | None:
        return _validate_days(v, allow_none=True)


class RosterUpdate(BaseModel):
    """Body for `PATCH /{event_key}/roster/{user_id}` -- any subset of
    `role` (one of ASSIGNABLE_ROLES) and `days` (same shape/rules as
    CheckInRequest.days, but can't be cleared: sending `null` or `[]` is
    rejected rather than treated as "no change"). At least one field is
    required; enforced by the endpoint, like `CompEventContentPatch`."""

    role: str | None = None
    days: list[str] | None = None

    @field_validator("role")
    @classmethod
    def _role_valid(cls, v: str | None) -> str:
        # Only runs when `role` is actually sent (omitted -> default `None`
        # skips validation), so an explicit `null` is the one way to reach
        # here with `v is None` -- rejected. Membership in the event's own
        # role list is checked by the endpoint, as for CheckInRequest.
        if v is None:
            raise ValueError("role must not be null")
        return _validate_role_key(v)

    @field_validator("days")
    @classmethod
    def _days_valid(cls, v: list[str] | None) -> list[str]:
        return _validate_days(v, allow_none=False)


class RosterMemberNotFound(Exception):
    """Raised by `update_roster_member` when `event_key` exists but has no
    roster entry with the given `user_id` (a hand-seeded entry with a null
    `user_id` is never addressable this way -- that's intended)."""


class UnknownRosterUser(Exception):
    """Raised by `replace_comp_event` when a roster entry's `user_id` isn't
    a known user."""


class CompEventContent(BaseModel):
    event_name: str
    links: Links | None = None
    itinerary: list[ItineraryItem] | None = None
    packing_list: list[PackingCategory] | None = None
    instructions: list[Instruction] | None = None
    roster: list[RosterMember] | None = None

    @model_validator(mode="after")
    def _one_entry_per_user(self) -> "CompEventContent":
        user_ids = [m.user_id for m in self.roster or [] if m.user_id is not None]
        if len(user_ids) != len(set(user_ids)):
            raise ValueError("roster lists a user more than once")
        return self


# ── Stricter item models for the content-PATCH path ────────────────────────
#
# These subclass the item models above rather than tightening them in place,
# so the existing PUT (`CompEventContent`, `replace_comp_event`) and the rows it
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


# An event's roster (event_roster rows) as the list of dicts the API returns,
# in roster order. A dismissal carries `"dismissed": true`; a check-in has no
# such key. A member's name is their current display_name, falling back to
# the one stored at check-in (always, for a guest with no account).
_ROSTER_JSON = """COALESCE((
    SELECT jsonb_agg(
        jsonb_build_object(
            'user_id', r.user_id,
            'display_name', COALESCE(u.display_name, r.display_name),
            'role', r.role,
            'phone', r.phone,
            'days', r.days
        ) || CASE WHEN r.dismissed THEN '{"dismissed": true}'::jsonb ELSE '{}'::jsonb END
        ORDER BY r.position
    )
    FROM event_roster r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.event_key = e.hub_key
), '[]'::jsonb)"""

# Every `events` row is a hub. Its content is read in the shape the old
# comp_events table had, which is what the API returns.
_HUB_COLUMNS = (
    "e.hub_key AS event_key, e.name AS event_name, "
    f"e.links, e.itinerary, e.packing_list, e.instructions, {_ROSTER_JSON} AS roster"
)


async def get_prefetch_event() -> dict | None:
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(f"""
            SELECT {_HUB_COLUMNS}
            FROM app_config ac
            JOIN events e ON e.hub_key = ac.prefetch_event_id
            LIMIT 1
        """)
        return dict(row) if row else None


async def set_prefetch_event(event_key: str | None) -> None:
    async with db_connection(DB_NAME) as conn:
        await conn.execute("UPDATE app_config SET prefetch_event_id = $1", event_key)


async def get_comp_event(event_key: str) -> dict | None:
    """The hub content of the event whose hub key is `event_key`, or `None`
    if there's no such event."""
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(
            f"SELECT {_HUB_COLUMNS} FROM events e WHERE e.hub_key = $1",
            event_key,
        )
        return dict(row) if row else None


async def get_comp_event_keys() -> list[str]:
    """Every event's hub key. Bootstrapped so the frontend can tell a real
    event from a 404 without waiting on a per-event fetch."""
    async with db_connection(DB_NAME) as conn:
        rows = await conn.fetch("SELECT hub_key FROM events")
        return [r["hub_key"] for r in rows]


async def replace_comp_event(event_key: str, content: CompEventContent) -> dict | None:
    """Overwrite an event's hub content (and its name) wholesale, roster
    included: its entries are replaced by `content.roster`, in that order.

    :returns: The updated hub, or `None` if no event has this hub key -- a
        hub can't exist without its event.
    :raises UnknownRosterUser: If a roster entry names a user that doesn't
        exist; nothing is changed.
    """
    data = content.model_dump()
    async with db_connection(DB_NAME) as conn:
        async with conn.transaction():
            updated = await conn.fetchval(
                """
                UPDATE events SET
                    name         = $2,
                    links        = $3,
                    itinerary    = $4,
                    packing_list = $5,
                    instructions = $6
                WHERE hub_key = $1
                RETURNING hub_key
                """,
                event_key,
                data["event_name"],
                data.get("links"),
                data.get("itinerary"),
                data.get("packing_list"),
                data.get("instructions"),
            )
            if updated is None:
                return None
            await conn.execute("DELETE FROM event_roster WHERE event_key = $1", event_key)
            try:
                await conn.executemany(
                    """
                    INSERT INTO event_roster (event_key, user_id, display_name, role, phone, days, dismissed)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    """,
                    [
                        (event_key, m["user_id"], m["display_name"], m["role"], m["phone"], m["days"], m["dismissed"])
                        for m in data.get("roster") or []
                    ],
                )
            except asyncpg.ForeignKeyViolationError as e:
                raise UnknownRosterUser() from e
            row = await conn.fetchrow(f"SELECT {_HUB_COLUMNS} FROM events e WHERE e.hub_key = $1", event_key)
        return dict(row)


# ── Check-in (roster) ───────────────────────────────────────────────────────
#
# An event's roster is its event_roster rows, of two kinds per member: a
# check-in, or a dismissal (`dismissed`, no role) recording that they hid the
# event's check-in prompt. A member has at most one row. Dismissals are
# bookkeeping, not attendance: every API response shows the roster through
# `visible_roster`, and "checked in" / role and day edits ignore them.


def is_dismissal(entry: dict) -> bool:
    return bool(entry.get("dismissed"))


def visible_roster(roster: list | None) -> list | None:
    """The roster as members see it: check-ins only, dismissals left out."""
    if roster is None:
        return None
    return [e for e in roster if not is_dismissal(e)]


async def _get_roster(conn, event_key: str) -> list | None:
    """The full roster (dismissals included), or `None` if no event has
    this hub key."""
    return await conn.fetchval(f"SELECT {_ROSTER_JSON} FROM events e WHERE e.hub_key = $1", event_key)


async def add_roster_member(event_key: str, member: dict) -> list | None:
    """Idempotently check `member` in to an event's roster.

    The unique (event_key, user_id) index makes the insert a no-op when this
    user already has a check-in, so two simultaneous check-ins can't
    duplicate them. A dismissal of theirs doesn't block it: it's deleted
    first, in the same transaction, and replaced by the check-in.

    :param member: The roster entry to add, e.g.
        ``{"user_id": ..., "display_name": ..., "role": "attending", "phone": None}``.
    :returns: The full roster (dismissals included) after the check-in (or
        after confirming the caller was already on it), or `None` if
        `event_key` doesn't exist.
    """
    async with db_connection(DB_NAME) as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM event_roster WHERE event_key = $1 AND user_id = $2 AND dismissed",
                event_key,
                member["user_id"],
            )
            await conn.execute(
                """
                INSERT INTO event_roster (event_key, user_id, display_name, role, phone, days)
                SELECT hub_key, $2, $3, $4, $5, $6 FROM events WHERE hub_key = $1
                ON CONFLICT (event_key, user_id) WHERE user_id IS NOT NULL DO NOTHING
                """,
                event_key,
                member["user_id"],
                member["display_name"],
                member["role"],
                member.get("phone"),
                member.get("days"),
            )
            return await _get_roster(conn, event_key)


async def is_on_roster(event_key: str, user_id: str) -> bool | None:
    """Return whether `user_id` is checked in to `event_key` (a dismissal
    doesn't count).

    :returns: `True`/`False`, or `None` if the event does not exist.
    """
    async with db_connection(DB_NAME) as conn:
        return await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1 FROM event_roster r
                WHERE r.event_key = e.hub_key AND r.user_id = $2 AND NOT r.dismissed
            )
            FROM events e WHERE e.hub_key = $1
            """,
            event_key,
            user_id,
        )


# Columns `update_roster_member` may set on one roster entry.
_ROSTER_UPDATABLE_COLUMNS = {"role", "days"}


async def update_roster_member(event_key: str, user_id: str, fields: dict) -> list | None:
    """Set one or more fields on one member's check-in, leaving every other
    field (e.g. `days` when only `role` was sent) and every other entry
    unchanged. Dismissals are never edited.

    :param fields: Column -> new value, restricted to
        `_ROSTER_UPDATABLE_COLUMNS`. `role` is a plain string; `days` is a
        list already produced by `RosterUpdate`'s validator.
    :returns: The full updated roster, or `None` if `event_key` doesn't exist.
    :raises ValueError: If `fields` is empty or names a column outside the
        whitelist -- callers should treat an empty `fields` dict as a no-op
        *before* calling this, not rely on it here.
    :raises RosterMemberNotFound: If the event exists but this user isn't
        checked in to it.
    """
    if not fields:
        raise ValueError("update_roster_member requires at least one field to set")
    unknown = set(fields) - _ROSTER_UPDATABLE_COLUMNS
    if unknown:
        raise ValueError(f"update_roster_member got unknown column(s): {sorted(unknown)}")

    params: list = [event_key, user_id]
    set_clauses = []
    for col, val in fields.items():
        params.append(val)
        set_clauses.append(f"{col} = ${len(params)}")
    query = f"""
        UPDATE event_roster SET {', '.join(set_clauses)}
        WHERE event_key = $1 AND user_id = $2 AND NOT dismissed
        RETURNING id
    """
    async with db_connection(DB_NAME) as conn:
        updated = await conn.fetchval(query, *params)
        roster = await _get_roster(conn, event_key)
    if updated is None and roster is not None:
        raise RosterMemberNotFound(user_id)
    return roster


async def get_event_schedule(event_key: str) -> dict | None:
    """Return `{"start_time", "end_time", "checkin_opens", "checkin_enabled",
    "checkin_roles"}` for the `events` row whose hub key is `event_key`, or
    `None` if there's no such row.

    Used by check-in's opening-time gate and role list, and by check-in's and
    the roster-role PATCH's lenient day-range check (see
    `endpoints.events._enforce_days_in_range`). The dates are TEXT and may be
    a bare date or a full datetime string, or `end_time`/`checkin_opens` may
    be null -- parsing them, and deciding what an unparseable or missing
    value means, is entirely the caller's job; this is a plain, single-query
    lookup with no date logic of its own.
    """
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(
            "SELECT start_time, end_time, checkin_opens, checkin_enabled, checkin_roles "
            "FROM events WHERE hub_key = $1",
            event_key,
        )
        return dict(row) if row else None


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
    :returns: The full updated hub (same shape `get_comp_event` returns), or
        `None` if `event_key` doesn't exist.
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

    query = f"UPDATE events e SET {', '.join(set_clauses)} WHERE e.hub_key = ${len(params)} RETURNING {_HUB_COLUMNS}"
    async with db_connection(DB_NAME) as conn:
        row = await conn.fetchrow(query, *params)
    return dict(row) if row else None


# ── Check-in dismissals (event_roster rows with dismissed = true) ──────────

async def is_check_in_dismissed(event_key: str, user_id: str) -> bool:
    async with db_connection(DB_NAME) as conn:
        return await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM event_roster WHERE event_key = $1 AND user_id = $2 AND dismissed)",
            event_key,
            user_id,
        )


async def set_check_in_dismissed(event_key: str, user_id: str, display_name: str, dismissed: bool) -> None:
    """Add (or remove) `user_id`'s dismissal on `event_key`'s roster.
    Idempotent either way. Dismissing is a no-op for someone already checked
    in -- a check-in isn't undone by dismissing the prompt -- and for an
    event that doesn't exist."""
    async with db_connection(DB_NAME) as conn:
        if dismissed:
            await conn.execute(
                """
                INSERT INTO event_roster (event_key, user_id, display_name, dismissed)
                SELECT hub_key, $2, $3, true FROM events WHERE hub_key = $1
                ON CONFLICT (event_key, user_id) WHERE user_id IS NOT NULL DO NOTHING
                """,
                event_key,
                user_id,
                display_name,
            )
        else:
            await conn.execute(
                "DELETE FROM event_roster WHERE event_key = $1 AND user_id = $2 AND dismissed",
                event_key,
                user_id,
            )
