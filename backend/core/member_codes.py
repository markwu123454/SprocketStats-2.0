"""Rotating member codes: what a member's phone shows and a kiosk's camera reads.

A code is 24 digits: a 2-digit header, the member's 4-digit code number
(``users.code_number``) and an 18-digit tag.

- The header packs a 2-bit format version and a 4-bit type as
  ``version * 16 + type``, written 00-63. Version 0 with type 0 (check-in /
  check-out) is ``00``; type 1 is reserved for electrical inventory.
- The tag is the first 64 bits of
  ``HMAC-SHA256(member_secret, f"SSID3|{header}|{code_number:04d}|{step}")``
  reduced mod 10^18 and zero-padded, where
  ``step = floor(unix_seconds / STEP_SECONDS)``. The header is signed, so a code
  can't be relabelled as another type or version.

Twenty-four digits is exactly what a 16x16 Data Matrix holds (12 codewords, two
digits each), the smallest symbol with room for the header and a ~60-bit tag,
so each module stays as large as the phone screen allows. Codes are only ever
checked online by an authorized kiosk, so guessing is hopeless.

``member_secret = HMAC-SHA256(ATTENDANCE_CODE_KEY, f"member-code|{member_id}|{code_version}")``,
keyed by the account id, not the code number. Nothing secret is stored: the
phone downloads its secret once, and bumping ``users.code_version`` revokes
every device's copy.

Timing: the server judges a code against the moment the kiosk saw it
(``scanned_at``, which must be within ``MAX_SCAN_SKEW_SECONDS`` of the server
clock). The current step is accepted, and the previous one only within
``GRACE_SECONDS`` of the rotation. Phones switch codes half a second after each
step boundary, which centres every code in that window.
"""

import base64
import hashlib
import hmac
import os
import re
from dataclasses import dataclass

STEP_SECONDS = 10
GRACE_SECONDS = 1.0
MAX_SCAN_SKEW_SECONDS = 5.0
CLOCK_SEARCH_STEPS = 60  # +-10 minutes, only to explain a rejection

KEY_ENV = "ATTENDANCE_CODE_KEY"

FORMAT_VERSION = 0  # 2 bits: 0-3
TYPE_CHECKIN = 0  # 4 bits: 0-15
TYPE_ELECTRICAL_INVENTORY = 1  # reserved; nothing makes or accepts these yet

HEADER_DIGITS = 2
NUMBER_DIGITS = 4
TAG_DIGITS = 18
MAX_CODE_NUMBER = 10**NUMBER_DIGITS - 1
_CODE_RE = re.compile(rf"^(\d{{{HEADER_DIGITS}}})(\d{{{NUMBER_DIGITS}}})(\d{{{TAG_DIGITS}}})$")

# LEGACY-16-DIGIT: codes from app builds before the header (4-digit number +
# 12-digit tag, 14x14 symbol). Only recognized to tell the member to update.
# Delete in the next update; see NEXT_UPDATE_CLEANUP.md.
_LEGACY_RE = re.compile(r"^\d{16}$")


@dataclass(frozen=True)
class ParsedCode:
    version: int
    kind: int
    code_number: int
    tag: str


def header(version: int, kind: int) -> str:
    if not (0 <= version <= 3 and 0 <= kind <= 15):
        raise ValueError("version is 2 bits and type is 4 bits")
    return f"{version << 4 | kind:0{HEADER_DIGITS}d}"


def _server_key() -> bytes:
    key = os.environ.get(KEY_ENV)
    if not key:
        raise RuntimeError(f"{KEY_ENV} not set")
    return key.encode()


def member_secret(member_id: str, code_version: int) -> bytes:
    return hmac.new(_server_key(), f"member-code|{member_id}|{code_version}".encode(), hashlib.sha256).digest()


def secret_b64(secret: bytes) -> str:
    return base64.urlsafe_b64encode(secret).rstrip(b"=").decode()


def tag_for(secret: bytes, head: str, code_number: int, step: int) -> str:
    digest = hmac.new(secret, f"SSID3|{head}|{code_number:04d}|{step}".encode(), hashlib.sha256).digest()
    return f"{int.from_bytes(digest[:8], 'big') % 10**TAG_DIGITS:0{TAG_DIGITS}d}"


def code_for(secret: bytes, code_number: int, step: int, kind: int = TYPE_CHECKIN) -> str:
    head = header(FORMAT_VERSION, kind)
    return head + f"{code_number:04d}" + tag_for(secret, head, code_number, step)


def parse(raw: str) -> ParsedCode | None:
    """A code in the current format, else None (other text, unknown version)."""
    m = _CODE_RE.match(raw.strip())
    if not m:
        return None
    packed = int(m.group(1))
    if packed > 63 or packed >> 4 != FORMAT_VERSION:
        return None
    return ParsedCode(packed >> 4, packed & 0xF, int(m.group(2)), m.group(3))


def is_legacy(raw: str) -> bool:
    """LEGACY-16-DIGIT: a code from an app build too old to show the header."""
    return bool(_LEGACY_RE.match(raw.strip()))


def accepted_steps(scanned_at: float) -> list[int]:
    step = int(scanned_at // STEP_SECONDS)
    steps = [step]
    if scanned_at - step * STEP_SECONDS < GRACE_SECONDS:
        steps.append(step - 1)
    return steps


def _tag_matches(parsed: ParsedCode, secret: bytes, step: int) -> bool:
    head = header(parsed.version, parsed.kind)
    return hmac.compare_digest(tag_for(secret, head, parsed.code_number, step), parsed.tag)


def verify(parsed: ParsedCode, secret: bytes, scanned_at: float) -> bool:
    ok = False
    for step in accepted_steps(scanned_at):
        ok |= _tag_matches(parsed, secret, step)
    return ok


def clock_offset(parsed: ParsedCode, secret: bytes, scanned_at: float) -> int | None:
    """Seconds the phone's clock looks off by, if the tag matches a nearby step.

    Only used to word a rejection; a code is never accepted from this range.
    Positive means the phone is ahead.
    """
    base = int(scanned_at // STEP_SECONDS)
    for d in range(1, CLOCK_SEARCH_STEPS + 1):
        for step in (base + d, base - d):
            if _tag_matches(parsed, secret, step):
                return (step - base) * STEP_SECONDS
    return None
