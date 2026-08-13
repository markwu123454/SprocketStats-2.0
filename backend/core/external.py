import asyncio
import os
import time
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException


class ExternalAPICache:
    def __init__(self, base_url: str, ttl: int, headers: dict | None = None):
        self._base_url = base_url
        self._ttl = ttl
        self._headers = headers or {}
        self._cache: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def get(self, path: str, params: dict | None = None) -> Any:
        key = path + ("?" + urlencode(sorted(params.items())) if params else "")

        now = time.monotonic()
        cached = self._cache.get(key)
        if cached and now - cached[0] < self._ttl:
            return cached[1]

        if key not in self._locks:
            self._locks[key] = asyncio.Lock()

        async with self._locks[key]:
            now = time.monotonic()
            cached = self._cache.get(key)
            if cached and now - cached[0] < self._ttl:
                return cached[1]

            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(
                        self._base_url + path,
                        headers=self._headers,
                        params=params,
                        timeout=10.0,
                    )
                    resp.raise_for_status()
                    data = resp.json()
            except httpx.HTTPStatusError as e:
                raise HTTPException(status_code=e.response.status_code, detail=str(e))
            except httpx.RequestError as e:
                raise HTTPException(status_code=503, detail=f"External API unavailable: {e}")

            self._cache[key] = (time.monotonic(), data)
            return data


tba = ExternalAPICache(
    "https://www.thebluealliance.com/api/v3",
    ttl=30,
    headers={"X-TBA-Auth-Key": os.environ.get("TBA_API_KEY", "")},
)
nexus = ExternalAPICache(
    "https://frc.nexus/api/v1",
    ttl=15,
    headers={"Nexus-Api-Key": os.environ.get("NEXUS_API_KEY", "")},
)
statbotics = ExternalAPICache("https://api.statbotics.io/v3", ttl=300)
