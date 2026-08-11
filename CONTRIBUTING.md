# Contributing

## IDE project setup

`.idea/` is gitignored on purpose — it holds per-machine state (interpreter paths, SDK
registry names, window layout) that shouldn't be shared. The two exceptions are the `.run/`
folders (portable run configurations) and `.idea/.name` (just the plain-text project display
name, sets the root project's name to `sprocketstats` in the IDE window/title regardless of
what folder you cloned the repo into). Everything else in `.idea/` regenerates locally the
first time your IDE opens the code, and the module name it lands on depends on **how** you
open it. Pick one of the two supported modes below and set it up accordingly — don't mix
them.

Naming, once set up correctly: the root project is `sprocketstats`, the backend module is
`backend` (from `backend/pyproject.toml`), the frontend module is `frontend` (from
`frontend/package.json`).

### Option A — one IDE at the repo root (recommended if you don't want to switch windows)

Open the repo root as a single project in **PyCharm Professional** (needed because it's the
only JetBrains IDE with both Python and JS/web support bundled — plain WebStorm can't run
the backend, and plain PyCharm Community can't run the frontend).

1. Open the repo root folder in PyCharm.
2. If PyCharm doesn't automatically prompt to attach `backend/pyproject.toml` and
   `frontend/package.json` as modules, add them manually: **File → Project Structure →
   Modules → + → Import Module**, once for `backend/pyproject.toml` and once for
   `frontend/package.json`.
3. Point the `backend` module's interpreter at `backend/.venv` (create it first if it
   doesn't exist yet — see backend setup below).
4. Run configs `backend: uvicorn` and `frontend: dev` (from `/.run/`) should now show up
   in the run configuration dropdown and work as-is.

### Option B — separate IDE windows per app

Open `backend/` and `frontend/` as two independent projects, each in whichever IDE fits
(PyCharm for `backend/`, PyCharm or WebStorm for `frontend/`).

1. Open `backend/` directly as a project root in PyCharm. It auto-imports from
   `backend/pyproject.toml` and names the module `backend`.
2. Open `frontend/` directly as a project root in PyCharm or WebStorm. It auto-imports
   from `frontend/package.json` and names the module `frontend`.
3. Run configs `uvicorn` (in `backend/.run/`) and `dev` (in `frontend/.run/`) work as-is
   in their respective windows.

### Why this matters

The two modes aren't interchangeable at the file level: a run config's `$PROJECT_DIR$`
macro resolves to whatever folder is the project root, so a path that's correct when
opened at the repo root (`$PROJECT_DIR$/backend/.env`) is wrong when `backend/` itself is
the project root (`$PROJECT_DIR$/.env`), and vice versa. That's why there are two sets of
run configs — `/.run/` for Option A, `backend/.run/` + `frontend/.run/` for Option B — and
why you shouldn't hand-edit one to match the other's expectations.

## Environment setup

- **Backend**: Python 3.11+, dependencies in `backend/pyproject.toml`. Create a venv inside
  `backend/` (`backend/.venv`) and install with `pip install -e ".[test]"` from `backend/`.
  Create `backend/.env` (gitignored, not committed) with the variables listed in
  [SELF_HOSTING.md § Environment variable reference](SELF_HOSTING.md#environment-variable-reference)
  — for local dev you generally only need `DATABASE_URL`, `SESSION_SECRET`, `JWT_SECRET`,
  `GOOGLE_CLIENT_ID`/`SECRET`, and `ENV=development`; the rest have safe defaults or only
  matter for features you're actively touching.
- **Frontend**: Node.js 24+, dependencies in `frontend/package.json`. Install with `npm ci`
  from `frontend/` (uses the committed `package-lock.json`).

## Before opening a PR

- Don't commit `.idea/` or any personal IDE state (it's gitignored for a reason — accidental
  commits of local interpreter names or absolute machine paths have happened before).
- If you touch a `.run/*.xml` file, check whether the same logical config exists in both
  `/.run/` and the per-app `.run/` folder, and keep both in sync using the path rules above.
