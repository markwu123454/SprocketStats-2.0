from fastapi import APIRouter, Depends

import db
from .auth import get_current_user

router = APIRouter()


@router.get("/summary")
async def get_summary(_: dict = Depends(get_current_user)):
    rows = await db.get_labeling_summary()
    return [
        {
            "project_id":     r["project_id"],
            "project":        r["project"],
            "total_tasks":    r["total_tasks"],
            "labeled_tasks":  r["labeled_tasks"],
            "unlabeled_tasks": r["unlabeled_tasks"],
            "pct_labeled":    float(r["pct_labeled"]) if r["pct_labeled"] is not None else 0.0,
        }
        for r in rows
    ]


@router.get("/contributions")
async def get_contributions(_: dict = Depends(get_current_user)):
    rows = await db.get_annotator_contributions()
    emails = list({r["email"] for r in rows})
    users = await db.get_users_by_fields(email=emails)
    display_map = {u["email"]: u["display_name"] or u["given_name"] or "Unknown User" for u in users}
    return [
        {
            "project_id":       r["project_id"],
            "project":          r["project"],
            "user_id":          r["user_id"],
            "annotator":        display_map.get(r["email"]) or r["annotator"],
            "annotations_done": r["annotations_done"],
            "skipped":          r["skipped"],
            "avg_time_secs":    float(r["avg_time_secs"]) if r["avg_time_secs"] is not None else None,
        }
        for r in rows
    ]