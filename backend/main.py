import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

sys.tracebacklimit = 2

REQUIRED_ENV_VARS = [
    "SESSION_SECRET",
    "FRONTEND_URL",
    "JWT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "LABEL_STUDIO_URL",
    "LABEL_STUDIO_TOKEN",
    "LABEL_STUDIO_PROJECT_ID",
    "DATABASE_URL",
    #"DATABASE_URL_LABEL_STUDIO",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
]
if os.environ.get("ENV") != "development":
    REQUIRED_ENV_VARS.append("CORS_ORIGIN")

missing_env_vars = [var for var in REQUIRED_ENV_VARS if not os.environ.get(var)]
if missing_env_vars:
    print(f"Missing required environment variables: {', '.join(missing_env_vars)}")

import db
from core import account_state
from endpoints import router
from endpoints import label_studio_client

logger = logging.getLogger(__name__)

# How often each process reloads the ban/approval cache while the app is
# seeing meaningful traffic. Also the upper bound, during active use, on how
# long a ban/approval change takes to propagate across server processes.
ACCOUNT_STATE_REFRESH_SECONDS = 30
# Ceiling the refresh interval backs off to when request volume is low.
ACCOUNT_STATE_REFRESH_MAX_SECONDS = 7200  # 2 hours

# How often each process sweeps push_delivery_logs for rows stuck in 'sent'
# past their 10-minute timeout (see db.expire_stale_deliveries), while the
# app is seeing meaningful traffic.
PUSH_DELIVERY_SWEEP_SECONDS = 60
# Ceiling the sweep interval backs off to when request volume is low.
PUSH_DELIVERY_SWEEP_MAX_SECONDS = 21600  # 6 hours

# Below this many requests in a sleep window, a loop treats itself as idle
# and doubles its interval next time instead of resetting to the base rate.
IDLE_REQUEST_THRESHOLD = 5

# Running count of inbound HTTP requests, used by both loops below to judge
# how busy their last sleep window was. Updated by the _track_activity
# middleware; each loop keeps its own snapshot to diff against.
_request_count = 0


def _record_request():
    global _request_count
    _request_count += 1


async def _account_state_refresh_loop():
    """Reload the account-state cache, backing off when request volume is low.

    Runs for the life of the app. A failed refresh is logged and the previous
    snapshot is kept -- a transient DB blip must not wipe the cache or kill the
    loop. Interval resets to ACCOUNT_STATE_REFRESH_SECONDS whenever the app saw
    at least IDLE_REQUEST_THRESHOLD requests since the last tick, and otherwise
    doubles (up to ACCOUNT_STATE_REFRESH_MAX_SECONDS) each low-traffic tick.
    """
    interval = ACCOUNT_STATE_REFRESH_SECONDS
    last_count = _request_count
    while True:
        await asyncio.sleep(interval)
        try:
            await account_state.refresh()
        except Exception as e:
            logger.error("account_state refresh failed, keeping previous snapshot: %s", e)
        seen = _request_count - last_count
        last_count = _request_count
        if seen < IDLE_REQUEST_THRESHOLD:
            interval = min(interval * 2, ACCOUNT_STATE_REFRESH_MAX_SECONDS)
        else:
            interval = ACCOUNT_STATE_REFRESH_SECONDS


async def _push_delivery_sweep_loop():
    """Fail any push delivery still stuck 'sent' past its timeout, backing
    off when request volume is low.

    Runs for the life of the app, independent of the account-state refresh
    loop above. A failed sweep is logged and retried on the next tick -- a
    transient DB blip must not kill the loop. Same low-traffic backoff
    behavior as the refresh loop above, capped at PUSH_DELIVERY_SWEEP_MAX_SECONDS.
    """
    interval = PUSH_DELIVERY_SWEEP_SECONDS
    last_count = _request_count
    while True:
        await asyncio.sleep(interval)
        try:
            expired = await db.expire_stale_deliveries()
            if expired:
                logger.info("push delivery sweep: expired %d stale delivery(ies)", expired)
        except Exception as e:
            logger.error("push delivery sweep failed: %s", e)
        seen = _request_count - last_count
        last_count = _request_count
        if seen < IDLE_REQUEST_THRESHOLD:
            interval = min(interval * 2, PUSH_DELIVERY_SWEEP_MAX_SECONDS)
        else:
            interval = PUSH_DELIVERY_SWEEP_SECONDS


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init_db()
    await db.run_migrations()
    # Prime the cache before serving so the first request is a hit, not a miss.
    await account_state.refresh()
    refresh_task = asyncio.create_task(_account_state_refresh_loop())
    push_sweep_task = asyncio.create_task(_push_delivery_sweep_loop())
    yield
    refresh_task.cancel()
    push_sweep_task.cancel()
    await label_studio_client.aclose()
    await db.close_pool()

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=Path(__file__).parent), name="static")

app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET"],
    https_only=os.environ.get("ENV") == "production",
    same_site="lax",
)

if os.environ.get("ENV") == "development":
    cors_origins = ["*"]
else:
    cors_origins = [
        origin.strip()
        for origin in os.environ["CORS_ORIGINS"].split(",")
        if origin.strip()
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _track_activity(request, call_next):
    """Record that a request came in, so the idle-backoff loops above can
    judge how busy the app has been."""
    _record_request()
    return await call_next(request)


app.include_router(router)
