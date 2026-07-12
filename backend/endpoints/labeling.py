import asyncio
import logging
import time

from fastapi import APIRouter, Depends

import db
from core.security import get_current_user
from .label_studio_client import (
    LABEL_STUDIO_PROJECT_ID,
    get_contributions,
    get_project,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("")
async def get_labeling(_: dict = Depends(get_current_user)):
    t_total = time.perf_counter()
    project_id = LABEL_STUDIO_PROJECT_ID

    t0 = time.perf_counter()
    project, rows = await asyncio.gather(
        get_project(project_id),
        get_contributions(project_id),
    )
    logger.info("LS gather=%.2fs", time.perf_counter() - t0)

    total = project.get("task_number") or 0
    labeled = project.get("num_tasks_with_annotations") or 0
    unlabeled = max(total - labeled, 0)
    pct = round(labeled / total * 100, 1) if total else 0.0

    # Resolve emails → display names via internal user DB.
    # Emails come from Label Studio but must never be forwarded to the client.
    emails = [r["email"] for r in rows if r["email"]]

    t0 = time.perf_counter()
    users = await db.get_users_by_fields(email=emails)
    logger.info("DB get_users_by_fields=%.2fs (n=%d)", time.perf_counter() - t0, len(emails))

    display_map = {
        u["email"]: u["display_name"] or u["given_name"] or "Unknown User"
        for u in users
    }

    logger.info("labeling handler total=%.2fs", time.perf_counter() - t_total)

    return {
        "summary": {
            "project_id":      project["id"],
            "project":         project.get("title"),
            "total_tasks":     total,
            "labeled_tasks":   labeled,
            "unlabeled_tasks": unlabeled,
            "pct_labeled":     pct,
        },
        "contributions": [
            {
                "project_id":       project_id,
                "project":          project.get("title"),
                "user_id":          r["user_id"],
                "annotator":        display_map.get(r["email"], "Unknown User"),
                "annotations_done": r["annotations_done"],
                "skipped":          r["skipped"],
                "avg_time_secs":    r["avg_time_secs"],
            }
            for r in rows
        ],
    }
