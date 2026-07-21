# Self-Hosting SprocketStats

SprocketStats is [AGPL-3.0-or-later](LICENSE) — any FRC team can run its own instance. This guide takes you from a fork to a working deployment.

Budget about **90 minutes** for a first run. Everything below fits in the free tier of each service.

> ### Talk to us first
>
> This guide is complete enough to get you running on your own.
>
> That said, **we'd genuinely like to hear from you before you start.** SprocketStats was built around one team's workflows, and most of what makes it useful to *your* team is in the parts this guide can't cover: which roles and subteams match your structure, what your scouting data actually looks like, how to brand it as your team's app rather than ours, and which of the rough edges we already know how to route around.
>
> We're also just glad to know someone's using it. Tell us what you're building, and we'll help you shape it to fit.
>
> **Mark Wu** — [me@markwu.org](mailto:me@markwu.org)
> **Team Sprocket (FRC 3473)** — open an issue or discussion on [the repository](https://github.com/markwu123454/SprocketStats-2.0)

---

## What you're deploying

| Piece | Runs on | Why                                                   |
| --- | --- |-------------------------------------------------------|
| Frontend (React + Vite PWA) | Vercel | Static build, global CDN                              |
| Backend (FastAPI) | Fly.io | Async API, always-on machine                          |
| Database (PostgreSQL) | Neon | Serverless Postgres, branch-per-environment           |
| Sign-in | Google Cloud Console | OAuth 2.0: members log in with school Google accounts |
| ML labeling | Label Studio | Scouting-data labeling pipeline                       |

The backend needs the database and Google OAuth to boot. Label Studio and web push can be stubbed out at first if you only want the team-ops features (attendance, meetings, members, notifications).

---

## Before you start

Create accounts on [Neon](https://neon.com), [Fly.io](https://fly.io), [Vercel](https://vercel.com), [Google Cloud Console](https://console.cloud.google.com), and [Label Studio](https://labelstud.io). Install the [Fly CLI](https://fly.io/docs/flyctl/install/) and the [Vercel CLI](https://vercel.com/docs/cli).

---

## 1. Fork and rename the Fly app

Fork the repo on GitHub, then clone your fork.

**Do this before anything else**, because Fly app names are globally unique, and the committed name is already taken:

```toml
# backend/fly.toml
app = 'sprocketstats'        # ← change to e.g. 'sprocketstats-1234'
primary_region = 'lax'       # ← change to your nearest region
```

Pick something with your team number in it. `flyctl platform regions` lists regions.

---

## 2. Neon database

Create a Neon project. From the dashboard, copy the **pooled** connection string, it looks like:

```
postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require
```

That's your `DATABASE_URL`. Use the pooled endpoint, not the direct one, the backend opens a connection pool of up to 20.

**You do not need to run any migrations.** The backend calls `init_db()` and `run_migrations()` on startup ([backend/main.py:85](backend/main.py:85)), and every statement is `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`. Tables appear on first boot.

If you want the Label Studio labeling pipeline, create a **second** Neon database and save its connection string as `DATABASE_URL_LABEL_STUDIO`. This one is currently optional, it's commented out of the required list in [backend/main.py:24](backend/main.py:24).

---

## 3. Google OAuth

In Google Cloud Console: create a project → **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID** → **Web application**.

Set the authorized redirect URI to your backend's callback:

```
https://<your-fly-app>.fly.dev/auth/callback
```

The path is `/auth/callback` — the auth router is mounted at `/auth` ([backend/endpoints/__init__.py:13](backend/endpoints/__init__.py:13)) and the callback route is named `callback` ([backend/endpoints/auth.py:43](backend/endpoints/auth.py:43)). It must match exactly, including `https://`.

Save the client ID and secret as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

If your team uses Google Workspace, restrict the consent screen to your school domain — otherwise anyone with a Google account can start the sign-up flow.

---

## 4. Label Studio

Deploy Label Studio (Docker, or Label Studio Cloud), then from **Account & Settings** copy your access token.

- `LABEL_STUDIO_URL` — base URL, no trailing slash (one is stripped anyway)
- `LABEL_STUDIO_TOKEN` — the access token
- `LABEL_STUDIO_PROJECT_ID` — numeric project id, defaults to `7`

These are read at import time in [backend/endpoints/label_studio_client.py](backend/endpoints/label_studio_client.py), so the backend **will not start** without `LABEL_STUDIO_URL` and `LABEL_STUDIO_TOKEN`. If you're not using labeling yet, point them at any reachable URL and a dummy token to get the rest of the app up.

---

## 5. Generate VAPID keys

Web push notifications need a VAPID keypair. With `pywebpush` already in the backend dependencies:

```bash
pip install py-vapid
vapid --gen
```

That writes `private_key.pem` / `public_key.pem`. Convert them to the URL-safe base64 strings the app expects, then set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Set `VAPID_CLAIM_EMAIL` to `mailto:you@yourteam.org` — it defaults to `mailto:admin@example.com`, which real push services may reject.

**Keep the private key secret and never rotate it casually**, every existing browser subscription is bound to the keypair and silently breaks if it changes.

---

## 6. Deploy the backend to Fly

From `backend/`:

```bash
flyctl launch --no-deploy      # reuses your edited fly.toml
```

Set every secret (this is one command, values are not echoed):

```bash
flyctl secrets set \
  DATABASE_URL="postgresql://..." \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  GOOGLE_CLIENT_ID="..." \
  GOOGLE_CLIENT_SECRET="..." \
  FRONTEND_URL="https://your-app.vercel.app" \
  CORS_ORIGIN="https://your-app.vercel.app" \
  LABEL_STUDIO_URL="https://..." \
  LABEL_STUDIO_TOKEN="..." \
  LABEL_STUDIO_PROJECT_ID="7" \
  VAPID_PUBLIC_KEY="..." \
  VAPID_PRIVATE_KEY="..." \
  VAPID_CLAIM_EMAIL="mailto:you@yourteam.org" \
  ENV="production"
```

`FRONTEND_URL` must have **no trailing slash**, it's concatenated directly into a redirect ([backend/endpoints/auth.py:60](backend/endpoints/auth.py:60)). `CORS_ORIGIN` must be the exact origin, scheme included.

You won't know the Vercel URL until step 7, use a placeholder, then re-run `flyctl secrets set` for those two afterward.

```bash
flyctl deploy
```

Check it: `flyctl logs`. A successful boot creates the tables and starts uvicorn on port 8000.

---

## 7. Deploy the frontend to Vercel

From `frontend/`:

```bash
vercel link
vercel env add VITE_BACKEND_URL production   # https://<your-fly-app>.fly.dev
vercel --prod
```

`VITE_BACKEND_URL` is the only frontend variable. It's baked in at **build time**, so changing it requires a redeploy, not just an env update.

Now go back and fix `FRONTEND_URL` / `CORS_ORIGIN` on Fly, and add the real callback URL in Google Cloud Console.

---

## 8. Wire up CI

The workflows in [.github/workflows](.github/workflows) auto-deploy on push to `main`, backend when `backend/**` changes, frontend when `frontend/**` changes. Add these under **Settings → Secrets and variables → Actions**:

| Secret | Where to get it |
| --- | --- |
| `FLY_API_TOKEN` | `flyctl tokens create deploy` |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| `VERCEL_PROJECT_ID` | `frontend/.vercel/project.json` after `vercel link` |
| `VERCEL_ORG_ID` | same file |

Both deploy workflows open a GitHub issue labeled `incident` when a deployment fails, so create that label or the step errors.

---

## 9. Seed your first admin

**Seeding the first admin is done directly in the database, by design.** SprocketStats ships with no default administrator and no bootstrap token, there are no credentials baked into the source for someone to look up. The tradeoff is that a fresh installation has nobody who can approve the first account, so you seed it yourself with SQL once.

Sign in through the app to create your user row. `captain` and `mentor` both carry `requires_approval: True` ([backend/core/permissions.py:54](backend/core/permissions.py:54)), and an unapproved account is rejected with `403 Account pending approval` ([backend/core/account_state.py:60](backend/core/account_state.py:60)), expected at this point.

Then, in the Neon SQL editor:

```sql
-- confirm your row exists after first sign-in
SELECT id, email, role, approved_by FROM users;

-- promote and self-approve
UPDATE users
SET role = 'captain',
    approved_by = id,
    onboarding_complete = true
WHERE email = 'you@yourteam.org';
```

Sign out and back in. You can now approve everyone else from the Members page.

Note that changing a user's role clears `approved_by` ([backend/db/users.py:176](backend/db/users.py:176)), an approval vouches for a specific role. If you change your own role later, you'll need this SQL again.

---

## Environment variable reference

**Backend** (Fly secrets).

`REQUIRED_ENV_VARS` ([backend/main.py:14](backend/main.py:14)) is the **warn list**, the set the app names on startup if unset. It is deliberately broader than the set the app cannot run without, so that a missing optional variable is visible in the logs instead of silent. The **If missing** column is what actually happens.

| Variable | Warned | If missing | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | startup fails when the pool is created | Neon **pooled** connection string |
| `SESSION_SECRET` | yes | process dies at import | random 32+ bytes |
| `JWT_SECRET` | yes | process dies at import | random 32+ bytes |
| `GOOGLE_CLIENT_ID` | yes | process dies at import | |
| `GOOGLE_CLIENT_SECRET` | yes | process dies at import | |
| `LABEL_STUDIO_URL` | yes | process dies at import | no trailing slash |
| `LABEL_STUDIO_TOKEN` | yes | process dies at import | |
| `CORS_ORIGIN` | in production | process dies at import | exact origin; unused when `ENV=development` |
| `FRONTEND_URL` | yes | **runs**, OAuth redirects to `None/...` | no trailing slash |
| `VAPID_PUBLIC_KEY` | yes | **runs**, web push broken | |
| `VAPID_PRIVATE_KEY` | yes | **runs**, web push broken | |
| `LABEL_STUDIO_PROJECT_ID` | yes | **runs**, defaults to `7` | |
| `VAPID_CLAIM_EMAIL` | no | **runs**, defaults to `mailto:admin@example.com` | push services may reject the default |
| `DATABASE_URL_LABEL_STUDIO` | no | **runs**, fails only on labeling queries | second Neon database |
| `ENV` | no | **runs** as production | `production` or `development` |

**Frontend** (Vercel): `VITE_BACKEND_URL`.

**GitHub Actions**: `FLY_API_TOKEN`, `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`.

---

## Troubleshooting

**Backend prints missing variables but keeps going.** That's deliberate. The startup check warns rather than exits ([backend/main.py:33](backend/main.py:33)) so that a missing *non-essential* variable doesn't put Fly into a crash-restart loop, you get a visible warning in `flyctl logs` and a running app. Treat the printed list as a checklist, not a fatal error.

Whether the app then survives depends on how each variable is read, see the **If missing** column above. Variables read as `os.environ["X"]` at module import raise `KeyError` and the process dies; ones read with `.get()` leave the app running with that feature broken. `DATABASE_URL` is its own case: it fails when the pool is first created during startup.

**`403 Account pending approval`.** Expected before seeding, see step 9.

**OAuth `redirect_uri_mismatch`.** The Google Console URI must exactly match `https://<fly-app>.fly.dev/auth/callback`, no trailing slash, `https` not `http`.

**CORS errors in the browser.** `CORS_ORIGIN` must be the exact Vercel origin. With `ENV=development` the backend allows all origins ([backend/main.py:110](backend/main.py:110)); in production it allows exactly one.

**Frontend calls `undefined/...`.** `VITE_BACKEND_URL` wasn't set at build time. Set it and redeploy.

**Push notifications never arrive.** Check `VAPID_CLAIM_EMAIL` is a real `mailto:`, and that the keypair hasn't changed since browsers subscribed.

---

## Your obligations under the AGPL

If you run a modified SprocketStats as a network service, **you must offer your users the complete source of your modified version** (AGPL §13), in practice, link your fork from the app. You must also preserve the attribution in [NOTICE](NOTICE) and mark your version as modified. See [Attribution](README.md#attribution).

Questions, or you got stuck somewhere this guide didn't cover: [me@markwu.org](mailto:me@markwu.org). Corrections welcome as PRs.
