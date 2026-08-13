"""Single prefetch endpoint fired on app load during the loading screen.

Calls existing endpoint handlers directly so the client cache is warm before
the user navigates anywhere. Pages still issue their own fetches when visited
— this just eliminates the blank-state delay on first navigation.

No business logic lives here. Each entry delegates entirely to its handler,
so output shape and internal rules stay owned by the respective modules.

Adding a new endpoint to the bootstrap is one line in ENDPOINTS below.

Excluded deliberately:
  - Labeling: hits the external Label Studio API; ScoutingPage fetches its own.
  - TBA / Statbotics / Nexus: server-proxied but per-page fetches — Schedule and
    Scouting pages call /events/{key}/schedule|rankings|teams|nexus individually.
"""

import asyncio

from fastapi import APIRouter, Depends

from core.permissions import can, get_permissions_for_role, has_moderation_authority
from core.security import get_current_user
from .attendance import get_meetings
from .events import list_events
from .members import list_members
from .tags import get_all_assignments, get_user_tags

router = APIRouter()

# ── Endpoint registry ─────────────────────────────────────────────────────────
#
# Each entry: (response_key, coroutine_factory, guard)
#
#   response_key  — key in the bootstrap JSON the frontend reads
#   factory       — lambda(user) returning the coroutine to await
#   guard         — None: all authenticated users
#                   "roster": leads, captains, and mentors only
#
# URL cross-reference (what each page fetches independently on its own visit):
#   meetings         → GET /attendance/meetings
#   tag_assignments  → GET /tags/assignments
#   user_tags        → GET /tags/user/{id}
#   members          → GET /members

ENDPOINTS: list[tuple[str, object, str | None]] = [
    ("events",          lambda u: list_events(),            None),
    ("meetings",        lambda u: get_meetings(),          None),
    ("tag_assignments", lambda u: get_all_assignments(),   None),
    ("user_tags",       lambda u: get_user_tags(u["sub"]), None),
    ("members",         lambda u: list_members(user=u),    "roster"),
]


@router.get("")
async def bootstrap(user: dict = Depends(get_current_user)):
    role = user.get("role")
    guards: dict[str, bool] = {
        "roster": (
            can(get_permissions_for_role(role), "control_panel.members")
            or has_moderation_authority(role)
        ),
    }

    eligible = [
        (key, factory)
        for key, factory, guard in ENDPOINTS
        if guard is None or guards.get(guard, False)
    ]

    results = await asyncio.gather(*[factory(user) for _, factory in eligible])
    return {key: result for (key, _), result in zip(eligible, results)}
