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

import account_state
import db
from endpoints import router

logger = logging.getLogger(__name__)

# How often each process reloads the ban/approval cache. Also the upper bound on
# how long a ban/approval change takes to propagate across server processes.
ACCOUNT_STATE_REFRESH_SECONDS = 30

# How often each process sweeps push_delivery_logs for rows stuck in 'sent'
# past their 10-minute timeout (see db.expire_stale_deliveries).
PUSH_DELIVERY_SWEEP_SECONDS = 60


async def _account_state_refresh_loop():
    """Reload the account-state cache every ACCOUNT_STATE_REFRESH_SECONDS.

    Runs for the life of the app. A failed refresh is logged and the previous
    snapshot is kept -- a transient DB blip must not wipe the cache or kill the
    loop.
    """
    while True:
        await asyncio.sleep(ACCOUNT_STATE_REFRESH_SECONDS)
        try:
            await account_state.refresh()
        except Exception as e:
            logger.error("account_state refresh failed, keeping previous snapshot: %s", e)


async def _push_delivery_sweep_loop():
    """Fail any push delivery still stuck 'sent' past its timeout, every
    PUSH_DELIVERY_SWEEP_SECONDS.

    Runs for the life of the app, independent of the account-state refresh
    loop above. A failed sweep is logged and retried on the next tick -- a
    transient DB blip must not kill the loop.
    """
    while True:
        await asyncio.sleep(PUSH_DELIVERY_SWEEP_SECONDS)
        try:
            expired = await db.expire_stale_deliveries()
            if expired:
                logger.info("push delivery sweep: expired %d stale delivery(ies)", expired)
        except Exception as e:
            logger.error("push delivery sweep failed: %s", e)


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
    await db.close_pool()

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=Path(__file__).parent), name="static")

app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET"],
    https_only=os.environ.get("ENV") == "production",
    same_site="lax",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if os.environ.get("ENV") == "development" else [os.environ["CORS_ORIGIN"]],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
