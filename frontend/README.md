# SprocketStats frontend

The SprocketStats web app: React 19 + TypeScript, built with Vite, styled with Tailwind
CSS 4, and installable as a PWA. It talks to the FastAPI backend in `../backend`.

For the project overview see the [root README](../README.md); for deploying your own
instance see [SELF_HOSTING.md](../SELF_HOSTING.md); for IDE and environment setup see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Setup

Node.js 24+. From `frontend/`:

```sh
npm ci
echo "VITE_BACKEND_URL=http://localhost:8000" > .env   # gitignored
npm run dev
```

`VITE_BACKEND_URL` is the only environment variable. Vite bakes it in at build time, so
changing it means rebuilding.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR, also reachable from other devices on your network |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm test` | Vitest, once (CI runs this on every PR that touches `frontend/`) |
| `npm run lint` | ESLint |

## Layout

- `src/pages/`: one file per route. Screens with separate desktop and mobile layouts
  have `*Desktop.tsx`, `*Mobile.tsx` and a `*Router.tsx` that picks between them;
  `pages/control/` is the control panel and `pages/events/` the event hub.
- `src/components/`: shared components; `components/ui/` holds the primitives
  (`Button`, `Dropdown`, `Sheet`, `FormFooter`, ...).
- `src/lib/`: API clients, hooks and pure logic, with the unit tests beside them
  (`*.test.ts`).
- `src/contexts/`, `src/layouts/`: app-wide providers and the app shell.
- `public/seasons/<year>/`: each season's background art and wordmark. `public/teams/`:
  team icons plus team and event names, regenerated from The Blue Alliance by
  `public/teams/populate.py`.

`@/` is an alias for `src/`.

## Design system

UI rules live in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) and the per-topic files in
[design-system/](design-system/README.md). `.design-sync/` holds the setup for syncing the
UI primitives to the design tool; see [.design-sync/NOTES.md](.design-sync/NOTES.md).

## Deploying

Pushes to `main` that touch `frontend/**` deploy to Vercel through
`.github/workflows/deploy-frontend.yml`.
