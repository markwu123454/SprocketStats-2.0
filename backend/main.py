import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

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