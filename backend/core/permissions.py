"""Role → policy definitions and lookup helpers.

This module is the single source of truth for what each role *is* and *can do*.
Every role maps to a nested "policy object" that bundles two kinds of thing:

  * access permissions — e.g. ``control_panel.view`` (can this role open the
    Control Panel), and
  * role attributes / metadata — e.g. ``label`` (display name) and
    ``school_info.required`` (does onboarding ask this role for grade/team year).

Keeping both in one object means a role has exactly one definition instead of
flags scattered across the frontend and backend. The structure is intentionally
a nested dict so values can be booleans, numbers, strings, or further nesting
without changing the shape of callers.

This module is deliberately pure: it has no FastAPI / request dependencies so it
stays trivially testable. The request-time enforcement dependency
(``require_access``) lives in ``core.security`` where ``get_current_user``
is available, to avoid a circular import.
"""

from typing import Any

# Moderation-authority specs, shared by role definitions below. `can_moderate`
# governs who may approve/unapprove and ban/unban whom — one scope for all four
# actions. `all` = any target; `subteam` = targets whose level is in
# `target_levels` and whose subteam matches the actor's, plus any role listed in
# `extra_roles` (subteam-agnostic, e.g. alumni). See `can_role_moderate`.
_MODERATE_ALL: dict[str, Any] = {"scope": "all"}
_MODERATE_SUBTEAM: dict[str, Any] = {"scope": "subteam", "target_levels": ["member"], "extra_roles": ["alumni"]}

