---
category: Inputs
---

Dropdown — a controlled select with a custom popover menu, keyboard navigation, and an optional drag-to-resize menu. Use via `window.SprocketStats.Dropdown`.

## Usage

`Dropdown` is **fully controlled**: it never holds the selected value itself. Pass `value` and update it from `onChange`.

```jsx
const options = [
  { value: 'red', label: 'Red Alliance' },
  { value: 'blue', label: 'Blue Alliance' },
]

<Dropdown
  value={alliance}
  options={options}
  onChange={setAlliance}
  triggerClassName="px-3 py-2 rounded-lg border theme-border theme-text"
/>
```

## Styling contract

The trigger ships **no visual styling of its own** — it only lays out its content
(`flex items-center justify-between gap-2 w-full`). Every border, padding, radius
and color comes from the `triggerClassName` you pass. A `Dropdown` rendered without
`triggerClassName` looks like unstyled text with a chevron; that is by design, so the
same component can sit in a toolbar, a card header, or a form row.

The **menu** styles itself from the season theme (`var(--theme-bg)`,
`var(--theme-text)`, `var(--theme-text-contrast)`, `var(--theme-button-bg)`) and must
therefore render inside a `.theme-2025` / `.theme-2026` / `.theme-2027` scope.

## Behavior

- Menu width always matches the trigger width exactly.
- Opening the menu scrolls the selected option to the vertical center.
- Keyboard: `Enter` / `Space` / `ArrowDown` / `ArrowUp` open it; arrows move the
  highlight, `Enter` selects, `Escape` closes.
- Clicking outside closes it.
- The trigger is disabled automatically when `options` is empty.
- The selected option shows a check mark and uses `--theme-text-contrast`.

## Props

- `value` — the selected option's `value`. No match renders `placeholder`.
- `options` — `{ value, label }[]`.
- `onChange(value)` — called with the chosen option's `value`.
- `disabled` — disables the trigger and prevents opening.
- `placeholder` — shown when nothing matches `value`. Default `"Select…"`.
- `className` — applied to the positioning root (which is `relative`).
- `triggerClassName` — **the styling hook for the trigger.** See above.
- `menuAlign` — `"left"` (default) or `"right"`; which edge the menu aligns to.
- `resizable` — adds a drag handle at the menu's bottom edge (clamped 120–600px).
- `initialMaxHeight` — menu max height in px when not resizable. Default `256`.
- `searchable` — adds a fuzzy-search box at the top of the menu. Default `false`;
  when off, the component renders and behaves exactly as it always has. See below.
- `searchPlaceholder` — placeholder for that box. Default `"Search…"`.
- `label` — title shown in the mobile modal's header (see "Mobile behavior"
  below). Optional; the header row is omitted entirely when unset. Has no
  effect on desktop.
- `defaultOpen` — mount with the menu already open. Default `false`.
- `onOpenChange(open)` — fires on every open/close, including a dismissal with
  no selection. See "Reveal-a-picker flows".

## Reveal-a-picker flows

When a `Dropdown` appears *because* the user just clicked something ("+ Add
contributor", "Change owner"), mounting it closed makes them click twice to
reach the options. Pass `defaultOpen` so the first click lands in the list, and
pair it with `onOpenChange` so dismissing without choosing takes the picker back
down:

```jsx
{adding ? (
  <Dropdown
    value="" options={people} onChange={v => { add(v); setAdding(false) }}
    searchable defaultOpen
    onOpenChange={open => { if (!open) setAdding(false) }}
  />
) : (
  <button onClick={() => setAdding(true)}>+ Add</button>
)}
```

Without the `onOpenChange` half, dismissing leaves a *closed* picker sitting
there — which costs the same second click the pattern exists to remove.

## Searchable menus

`searchable` is for pickers backed by a list that grows with the team — the task
board's "Assign to" / "Owner" / add-contributor / who-filter dropdowns all set it.
Leave it off for short fixed lists (status, priority, subteam); a search box over
four options is just noise.

When on, the menu gets a text input (autofocused on open) that filters the options
through `fuzzyFilter` from `@/lib/fuzzyMatch`. Matching is tiered — exact, prefix,
word-start, initials (`js` → "John Smith"), substring, then subsequence — with
shorter labels winning ties, so the best match is always first. The query clears
every time the menu opens or closes, arrows/Enter/Escape keep working from inside
the input, and a query that matches nothing shows a muted "No matches" row rather
than collapsing the menu.

## Mobile behavior

Below the app's shared 768px breakpoint, an **open** `Dropdown` renders its menu
as a centered "bubble" modal (via `createPortal` to `document.body`) instead of
an anchored popover — scrim behind it, a card with an optional header (`label`
as the title, plus a close button), the search box when `searchable`, and a
scrollable option list with rows at least 44px tall. The card tracks the visual
viewport (`--real-vh`) so an open on-screen keyboard can't cover it. It closes on
choosing an option, the close button, tapping the scrim, or `Escape`. This is
automatic — no prop opts a `Dropdown` into it — and desktop/tablet rendering is
completely unaffected.

## Flip-up

The anchored (desktop/non-modal) menu measures the trigger when it opens and, if
there isn't room below for it but there is above, anchors itself upward from the
trigger's top edge instead of downward from its bottom edge. This is automatic
and applies to every `Dropdown`, including ones placed low on a page.
