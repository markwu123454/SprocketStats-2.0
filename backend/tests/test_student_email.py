"""Tests for the student-email rule and the visitor role in core.permissions.

Pure logic, no database or FastAPI app needed.
"""

from core.permissions import (
    ROLE_DEFINITIONS,
    email_allowed_for_role,
    role_catalog,
    role_is_student,
    role_requires_approval,
)

_NON_STUDENT_ROLES = {"mentor", "alumni", "visitor"}


def test_every_role_but_mentor_alumni_visitor_is_student():
    for role in ROLE_DEFINITIONS:
        assert role_is_student(role) is (role not in _NON_STUDENT_ROLES), role


def test_student_roles_require_school_email():
    for role in ROLE_DEFINITIONS:
        if not role_is_student(role):
            continue
        assert email_allowed_for_role("jdoe@stu.wvusd.org", role)
        assert email_allowed_for_role("JDoe@STU.WVUSD.ORG", role)
        assert not email_allowed_for_role("jdoe@gmail.com", role)
        assert not email_allowed_for_role("jdoe@wvusd.org", role)
        assert not email_allowed_for_role("jdoe@evilstu.wvusd.org", role)
        assert not email_allowed_for_role(None, role)


def test_non_student_roles_accept_any_email():
    for role in _NON_STUDENT_ROLES:
        assert email_allowed_for_role("someone@gmail.com", role)


def test_visitor_role_requires_approval_and_no_school_info():
    assert "visitor" in ROLE_DEFINITIONS
    assert role_requires_approval("visitor") is True
    entry = next(r for r in role_catalog() if r["value"] == "visitor")
    assert entry["school_info_required"] is False
    assert entry["student"] is False
