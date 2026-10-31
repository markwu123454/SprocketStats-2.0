---
category: Inputs
---

Checkbox — a themed checkbox with an indeterminate state, for selecting items in a list. Use via `window.SprocketStats.Checkbox`.

## Usage

`Checkbox` is **fully controlled**. Hold `checked` yourself and flip it from `onChange`,
which receives no arguments.

```jsx
<label className="flex items-center gap-2 text-sm theme-text">
  <Checkbox checked={selected} onChange={() => setSelected(v => !v)} />
  Include in this meeting
</label>
```

Use a toggle instead for a setting that applies immediately. Pass `aria-label` when no
visible `<label>` wraps the control.

## Props

- `checked` — whether the box is checked.
- `onChange()` — called when the user toggles it.
- `indeterminate` — shows a dash for "some selected", and overrides the check mark.
- `aria-label` — accessible name when there's no visible label.
- `className` — applied to the outer wrapper.

## Known gap

The visible box and its hit area are both 16px, below the 44px target in
`guidelines/design-system/accessibility.md`. Wrap it in a `<label>` so the text is also tappable.
