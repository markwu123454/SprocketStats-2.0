import os
import re
import socket
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

import db
from endpoints import general, auth


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting up...")
    await db.init_db()
    await db.run_migrations()
    yield
    print("Shutting down...")
    await db.close_pool()


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=Path(__file__).parent), name="static")

with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
    s.connect(("8.8.8.8", 80))
    local_ip = s.getsockname()[0]

load_dotenv()

# SessionMiddleware must come before CORSMiddleware
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET"],
    https_only=os.environ.get("ENV") == "production",
    same_site="lax",
)

regex_patterns = []
for origin in [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]:
    if "*" in origin:
        escaped = re.escape(origin).replace(r"\*", ".*")
        regex_patterns.append(rf"^{escaped}$")
    else:
        regex_patterns.append(rf"^{re.escape(origin)}$")

combined_regex = "|".join(regex_patterns) if regex_patterns else None

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=combined_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(general.router)
app.include_router(auth.router, prefix="/auth")