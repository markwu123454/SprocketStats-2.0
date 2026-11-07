"""Tests for the pure guard logic in db.tasks.update_task -- the parts that
run before any database connection is touched. Same "provable with no live DB"
approach as test_connection.py.
"""

import pytest

from db.tasks import update_task


async def test_update_task_rejects_empty_fields():
    with pytest.raises(ValueError):
        await update_task("some-id", {})


async def test_update_task_rejects_unknown_column():
    with pytest.raises(ValueError):
        await update_task("some-id", {"not_a_real_column": "x"})


async def test_update_task_rejects_mix_of_known_and_unknown_columns():
    with pytest.raises(ValueError):
        await update_task("some-id", {"title": "ok", "sneaky": "nope"})
