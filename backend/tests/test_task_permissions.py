"""Tests for the Task Assignments additions to core.permissions.

Pure logic, no database or FastAPI app needed -- mirrors permissions.py's own
"deliberately pure" design.
"""

from core.permissions import ROLE_DEFINITIONS, can, get_permissions_for_role, has_task_authority, task_buckets

# The authority set per the spec: every *_lead, captain, and mentor.
_AUTHORITY_ROLES = {
    "cad_lead", "electrical_lead", "manufacturing_lead", "programming_lead",
    "scouting_lead", "publicity_lead", "operations_lead", "outreach_lead",
    "captain", "mentor",
}
_NON_AUTHORITY_ROLES = set(ROLE_DEFINITIONS) - _AUTHORITY_ROLES


def test_every_role_has_a_tasks_policy_block():
    # A role missing this block would silently fail every tasks.* check
    # instead of raising, since core.permissions.can() treats a missing path
    # as False -- assert the block explicitly so that failure mode can't hide.
    for role, defn in ROLE_DEFINITIONS.items():
        tasks_policy = defn.get("tasks")
        assert isinstance(tasks_policy, dict), f"{role} is missing a 'tasks' policy block"
        assert tasks_policy.get("view") is True, f"{role}.tasks.view should be True"
        assert isinstance(tasks_policy.get("assign"), bool), f"{role}.tasks.assign should be a bool"


def test_every_role_can_view_tasks():
    for role in ROLE_DEFINITIONS:
        assert can(get_permissions_for_role(role), "tasks.view") is True


def test_authority_set_matches_leads_captain_mentor():
    for role in _AUTHORITY_ROLES:
        assert has_task_authority(role) is True, f"{role} should be in the tasks authority set"
        assert can(get_permissions_for_role(role), "tasks.assign") is True
    for role in _NON_AUTHORITY_ROLES:
        assert has_task_authority(role) is False, f"{role} should NOT be in the tasks authority set"
        assert can(get_permissions_for_role(role), "tasks.assign") is False


def test_has_task_authority_handles_unknown_role():
    assert has_task_authority(None) is False
    assert has_task_authority("not_a_real_role") is False


def test_task_buckets_is_every_subteam_plus_general_in_order():
    # Declaration order in ROLE_DEFINITIONS, deduplicated, with "general" last --
    # matches the spec's bucket list exactly.
    assert task_buckets() == [
        "cad",
        "electrical",
        "manufacturing",
        "programming",
        "scouting",
        "publicity",
        "operations",
        "outreach",
        "general",
    ]


def test_task_buckets_has_no_duplicates():
    buckets = task_buckets()
    assert len(buckets) == len(set(buckets))
