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
(``require_permission``) lives in ``endpoints.auth`` where ``get_current_user``
is available, to avoid a circular import.
"""

from typing import Any

# Each role → its full policy object. `control_panel.view` is an access
# permission; `school_info.required` and `label` are role attributes.
ROLE_DEFINITIONS: dict[str, dict[str, Any]] = {
    "cad_member":           {"label": "CAD Member",           "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "cad_lead":             {"label": "CAD Lead",             "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True}},
    "manufacturing_member": {"label": "Manufacturing Member", "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "manufacturing_lead":   {"label": "Manufacturing Lead",   "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True}},
    "programming_member":   {"label": "Programming Member",   "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "programming_lead":     {"label": "Programming Lead",     "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True}},
    "scouting_member":      {"label": "Scouting Member",      "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_time": True, "meeting_agenda": True, "upcoming_event": True}},
    "scouting_lead":        {"label": "Scouting Lead",        "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_time": True, "meeting_agenda": True, "upcoming_event": True}},
    "publicity_member":     {"label": "Publicity Member",     "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "publicity_lead":       {"label": "Publicity Lead",       "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True}},
    "operations_member":    {"label": "Operations Member",    "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "operations_lead":      {"label": "Operations Lead",      "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True}},
    "outreach_member":      {"label": "Outreach Member",      "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": False}},
    "outreach_lead":        {"label": "Outreach Lead",        "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_agenda": True}},
    "captain":              {"label": "Captain",              "school_info": {"required": True},  "attendance": {"view": True},  "control_panel": {"view": True, "meeting_time": True, "meeting_agenda": True, "upcoming_event": True}},
    "mentor":               {"label": "Mentor",               "school_info": {"required": False}, "attendance": {"view": False}, "control_panel": {"view": True, "meeting_time": True, "meeting_agenda": True, "upcoming_event": True}},
    "alumni":               {"label": "Alumni",               "school_info": {"required": False}, "attendance": {"view": False}, "control_panel": {"view": False}},
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


def role_catalog() -> list[dict[str, Any]]:
    """Return the public list of roles for the onboarding role picker.

    During onboarding the user is authenticated but has not chosen a role yet,
    so the frontend needs metadata for *every* role up front (which ``/auth/me``
    cannot provide, as it only knows the current user's role). This exposes just
    the fields the picker needs — value, display label, and whether the role
    requires school info — derived from :data:`ROLE_DEFINITIONS`, preserving its
    declaration order.

    :returns: A list of ``{"value", "label", "school_info_required"}`` dicts.
    """
    return [
        {
            "value": role,
            "label": defn.get("label", role),
            "school_info_required": bool(get_perm(defn, "school_info.required")),
        }
        for role, defn in ROLE_DEFINITIONS.items()
    ]


__all__ = [
    "ROLE_DEFINITIONS",
    "get_permissions_for_role",
    "get_perm",
    "can",
    "role_catalog",
]
