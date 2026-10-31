# Motion

Motion explains where something came from. It never decorates.

| Token | Value | Use |
|---|---|---|
| `duration-fast` | 150ms | Hover, opacity, icon changes |
| `duration-base` | 200ms | Toggles, sheet and dialog exit |
| `duration-moderate` | 220ms | Sidebar collapse |
| `duration-slow` | 340ms | Sheet enter, drag settle |
| `ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | Resizes, menus, dialogs |
| `ease-sheet` | `cubic-bezier(0.32, 0.72, 0, 1)` | Sheet enter and settle |
| `ease-exit` (new) | `cubic-bezier(0.4, 0, 1, 1)` | Anything leaving the screen |

## By component

| Component | Web | Mobile |
|---|---|---|
| Menu | Fade and 4px slide, 150ms in, 100ms out | Sheet |
| Sheet | Not used | 340ms up with `ease-sheet`; 200ms down with `ease-exit` |
| Sheet during drag | Not used | Follows the finger with no transition |
| Dialog | Fade and scale from 95%, 200ms | Alert dialog: same |
| Scrim | Fade, same duration as its surface | Same |
| Snackbar | Slide and fade, 200ms | Same |
| Page change | None | None |

## Rules

- Animate `transform` and `opacity` only. The login sheet's `height` animation is an accepted exception, since its content reflows.
- Nothing above 400ms except looping progress.
- Exits are faster than entrances.
- A running transition never blocks interaction.

## Reduced motion

Add this globally to `src/index.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

Dragging still tracks the finger, since that's direct control. `TimeWheel` drops its coasting
and snaps at once.

## Decisions

- **A third curve is added.** Material 3 separates entering and exiting curves because an element
  leaving should accelerate away. The old doc allowed two, which left sheets exiting on a curve
  designed for arrival.
- **The sheet enter is fixed at 340ms,** in place of the 340 to 380 range. M3's emphasized enter
  is about 400ms, but these sheets open constantly, so slightly faster wins.
- **No page transitions.** The shell stays still and only the outlet changes, which already reads
  as continuous. Transitions would slow a heavily used tab bar.

## Migration

- Add the reduced-motion rule and the `TimeWheel` momentum check (`TimeWheel.tsx:131`).
- Add enter and exit animation to `EventEditSheet.tsx`, `MembersPage.tsx:808` and `TasksPageMobile.tsx:943`, which appear instantly today.
- Normalize the login sheet's 0.38s (`LoginPageMobile.tsx:263`) to 340ms.
