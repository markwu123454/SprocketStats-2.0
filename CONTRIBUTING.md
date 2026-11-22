# Contributing

## IDE project setup

The root `.gitignore` ignores the repo-root `.idea/`, which holds per-machine state
(interpreter paths, SDK registry names, window layout) that shouldn't be shared. The one
exception there is `.idea/.name`, the plain-text project display name, which sets the root
project's name to `sprocketstats` in the IDE window/title regardless of what folder you
cloned the repo into. Everything else in the root `.idea/` regenerates locally the first
time your IDE opens the code, and the module name it lands on depends on **how** you open
it. Pick one of the two supported modes below and set it up accordingly — don't mix them.

`backend/.idea/` and `frontend/.idea/` are different: they are the project settings for
Option B and are committed (module files, inspection profiles, and in `backend/` the SDK
name and database connections). Each has its own `.gitignore` that keeps per-user state
(`workspace.xml`, `shelf/`, `dataSources.local.xml`, and so on) out of git.

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
4. Run configs `backend: uvicorn`, `frontend: dev` and `frontend: dev:phone` (all from
   `/.run/`) should now show up in the run configuration dropdown and work as-is. The
   dropdown also lists `uvicorn`, `dev` and `dev:phone` from `backend/.run/` and
   `frontend/.run/`; those are for Option B and won't find their files here.

### Option B — separate IDE windows per app

Open `backend/` and `frontend/` as two independent projects, each in whichever IDE fits
(PyCharm for `backend/`, PyCharm or WebStorm for `frontend/`).

1. Open `backend/` directly as a project root in PyCharm. It picks up the committed
   `backend/.idea/` and names the module `backend`. The committed SDK name is
   `Python 3.11 (backend)`; point it at `backend/.venv`.
2. Open `frontend/` directly as a project root in PyCharm or WebStorm. It picks up the
   committed `frontend/.idea/` and names the module `frontend`.
3. Run config `uvicorn` (in `backend/.run/`) works as-is, and so do `dev` and `dev:phone`
   (in `frontend/.run/`).

### Why this matters

The two modes aren't interchangeable at the file level: a run config's `$PROJECT_DIR$`
macro resolves to whatever folder is the project root, so a path that's correct when
opened at the repo root (`$PROJECT_DIR$/backend/.env`) is wrong when `backend/` itself is
the project root (`$PROJECT_DIR$/.env`), and vice versa. The committed run configs are:

| File | Config name | Written for |
| --- | --- | --- |
| `.run/backend_ uvicorn.run.xml` | `backend: uvicorn` | Option A (`$PROJECT_DIR$/backend/.env`, runs in `$PROJECT_DIR$/backend`) |
| `.run/frontend_ dev.run.xml` | `frontend: dev` | Option A (`$PROJECT_DIR$/frontend/package.json`) |
| `.run/frontend_ dev_phone.run.xml` | `frontend: dev:phone` | Option A (`$PROJECT_DIR$/frontend/package.json`) |
| `backend/.run/uvicorn.run.xml` | `uvicorn` | Option B (`$PROJECT_DIR$/.env`) |
| `frontend/.run/dev.run.xml` | `dev` | Option B (`$PROJECT_DIR$/package.json`) |
| `frontend/.run/dev_phone.run.xml` | `dev:phone` | Option B (`$PROJECT_DIR$/package.json`) |

