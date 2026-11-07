"""Shared test setup.

A handful of modules read required config straight out of the environment at
*import* time -- not lazily, not via a fixture -- so it has to already be set
before any test module imports them, directly or transitively:

* ``core.security`` (``JWT_SECRET``) -- pulled in by anything under ``endpoints``.
* ``endpoints.auth`` (``GOOGLE_CLIENT_ID``/``GOOGLE_CLIENT_SECRET``) and
  ``endpoints.label_studio_client`` (``LABEL_STUDIO_URL``/``LABEL_STUDIO_TOKEN``)
  -- both get imported as a side effect of ``import endpoints`` (its
  ``__init__.py`` wires up every router), even for a test that only cares
  about one router, e.g. ``endpoints.tasks``.

None of these values are ever used to make a real network/DB call in the test
suite -- they just need to *exist* so the import doesn't raise ``KeyError``.
Pytest imports ``conftest.py`` before collecting test files in the same
directory, so setting these here at module scope (not inside a fixture)
guarantees they land before any such import.
"""

import os

os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-google-client-id")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-google-client-secret")
os.environ.setdefault("LABEL_STUDIO_URL", "http://localhost:0")
os.environ.setdefault("LABEL_STUDIO_TOKEN", "test-label-studio-token")
