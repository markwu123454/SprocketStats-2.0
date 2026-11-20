"""Member code format and the timing rule (core.member_codes)."""

import pytest

from core import member_codes as mc

MEMBER = "104837261955310428817"
NUMBER = 42
STEP = 1000
MID_STEP = STEP * mc.STEP_SECONDS + 5.0  # halfway through step 1000


@pytest.fixture(autouse=True)
def server_key(monkeypatch):
    monkeypatch.setenv(mc.KEY_ENV, "test-member-code-key")


def secret(version: int = 1) -> bytes:
    return mc.member_secret(MEMBER, version)


def code_at(step: int, version: int = 1) -> mc.ParsedCode:
    return mc.parse(mc.code_for(secret(version), NUMBER, step))


def test_code_is_header_number_and_tag():
    code = mc.code_for(secret(), NUMBER, STEP)
    assert len(code) == 24 and code.isdigit()
    assert code.startswith("00" + "0042")
    assert mc.parse(code) == mc.ParsedCode(mc.FORMAT_VERSION, mc.TYPE_CHECKIN, NUMBER, code[6:])


def test_header_packs_version_and_type():
    assert mc.header(0, 0) == "00"
    assert mc.header(0, mc.TYPE_ELECTRICAL_INVENTORY) == "01"
    assert mc.header(1, 0) == "16"
    assert mc.header(3, 15) == "63"
    with pytest.raises(ValueError):
        mc.header(4, 0)
    with pytest.raises(ValueError):
        mc.header(0, 16)


def test_matches_shared_vector():
    # The phone's implementation (frontend/src/lib/memberCode.test.ts) checks the same values.
    s = bytes(range(32))
    assert mc.code_for(s, NUMBER, 179463961) == "000042605876915828510742"
    assert mc.code_for(s, NUMBER, 179463962) == "000042890758023363107329"
    assert mc.code_for(s, 9999, 179463961) == "009999664936680702660784"
    assert mc.secret_b64(s) == "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"


def test_inventory_type_parses_as_its_own_kind():
    code = mc.code_for(secret(), NUMBER, STEP, kind=mc.TYPE_ELECTRICAL_INVENTORY)
    assert code.startswith("01")
    parsed = mc.parse(code)
    assert parsed.kind == mc.TYPE_ELECTRICAL_INVENTORY
    assert mc.verify(parsed, secret(), MID_STEP)


@pytest.mark.parametrize("raw", [
    "", "hello", "1" * 23, "1" * 25, "a" * 24,
    "64" + "0" * 22,  # header past 6 bits
    "16" + "0" * 22,  # version 1: not a format this server knows
])
def test_parse_rejects_other_text(raw):
    assert mc.parse(raw) is None


def test_header_is_signed():
    # Relabelling a check-in code as another type breaks its tag.
    parsed = code_at(STEP)
    relabelled = mc.ParsedCode(parsed.version, mc.TYPE_ELECTRICAL_INVENTORY, parsed.code_number, parsed.tag)
    assert not mc.verify(relabelled, secret(), MID_STEP)


# LEGACY-16-DIGIT: delete with the warning; see NEXT_UPDATE_CLEANUP.md.
def test_legacy_codes_are_recognized_but_not_parsed():
    old = "0042853876120619"
    assert mc.is_legacy(old)
    assert mc.parse(old) is None
    assert not mc.is_legacy(mc.code_for(secret(), NUMBER, STEP))


def test_current_step_accepted():
    assert mc.verify(code_at(STEP), secret(), MID_STEP)


def test_previous_step_only_within_grace():
    boundary = STEP * mc.STEP_SECONDS
    assert mc.verify(code_at(STEP - 1), secret(), boundary + 0.9)
    assert not mc.verify(code_at(STEP - 1), secret(), boundary + 1.1)


def test_next_step_rejected():
    assert not mc.verify(code_at(STEP + 1), secret(), MID_STEP)


def test_bumped_version_rejects_old_codes():
    assert not mc.verify(code_at(STEP, version=1), secret(2), MID_STEP)


def test_tampered_code_rejected():
    parsed = code_at(STEP)
    flipped = ("1" if parsed.tag[-1] != "1" else "2")
    tampered = mc.ParsedCode(parsed.version, parsed.kind, NUMBER, parsed.tag[:-1] + flipped)
    assert not mc.verify(tampered, secret(), MID_STEP)


def test_tag_is_bound_to_the_code_number():
    parsed = code_at(STEP)
    moved = mc.ParsedCode(parsed.version, parsed.kind, NUMBER + 1, parsed.tag)
    assert not mc.verify(moved, secret(), MID_STEP)


def test_clock_offset_explains_rejections():
    assert mc.clock_offset(code_at(STEP + 3), secret(), MID_STEP) == 30
    assert mc.clock_offset(code_at(STEP - 3), secret(), MID_STEP) == -30
    tampered = mc.ParsedCode(mc.FORMAT_VERSION, mc.TYPE_CHECKIN, NUMBER, "0" * mc.TAG_DIGITS)
    assert mc.clock_offset(tampered, secret(), MID_STEP) is None
