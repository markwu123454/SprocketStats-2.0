"""Tests for the DB connection layer.

These run with no database available: they exercise the pure guard logic in
`_get_pool` that must fail *before* any network call. The point of this file is
to prove the CI test pipeline works end to end against real code — grow it with
higher-value cases (e.g. the connection-leak / pool-exhaustion test) as the
suite matures.
"""

import pytest

from db.connection import _DSN_ENV_VARS, DB_NAME, _get_pool


async def test_unknown_database_raises_value_error():
    # An unregistered db name must fail fast with a clear error and never try to
    # open a connection. Pure guard logic — no DB required.
    with pytest.raises(ValueError):
        await _get_pool("not_a_real_db")


async def test_known_database_without_dsn_raises_runtime_error(monkeypatch):
    # A registered db whose DSN env var is unset must raise, not silently try to
    # connect to nothing. Clearing the pool cache guarantees we hit the DSN check
    # rather than returning a pool a previous test may have created.
    monkeypatch.setattr("db.connection._pools", {})
    monkeypatch.delenv(_DSN_ENV_VARS[DB_NAME], raising=False)
    with pytest.raises(RuntimeError):
        await _get_pool(DB_NAME)


# --- ensure_dev_database: in development, the database must be marked 'dev' ---

from contextlib import asynccontextmanager  # noqa: E402

from db.connection import ensure_dev_database  # noqa: E402


def _fake_db_with_comment(monkeypatch, comment):
    """Swap db_connection for one whose fetchval returns `comment`; returns the call log."""
    calls = []

    class _Conn:
        async def fetchval(self, sql, *args):
            calls.append(sql)
            return comment

    @asynccontextmanager
    async def fake_db_connection(_db):
        yield _Conn()

    monkeypatch.setattr("db.connection.db_connection", fake_db_connection)
    return calls


async def test_dev_database_check_passes_when_marked_dev(monkeypatch):
    monkeypatch.setenv("ENV", "development")
    calls = _fake_db_with_comment(monkeypatch, "dev")
    await ensure_dev_database()
    assert "shobj_description" in calls[0]


async def test_dev_database_check_tolerates_surrounding_whitespace(monkeypatch):
    monkeypatch.setenv("ENV", "development")
    _fake_db_with_comment(monkeypatch, " dev\n")
    await ensure_dev_database()


@pytest.mark.parametrize("comment", [None, "", "prod", "Development", "dev database"])
async def test_dev_database_check_refuses_unmarked_database(monkeypatch, comment):
    # Development mode pointed at anything not marked exactly 'dev' (including a
    # database with no comment at all) must stop startup.
    monkeypatch.setenv("ENV", "development")
    _fake_db_with_comment(monkeypatch, comment)
    with pytest.raises(RuntimeError, match="isn't marked as a dev database"):
        await ensure_dev_database()


@pytest.mark.parametrize("env", ["production", None])
async def test_dev_database_check_skipped_outside_development(monkeypatch, env):
    # Production (or no ENV) never queries the comment, so it can't block a deploy.
    if env is None:
        monkeypatch.delenv("ENV", raising=False)
    else:
        monkeypatch.setenv("ENV", env)
    calls = _fake_db_with_comment(monkeypatch, None)
    await ensure_dev_database()
    assert calls == []