The rule: configs in the root `.run/` start their paths with `/backend` or `/frontend`, and
configs in `backend/.run/` or `frontend/.run/` don't. Both modes list every config, so each
window shows the other mode's configs too; they just won't work there. If one is wrong, fix
it in the file for its own mode rather than editing it to suit the window you have open
(`dev:phone` is for [testing on a phone](#testing-on-a-phone)).

## Environment setup

- **Backend**: Python 3.11+, dependencies in `backend/pyproject.toml`. Create a venv inside
  `backend/` (`backend/.venv`) and install with `pip install -e ".[test]"` from `backend/`.
  Run the tests with `pytest` from `backend/`; they need no database or `.env`. Create `backend/.env`
  (gitignored, not committed) with the variables listed in
  [SELF_HOSTING.md § Environment variable reference](SELF_HOSTING.md#environment-variable-reference).
  For local dev you generally need:
  - `DATABASE_URL`, `SESSION_SECRET`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`/`SECRET`, and
    `ENV=development`. With `ENV=development` the backend (and `seed_dev.py`) refuses to
    start unless the database's comment is `dev`, so dev sign-in can never reach a real
    database. Mark your dev database once with `COMMENT ON DATABASE <name> IS 'dev';`.
  - `LABEL_STUDIO_URL` and `LABEL_STUDIO_TOKEN`. The backend won't start without them,
    because they're read at import time; any URL and a dummy token will do if you aren't
    working on labeling.
  - Optionally `MOCK_EXTERNAL=true`, which replaces The Blue Alliance and FRC Nexus with
    canned data so event pages work without API keys or a network.

  The rest have safe defaults or only matter for features you're actively touching.
  `CORS_ORIGINS` isn't needed: with `ENV=development` the backend allows every origin.
- **Frontend**: Node.js 24+, dependencies in `frontend/package.json`. Install with `npm ci`
  from `frontend/` (uses the committed `package-lock.json`), and set `VITE_BACKEND_URL` in
  `frontend/.env` (gitignored), e.g. `VITE_BACKEND_URL=http://localhost:8000`.

## Testing on a phone

Use this for anything that only shows on a real phone, like the iOS keyboard pushing sheets
around. The phone opens the dev server on your computer over the network.

1. Start the backend as usual, with `ENV=development` in `backend/.env`.
2. Start the frontend in phone mode: `npm run dev:phone` from `frontend/`, or the
   `frontend: dev:phone` run config (`dev:phone` with `frontend/` open on its own). It's the normal dev server, except the app calls the API at `/api` on the dev
   server itself, which forwards to the backend at `127.0.0.1:8000` (set `DEV_BACKEND_URL`
   to change that). The phone can't reach `localhost:8000`, since that's the phone.
3. On the phone, open one of the `Network:` addresses Vite prints. Use the one on the same
   network as the phone: your Wi-Fi address, or the `100.x` address if both devices run
   Tailscale.
4. Tap **Dev sign-in** at the top of the login page and pick a user. Google sign-in doesn't
   work here, because Google only sends you back to `localhost` or a registered domain.

**Dev sign-in** lists every user in the dev database, including pending, banned and not-yet-
onboarded ones, so those screens can be tested too. It lives in
`backend/endpoints/dev_auth.py` and `frontend/src/components/DevSignIn.tsx`. The backend
only adds its routes with `ENV=development`, and production builds of the frontend leave it
out. It also works on your computer, if you don't want to use Google there.

**If the phone can't load the page**, Windows Firewall is probably blocking it. That
happens when Windows calls your Wi-Fi a **Public** network: either set the network to
Private (on a network you trust) and allow Node.js through the firewall on private networks,
or use Tailscale on both devices. School and guest Wi-Fi often stop devices from reaching
each other at all; Tailscale gets around that.

**What doesn't work over plain `http`:** the phone treats `http://192.168…` as insecure,
so the browser turns off what needs HTTPS: My code (it signs codes with Web Crypto), the
check-in scanner (camera), push notifications and the service worker. Everything else,
including sheets, forms and the keyboard, behaves as in production.

## Before opening a PR

- Don't commit personal IDE state: anything in the root `.idea/` besides `.name` (it's
  gitignored for a reason), or changes your IDE made to the committed files in
  `backend/.idea/` and `frontend/.idea/` that only record your machine, such as a
  different interpreter name or absolute paths. Accidental commits of both have happened
  before.
- If `frontend/.run/dev.run.xml` shows up in your diff, check its `package-json` path is
  still `$PROJECT_DIR$/frontend/package.json` before committing it.
- If you touch a backend run config, make the same change in both `/.run/` and
  `backend/.run/`, using the path rules above.
