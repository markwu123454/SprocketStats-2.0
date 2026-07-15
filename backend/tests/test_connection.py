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
