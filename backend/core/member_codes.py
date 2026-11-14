"""Rotating member codes: what a member's phone shows and a kiosk's camera reads.

A code is 16 digits: the member's 4-digit code number (``users.code_number``)
+ a 12-digit tag. The tag is the first 64 bits of
``HMAC-SHA256(member_secret, f"SSID2|{code_number:04d}|{step}")`` reduced mod
10^12 and zero-padded, where ``step = floor(unix_seconds / STEP_SECONDS)``.
Sixteen digits is exactly what a 14x14 Data Matrix holds, the smallest symbol
with room for a ~40-bit tag, so each module is as large as the phone screen
allows and a laptop webcam can read it from further away. Codes are only ever
checked online by an authorized kiosk, so 40 bits leaves guessing hopeless.

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
NUMBER_DIGITS = 4
TAG_DIGITS = 12
MAX_CODE_NUMBER = 10**NUMBER_DIGITS - 1
_CODE_RE = re.compile(rf"^(\d{{{NUMBER_DIGITS}}})(\d{{{TAG_DIGITS}}})$")


@dataclass(frozen=True)
class ParsedCode:
    code_number: int
    tag: str


def _server_key() -> bytes:
    key = os.environ.get(KEY_ENV)
    if not key:
        raise RuntimeError(f"{KEY_ENV} not set")
    return key.encode()


def member_secret(member_id: str, code_version: int) -> bytes:
    return hmac.new(_server_key(), f"member-code|{member_id}|{code_version}".encode(), hashlib.sha256).digest()


def secret_b64(secret: bytes) -> str:
    return base64.urlsafe_b64encode(secret).rstrip(b"=").decode()


def tag_for(secret: bytes, code_number: int, step: int) -> str:
    digest = hmac.new(secret, f"SSID2|{code_number:04d}|{step}".encode(), hashlib.sha256).digest()
    return f"{int.from_bytes(digest[:8], 'big') % 10**TAG_DIGITS:0{TAG_DIGITS}d}"


def code_for(secret: bytes, code_number: int, step: int) -> str:
    return f"{code_number:04d}" + tag_for(secret, code_number, step)


def parse(raw: str) -> ParsedCode | None:
    m = _CODE_RE.match(raw.strip())
    return ParsedCode(int(m.group(1)), m.group(2)) if m else None


def accepted_steps(scanned_at: float) -> list[int]:
    step = int(scanned_at // STEP_SECONDS)
    steps = [step]
    if scanned_at - step * STEP_SECONDS < GRACE_SECONDS:
        steps.append(step - 1)
    return steps


def verify(parsed: ParsedCode, secret: bytes, scanned_at: float) -> bool:
    ok = False
    for step in accepted_steps(scanned_at):
        ok |= hmac.compare_digest(tag_for(secret, parsed.code_number, step), parsed.tag)
    return ok


def clock_offset(parsed: ParsedCode, secret: bytes, scanned_at: float) -> int | None:
    """Seconds the phone's clock looks off by, if the tag matches a nearby step.

    Only used to word a rejection; a code is never accepted from this range.
    Positive means the phone is ahead.
    """
    base = int(scanned_at // STEP_SECONDS)
    for d in range(1, CLOCK_SEARCH_STEPS + 1):
        for step in (base + d, base - d):
            if hmac.compare_digest(tag_for(secret, parsed.code_number, step), parsed.tag):
                return (step - base) * STEP_SECONDS
    return None
