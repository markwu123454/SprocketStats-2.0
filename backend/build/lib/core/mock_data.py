"""
Dev-only mock for TBA and Nexus external API calls.
Applied when MOCK_EXTERNAL=true in the environment.
Timestamps are computed at call time so the data stays "live" relative to now.
"""

import time
from typing import Any


# ── Static mock payloads ───────────────────────────────────────────────────────

FAKE_RANKINGS = {
    "rankings": [
        {"rank":  1, "team_key": "frc4414", "matches_played": 4, "record": {"wins": 4, "losses": 0, "ties": 0}, "sort_orders": [16.0, 185.3]},
        {"rank":  2, "team_key": "frc254",  "matches_played": 4, "record": {"wins": 4, "losses": 0, "ties": 0}, "sort_orders": [15.0, 179.2]},
        {"rank":  3, "team_key": "frc968",  "matches_played": 4, "record": {"wins": 4, "losses": 0, "ties": 0}, "sort_orders": [14.0, 172.8]},
        {"rank":  4, "team_key": "frc1678", "matches_played": 4, "record": {"wins": 3, "losses": 1, "ties": 0}, "sort_orders": [12.0, 168.5]},
        {"rank":  5, "team_key": "frc5199", "matches_played": 4, "record": {"wins": 3, "losses": 1, "ties": 0}, "sort_orders": [12.0, 162.1]},
        {"rank":  6, "team_key": "frc2767", "matches_played": 4, "record": {"wins": 3, "losses": 1, "ties": 0}, "sort_orders": [11.0, 158.4]},
        {"rank":  7, "team_key": "frc5026", "matches_played": 4, "record": {"wins": 3, "losses": 1, "ties": 0}, "sort_orders": [11.0, 155.2]},
        {"rank":  8, "team_key": "frc3476", "matches_played": 4, "record": {"wins": 3, "losses": 1, "ties": 0}, "sort_orders": [10.0, 148.7]},
        {"rank":  9, "team_key": "frc148",  "matches_played": 4, "record": {"wins": 2, "losses": 2, "ties": 0}, "sort_orders": [ 9.0, 145.3]},
        {"rank": 10, "team_key": "frc4910", "matches_played": 4, "record": {"wins": 2, "losses": 2, "ties": 0}, "sort_orders": [ 9.0, 141.8]},
        {"rank": 11, "team_key": "frc3538", "matches_played": 4, "record": {"wins": 2, "losses": 2, "ties": 0}, "sort_orders": [ 8.0, 139.2]},
        {"rank": 12, "team_key": "frc6995", "matches_played": 4, "record": {"wins": 2, "losses": 2, "ties": 0}, "sort_orders": [ 8.0, 136.5]},
        {"rank": 13, "team_key": "frc4481", "matches_played": 4, "record": {"wins": 2, "losses": 2, "ties": 0}, "sort_orders": [ 8.0, 132.1]},
        {"rank": 14, "team_key": "frc2910", "matches_played": 4, "record": {"wins": 2, "losses": 2, "ties": 0}, "sort_orders": [ 7.0, 128.4]},
        {"rank": 15, "team_key": "frc3473", "matches_played": 4, "record": {"wins": 2, "losses": 2, "ties": 0}, "sort_orders": [ 7.0, 124.6]},
        {"rank": 16, "team_key": "frc5818", "matches_played": 4, "record": {"wins": 2, "losses": 2, "ties": 0}, "sort_orders": [ 6.0, 121.3]},
        {"rank": 17, "team_key": "frc6036", "matches_played": 4, "record": {"wins": 2, "losses": 2, "ties": 0}, "sort_orders": [ 6.0, 118.9]},
        {"rank": 18, "team_key": "frc7777", "matches_played": 4, "record": {"wins": 1, "losses": 3, "ties": 0}, "sort_orders": [ 5.0, 115.2]},
        {"rank": 19, "team_key": "frc8888", "matches_played": 4, "record": {"wins": 1, "losses": 3, "ties": 0}, "sort_orders": [ 5.0, 112.7]},
        {"rank": 20, "team_key": "frc1111", "matches_played": 4, "record": {"wins": 1, "losses": 3, "ties": 0}, "sort_orders": [ 4.0, 109.5]},
        {"rank": 21, "team_key": "frc2222", "matches_played": 4, "record": {"wins": 1, "losses": 3, "ties": 0}, "sort_orders": [ 4.0, 106.2]},
        {"rank": 22, "team_key": "frc5857", "matches_played": 4, "record": {"wins": 1, "losses": 3, "ties": 0}, "sort_orders": [ 4.0, 103.8]},
        {"rank": 23, "team_key": "frc3333", "matches_played": 4, "record": {"wins": 1, "losses": 3, "ties": 0}, "sort_orders": [ 3.0, 100.1]},
        {"rank": 24, "team_key": "frc4444", "matches_played": 4, "record": {"wins": 1, "losses": 3, "ties": 0}, "sort_orders": [ 3.0,  97.4]},
        {"rank": 25, "team_key": "frc5555", "matches_played": 4, "record": {"wins": 0, "losses": 4, "ties": 0}, "sort_orders": [ 2.0,  94.8]},
        {"rank": 26, "team_key": "frc6666", "matches_played": 4, "record": {"wins": 0, "losses": 4, "ties": 0}, "sort_orders": [ 2.0,  92.1]},
        {"rank": 27, "team_key": "frc7157", "matches_played": 4, "record": {"wins": 0, "losses": 4, "ties": 0}, "sort_orders": [ 2.0,  89.5]},
        {"rank": 28, "team_key": "frc9012", "matches_played": 4, "record": {"wins": 0, "losses": 4, "ties": 0}, "sort_orders": [ 1.0,  86.2]},
    ]
}

