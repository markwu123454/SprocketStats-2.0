import os
import asyncio
import re
from itertools import takewhile
from typing import Set

import aiohttp
import logging
import base64
import json
from tqdm.asyncio import tqdm_asyncio

# === CONFIG ===
TBA_KEY = ""
HEADERS = {"X-TBA-Auth-Key": TBA_KEY}
BASE_URL = "https://www.thebluealliance.com/api/v3"
OUT_DIR = "team_icons"
TEAM_NAMES_JSON = "team_names.json"
EVENT_NAMES_JSON = "event_names.json"
MAX_SIZE = 65536  # bytes
CURRENT_YEAR = 2025
CONCURRENCY = 25

os.makedirs(OUT_DIR, exist_ok=True)

# === LOGGING ===
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("tba_fetch")


# === CORE FUNCTIONS ===

async def fetch_json(session, url):
    try:
        async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=10)) as r:
            if r.status != 200:
                return None
            return await r.json()
    except Exception as e:
        log.warning(f"Fetch failed {url}: {e}")
        return None


async def get_all_teams(session):
    """Fetch all teams from TBA paginated /teams/{page} endpoint."""
    teams = []
    page = 0
    while True:
        log.info(f"Fetching team page {page} ...")
        data = await fetch_json(session, f"{BASE_URL}/teams/{page}")
        if not data:
            log.info("No more teams.")
            break
        teams.extend(data)
        page += 1
    log.info(f"Total teams fetched: {len(teams)}")
    return teams

import re

def shorten_event_name(name: str) -> str:
    """
    Produce a shortened event name using only regex:
      - FIRST Robotics District Competition / FIRST Robotics District → 'Districts'
      - Remove 'Regional' and 'Event'
      - If the second word is 'District', drop the first two words
      - Remove: 'presented', 'sponsored', 'co-sponsored', 'co-sponsored',
               '(Cancelled)' and everything after them
      - If the outcome is empty, return the input unmodified
    """

    original = name  # for fallback

    # Tier collapse / exact replacement
    name = re.sub(
        r"(?i)\bFIRST\s+Robotics\s+District\s+Competition\b|\bFIRST\s+Robotics\s+District\b",
        "Districts",
        name,
    )

    # Drop banned tokens (stand-alone words Regional, Event)
    name = re.sub(r"\b(?:Regional|Event)\b", "", name)

    # If 2nd word is 'District', drop first two words
    name = re.sub(r"(?i)^(\S+\s+District\b\s*)", "", name, count=1)

    # Truncate at sponsor/cancel keywords and drop the rest
    name = re.sub(
        r"(?i)\b(presented|sponsored|co-sponsored|\(Cancelled\)).*$",
        "",
        name,
    )

    # Collapse extra whitespace produced by removals
    name = re.sub(r"\s{2,}", " ", name).strip()

    # Fallback if empty
    return name if name else original




async def get_all_events(session):
    """Fetch all events from TBA for all years up to CURRENT_YEAR."""
    event_map = {}
    for year in range(1992, CURRENT_YEAR + 1):
        log.info(f"Fetching events for {year}...")
        data = await fetch_json(session, f"{BASE_URL}/events/{year}")
        if not data:
            continue
        for evt in data:
            key = evt.get("key")
            full = evt.get("name")
            if key and full:
                short = shorten_event_name(full)
                event_map[key] = {
                    "full": full,
                    "short": short
                }

    # Inject test events before returning
    event_map["2025test"] = {
        "full": "2025 Test Event",
        "short": "Test"
    }
    event_map["2026test"] = {
        "full": "2026 Test Event",
        "short": "Test"
    }

    log.info(f"Total events collected: {len(event_map)}")
    return event_map



async def get_team_image(session, team_key):
    """Fetch avatar or fallback image for one team."""
    media_url = f"{BASE_URL}/team/{team_key}/media/{CURRENT_YEAR}"
    media = await fetch_json(session, media_url)
    if not media:
        return None

    # Priority 1: avatar base64
    for item in media:
        if item.get("type") == "avatar":
            details = item.get("details", {})
            if "base64Image" in details:
                try:
                    img = base64.b64decode(details["base64Image"])
                    if len(img) <= MAX_SIZE:
                        return img
                    else:
                        log.info(f"Skipped {team_key} ({len(img)/1024:.1f} KB > {MAX_SIZE/1024:.1f} KB)")
                except Exception as e:
                    log.error(f"Decode error for {team_key}: {e}")
                return None

    # Priority 2: preferred imgur direct_url
    for item in media:
        if item.get("type") == "imgur" and item.get("direct_url"):
            try:
                async with session.get(item["direct_url"]) as r:
                    if r.status == 200:
                        data = await r.read()
                        if len(data) <= MAX_SIZE:
                            return data
                        else:
                            log.info(f"Skipped {team_key} imgur ({len(data)/1024:.1f} KB > {MAX_SIZE/1024:.1f} KB)")
            except Exception as e:
                log.warning(f"Imgur fetch failed {team_key}: {e}")
            break

    return None


async def process_team(sem, session, team, existing_files):
    team_key = team["key"]
    team_num = team_key[3:]  # "frcXXXX"
    out_path = os.path.join(OUT_DIR, f"{team_num}.png")

    if team_num in existing_files:
        # Skip immediately, no HTTP call
        return False

    async with sem:
        img = await get_team_image(session, team_key)
        if not img:
            return False

        try:
            with open(out_path, "wb") as f:
                f.write(img)
            log.info(f"Saved {out_path} ({len(img)} bytes)")
            return True
        except Exception as e:
            log.error(f"Write failed {team_num}: {e}")
            return False


async def main():
    # Pre-scan output directory for already downloaded icons
    existing_files = {
        os.path.splitext(f)[0]
        for f in os.listdir(OUT_DIR)
        if f.lower().endswith(".png")
    }
    log.info(f"Found {len(existing_files)} existing icons; skipping them.")

    async with aiohttp.ClientSession() as session:

        # === Fetch teams ===
        '''
        teams = await get_all_teams(session)

        # === Save team names ===
        team_name_map = {
            str(t["team_number"]): t.get("nickname") or t.get("name") or "Unknown"
            for t in teams
        }
        with open(TEAM_NAMES_JSON, "w", encoding="utf-8") as f:
            json.dump(team_name_map, f, indent=2, ensure_ascii=False)
        log.info(f"Saved {len(team_name_map)} team names to {TEAM_NAMES_JSON}")'''

        # === Fetch & save all event names ===
        event_name_map = await get_all_events(session)
        with open(EVENT_NAMES_JSON, "w", encoding="utf-8") as f:
            json.dump(event_name_map, f, indent=2, ensure_ascii=False)
        log.info(f"Saved {len(event_name_map)} event names to {EVENT_NAMES_JSON}")

        # === Download team icons ===
        '''
        sem = asyncio.Semaphore(CONCURRENCY)
        tasks = [process_team(sem, session, t, existing_files) for t in teams]
        results = await tqdm_asyncio.gather(*tasks, desc="Downloading icons")
        saved = sum(results)
        '''
        # === Summary ===
        log.info("=== SUMMARY ===")

        v = locals()
        log.info(f"Teams processed: {len(v.get('teams', []))}")
        log.info(f"Already present: {len(v.get('existing_files', []))}")
        log.info(f"Images saved:    {v.get('saved', 0)}")
        log.info(f"Images skipped:  {len(v.get('teams', [])) - v.get('saved', 0) - len(v.get('existing_files', []))}")



if __name__ == "__main__":
    if not TBA_KEY:
        raise ValueError(f"TBA key is empty")

    asyncio.run(main())
