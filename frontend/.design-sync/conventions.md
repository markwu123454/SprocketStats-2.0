# Building with the SprocketStats UI kit

SprocketStats is a scouting/attendance app for FRC Team Sprocket. Its look is driven
entirely by a **season theme**: one of three palettes (`theme-2025` REEFSCAPE,
`theme-2026` REBUILT, `theme-2027` BIOCORE) supplies every color in the app.

## Always wrap in a season theme scope — this is not optional

Every component reads its colors from `--theme-*` custom properties, and those are
defined **only** inside a `.theme-2025` / `.theme-2026` / `.theme-2027` scope. A
component rendered outside one gets no colors at all: transparent backgrounds,
invisible borders, default-black text on whatever is behind it.

Wrap the tree in `ThemeShell` (exported from the bundle alongside the components):

```jsx
const { ThemeShell, Dropdown, TimeWheel } = window.SprocketStats

<ThemeShell season="theme-2027">
  {/* everything you build goes in here */}
</ThemeShell>
```

`season` defaults to `theme-2027`, which is the app's own default. `ThemeShell`
paints `--theme-bg` and `--theme-text` and fills its container, so it doubles as
the page ground — you rarely need your own background color.

If you need the scope without the shell's padding/background, any element with the
class works: `<div className="theme-2027">…</div>`. The theme CSS is class-scoped,
not `:root`-scoped. (In the app itself the class is applied to `<html>` by
`src/contexts/themeProvider.tsx`.)

## Styling idiom: Tailwind v4 utilities + the `theme-*` family

Layout and spacing use ordinary Tailwind v4 utilities (`flex`, `grid`, `gap-4`,
`rounded-lg`, `px-3`, `py-2.5`, `text-sm`). **All color comes from this exact
family** — never hard-code a hex value, and never use Tailwind's own palette
(`bg-slate-800`, `text-gray-500`), because those don't change with the season:

| Class | Effect |
|---|---|
| `theme-bg` | `background-color: var(--theme-bg)` — panel/surface ground |
| `theme-border` | `border-color: var(--theme-border)` — pair with `border` |
| `theme-text` | body text |
| `theme-h1-color` | headings and emphasized text |
| `theme-subtext-color` | secondary / muted text |
| `theme-text-contrast` | accent — links, selected state |
| `theme-button-bg` / `theme-button-hover` | button surfaces |
| `theme-bg-page` | the season's full-bleed background image |
| `theme-scrollbar` | themed scrollbar on a scroll container |
| `theme-season-name` / `theme-season-tag` | injects the season name/tag as `::before` |

For values Tailwind can't express, use the custom properties directly:
`--theme-bg`, `--theme-border`, `--theme-text`, `--theme-h1-color`,
`--theme-subtext-color`, `--theme-text-contrast`, `--theme-button-bg`,
`--theme-button-hover`, `--theme-bg-page`, plus `--scrollbar-track`,
`--scrollbar-thumb`, `--scrollbar-thumb-hover`. Blending is idiomatic here, e.g.
`color-mix(in oklch, var(--theme-button-bg) 60%, transparent)`.

## Where the truth lives

- `_ds/<folder>/styles.css` and the `_ds_bundle.css` it imports — every class and
  token above, as actually shipped. Read it before inventing a class name.
- `components/inputs/<Name>/<Name>.prompt.md` — per-component usage, behavior and
  prop notes. `<Name>.d.ts` is the exact prop contract.

## Component notes

**`Dropdown` ships no trigger chrome of its own.** It only lays out the trigger's
contents; the border, padding, radius and colors must come from `triggerClassName`.
Omit it and the control looks like bare text with a chevron. It is fully
controlled — hold `value` yourself and update it from `onChange`.

**`TimeWheel`** is self-styling and fixed at 58px tall, spanning its container's
width. It handles 24-hour `"HH:MM"` strings but only covers **6:00 AM–11:55 PM in
5-minute steps**, so don't reach for it as a general time input.

## An idiomatic example

```jsx
<ThemeShell season="theme-2027">
  <div className="flex flex-col gap-2" style={{ width: 280 }}>
    <label className="text-sm font-semibold theme-h1-color">
      What's your role on Team Sprocket?
    </label>
    <Dropdown
      value={role}
      onChange={setRole}
      options={[
        { value: 'build', label: 'Build' },
        { value: 'scouting', label: 'Scouting' },
      ]}
      triggerClassName="rounded-lg border px-3 py-2.5 text-sm transition theme-bg theme-border theme-text"
    />
  </div>
</ThemeShell>
```
