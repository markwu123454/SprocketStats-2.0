import asyncio
import logging
import os
import time
from typing import Any

from fastapi import HTTPException
from label_studio_sdk import LabelStudio
from label_studio_sdk.core.api_error import ApiError

logger = logging.getLogger(__name__)

LABEL_STUDIO_URL = os.environ["LABEL_STUDIO_URL"].rstrip("/")
LABEL_STUDIO_TOKEN = os.environ["LABEL_STUDIO_TOKEN"]
LABEL_STUDIO_PROJECT_ID = int(os.environ.get("LABEL_STUDIO_PROJECT_ID", "7"))

_project_cache: dict[int, tuple[float, dict[str, Any]]] = {}
_PROJECT_TTL = 300.0  # seconds

_LS_CLIENT: LabelStudio | None = None

def _client() -> LabelStudio:
    global _LS_CLIENT
    if _LS_CLIENT is None:
        _LS_CLIENT = LabelStudio(base_url=LABEL_STUDIO_URL, api_key=LABEL_STUDIO_TOKEN)
    return _LS_CLIENT


async def get_project(project_id: int) -> dict[str, Any]:
    cached = _project_cache.get(project_id)
    if cached and time.time() - cached[0] < _PROJECT_TTL:
        return cached[1]

    client = _client()
    try:
        t0 = time.perf_counter()
        result = await asyncio.to_thread(client.projects.get, id=project_id)
        logger.info("LS projects.get=%.2fs", time.perf_counter() - t0)
        data = result.dict()
        _project_cache[project_id] = (time.time(), data)
        return data
    except ApiError as e:
        logger.error("projects.get(%s) failed: %s", project_id, e)
        raise HTTPException(status_code=502, detail="Label Studio request failed")


async def get_contributions(project_id: int) -> list[dict[str, Any]]:
    """
    Returns per-annotator rows with annotations_done, avg_time_secs, and the
    annotator's email (for the caller to resolve to a display name via the
    internal user DB — email must not be forwarded to the client).

    Uses two calls:
      - projects.stats.lead_time  → mean_time + sum_lead_time per user_id
      - projects.list_unique_annotators → user_id + email for DB lookup
    """
    client = _client()

    try:
        t_total = time.perf_counter()

        async def _lead_time():
            t0 = time.perf_counter()
            r = await asyncio.to_thread(client.projects.stats.lead_time, id=project_id)
            logger.info("LS lead_time=%.2fs", time.perf_counter() - t0)
            return r

        async def _annotators():
            t0 = time.perf_counter()
            r = await asyncio.to_thread(client.projects.list_unique_annotators, id=project_id)
            logger.info("LS list_unique_annotators=%.2fs", time.perf_counter() - t0)
            return r

        lead_time_resp, annotators = await asyncio.gather(_lead_time(), _annotators())
        logger.info("LS contributions total=%.2fs", time.perf_counter() - t_total)
    except ApiError as e:
        logger.error("contributions fetch for project %s failed: %s", project_id, e)
        raise HTTPException(status_code=502, detail="Label Studio request failed")

    # user_id → email, for internal DB display-name resolution
    email_map: dict[int, str] = {
        a.id: a.email
        for a in annotators
        if a.id is not None and a.email
    }

    rows = []
    for stat in (lead_time_resp.lead_time_stats or []):
        user_id = stat.user_id
        mean = stat.mean_time
        total = stat.sum_lead_time

        if user_id is None:
            continue

        annotations_done = round(total / mean) if mean else 0

        rows.append({
            "user_id":          user_id,
            "email":            email_map.get(user_id),   # resolve to display_name in router; never forward to client
            "annotations_done": annotations_done,
            "skipped":          0,  # skipping is disabled on this project
            "avg_time_secs":    round(mean, 1) if mean is not None else None,
        })

    rows.sort(key=lambda r: -r["annotations_done"])
    return rows