# Each role → its full policy object. `control_panel.view` is an access
# permission; `school_info.required` and `label` are role attributes. `level` /
# `subteam` place the role in the org (subteam is None for team-wide roles);
# `requires_approval` marks a role that can't be used until an approver signs off
# (enforced at /auth/me); `can_moderate` is this role's moderation authority.
ROLE_DEFINITIONS: dict[str, dict[str, Any]] = {
    "cad_member":           {"label": "CAD Member",           "level": "member", "subteam": "cad",           "requires_approval": False, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "cad_lead":             {"label": "CAD Lead",             "level": "lead",   "subteam": "cad",           "requires_approval": True,  "can_moderate": _MODERATE_SUBTEAM, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True, "notifications": True}},
    "electrical_member":    {"label": "Electrical Member",    "level": "member", "subteam": "electrical",    "requires_approval": False, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "electrical_lead":      {"label": "Electrical Lead",      "level": "lead",   "subteam": "electrical",    "requires_approval": True,  "can_moderate": _MODERATE_SUBTEAM, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True, "notifications": True}},
    "manufacturing_member": {"label": "Manufacturing Member", "level": "member", "subteam": "manufacturing", "requires_approval": False, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "manufacturing_lead":   {"label": "Manufacturing Lead",   "level": "lead",   "subteam": "manufacturing", "requires_approval": True,  "can_moderate": _MODERATE_SUBTEAM, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True, "notifications": True}},
    "programming_member":   {"label": "Programming Member",   "level": "member", "subteam": "programming",   "requires_approval": False, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "programming_lead":     {"label": "Programming Lead",     "level": "lead",   "subteam": "programming",   "requires_approval": True,  "can_moderate": _MODERATE_SUBTEAM, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True, "notifications": True}},
    "scouting_member":      {"label": "Scouting Member",      "level": "member", "subteam": "scouting",      "requires_approval": False, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_time": True, "meeting_agenda": True, "upcoming_event": True}},
    "scouting_lead":        {"label": "Scouting Lead",        "level": "lead",   "subteam": "scouting",      "requires_approval": True,  "can_moderate": _MODERATE_SUBTEAM, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_time": True, "meeting_agenda": True, "upcoming_event": True, "notifications": True}},
    "publicity_member":     {"label": "Publicity Member",     "level": "member", "subteam": "publicity",     "requires_approval": False, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "publicity_lead":       {"label": "Publicity Lead",       "level": "lead",   "subteam": "publicity",     "requires_approval": True,  "can_moderate": _MODERATE_SUBTEAM, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True, "notifications": True}},
    "operations_member":    {"label": "Operations Member",    "level": "member", "subteam": "operations",    "requires_approval": False, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "operations_lead":      {"label": "Operations Lead",      "level": "lead",   "subteam": "operations",    "requires_approval": True,  "can_moderate": _MODERATE_SUBTEAM, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True, "notifications": True}},
    "outreach_member":      {"label": "Outreach Member",      "level": "member", "subteam": "outreach",      "requires_approval": False, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "outreach_lead":        {"label": "Outreach Lead",        "level": "lead",   "subteam": "outreach",      "requires_approval": True,  "can_moderate": _MODERATE_SUBTEAM, "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True, "notifications": True}},
    "captain":              {"label": "Captain",              "level": "captain", "subteam": None,           "requires_approval": True,  "can_moderate": _MODERATE_ALL,     "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_time": True, "meeting_agenda": True, "upcoming_event": True, "members": True, "notifications": True}},
    "mentor":               {"label": "Mentor",               "level": "mentor",  "subteam": None,           "requires_approval": True,  "can_moderate": _MODERATE_ALL,     "school_info": {"required": False}, "attendance": {"view": False}, "control_panel": {"view": True, "meeting_time": True, "meeting_agenda": True, "upcoming_event": True, "members": True, "notifications": True}},
    "alumni":               {"label": "Alumni",               "level": "alumni",  "subteam": None,           "requires_approval": False, "school_info": {"required": False}, "attendance": {"view": False}, "control_panel": {"view": False}},
}


def get_permissions_for_role(role: str | None) -> dict[str, Any]:
    """Return the full policy object for a role.

    Users hold a single role (see ``users.role``), so this is a direct lookup
    with no merging. Returns an empty dict for an unknown or missing role, which
    makes every downstream ``can(...)`` check evaluate to ``False`` — i.e. an
    unrecognised role is treated as having no permissions.

    :param role: The role slug (e.g. ``"scouting_lead"``) or ``None``.
    :returns: The role's policy object, or ``{}`` if the role is unknown/``None``.
    """
    if not role:
        return {}
    return ROLE_DEFINITIONS.get(role, {})


def get_perm(perms: dict[str, Any] | None, path: str) -> Any:
    """Safely read a value from a policy object by dotted path.

    Walks a ``"a.b.c"`` path through the nested policy dict, returning ``None``
    the moment any segment is missing rather than raising ``KeyError`` /
    ``TypeError``. This is the only supported way to read nested policy values —
    callers must never index the dict directly, so a missing branch can never
    crash a request.

    :param perms: A policy object (e.g. from :func:`get_permissions_for_role`).
    :param path: Dotted key path, e.g. ``"control_panel.view"``.
    :returns: The value at ``path``, or ``None`` if any segment is absent.
    """
    node: Any = perms
    for key in path.split("."):
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node


def can(perms: dict[str, Any] | None, path: str) -> bool:
    """Return whether a policy grants a boolean capability at ``path``.

    Thin truthiness wrapper over :func:`get_perm` for the common yes/no case,
    e.g. ``can(perms, "control_panel.view")``. A missing path is ``False``.

    :param perms: A policy object.
    :param path: Dotted capability path, e.g. ``"control_panel.view"``.
    :returns: ``True`` if the value at ``path`` is truthy, else ``False``.
    """
    return bool(get_perm(perms, path))


def role_requires_approval(role: str | None) -> bool:
    """Return whether ``role`` may not be used until an approver signs off.

    Reads the ``requires_approval`` attribute from :data:`ROLE_DEFINITIONS`. This
    is the single gate that ``/auth/me`` consults to block an onboarded-but-not-yet
    -approved user. An unknown/``None`` role is treated as not requiring approval
    (it has no powers to protect anyway).

    :param role: The role slug, or ``None``.
    :returns: ``True`` if the role is locked behind approval, else ``False``.
    """
    return bool(get_perm(get_permissions_for_role(role), "requires_approval"))


def has_moderation_authority(role: str | None) -> bool:
    """Return whether ``role`` may moderate (approve/ban) at least someone.

    True when the role carries a ``can_moderate`` spec (Captains, Mentors, and
    Leads). Used to admit Leads to the read-only member roster alongside the
    Captains/Mentors who hold ``control_panel.members``.

    :param role: The role slug, or ``None``.
    :returns: ``True`` if the role has any moderation authority, else ``False``.
    """
    return get_perm(get_permissions_for_role(role), "can_moderate") is not None


def can_role_moderate(actor_role: str | None, target_role: str | None) -> bool:
    """Return whether ``actor_role`` may moderate a user holding ``target_role``.

    Moderation covers approve/unapprove and ban/unban — all four share this one
    scope. Evaluates the actor's ``can_moderate`` spec against the target's role:

      * no spec → ``False`` (members/alumni can't moderate);
      * ``scope == "all"`` → ``True`` (Captains/Mentors moderate anyone);
      * ``scope == "subteam"`` → ``True`` if the target role is in ``extra_roles``
        (e.g. alumni), or the target's ``level`` is in ``target_levels`` *and* its
        ``subteam`` equals the actor's (Leads moderate their own subteam's members).

    This is authority only; it deliberately does not check whether the actor is
    themselves approved (enforcement is at ``/auth/me`` for now).

    :param actor_role: The role performing the action.
    :param target_role: The role of the user being acted on.
    :returns: ``True`` if the action is within the actor's scope, else ``False``.
    """
    spec = get_perm(get_permissions_for_role(actor_role), "can_moderate")
    if not isinstance(spec, dict):
        return False
    if spec.get("scope") == "all":
        return True
    if spec.get("scope") == "subteam":
        if target_role in spec.get("extra_roles", []):
            return True
        target = get_permissions_for_role(target_role)
        actor = get_permissions_for_role(actor_role)
        return (
            get_perm(target, "level") in spec.get("target_levels", [])
            and get_perm(target, "subteam") is not None
            and get_perm(target, "subteam") == get_perm(actor, "subteam")
        )
    return False


# Coarse seniority ranking, keyed by a role's ``level``, for deciding who may
# edit whose *authored content* (e.g. dashboard notices). This is distinct from
# ``can_moderate`` (which is about moderating *people*, subteam-scoped): here we
# only compare authority to edit a resource. Members/alumni have no authoring
# authority (0); leads are peers (1); captains and mentors sit above them (2).
_LEVEL_RANKS: dict[str, int] = {"member": 0, "alumni": 0, "lead": 1, "captain": 2, "mentor": 2}


def role_rank(role: str | None) -> int:
    """Return the content-authority rank of ``role`` (higher = more senior).

    Derived from the role's ``level`` in :data:`ROLE_DEFINITIONS`: members/alumni
    ``0``, leads ``1``, captains/mentors ``2``. An unknown/``None`` role — or one
    whose level isn't ranked — is ``0`` (no authority).

    :param role: The role slug, or ``None``.
    :returns: The role's authority rank.
    """
    level = get_perm(get_permissions_for_role(role), "level")
    return _LEVEL_RANKS.get(level, 0)


def can_edit_authored(actor_role: str | None, author_role: str | None) -> bool:
    """Return whether ``actor_role`` may edit content authored by ``author_role``.

    True when the actor's authority rank is at least the author's, so peers of
    equal seniority can edit each other's work (a lead may edit another lead's
    notice) and seniors can edit juniors' — but a junior cannot edit a senior's
    (a lead may not edit a captain's/mentor's notice). Editing one's own content
    always holds (equal rank). An unknown author ranks ``0``, so anyone with the
    authoring capability can edit orphaned content.

    :param actor_role: The role attempting the edit.
    :param author_role: The role that authored the content.
    :returns: ``True`` if the edit is within the actor's authority, else ``False``.
    """
    return role_rank(actor_role) >= role_rank(author_role)


def role_catalog() -> list[dict[str, Any]]:
    """Return the public list of roles for the onboarding picker and roster UI.

    During onboarding the user is authenticated but has not chosen a role yet,
    so the frontend needs metadata for *every* role up front (which ``/auth/me``
    cannot provide, as it only knows the current user's role). The Members roster
    also uses this to place each row (``level``/``subteam``) when deciding whether
    the current user may moderate it. Derived from :data:`ROLE_DEFINITIONS`,
    preserving its declaration order.

    :returns: A list of ``{"value", "label", "school_info_required", "level",
        "subteam", "requires_approval"}`` dicts.
    """
    return [
        {
            "value": role,
            "label": defn.get("label", role),
            "school_info_required": bool(get_perm(defn, "school_info.required")),
            "level": get_perm(defn, "level"),
            "subteam": get_perm(defn, "subteam"),
            "requires_approval": bool(get_perm(defn, "requires_approval")),
        }
        for role, defn in ROLE_DEFINITIONS.items()
    ]


__all__ = [
    "ROLE_DEFINITIONS",
    "get_permissions_for_role",
    "get_perm",
    "can",
    "role_requires_approval",
    "has_moderation_authority",
    "can_role_moderate",
    "role_rank",
    "can_edit_authored",
    "role_catalog",
]
