# design-sync notes — SprocketStats

Project: `SprocketStats Design System` (`b8ac76b4-10f3-4073-b690-6e4bd7c7ea14`)
First sync: 2026-09-20. Scope chosen by the user: **UI primitives only**
(`src/components/ui/`) — `Dropdown` and `TimeWheel`.

## Repo shape — read this first

- `frontend/` is a **Vite application, not a library.** There is no library build,
  no package entry in `package.json`, and no `.d.ts` tree. `dist/` is an *app*
  bundle and is NOT the converter's input.
- Because of that the converter runs with an explicit `--entry`:
  **`.design-sync/entry.tsx`**, a committed file listing the public surface.
  The converter's own fallback (`export *` over every `src/` file) is unusable
  here — `Dropdown` is a **default export**, which `export *` does not re-export.
  **Adding a component to the sync means editing `entry.tsx` AND `componentSrcMap`.**
- `entry.tsx` also exports **`ThemeShell`**, which is design-sync-authored (it is
  not an app component). See "Theme scope" below.

## Build sequence

```sh
npx vite build -c .design-sync/vite.ds-css.config.ts      # cfg.buildCmd — makes the CSS
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules ./node_modules --entry ./.design-sync/entry.tsx --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle
```

The CSS step is **not** `npm run build`. See the next section for why.

## The CSS is a purpose-built stylesheet, not the app's

`cfg.cssEntry` points at `.design-sync/.cache/tw/ds.css`, compiled from the
committed **`.design-sync/ds.css`** by **`.design-sync/vite.ds-css.config.ts`**.

Why this exists: the app's own compiled CSS is Tailwind-purged down to the classes
the app happens to use. Utilities as ordinary as `grid-cols-2`, `col-span-2`,
`max-w-2xl` and `shadow-lg` were **absent** from it. A design agent building new
screens writes classes the app never needed, and each one would silently render as
nothing. `ds.css` re-imports `src/index.css` (still the single source of truth for
the season palettes and `theme-*` utilities) and adds an `@source inline(...)`
safelist of common layout/typography utilities. 40 KB → 56 KB.

- **`src/index.css` remains authoritative.** `ds.css` never redefines app styling.
- `ds.css` also `@source`s `.design-sync/previews`, so authored preview cards can
  use utilities the app doesn't — without that, previews can go silently unstyled.
- If a future design needs a utility that still isn't there, add it to the
  safelist in `ds.css` and re-run the CSS build.

## Theme scope — the one thing that breaks everything

Every component reads `--theme-*` custom properties that exist **only** inside a
`.theme-2025` / `.theme-2026` / `.theme-2027` scope. Rendered outside one, a
component has no colors at all.

- In the app, `src/contexts/themeProvider.tsx` puts the class on `<html>` and
  persists it to localStorage; `DEFAULT_THEME` is `theme-2027`.
- For previews and for designs, `cfg.provider` is **`ThemeShell`** (in
  `entry.tsx`), which applies the class to a plain element and paints
  `--theme-bg`/`--theme-text`. The theme CSS is class-scoped, not `:root`-scoped,
  so either placement works. `ThemeShell` defaults to `theme-2027` to match the app.
- If previews ever come back unstyled, check `cfg.provider` first.

## Known render warns

Re-syncs should treat these as expected, not new:

- **`[TOKENS_MISSING]`** — `--scrollbar-track-radius`, `--scrollbar-thumb-radius`,
  `--scrollbar-corner`, `--scrollbar-corner-radius`. These are optional knobs of
  the `tailwind-scrollbar` plugin that the app never opts into; its own
  `.theme-scrollbar` rule sets `border-radius: 9999px` explicitly. No visual
  impact. Deliberately **not** given invented values.

## Per-component findings

- **`Dropdown` is not used anywhere in the app** (only `SimpleDropdown`, a
  separate inline component in `OnboardingShared.tsx`, is). There was no usage to
  port, so its preview was composed from the component source, with the trigger
  styling idiom taken from `SimpleDropdown`.
- **`Dropdown`'s open menu cannot be previewed.** `open` is internal state with no
  controlling prop, so a static render only ever shows the closed trigger. The menu
  styling (`--theme-bg` ground, `--theme-text-contrast` selected row, check mark)
  is therefore **unverified by screenshot** — the menu's described appearance in
  `.design-sync/docs/Dropdown.md` was read off the source, not confirmed visually.
- **Props are hand-written.** With no `.d.ts` tree, extraction produced empty
  `[key: string]: unknown` interfaces — useless as an agent-facing contract. Real
  bodies live in `cfg.dtsPropsFor`. **If either component's props change, update
  `dtsPropsFor` by hand** — nothing will catch the drift automatically.
- Both use `cardMode: column`: their stories are wider than a grid cell and get
  cropped otherwise (`[GRID_OVERFLOW]` fired for TimeWheel; Dropdown's clipping was
  caught by eye on the contact sheet, not by the checker).
- Grouping: both sit under `inputs/`, set via `category:` frontmatter in
  `.design-sync/docs/*.md`. Without it they land in `general` (`components/` and
  `ui/` are both "generic" dir names to the converter).

## Re-sync risks — what can silently go stale

- **`dtsPropsFor` is a hand-maintained copy of the real prop types.** This is the
  most likely thing to rot. Diff it against the component sources on every re-sync.
- **`.design-sync/entry.tsx` is a hand-maintained export list.** New components in
  `src/components/ui/` will NOT appear until added there.
- **The docs in `.design-sync/docs/` are hand-written** and describe behavior
  (TimeWheel's 6:00 AM–11:55 PM range, Dropdown's `triggerClassName` contract).
  If the components change, these become confidently wrong.
- **`conventions.md` enumerates class names** verified against the built CSS on
  2026-09-20. Re-validate them after any change to `ds.css` or `src/index.css`.
- The safelist in `ds.css` is a **guess at what designs will need**, not a complete
  Tailwind build. Absent utilities fail silently.
- Assumed toolchain: node v24.18.0, npm, Tailwind v4 via `@tailwindcss/vite`,
  React 19. The render check used playwright's bundled chromium.
- Only `theme-2027` was visually verified. `theme-2025` and `theme-2026` render
  from the same token structure but were not screenshotted for every cell.
