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
