import asyncpg
import logging
from fastapi import HTTPException
from .connection import DB_NAME, get_db_connection, release_db_connection

logger = logging.getLogger(__name__)


async def get_labeling_summary() -> list[asyncpg.Record]:
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetch(
            """
            SELECT
                p.id                                                        AS project_id,
                p.title                                                     AS project,
                COUNT(DISTINCT t.id)                                        AS total_tasks,
                COUNT(DISTINCT t.id) FILTER (WHERE t.is_labeled = true)    AS labeled_tasks,
                COUNT(DISTINCT t.id) FILTER (WHERE t.is_labeled = false)   AS unlabeled_tasks,
                ROUND(
                    COUNT(DISTINCT t.id) FILTER (WHERE t.is_labeled = true)::numeric
                    / NULLIF(COUNT(DISTINCT t.id), 0) * 100, 1
                )                                                           AS pct_labeled
            FROM project p
            LEFT JOIN task t ON t.project_id = p.id
            WHERE p.deleted_at IS NULL
            GROUP BY p.id, p.title
            ORDER BY p.title
            """
        )
    except Exception as e:
        logger.error("get_labeling_summary failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch labeling summary")
    finally:
        await release_db_connection(pool, conn)


async def get_annotator_contributions() -> list[asyncpg.Record]:
    pool, conn = await get_db_connection(DB_NAME)
    try:
        return await conn.fetch(
            """
            SELECT
                p.id                                                AS project_id,
                p.title                                             AS project,
                u.id                                               AS user_id,
                u.first_name || ' ' || u.last_name                 AS annotator,
                u.email,
                COUNT(tc.id)                                        AS annotations_done,
                COUNT(tc.id) FILTER (WHERE tc.was_cancelled = true) AS skipped,
                ROUND(AVG(tc.lead_time)::numeric, 1)               AS avg_time_secs
            FROM task_completion tc
            JOIN project p ON p.id = tc.project_id
            JOIN htx_user u ON u.id = tc.completed_by_id
            WHERE p.deleted_at IS NULL
            GROUP BY p.id, p.title, u.id, u.first_name, u.last_name, u.email
            ORDER BY p.title, annotations_done DESC
            """
        )
    except Exception as e:
        logger.error("get_annotator_contributions failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch annotator contributions")
    finally:
        await release_db_connection(pool, conn)

__all__ = ["get_labeling_summary", "get_annotator_contributions"]