import asyncio
import base64
import binascii
import json
import logging
import os
import time
from typing import Any

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

_raw_url = os.environ["LABEL_STUDIO_URL"].rstrip("/")
# The env value may omit the scheme (e.g. "app.humansignal.com"); httpx rejects a
# scheme-less URL, so default to https.
LABEL_STUDIO_URL = _raw_url if _raw_url.startswith(("http://", "https://")) else f"https://{_raw_url}"
LABEL_STUDIO_TOKEN = os.environ["LABEL_STUDIO_TOKEN"]
LABEL_STUDIO_PROJECT_ID = int(os.environ.get("LABEL_STUDIO_PROJECT_ID", "7"))

_project_cache: dict[int, tuple[float, dict[str, Any]]] = {}
_PROJECT_TTL = 300.0  # seconds

# Refresh the access token this many seconds before its JWT expiry to avoid racing
# the clock on in-flight requests.
_TOKEN_SKEW = 30.0

_http: httpx.AsyncClient | None = None
_http_lock = asyncio.Lock()

# Cached short-lived Bearer access token, minted from the refresh token (PAT).
_access_token: str | None = None
_access_exp: float = 0.0
_token_lock = asyncio.Lock()


async def _client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        async with _http_lock:
            if _http is None:
                _http = httpx.AsyncClient(timeout=60)
    return _http


async def aclose() -> None:
    """Close the shared HTTP client. Called on app shutdown."""
    global _http
    if _http is not None:
        await _http.aclose()
        _http = None


def _jwt_exp(token: str) -> float | None:
    """Return the `exp` claim (unix seconds) from a JWT, or None if it can't be read.

    Signature is not verified -- we only read our own token's expiry, matching the SDK.
    """
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = parts[1]
        payload += "=" * (-len(payload) % 4)  # restore base64 padding
        claims = json.loads(base64.urlsafe_b64decode(payload))
    except (ValueError, binascii.Error, json.JSONDecodeError):
        return None
    exp = claims.get("exp")
    return float(exp) if isinstance(exp, (int, float)) else None


def _looks_like_jwt(token: str) -> bool:
    """A refresh-token (PAT) is a JWT; a legacy token is not."""
    return _jwt_exp(token) is not None


async def _refresh_access_token() -> str:
    """Exchange the refresh token (PAT) for a short-lived access token, with caching."""
    global _access_token, _access_exp
    now = time.time()
    if _access_token and now < _access_exp - _TOKEN_SKEW:
        return _access_token

    async with _token_lock:
        now = time.time()
        if _access_token and now < _access_exp - _TOKEN_SKEW:
            return _access_token

        client = await _client()
        t0 = time.perf_counter()
        resp = await client.post(
            f"{LABEL_STUDIO_URL}/api/token/refresh/",
            json={"refresh": LABEL_STUDIO_TOKEN},
        )
        logger.info("LS token refresh=%.2fs", time.perf_counter() - t0)
        if resp.status_code != 200:
            logger.error("token refresh failed: %s %s", resp.status_code, resp.text[:200])
            raise HTTPException(status_code=502, detail="Label Studio request failed")

        access = resp.json().get("access")
        if not access:
            logger.error("token refresh response missing 'access'")
            raise HTTPException(status_code=502, detail="Label Studio request failed")

        _access_token = access
        _access_exp = _jwt_exp(access) or (now + 300)
        return access


async def _auth_header() -> dict[str, str]:
    if not _looks_like_jwt(LABEL_STUDIO_TOKEN):
        # Legacy self-hosted token: use it directly, no refresh dance.
        return {"Authorization": f"Token {LABEL_STUDIO_TOKEN}"}
    access = await _refresh_access_token()
    return {"Authorization": f"Bearer {access}"}


async def _get(path: str) -> Any:
    """GET an absolute API path and return the parsed JSON body.

    Refreshes the access token and retries once on 401; any other failure surfaces as a
    502 to the caller.
    """
    global _access_token
    client = await _client()
    url = f"{LABEL_STUDIO_URL}{path}"

    for attempt in (1, 2):
        try:
            resp = await client.get(url, headers=await _auth_header())
        except httpx.HTTPError as e:
            logger.error("GET %s failed: %s", path, e)
            raise HTTPException(status_code=502, detail="Label Studio request failed")

        if resp.status_code == 401 and attempt == 1 and _looks_like_jwt(LABEL_STUDIO_TOKEN):
            # Access token likely stale/revoked -- drop it and mint a fresh one.
            _access_token = None
            continue

        if 200 <= resp.status_code < 300:
            return resp.json()

        logger.error("GET %s -> %s %s", path, resp.status_code, resp.text[:200])
        raise HTTPException(status_code=502, detail="Label Studio request failed")


async def get_project(project_id: int) -> dict[str, Any]:
    cached = _project_cache.get(project_id)
    if cached and time.time() - cached[0] < _PROJECT_TTL:
        return cached[1]

    t0 = time.perf_counter()
    data = await _get(f"/api/projects/{project_id}/")
    logger.info("LS projects.get=%.2fs", time.perf_counter() - t0)
    _project_cache[project_id] = (time.time(), data)
    return data


async def get_contributions(project_id: int) -> list[dict[str, Any]]:
    """
    Returns per-annotator rows with annotations_done, avg_time_secs, and the
    annotator's email (for the caller to resolve to a display name via the
    internal user DB — email must not be forwarded to the client).

    Uses two calls:
      - stats/lead_time  → mean_time + sum_lead_time per user_id
      - annotators       → user_id + email for DB lookup
    """
    t_total = time.perf_counter()

    async def _lead_time():
        t0 = time.perf_counter()
        r = await _get(f"/api/projects/{project_id}/stats/lead_time")
        logger.info("LS lead_time=%.2fs", time.perf_counter() - t0)
        return r

    async def _annotators():
        t0 = time.perf_counter()
        r = await _get(f"/api/projects/{project_id}/annotators/")
        logger.info("LS list_unique_annotators=%.2fs", time.perf_counter() - t0)
        return r

    lead_time_resp, annotators = await asyncio.gather(_lead_time(), _annotators())
    logger.info("LS contributions total=%.2fs", time.perf_counter() - t_total)

    # user_id → email, for internal DB display-name resolution
    email_map: dict[int, str] = {
        a["id"]: a["email"]
        for a in annotators
        if a.get("id") is not None and a.get("email")
    }

    rows = []
    for stat in (lead_time_resp.get("lead_time_stats") or []):
        user_id = stat.get("user_id")
        mean = stat.get("mean_time")
        total = stat.get("sum_lead_time")

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
