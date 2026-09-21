---
category: Inputs
---

TimeWheel — a drag-to-set time picker with momentum scrolling that snaps to 5-minute slots. Use via `window.SprocketStats.TimeWheel`.

## Usage

`TimeWheel` is **fully controlled** and speaks 24-hour `"HH:MM"` strings, while
displaying 12-hour time with an AM/PM suffix.

```jsx
<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
  <TimeWheel label="Clock in" value={clockIn} onChange={setClockIn} />
  <TimeWheel label="Clock out" value={clockOut} onChange={setClockOut} />
</div>
```

Use it wherever a start/end time is entered — attendance clock in/out, the admin
meeting-hours editor — so the scroll physics stay identical across the app.

## Behavior

- Range is fixed: **6:00 AM to 11:55 PM in 5-minute steps.** Values outside that
  range are clamped; it is not a general-purpose time input.
- Drag with a pointer or scroll the wheel; releasing coasts with momentum and then
  eases into the nearest slot over ~240ms.
- `onChange` fires continuously as the wheel crosses each slot, not just on release —
  debounce downstream if that write is expensive.
- An external `value` change re-positions the wheel, but is ignored mid-interaction
  so it never fights the user's drag.
- Fixed height of **58px**; the component sizes itself and fills its container's width.

## Styling

Self-styling from the season theme — the field background is
`color-mix(in oklch, var(--theme-button-bg) 60%, transparent)` with a
`var(--theme-border)` border, and the slot text uses `theme-h1-color` /
`theme-subtext-color`. It must render inside a `.theme-2025` / `.theme-2026` /
`.theme-2027` scope. Pass no class names; wrap it in your own layout element to
control width.

## Props

- `label` — short tag pinned to the field's left edge, rendered uppercase by the
  component itself (e.g. `"Clock in"`, `"Clock out"`, `"Start"`, `"End"`).
- `value` — current time as 24-hour `"HH:MM"` (e.g. `"14:30"`).
- `onChange(v)` — called with the new 24-hour `"HH:MM"` string.
