"""Discord announcements for newly scheduled meetings.

Posts to a Discord channel webhook and pings one role (the team's @member
role) when a meeting -- or a recurring series -- is created from the Control
Panel. A recurring series is a single message, never one ping per date.

Configuration (both required; unset means "off", so dev and tests stay quiet):

  * ``DISCORD_MEETING_WEBHOOK_URL`` -- Server Settings > Integrations >
    Webhooks > Copy Webhook URL. Treat it as a secret: anyone holding it can
    post to the channel.
  * ``DISCORD_MEMBER_ROLE_ID`` -- the numeric id of the role to ping
    (Developer Mode on, right-click the role > Copy Role ID).

``FRONTEND_URL``, when set, adds a link to the Meetings page.

Sending is fire-and-forget: a slow or failing Discord never delays or fails
creating the meeting; problems are logged.
"""

import logging
import os
import re
from datetime import datetime

import httpx

from core.push_notify import TEAM_TZ, fire_and_forget

logger = logging.getLogger(__name__)

WEBHOOK_ENV = "DISCORD_MEETING_WEBHOOK_URL"
ROLE_ENV = "DISCORD_MEMBER_ROLE_ID"
DISCORD_TIMEOUT = httpx.Timeout(10.0)
DISCORD_MAX_CONTENT = 2000

# Day gap between occurrences -> how a uniform series is described.
_CADENCE = {1: "daily", 7: "weekly", 14: "every 2 weeks"}


def _webhook_url() -> str | None:
    url = (os.environ.get(WEBHOOK_ENV) or "").strip()
    return url or None


def _role_id() -> str | None:
    role = (os.environ.get(ROLE_ENV) or "").strip()
    # Snowflake ids are digits only; anything else would break the mention.
    return role if role.isdigit() else None


def discord_configured() -> bool:
    return _webhook_url() is not None and _role_id() is not None


def _escape(text: str) -> str:
    """Neutralise Discord markdown in user-entered text (meeting names)."""
    return re.sub(r"([\\*_~`|>#\[\]()])", r"\\\1", text)


def _ts(dt: datetime, style: str) -> str:
    """Discord timestamp markup -- rendered in each reader's own timezone."""
    return f"<t:{int(dt.timestamp())}:{style}>"


def _time_range(start: datetime, end: datetime) -> str:
    # Same local day: "Tuesday, January 12, 2027 4:00 PM – 8:00 PM";
    # otherwise the end carries its own date.
    same_day = start.astimezone(TEAM_TZ).date() == end.astimezone(TEAM_TZ).date()
    return f"{_ts(start, 'F')} – {_ts(end, 't' if same_day else 'f')}"


def _cadence(starts: list[datetime]) -> str | None:
    days = {(b.astimezone(TEAM_TZ).date() - a.astimezone(TEAM_TZ).date()).days for a, b in zip(starts, starts[1:])}
    return _CADENCE.get(days.pop()) if len(days) == 1 else None


def meetings_created_message(meetings: list[dict], role_id: str, frontend_url: str | None = None) -> dict:
    """The webhook JSON body announcing ``meetings`` (one, or one series).

    ``meetings`` are rows with ``start_time``/``end_time`` (aware datetimes)
    and ``meeting_purpose``. Pure, so it's testable without Discord.
    """
    ordered = sorted(meetings, key=lambda m: m["start_time"])
    first, last = ordered[0], ordered[-1]
    name = _escape(first.get("meeting_purpose") or "Team meeting")
    mention = f"<@&{role_id}>"

    if len(ordered) == 1:
        lines = [f"{mention} New meeting: **{name}**. If you will be absent, click the link to report it.", _time_range(first["start_time"], first["end_time"])]
    else:
        cadence = _cadence([m["start_time"] for m in ordered])
        lines = [
            f"{mention} New {cadence + ' ' if cadence else ''}meetings: **{name}** · {len(ordered)} dates",
            f"First: {_time_range(first['start_time'], first['end_time'])}",
            f"Last: {_ts(last['start_time'], 'D')}",
        ]
    if frontend_url:
        lines.append(f"<{frontend_url.rstrip('/')}/meetings>")

    return {
        "content": "\n".join(lines)[:DISCORD_MAX_CONTENT],
        # Only this role may be pinged -- never @everyone/@here or a user,
        # whatever ends up in the meeting name.
        "allowed_mentions": {"parse": [], "roles": [role_id]},
    }


async def post_meetings_created(meetings: list[dict]) -> None:
    url, role = _webhook_url(), _role_id()
    if not url or not role or not meetings:
        return
    payload = meetings_created_message(meetings, role, os.environ.get("FRONTEND_URL"))
    try:
        async with httpx.AsyncClient(timeout=DISCORD_TIMEOUT) as client:
            response = await client.post(url, json=payload)
        if response.status_code >= 400:
            logger.warning("Discord meeting webhook returned %s: %s", response.status_code, response.text[:300])
    except httpx.HTTPError as e:
        logger.warning("Discord meeting webhook failed: %s", e)


def notify_meetings_created(meetings: list[dict]) -> None:
    """Announce new meeting(s) in the background; no-op when unconfigured."""
    if discord_configured() and meetings:
        fire_and_forget(post_meetings_created([dict(m) for m in meetings]))


__all__ = ["discord_configured", "meetings_created_message", "notify_meetings_created", "post_meetings_created"]
