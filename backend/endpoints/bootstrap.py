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
import logging

from fastapi import APIRouter, Depends, HTTPException

from core import account_state
from core.permissions import can, get_permissions_for_role, has_moderation_authority
from core.security import get_current_user
from .attendance import get_meetings, get_leaderboard
from .auth import roles as auth_roles
from .events import list_events, get_current_event_info, list_event_keys
from .meeting_hours import (
    list_absences as list_meeting_absences,
    list_meetings as list_meeting_schedule,
)
from .members import list_members
from .tags import get_all_assignments, get_user_tags
from .tasks import list_tasks, list_people as list_task_people

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Endpoint registry ─────────────────────────────────────────────────────────
#
# Each entry: (response_key, coroutine_factory, guard)
#
#   response_key  — key in the bootstrap JSON the frontend reads
#   factory       — lambda(user) returning the coroutine to await
#   guard         — None: all authenticated users
#                   "roster": leads, captains, and mentors only
#                   "active": not banned / pending approval. Handlers behind
#                     require_active also run account_state.assert_active, a
#                     dependency that direct calls bypass, so it is re-checked
#                     here (once per request).
#
# Factories call endpoint functions (from .events, .attendance, etc.), never
# db.* directly. The point of bootstrap is to prefetch what each endpoint
# would return — permission checks, response shaping, joins with other data —
# not to reach around that and return raw db output.
#
# URL cross-reference (what each page fetches independently on its own visit):
#   meetings         → GET /attendance/meetings
#   tag_assignments  → GET /tags/assignments
#   user_tags        → GET /tags/user/{id}
#   members          → GET /members
#   event_keys       → GET /events/list_events
#   tasks            → GET /tasks
#   task_people      → GET /tasks/people
#   meeting_schedule → GET /meeting-hours
#   meeting_absences → GET /meeting-hours/absences
#   attendance_leaderboard → GET /attendance/leaderboard
#   roles            → GET /auth/roles
#
# A factory that raises is logged and its key is simply omitted from the
# response; one failing prefetch never fails the whole bootstrap.

ENDPOINTS: list[tuple[str, object, str | None]] = [
    ("events",          lambda u: list_events(),              None),
    ("meetings",        lambda u: get_meetings(),             None),
    ("tag_assignments", lambda u: get_all_assignments(),      None),
    ("user_tags",       lambda u: get_user_tags(u["sub"]),    None),
    ("members",         lambda u: list_members(user=u),       "roster"),
    ("current_event",   lambda u: get_current_event_info(u),  None),
    ("event_keys",      lambda u: list_event_keys(),          None),
    ("tasks",           lambda u: list_tasks(None, u),        "active"),
    ("task_people",     lambda u: list_task_people(u),        "active"),
    ("meeting_schedule", lambda u: list_meeting_schedule(u),  "active"),
    ("meeting_absences", lambda u: list_meeting_absences(u),  "active"),
    ("attendance_leaderboard", lambda u: get_leaderboard(u),  None),
    ("roles",           lambda u: auth_roles(u),              None),
]


async def _is_active(user: dict) -> bool:
    try:
        await account_state.assert_active(user["sub"])
    except HTTPException:
        return False
    return True


async def _run(key: str, factory, user: dict):
    """Run one factory; an exception is logged and surfaces as a dropped key."""
    try:
        return await factory(user)
    except Exception:
        logger.exception("bootstrap: %s failed; omitting from response", key)
        raise


@router.get("")
async def bootstrap(user: dict = Depends(get_current_user)):
    role = user.get("role")
    guards: dict[str, bool] = {
        "roster": (
            can(get_permissions_for_role(role), "control_panel.members")
            or has_moderation_authority(role)
        ),
        "active": await _is_active(user),
    }

    eligible = [
        (key, factory)
        for key, factory, guard in ENDPOINTS
        if guard is None or guards.get(guard, False)
    ]

    results = await asyncio.gather(
        *[_run(key, factory, user) for key, factory in eligible],
        return_exceptions=True,
    )
    return {
        key: result
        for (key, _), result in zip(eligible, results)
        if not isinstance(result, BaseException)
    }
