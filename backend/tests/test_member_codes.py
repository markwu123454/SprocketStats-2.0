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


def test_code_is_16_digits_with_code_number():
    code = mc.code_for(secret(), NUMBER, STEP)
    assert len(code) == 16 and code.isdigit()
    assert code.startswith("0042")
    assert mc.parse(code) == mc.ParsedCode(NUMBER, code[4:])


def test_matches_shared_vector():
    # The phone's implementation (frontend/src/lib/memberCode.test.ts) checks the same values.
    s = bytes(range(32))
    assert mc.code_for(s, NUMBER, 179463961) == "0042853876120619"
    assert mc.code_for(s, NUMBER, 179463962) == "0042226907458202"
    assert mc.code_for(s, 9999, 179463961) == "9999332735996435"
    assert mc.secret_b64(s) == "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"


@pytest.mark.parametrize("raw", ["", "hello", "1" * 15, "1" * 17, "a" * 16, "1" + "0" * 41])
def test_parse_rejects_other_text(raw):
    assert mc.parse(raw) is None


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
    assert not mc.verify(mc.ParsedCode(NUMBER, parsed.tag[:-1] + flipped), secret(), MID_STEP)


def test_tag_is_bound_to_the_code_number():
    parsed = code_at(STEP)
    assert not mc.verify(mc.ParsedCode(NUMBER + 1, parsed.tag), secret(), MID_STEP)


def test_clock_offset_explains_rejections():
    assert mc.clock_offset(code_at(STEP + 3), secret(), MID_STEP) == 30
    assert mc.clock_offset(code_at(STEP - 3), secret(), MID_STEP) == -30
    tampered = mc.ParsedCode(NUMBER, "0" * mc.TAG_DIGITS)
    assert mc.clock_offset(tampered, secret(), MID_STEP) is None
