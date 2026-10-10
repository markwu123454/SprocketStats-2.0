"""Tests for the `events.edit` permission added to core.permissions.

Pure logic, no database or FastAPI app needed -- mirrors
test_task_permissions.py's approach for the (structurally identical)
`tasks.assign` authority set: every *_lead, captain, and mentor should hold
`events.edit`; members and alumni should not.
"""

from core.permissions import ROLE_DEFINITIONS, can, get_permissions_for_role, has_task_authority

_EVENT_EDIT_ROLES = {
    "cad_lead", "electrical_lead", "manufacturing_lead", "programming_lead",
    "scouting_lead", "publicity_lead", "operations_lead", "outreach_lead",
    "captain", "mentor",
}
_NO_EVENT_EDIT_ROLES = set(ROLE_DEFINITIONS) - _EVENT_EDIT_ROLES


def test_every_lead_captain_and_mentor_has_events_edit():
    for role in _EVENT_EDIT_ROLES:
        assert can(get_permissions_for_role(role), "events.edit") is True, (
            f"{role} should have events.edit"
        )


def test_members_and_alumni_lack_events_edit():
    for role in _NO_EVENT_EDIT_ROLES:
        assert can(get_permissions_for_role(role), "events.edit") is False, (
            f"{role} should NOT have events.edit"
        )


def test_events_edit_set_matches_task_authority_set():
    # The spec defines both authority sets identically (every *_lead, captain,
    # mentor) -- assert they haven't drifted apart.
    for role in ROLE_DEFINITIONS:
        assert can(get_permissions_for_role(role), "events.edit") == has_task_authority(role)
