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
    "DATABASE_URL_LABEL_STUDIO",
]
if os.environ.get("ENV") != "development":
    REQUIRED_ENV_VARS.append("CORS_ORIGIN")

missing_env_vars = [var for var in REQUIRED_ENV_VARS if not os.environ.get(var)]
if missing_env_vars:
    raise RuntimeError(f"Missing required environment variables: {', '.join(missing_env_vars)}")

import db
from endpoints import router

@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init_db()
    await db.run_migrations()
    yield
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
