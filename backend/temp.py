"""
TBA endpoint latency benchmark — measures raw (cache-miss) latency.
The backend already has a 30s in-memory cache (core/external.py), so this
tells you what each cache miss actually costs.

Usage: python tba_bench.py [event_key]
       e.g. python tba_bench.py 2025casj
TBA_API_KEY must be in the environment.
"""

import asyncio
import os
import statistics
import sys
import time

import dotenv
import httpx

dotenv.load_dotenv()

TBA_BASE  = "https://www.thebluealliance.com/api/v3"
TBA_KEY   = os.environ["TBA_API_KEY"]
EVENT_KEY = sys.argv[1] if len(sys.argv) > 1 else "2025cass"
TEAM_KEY  = "frc3473"
RUNS      = 5

DB_LOW, DB_HIGH = 100, 150  # ms — known round-trip baseline

HEADERS = {"X-TBA-Auth-Key": TBA_KEY}

ENDPOINTS = [
    ("status (sanity check)",     "/status"),
    ("event info",                f"/event/{EVENT_KEY}"),
    ("event matches",             f"/event/{EVENT_KEY}/matches"),
    ("event rankings",            f"/event/{EVENT_KEY}/rankings"),
    ("team matches at event",     f"/team/{TEAM_KEY}/event/{EVENT_KEY}/matches"),
]

# What the app fetches in parallel when opening the Comp/Overview page
PARALLEL_SET = [
    ("matches",   f"/team/{TEAM_KEY}/event/{EVENT_KEY}/matches"),
    ("rankings",  f"/event/{EVENT_KEY}/rankings"),
]


def measure(client: httpx.Client, path: str) -> list[float]:
    times = []
    for _ in range(RUNS):
        start = time.perf_counter()
        r = client.get(f"{TBA_BASE}{path}", headers=HEADERS)
        times.append((time.perf_counter() - start) * 1000)
        if r.status_code not in (200, 304):
            print(f"  WARNING {r.status_code}: {path}")
    return times


async def parallel_fetch(paths: list[tuple[str, str]]) -> float:
    async with httpx.AsyncClient(headers=HEADERS, timeout=10.0) as client:
        start = time.perf_counter()
        await asyncio.gather(*[
            client.get(f"{TBA_BASE}{path}") for _, path in paths
        ])
        return (time.perf_counter() - start) * 1000


def report(label: str, times: list[float]):
    avg = statistics.mean(times)
    med = statistics.median(times)
    lo, hi = min(times), max(times)
    flag = "✓" if avg < DB_HIGH else ("~" if avg < 300 else "✗ slow")
    print(f"  {label:<35} avg {avg:5.0f}ms  med {med:5.0f}ms  [{lo:.0f}–{hi:.0f}ms]"
          f"  comp-day ~{avg*1.5:.0f}–{avg*2:.0f}ms  {flag}")


def main():
    print(f"\nTBA latency benchmark  (cache-miss cost)")
    print(f"Event: {EVENT_KEY}   Team: {TEAM_KEY}   Runs: {RUNS}")
    print(f"DB baseline: {DB_LOW}–{DB_HIGH}ms\n")

    print("── Per-endpoint ──────────────────────────────────────────────────────────────")
    with httpx.Client(timeout=10.0) as client:
        for label, path in ENDPOINTS:
            report(label, measure(client, path))

    print()
    print("── Parallel fetch (matches + rankings — what Comp page does on load) ─────────")
    wall_times = [asyncio.run(parallel_fetch(PARALLEL_SET)) for _ in range(RUNS)]
    avg_wall = statistics.mean(wall_times)
    print(f"  wall time: avg {avg_wall:.0f}ms  [{min(wall_times):.0f}–{max(wall_times):.0f}ms]")
    print(f"  comp-day est: ~{avg_wall*1.5:.0f}–{avg_wall*2:.0f}ms")
    print()
    print("  Note: backend cache (ttl=30s) means users only hit raw TBA on the first")
    print("  request per 30s window. Comp-day figure matters most for that first hit.")
    print()
    if avg_wall * 1.5 > 400:
        print("  ⚠  Comp-day wall time looks high — consider bumping cache TTL or")
        print("     pre-warming on event start.")
    else:
        print("  ✓  30s cache should be sufficient; cold requests are within tolerance.")


if __name__ == "__main__":
    main()