FAKE_NEXUS_STATUS = {
    "nowQueuing": "Quals 15",
    "onDeck":     "Quals 16",
    "onField":    "Quals 14",
    "teamStatuses": {
        "3473": "Queued",
        "968":  "At Pit",
        "3476": "At Pit",
        "4414": "On Field",
        "254":  "On Field",
    },
}

FAKE_NEXUS_INSPECTION = {
    "3473": {"inspected": True,  "weight_lbs": 118.4},
    "968":  {"inspected": True},
    "3476": {"inspected": True},
    "4414": {"inspected": True},
    "254":  {"inspected": True},
    "1678": {"inspected": False},
    "5857": {"inspected": False},
}


def _build_matches(now: int) -> list[dict]:
    """Build match list relative to current Unix timestamp."""
    return [
        # ── PLAYED ────────────────────────────────────────────────────────────
        {
            "key": "2025casj_qm5", "comp_level": "qm", "set_number": 1, "match_number": 5,
            "alliances": {
                "red":  {"team_keys": ["frc3473", "frc1678", "frc2767"], "score": 82},
                "blue": {"team_keys": ["frc4910", "frc5818", "frc6036"], "score": 45},
            },
            "winning_alliance": "red",
            "scheduled_time": now - 7800, "predicted_time": now - 7800,
            "actual_time":    now - 7200, "post_result_time": now - 7100,
        },
        {
            "key": "2025casj_qm11", "comp_level": "qm", "set_number": 1, "match_number": 11,
            "alliances": {
                "red":  {"team_keys": ["frc148",  "frc3538", "frc5026"], "score": 61},
                "blue": {"team_keys": ["frc3473", "frc2910", "frc4481"], "score": 54},
            },
            "winning_alliance": "red",
            "scheduled_time": now - 3000, "predicted_time": now - 3000,
            "actual_time":    now - 2400, "post_result_time": now - 2300,
        },
        # ── UPCOMING ──────────────────────────────────────────────────────────
        {
            "key": "2025casj_qm17", "comp_level": "qm", "set_number": 1, "match_number": 17,
            "alliances": {
                "red":  {"team_keys": ["frc3473", "frc7157", "frc3476"], "score": -1},
                "blue": {"team_keys": ["frc4414", "frc254",  "frc1678"], "score": -1},
            },
            "winning_alliance": "",
            "scheduled_time": now + 900,  "predicted_time": now + 1080,
            "actual_time": None, "post_result_time": None,
        },
        {
            "key": "2025casj_qm23", "comp_level": "qm", "set_number": 1, "match_number": 23,
            "alliances": {
                "red":  {"team_keys": ["frc2767", "frc4481", "frc6036"], "score": -1},
                "blue": {"team_keys": ["frc3473", "frc968",  "frc5199"], "score": -1},
            },
            "winning_alliance": "",
            "scheduled_time": now + 2700, "predicted_time": now + 2880,
            "actual_time": None, "post_result_time": None,
        },
        {
            "key": "2025casj_qm31", "comp_level": "qm", "set_number": 1, "match_number": 31,
            "alliances": {
                "red":  {"team_keys": ["frc3473", "frc5857", "frc2910"], "score": -1},
                "blue": {"team_keys": ["frc6995", "frc148",  "frc3538"], "score": -1},
            },
            "winning_alliance": "",
            "scheduled_time": now + 5400, "predicted_time": now + 5760,
            "actual_time": None, "post_result_time": None,
        },
        {
            "key": "2025casj_qm38", "comp_level": "qm", "set_number": 1, "match_number": 38,
            "alliances": {
                "red":  {"team_keys": ["frc1678", "frc7157", "frc5026"], "score": -1},
                "blue": {"team_keys": ["frc3473", "frc4414", "frc6036"], "score": -1},
            },
            "winning_alliance": "",
            "scheduled_time": now + 9000, "predicted_time": now + 9360,
            "actual_time": None, "post_result_time": None,
        },
        {
            "key": "2025casj_qm45", "comp_level": "qm", "set_number": 1, "match_number": 45,
            "alliances": {
                "red":  {"team_keys": ["frc3473", "frc2767", "frc968"],  "score": -1},
                "blue": {"team_keys": ["frc3476", "frc5857", "frc5199"], "score": -1},
            },
            "winning_alliance": "",
            "scheduled_time": now + 12600, "predicted_time": now + 12960,
            "actual_time": None, "post_result_time": None,
        },
    ]


# ── Patch function ─────────────────────────────────────────────────────────────

def apply_mocks(tba, nexus, statbotics) -> None:
    """Monkey-patch ExternalAPICache instances to return fake data."""

    async def mock_tba_get(path: str, params: dict | None = None) -> Any:
        now = int(time.time())
        if "/matches" in path:
            return _build_matches(now)
        if "/rankings" in path:
            return FAKE_RANKINGS
        return {}

    async def mock_nexus_get(path: str, params: dict | None = None) -> Any:
        if "/inspection" in path:
            return FAKE_NEXUS_INSPECTION
        return FAKE_NEXUS_STATUS

    tba.get       = mock_tba_get
    nexus.get     = mock_nexus_get
    # statbotics not currently used in events endpoints; leave untouched
